import { describe, expect, test } from 'bun:test';
import type { AppUpdater } from 'electron-updater';
import type { UpdateState } from './bridge/update.ts';
import { createUpdater, describeUpdateError, UPDATE_INTERVAL_MS } from './updater.ts';

const fakeUpdater = () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const calls: string[] = [];
    const fake = {
        autoDownload: true,
        on: (event: string, listener: (...args: never[]) => void) => {
            listeners.set(event, listener);
            return fake;
        },
        checkForUpdates: async () => {
            calls.push('check');
            return null;
        },
        downloadUpdate: async () => {
            calls.push('download');
            return [];
        },
        quitAndInstall: () => {
            calls.push('install');
        }
    };
    const emit = (event: string, ...args: unknown[]): void => (listeners.get(event) as (...args: unknown[]) => void)(...args);
    return { updater: fake as unknown as AppUpdater, fake, emit, calls };
};

const setup = (packaged = true) => {
    const fake = fakeUpdater();
    const published: UpdateState[] = [];
    const intervals: { run: () => void; ms: number }[] = [];
    const logged: string[] = [];
    let beforeChecks = 0;
    const updater = createUpdater({
        currentVersion: '1.0.0',
        packaged,
        load: () => fake.updater,
        publish: (state) => void published.push(state),
        beforeCheck: () => void beforeChecks++,
        log: (message) => void logged.push(message),
        setInterval: (run, ms) => intervals.push({ run, ms })
    });
    return { ...fake, updater, published, intervals, logged, beforeChecks: () => beforeChecks };
};

describe('createUpdater', () => {
    test('a checkout stays unsupported and never loads the updater', () => {
        let loads = 0;
        const updater = createUpdater({
            currentVersion: '1.0.0',
            packaged: false,
            load: () => {
                loads++;
                return fakeUpdater().updater;
            },
            publish: () => {}
        });
        updater.start();
        expect(updater.state()).toEqual({ status: 'unsupported', currentVersion: '1.0.0' });
        expect(loads).toBe(0);
    });

    test('a packaged app starts idle and downloads nothing until the page says it may', () => {
        const { updater, fake, published } = setup();
        updater.start();
        expect(fake.autoDownload).toBe(false);
        expect(published).toEqual([{ status: 'idle', currentVersion: '1.0.0' }]);
        expect(updater.state().status).toBe('idle');
    });

    test('follows what the updater reports, and publishes every step', () => {
        const { updater, emit, published } = setup();
        updater.start();
        emit('checking-for-update');
        expect(updater.state().status).toBe('checking');
        emit('update-available', { version: '1.1.0' });
        expect(updater.state()).toMatchObject({ status: 'available', version: '1.1.0' });
        emit('download-progress', { percent: 40 });
        expect(updater.state()).toMatchObject({ status: 'downloading', percent: 40 });
        emit('update-downloaded', { version: '1.1.0' });
        expect(updater.state()).toMatchObject({ status: 'ready', version: '1.1.0', percent: 100 });
        expect(published.map((state) => state.status)).toEqual(['idle', 'checking', 'available', 'downloading', 'ready']);
    });

    test('nothing newer clears the version a check saw before', () => {
        const { updater, emit } = setup();
        updater.start();
        emit('update-available', { version: '1.1.0' });
        emit('update-not-available');
        expect(updater.state()).toMatchObject({ status: 'current', version: undefined });
    });

    test('an error keeps only its first line, beside a code the page words', () => {
        const { updater, emit } = setup();
        updater.start();
        emit('error', new Error('HttpError: 500\nset-cookie: secret'));
        expect(updater.state()).toMatchObject({ status: 'error', error: 'HttpError: 500', errorCode: 'failed' });
        emit('error', new Error('404 Not Found\nset-cookie: secret'));
        expect(updater.state()).toMatchObject({ status: 'error', error: '404 Not Found', errorCode: 'no-feed' });
        emit('checking-for-update');
        expect(updater.state()).toMatchObject({ status: 'checking', error: null, errorCode: null });
    });

    test('the first preference starts the hourly check, and a second one starts no second timer', async () => {
        const { updater, fake, intervals, calls, beforeChecks } = setup();
        updater.start();
        updater.configure(true);
        updater.configure(false);
        expect(fake.autoDownload).toBe(false);
        expect(intervals).toHaveLength(1);
        expect(intervals[0]!.ms).toBe(UPDATE_INTERVAL_MS);
        intervals[0]!.run();
        await Promise.resolve();
        expect(calls).toEqual(['check']);
        expect(beforeChecks()).toBe(1);
    });

    test('only true turns downloading on', () => {
        const { updater, fake } = setup();
        updater.start();
        updater.configure('yes');
        expect(fake.autoDownload).toBe(false);
        updater.configure(true);
        expect(fake.autoDownload).toBe(true);
    });

    test('a check waits while one runs, a download runs or a build is ready', async () => {
        const { updater, emit, calls } = setup();
        updater.start();
        for (const event of ['checking-for-update', 'download-progress', 'update-downloaded']) {
            emit(event, { version: '1.1.0', percent: 10 });
            await updater.check();
        }
        expect(calls).toEqual([]);
    });

    test('checks, downloads and installs through the updater', async () => {
        const { updater, calls, emit } = setup();
        updater.start();
        await updater.check();
        await updater.download();
        emit('update-downloaded', { version: '1.1.0' });
        expect(updater.install()).toBe(true);
        expect(calls).toEqual(['check', 'download', 'install']);
    });

    test('installs only a build that is ready', () => {
        const { updater, calls } = setup();
        updater.start();
        expect(updater.install()).toBe(false);
        expect(calls).toEqual([]);
    });

    test('says the app is about to quit, and that it stays when the install fails', () => {
        const quits: boolean[] = [];
        const fake = fakeUpdater();
        const updater = createUpdater({
            currentVersion: '1.0.0',
            packaged: true,
            load: () => fake.updater,
            publish: () => {},
            log: () => {},
            onQuit: (quitting) => void quits.push(quitting)
        });
        updater.start();
        fake.emit('update-downloaded', { version: '1.1.0' });
        updater.install();
        expect(quits).toEqual([true]);
        fake.emit('error', new Error('signature mismatch'));
        expect(quits).toEqual([true, false]);
        fake.emit('error', new Error('later'));
        expect(quits).toEqual([true, false]);
        fake.emit('update-downloaded', { version: '1.1.0' });
        fake.fake.quitAndInstall = () => {
            throw new Error('busy');
        };
        expect(updater.install()).toBe(false);
        expect(quits).toEqual([true, false, true, false]);
    });

    test('before it started, checking, downloading and installing do nothing', async () => {
        const { updater, calls, intervals } = setup();
        updater.configure(true);
        await updater.check();
        await updater.download();
        expect(updater.install()).toBe(false);
        expect(calls).toEqual([]);
        expect(intervals).toEqual([]);
    });

    test('a failed check or download is logged, not thrown', async () => {
        const { updater, fake, logged } = setup();
        updater.start();
        fake.checkForUpdates = async () => {
            throw new Error('offline');
        };
        fake.downloadUpdate = async () => {
            throw new Error('offline');
        };
        await updater.check();
        await updater.download();
        expect(logged).toEqual(['Update check failed', 'Update download failed']);
    });

    test('an updater that fails to load leaves the app as it is', () => {
        const published: UpdateState[] = [];
        const logged: string[] = [];
        const updater = createUpdater({
            currentVersion: '1.0.0',
            packaged: true,
            load: () => {
                throw new Error('missing');
            },
            publish: (state) => void published.push(state),
            log: (message) => void logged.push(message)
        });
        updater.start();
        expect(updater.state().status).toBe('unsupported');
        expect(published).toEqual([]);
        expect(logged).toEqual(['The updater did not start']);
    });
});

describe('describeUpdateError', () => {
    test('returns a code and the first line as it was, never a sentence of its own', () => {
        expect(describeUpdateError('')).toEqual({ code: 'failed', detail: null });
        expect(describeUpdateError('404 Not Found\nheaders')).toEqual({ code: 'no-feed', detail: '404 Not Found' });
        expect(describeUpdateError(`${'x'.repeat(250)}\nmore`)).toEqual({ code: 'failed', detail: `${'x'.repeat(200)}…` });
    });
});
