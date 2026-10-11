import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@adecore/agent-contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import type { TurnInput } from './backend.ts';
import { type ChatSessionOptions } from './chat-session.ts';
import { ClaudeProtocol } from './claude-protocol.ts';
import { info, flush, rig } from './chat-session.fixture.test.ts';

describe('a queue behind a usage limit', () => {
    test('an unknown reset preserves the queue without owing an automatic resume', async () => {
        let owed = 0;
        const run = rig({
            limitResume: {
                allowed: () => true,
                now: () => 1000,
                owe: async () => {
                    owed += 1;
                },
                lapse: async () => undefined,
                owed: () => false
            }
        });
        run.session.send('original');
        await flush();
        run.session.send('queued');
        run.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage' }, error: 'reset unknown' });
        await flush();
        expect(owed).toBe(0);
        expect(run.session.info.resumeAt).toBeUndefined();
        expect(run.session.info.queuePaused).toBe(true);
        expect(run.session.info.queue?.map((message) => message.text)).toEqual(['queued']);
        expect(run.sent.map((input) => input.text)).toEqual(['original']);
        expect(run.session.sendNow(run.session.info.queue![0]!.id)).toBe(true);
        await flush();
        expect(run.sent[1]?.text).toBe('queued');
        await run.session.dispose();
    });

    for (const allowed of [false, true]) {
        test(`waits across a restart with automatic resume ${allowed}`, async () => {
            let owed = 0;
            const hooks = {
                allowed: () => allowed,
                now: () => 1000,
                owe: async () => {
                    owed += 1;
                },
                lapse: async () => {
                    owed = 0;
                },
                owed: () => owed > 0
            };
            const first = rig({ limitResume: hooks });
            first.session.send('original');
            await flush();
            const limitedId = first.session.info.activeTurnId!;
            first.session.send('queued one');
            first.session.send('queued two');
            first.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage', resetsAt: 100000 }, error: 'limit' });
            await flush();
            expect(first.sent.map((input) => input.text)).toEqual(['original']);
            expect(first.session.info.queue?.map((message) => message.text)).toEqual(['queued one', 'queued two']);
            expect(first.session.info.resumeAt).toBe(allowed ? 100000 : undefined);
            const second = rig({ info: structuredClone(first.session.info), items: structuredClone(first.session.thread.list()), limitResume: hooks });
            second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
            second.session.settleOwedResume();
            await flush();
            expect(second.sent).toEqual([]);
            if (allowed) {
                expect(second.session.takeUpAfterLimit(limitedId)).toBe('opened');
                expect(second.session.takeUpAfterLimit(limitedId)).toBe('lapsed');
                await flush();
                expect(second.sent).toHaveLength(1);
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent[1]?.text).toBe('queued one');
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent[2]?.text).toBe('queued two');
            } else {
                expect(second.session.sendNow(second.session.info.queue![0]!.id)).toBe(true);
                await flush();
                expect(second.sent[0]?.text).toBe('queued one');
            }
            await first.session.dispose();
            await second.session.dispose();
        });
    }
});

describe('Stop while a turn is starting', () => {
    for (const stage of ['handshake', 'checkpoint']) {
        test(`stops without waiting for the ${stage} and ignores its late completion`, async () => {
            const checkpoint = Promise.withResolvers<string | null>();
            const blocked = rig(
                stage === 'checkpoint'
                    ? {
                          checkpoints: {
                              take: () => checkpoint.promise,
                              diff: async () => null,
                              settle: async () => null
                          }
                      }
                    : {},
                stage === 'handshake'
            );
            blocked.session.send('never send this');
            await flush();
            blocked.session.cancel();
            await flush();
            expect(blocked.stops()).toBe(1);
            expect(blocked.session.info.activeTurnId).toBeNull();
            expect(blocked.session.thread.list().find((item) => item.kind === 'turn')).toMatchObject({ state: 'aborted' });
            blocked.start.resolve();
            checkpoint.resolve('late-tree');
            await flush();
            expect(blocked.sent).toEqual([]);
            expect(blocked.session.info.status).toBe('idle');
            await blocked.session.dispose();
        });
    }

    test('warns about a stuck start without killing it or timing out an accepted turn', async () => {
        const clock = new ManualClock();
        const blocked = rig({ clock } as Partial<ChatSessionOptions>, true);
        blocked.session.send('go');
        clock.advance(60000);
        expect(blocked.session.thread.list().some((item) => item.kind === 'note' && item.level === 'warning')).toBe(true);
        expect(blocked.stops()).toBe(0);
        blocked.start.resolve();
        await flush();
        clock.advance(3600000);
        expect(blocked.stops()).toBe(0);
        expect(blocked.session.info.activeTurnId).not.toBeNull();
        await blocked.session.dispose();
    });

    test('a rejected handshake visibly fails the turn', async () => {
        const blocked = rig({}, true);
        blocked.session.send('go');
        blocked.start.reject(new Error('handshake refused'));
        await flush();
        expect(blocked.session.info.status).toBe('error');
        expect(blocked.session.thread.list().some((item) => item.kind === 'note' && item.text.includes('handshake refused'))).toBe(true);
        await blocked.session.dispose();
    });
});

describe('a queue after Stop or failure', () => {
    test('a message sent while the Stop acknowledgement is still arriving explicitly continues the queue', async () => {
        const run = rig();
        run.backend.interrupt = () => undefined;
        run.session.send('original');
        await flush();
        run.session.cancel();
        run.session.send('continue');
        expect(run.sent).toHaveLength(1);
        run.event({ type: 'turn.done', state: 'aborted', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'continue']);
        await run.session.dispose();
    });
    test('a CLI permission fallback updates and persists the effective mode without changing the selected one', async () => {
        let saves = 0;
        const run = rig({
            info: { ...info(), runtimeMode: 'auto' },
            persist: () => {
                saves += 1;
            }
        });
        run.session.send('go');
        await flush();
        run.event({ type: 'session', agentSessionId: 'sid', model: 'haiku', permissionMode: 'auto', effectiveRuntimeMode: 'auto' });
        const before = saves;
        run.event({ type: 'permissions', permissionMode: 'default', effectiveRuntimeMode: 'supervised' });
        expect(run.session.info).toMatchObject({ runtimeMode: 'auto', effectiveRuntimeMode: 'supervised', permissionMode: 'default' });
        expect(saves).toBeGreaterThan(before);
        await run.session.dispose();
    });
    for (const end of ['stop', 'error', 'exit'] as const) {
        test(`holds after ${end}, across reload, until an explicit send`, async () => {
            const first = rig();
            first.session.send('original');
            await flush();
            first.session.send('one');
            first.session.send('two');
            if (end === 'stop') {
                first.session.cancel();
            } else {
                first.event(end === 'exit' ? { type: 'exit', exitCode: 1 } : { type: 'turn.done', state: 'error', costUsd: 0, error: 'failed' });
            }
            await flush();
            expect(first.sent.map((input) => input.text)).toEqual(['original']);
            expect(first.session.info.queuePaused).toBe(true);
            const second = rig({ info: structuredClone(first.session.info), items: structuredClone(first.session.thread.list()) });
            second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
            await flush();
            expect(second.sent).toEqual([]);
            second.session.send('three');
            await flush();
            expect(second.sent.map((input) => input.text)).toEqual(['one']);
            expect(second.session.info.queuePaused).toBe(false);
            for (const text of ['two', 'three']) {
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent.at(-1)?.text).toBe(text);
            }
            await first.session.dispose();
            await second.session.dispose();
        });
    }

    test('Send now interrupts the current turn and continues with the selected queued message', async () => {
        const run = rig();
        run.session.send('original');
        await flush();
        run.session.send('one');
        run.session.send('two');
        expect(run.session.sendNow(run.session.info.queue![1]!.id)).toBe(true);
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'two']);
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'two', 'one']);
        await run.session.dispose();
    });
});

describe('a resume before CLI acceptance', () => {
    test('writes its attempt and note before start, retaining one attempt across a failed start and retry', async () => {
        const failed = rig({}, true);
        failed.session.send('original');
        await flush();
        const turnId = failed.session.info.activeTurnId!;
        await failed.session.dispose();
        const saved = Promise.withResolvers<void>();
        const run = rig({ info: structuredClone(failed.session.info), items: structuredClone(failed.session.thread.list()), save: () => saved.promise }, true);
        const words = { prompt: 'continue', note: 'Resuming after restart', preamble: null };
        const attempt = run.session.resume(turnId, 2, words);
        expect(run.session.thread.get(turnId)).toMatchObject({ attempt: 2, resumePending: true });
        expect(run.session.thread.get(`resume-${turnId}-2`)).toMatchObject({ text: words.note });
        expect(run.session.running).toBe(false);
        saved.resolve();
        await flush();
        run.start.reject(new Error('start failed'));
        await expect(attempt).rejects.toThrow('start failed');
        expect(run.sent).toEqual([]);
        const retry = rig({ info: structuredClone(run.session.info), items: structuredClone(run.session.thread.list()) });
        await retry.session.resume(turnId, 2, words);
        await retry.session.resume(turnId, 2, words);
        expect(retry.sent).toHaveLength(1);
        expect(retry.session.thread.get(turnId)).toMatchObject({ attempt: 2 });
        expect(retry.session.thread.get(turnId)).not.toHaveProperty('resumePending', true);
        expect(retry.session.thread.list().filter((item) => item.id === `resume-${turnId}-2`)).toHaveLength(1);
        await run.session.dispose();
        await retry.session.dispose();
    });
});

describe('provider acceptance of a wake', () => {
    test('persists before sending and clears delivery only for its own acknowledgement', async () => {
        const saved = Promise.withResolvers<void>();
        const run = rig({ save: () => saved.promise });
        Object.defineProperty(run.backend, 'acknowledgesTurns', { value: true });
        const turnId = run.session.wake({ text: 'settled result', label: 'Task', taskIds: ['task'] })!;
        await flush();
        expect(run.sent).toEqual([]);
        expect(run.session.thread.get(turnId)).toMatchObject({ deliveryPending: true });
        saved.resolve();
        await flush();
        expect(run.sent).toHaveLength(1);
        run.event({ type: 'turn.accepted', promptId: 'foreign' });
        expect(run.session.thread.get(turnId)).toMatchObject({ deliveryPending: true });
        run.event({ type: 'turn.accepted', promptId: run.sent[0]!.promptId! });
        expect(run.session.thread.get(turnId)).not.toHaveProperty('deliveryPending', true);
        run.event({ type: 'turn.done', state: 'error', costUsd: 0 });
        expect(run.session.thread.get(turnId)).toMatchObject({ state: 'error' });
        await run.session.dispose();
    });

    for (const failure of ['start', 'write', 'exit']) {
        test(`keeps results and consumed notices across a ${failure} failure and restart`, async () => {
            let notices = ['A native task was lost', 'A message from another node'];
            const first = rig({ promptNotes: { next: () => ({ shown: [], heard: notices.splice(0) }), reset: () => undefined } }, failure === 'start');
            Object.defineProperty(first.backend, 'acknowledgesTurns', { value: true });
            if (failure === 'write') {
                first.backend.sendTurn = () => {
                    throw new Error('broken pipe');
                };
            }
            const turnId = first.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
            if (failure === 'start') {
                first.start.reject(new Error('failed start'));
            }
            await flush();
            if (failure === 'exit') {
                first.event({ type: 'exit', exitCode: 1 });
            }
            expect(first.session.thread.get(turnId)).toMatchObject({ state: 'error', deliveryPending: true });
            expect(first.session.preambles.join('\n')).toContain('A message from another node');
            const second = rig({
                info: structuredClone(first.session.info),
                items: structuredClone(first.session.thread.list()),
                preambles: [...first.session.preambles]
            });
            second.session.send('continue consciously');
            await flush();
            expect(second.sent[0]?.preamble).toContain('A native task was lost');
            expect(second.sent[0]?.preamble).toContain('A message from another node');
            expect(second.session.preambles).toEqual([]);
            second.session.clear(true);
            expect(second.session.preambles).toEqual([]);
            await first.session.dispose();
            await second.session.dispose();
        });
    }
});

test('a legacy result proves wake acceptance, while a failed durable save sends nothing', async () => {
    const legacy = rig();
    Object.defineProperty(legacy.backend, 'acknowledgesTurns', { value: true });
    const turnId = legacy.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
    await flush();
    legacy.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    expect(legacy.session.thread.get(turnId)).not.toHaveProperty('deliveryPending', true);
    const failed = rig({
        save: async () => {
            throw new Error('disk full');
        }
    });
    const failedTurn = failed.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
    await flush();
    expect(failed.sent).toEqual([]);
    expect(failed.session.thread.get(failedTurn)).toMatchObject({ state: 'error', deliveryPending: true });
    await legacy.session.dispose();
    await failed.session.dispose();
});

for (const unknown of [false, true]) {
    test(`Claude window resets persist before the queue with an unknown window ${unknown}`, async () => {
        const protocol = new ClaudeProtocol();
        const owed: { at: number; resumeAt: number | undefined; queue: string[] }[] = [];
        let persisted: ChatInfo | null = null;
        const run = rig({
            persist: () => {
                persisted = structuredClone(run.session.info);
            },
            limitResume: {
                allowed: () => true,
                now: () => 1000,
                owed: () => owed.length > 0,
                owe: async (_turnId, at) => {
                    owed.push({ at, resumeAt: persisted?.resumeAt, queue: persisted?.queue?.map((entry) => entry.text) ?? [] });
                },
                lapse: async () => undefined
            }
        });
        run.session.send('original');
        await flush();
        protocol.beginPrompt(run.sent[0]!.promptId!);
        run.session.send('queued');
        protocol.handle({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', ...(unknown ? {} : { resetsAt: 900 }) }
        });
        protocol.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 500 } });
        protocol.handle({ type: 'assistant', error: 'rate_limit', message: { id: 'limited', content: [] } });
        for (const event of protocol.handle({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            user_message_uuids: [run.sent[0]!.promptId!]
        })) {
            run.event(event);
        }
        await flush();
        expect(run.session.info.queuePaused).toBe(true);
        expect(run.sent.map((input) => input.text)).toEqual(['original']);
        if (unknown) {
            expect(owed).toEqual([]);
            expect(run.session.info.resumeAt).toBeUndefined();
        } else {
            expect(owed).toEqual([{ at: 900000, resumeAt: 900000, queue: ['queued'] }]);
            expect(run.session.takeUpAfterLimit(run.session.thread.list().find((item) => item.kind === 'turn')!.id)).toBe('opened');
            await flush();
            expect(run.sent).toHaveLength(2);
            expect(run.sent[1]?.text).not.toBe('queued');
            run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
            await flush();
            expect(run.sent[2]?.text).toBe('queued');
        }
        await run.session.dispose();
    });
}

describe('a resume owed after a limit', () => {
    const owing = () => {
        const owed = { count: 0, lapsed: 0 };
        const hooks = {
            allowed: () => true,
            now: () => 1000,
            owe: async () => {
                owed.count += 1;
            },
            lapse: async () => {
                owed.lapsed += 1;
            },
            owed: () => owed.count > owed.lapsed
        };
        return { owed, hooks };
    };

    test('goes with a clear, so the empty chat shows no limit and a wake opens a turn', async () => {
        const { owed, hooks } = owing();
        const run = rig({ limitResume: hooks });
        run.session.send('original');
        await flush();
        run.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage', resetsAt: 100000 }, error: 'limit' });
        await flush();
        expect(run.session.info.resumeAt).toBe(100000);

        run.session.clear(false);
        await flush();
        expect(run.session.info.resumeAt).toBeUndefined();
        expect(run.session.info.limit).toBeUndefined();
        expect(owed.lapsed).toBe(1);
        expect(run.session.wake({ text: 'A task you gave has settled.', label: 'Lexer', taskIds: [] })).not.toBeNull();
        await run.session.dispose();
    });

    test('takes its time off when it comes due and opens no turn', async () => {
        const { hooks } = owing();
        const run = rig({ limitResume: hooks });
        run.session.send('original');
        await flush();
        const limitedId = run.session.info.activeTurnId!;
        run.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage', resetsAt: 100000 }, error: 'limit' });
        await flush();
        expect(run.session.info.resumeAt).toBe(100000);

        expect(run.session.takeUpAfterLimit('turn-gone')).toBe('lapsed');
        expect(run.session.info.resumeAt).toBeUndefined();
        expect(run.session.takeUpAfterLimit(limitedId)).toBe('opened');
        await run.session.dispose();
    });
});

describe('input during an active turn', () => {
    test('explicit steering reaches the backend without interrupting or opening another turn', async () => {
        const run = rig();
        const steered: TurnInput[] = [];
        run.backend.steerTurn = async (input) => {
            steered.push(input);
            return true;
        };
        run.session.send('original');
        await flush();
        const turnId = run.session.info.activeTurnId!;
        expect(await run.session.sendInput('change direction', { delivery: 'steer' })).toEqual({ queued: false, turnId });
        expect(steered.map((input) => input.text)).toEqual(['change direction']);
        expect(run.session.info.queue).toEqual([]);
        expect(run.session.thread.list().filter((item) => item.kind === 'turn')).toHaveLength(1);
        expect(
            run.session.thread
                .list()
                .filter((item) => item.kind === 'user')
                .map((item) => item.text)
        ).toEqual(['original', 'change direction']);
        await run.session.dispose();
    });

    test('default input waits for completion even with a steering backend', async () => {
        const run = rig();
        let steers = 0;
        run.backend.steerTurn = async () => {
            steers += 1;
            return true;
        };
        run.session.send('original');
        await flush();
        expect(await run.session.sendInput('next task')).toMatchObject({ queued: true });
        expect(steers).toBe(0);
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'next task']);
        await run.session.dispose();
    });
});

test('a steer accepted across turn completion is recorded once in the original turn', async () => {
    const run = rig();
    const acceptance = Promise.withResolvers<boolean>();
    run.backend.steerTurn = () => acceptance.promise;
    run.session.send('original');
    await flush();
    const original = run.session.info.activeTurnId!;
    const sending = run.session.sendInput('followup', { delivery: 'steer', mentions: ['notes.md'] });
    await flush();
    const held = run.session.info.queue![0]!;
    expect(run.session.unqueue(held.id)).toBeNull();
    expect(run.session.sendNow(held.id)).toBe(false);
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    await flush();
    expect(run.sent.map((input) => input.text)).toEqual(['original']);
    acceptance.resolve(true);
    expect(await sending).toEqual({ queued: false, turnId: original });
    expect(run.session.info.queue).toEqual([]);
    expect(run.session.thread.list().filter((item) => item.kind === 'user' && item.text === 'followup')).toMatchObject([
        { turnId: original, mentions: ['notes.md'] }
    ]);
    expect(run.sent.map((input) => input.text)).toEqual(['original']);
    await run.session.dispose();
});

test('a steer refused at completion falls back to exactly one new turn', async () => {
    const run = rig();
    const acceptance = Promise.withResolvers<boolean>();
    run.backend.steerTurn = () => acceptance.promise;
    run.session.send('original');
    await flush();
    const sending = run.session.sendInput('followup', { delivery: 'steer' });
    await flush();
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    acceptance.resolve(false);
    await sending;
    await flush();
    expect(run.sent.map((input) => input.text)).toEqual(['original', 'followup']);
    expect(run.session.info.queue).toEqual([]);
    await run.session.dispose();
});

test('a lost steering acknowledgement retains the message and pauses automatic replay', async () => {
    const run = rig();
    run.backend.steerTurn = async () => {
        throw new Error('lost connection');
    };
    run.session.send('original');
    await flush();
    await expect(run.session.sendInput('followup', { delivery: 'steer' })).rejects.toThrow('lost connection');
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    await flush();
    expect(run.session.info.queue?.map((message) => message.text)).toEqual(['followup']);
    expect(run.session.info.queuePaused).toBe(true);
    expect(run.sent.map((input) => input.text)).toEqual(['original']);
    await run.session.dispose();
});

test('multiple followups enter the native queue before either is acknowledged', async () => {
    const run = rig();
    const acceptance = Promise.withResolvers<boolean>();
    const texts: string[] = [];
    run.backend.steerTurn = (input) => {
        texts.push(input.text);
        return acceptance.promise;
    };
    run.session.send('original');
    await flush();
    const first = run.session.sendInput('one', { delivery: 'steer' });
    const second = run.session.sendInput('two', { delivery: 'steer' });
    await flush();
    expect(texts).toEqual(['one', 'two']);
    expect(run.session.info.queue?.map((entry) => entry.text)).toEqual(['one', 'two']);
    acceptance.resolve(true);
    await Promise.all([first, second]);
    expect(
        run.session.thread
            .list()
            .filter((item) => item.kind === 'user')
            .map((item) => item.text)
    ).toEqual(['original', 'one', 'two']);
    await run.session.dispose();
});

test('an end-of-turn message cannot start while another steer still awaits acceptance', async () => {
    const run = rig();
    const acceptance = Promise.withResolvers<boolean>();
    run.backend.steerTurn = () => acceptance.promise;
    run.session.send('original');
    await flush();
    await run.session.sendInput('next task', { delivery: 'queue' });
    const sending = run.session.sendInput('correction', { delivery: 'steer' });
    await flush();
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    await flush();
    expect(run.sent.map((input) => input.text)).toEqual(['original']);
    acceptance.resolve(true);
    await sending;
    await flush();
    expect(run.sent.map((input) => input.text)).toEqual(['original', 'next task']);
    await run.session.dispose();
});
