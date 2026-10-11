import { describe, expect, jest, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { GrammarPreparation } from './grammar-preparation.ts';
import type { LineTokenizer } from './types.ts';

const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

function setup(text = 'head\nbody') {
    const model = new DocumentModel(text);
    const timers = new Set<() => void>();
    const changed = jest.fn();
    const preparation = new GrammarPreparation(model, changed, (callback, delay) => {
        expect(delay).toBe(200);
        timers.add(callback);
        return () => timers.delete(callback);
    });
    const prepare = jest.fn(async (_text: string) => false);
    const tokenizer: LineTokenizer = { prepare, tokenizeLine: () => ({ tokens: [], state: null }), sameState: () => true };
    preparation.ready(tokenizer);
    const subscription = model.subscribe((snapshot) => {
        if (snapshot.changes !== undefined) {
            preparation.edited(snapshot.changes);
        }
    });
    const flush = async (): Promise<void> => {
        const callbacks = [...timers];
        timers.clear();
        callbacks.forEach((callback) => callback());
        await settle();
    };
    const edit = (text: string): void => {
        const at = model.getText().length;
        model.applyEdits([{ from: at, to: at, text }]);
    };
    const dispose = (): void => {
        preparation.dispose();
        subscription.dispose();
    };
    return { model, preparation, prepare, tokenizer, changed, timers, flush, edit, dispose };
}

describe('grammar preparation', () => {
    for (const language of ['cpp', 'rust', 'jsonc', 'tsx', 'javascript', 'csharp']) {
        test(`prepares only the final language name while typing ${language}`, async () => {
            const fixture = setup('');
            for (const character of '```' + language) {
                fixture.edit(character);
            }
            await fixture.flush();
            expect(fixture.prepare).toHaveBeenCalledTimes(1);
            expect(fixture.prepare.mock.calls[0]![0]).toBe('```' + language);
            fixture.dispose();
        });
    }

    test('does not prepare a pasted declaration undone before the debounce', async () => {
        const fixture = setup('');
        fixture.edit('```ts');
        fixture.model.undo();
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(1);
        expect(fixture.prepare.mock.calls[0]![0]).toBe('');
        fixture.dispose();
    });

    test('resetting preparation cannot replace a stale buffer entry', async () => {
        const fixture = setup('');
        fixture.edit('```c');
        fixture.preparation.begin();
        fixture.preparation.ready(fixture.tokenizer);
        fixture.edit('pp');
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledWith('```cpp');
        fixture.dispose();
    });

    test('debounces rapid edits and collects complete post-edit lines', async () => {
        const fixture = setup();
        for (const character of '\n```ts') {
            fixture.edit(character);
        }
        expect(fixture.prepare).not.toHaveBeenCalled();
        expect(fixture.timers.size).toBe(1);
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(1);
        expect(fixture.prepare.mock.calls[0]![0]).toContain('```ts');
        expect(fixture.changed).toHaveBeenCalledTimes(1);
        fixture.dispose();
    });

    test('maps separate edits to their final line positions', async () => {
        const fixture = setup('one\ntwo\nthree');
        fixture.model.applyEdits([
            { from: 0, to: 0, text: 'new\n' },
            { from: 8, to: 13, text: '```ts' }
        ]);
        await fixture.flush();
        expect(fixture.prepare.mock.calls[0]![0]).toContain('```ts');
        expect(fixture.prepare.mock.calls[0]![0]).toContain('new');
        fixture.dispose();
    });

    test('serializes loads and flushes edits collected while one runs', async () => {
        const fixture = setup();
        let finish = (_loaded: boolean): void => {};
        fixture.prepare.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
        fixture.edit('\n```ts');
        await fixture.flush();
        fixture.edit('\n```scss');
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(1);
        finish(true);
        await settle();
        expect(fixture.prepare).toHaveBeenCalledTimes(2);
        expect(fixture.prepare.mock.calls[1]![0]).toContain('```scss');
        fixture.dispose();
    });

    test('ignores the old load after a tokenizer replacement', async () => {
        const fixture = setup();
        let finish = (_loaded: boolean): void => {};
        fixture.prepare.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
        fixture.edit('\n```ts');
        await fixture.flush();
        fixture.preparation.begin();
        fixture.preparation.ready({ ...fixture.tokenizer, prepare: async () => false });
        finish(true);
        await settle();
        expect(fixture.changed).not.toHaveBeenCalled();
        fixture.dispose();
    });

    test('collects edits made while the initial tokenizer loads', async () => {
        const fixture = setup();
        fixture.preparation.begin();
        fixture.edit('\n```ts');
        expect(fixture.timers.size).toBe(0);
        fixture.preparation.ready(fixture.tokenizer);
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledWith(fixture.model.getText());
        fixture.dispose();
    });

    test('does not prepare external tokens and scans once when they are cleared', async () => {
        const fixture = setup();
        fixture.preparation.pause(true);
        fixture.edit('\n```ts');
        await fixture.flush();
        expect(fixture.prepare).not.toHaveBeenCalled();
        fixture.preparation.pause(false);
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(1);
        expect(fixture.prepare).toHaveBeenCalledWith(fixture.model.getText());
        fixture.dispose();
    });

    test('does not announce a load which finishes while paused or disposed', async () => {
        for (const state of ['paused', 'disposed']) {
            const fixture = setup();
            let finish = (_loaded: boolean): void => {};
            fixture.prepare.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
            fixture.edit('\n```ts');
            await fixture.flush();
            if (state === 'paused') {
                fixture.preparation.pause(true);
            } else {
                fixture.dispose();
            }
            finish(true);
            await settle();
            expect(fixture.changed).not.toHaveBeenCalled();
            fixture.dispose();
        }
    });

    test('scans the current document once when the buffer exceeds 64 KiB', async () => {
        const fixture = setup();
        fixture.edit('x'.repeat(65537) + '\n```ts');
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(1);
        expect(fixture.prepare).toHaveBeenCalledWith(fixture.model.getText());
        fixture.dispose();
    });

    test('handles undo and redo as post-edit declarations', async () => {
        const fixture = setup('');
        fixture.edit('```ts');
        await fixture.flush();
        fixture.model.undo();
        await fixture.flush();
        fixture.model.redo();
        await fixture.flush();
        expect(fixture.prepare.mock.calls.map(([text]) => text)).toEqual(['```ts', '', '```ts']);
        fixture.dispose();
    });

    test('allows a later edit to retry a rejected load', async () => {
        const fixture = setup();
        fixture.prepare.mockRejectedValueOnce(new Error('network'));
        fixture.edit('\n```ts');
        await fixture.flush();
        expect(fixture.changed).not.toHaveBeenCalled();
        fixture.edit(' ');
        await fixture.flush();
        expect(fixture.prepare).toHaveBeenCalledTimes(2);
        expect(fixture.changed).toHaveBeenCalledTimes(1);
        fixture.dispose();
    });
});
