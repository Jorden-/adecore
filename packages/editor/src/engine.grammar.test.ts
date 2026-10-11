import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { setup, settle } from './engine.fixture.test.ts';
import type { Editor, LineTokenizer } from './types.ts';

const disposals: (() => void)[] = [];
afterEach(() => {
    while (disposals.length > 0) {
        disposals.pop()!();
    }
});

function preparationClock() {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout as (timer: unknown) => void;
    const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
    const set = spyOn(globalThis, 'setTimeout');
    set.mockImplementation(((callback: () => void, delay?: number) => {
        if (delay !== 200) {
            return originalSet(callback, delay);
        }
        const timer = originalSet(() => {}, 1_000_000);
        pending.set(timer, callback);
        return timer;
    }) as typeof setTimeout);
    const clear = spyOn(globalThis, 'clearTimeout');
    clear.mockImplementation((timer) => {
        pending.delete(timer as ReturnType<typeof setTimeout>);
        originalClear(timer);
    });
    disposals.push(() => {
        pending.forEach((_callback, timer) => originalClear(timer));
        clear.mockRestore();
        set.mockRestore();
    });
    return async (): Promise<void> => {
        const callbacks = [...pending];
        pending.clear();
        callbacks.forEach(([timer, callback]) => {
            originalClear(timer);
            callback();
        });
        await settle();
    };
}

function tokenizer() {
    let invalid = false;
    let color = '#112233';
    const prepare = jest.fn(async (text: string) => {
        if (text.includes('```ts') && color === '#112233') {
            invalid = true;
            color = '#336699';
            return true;
        }
        return false;
    });
    const tokenizeLine = jest.fn((text: string) => ({ tokens: [{ length: text.length, color, fontStyle: 0 }], state: null }));
    const stale = jest.fn(() => {
        const changed = invalid;
        invalid = false;
        return changed;
    });
    const source: LineTokenizer = { prepare, tokenizeLine, stale, sameState: () => true };
    return { source, prepare, tokenizeLine, stale };
}

function keep(editor: Editor): void {
    disposals.push(() => editor.dispose());
}

describe('embedded grammar edits in the editor', () => {
    test('recolors a covered viewport from line zero after preparation', async () => {
        const flush = preparationClock();
        const grammar = tokenizer();
        const { editor, host } = setup({ text: 'head\nbody', language: 'markdown' }, { tokenizer: async () => grammar.source });
        keep(editor);
        await settle();
        editor.setText('head\nbody\n```ts');
        editor.refreshFont();
        grammar.tokenizeLine.mockClear();
        expect(host.querySelector('.se-run span')?.getAttribute('style')).toContain('#112233');
        await flush();
        editor.refreshFont();
        expect(grammar.prepare).toHaveBeenCalledTimes(1);
        expect(grammar.tokenizeLine.mock.calls.map(([text]) => text)).toContain('head');
        expect(host.querySelector('.se-run span')?.getAttribute('style')).toContain('#336699');
    });

    test('coalesces typing and avoids a rebuild when undo and redo name no new grammar', async () => {
        const flush = preparationClock();
        const grammar = tokenizer();
        const { editor, type } = setup({ text: '', language: 'markdown' }, { tokenizer: async () => grammar.source });
        keep(editor);
        await settle();
        for (const character of '```ts') {
            type(character);
        }
        await flush();
        editor.refreshFont();
        expect(grammar.prepare).toHaveBeenCalledTimes(1);
        expect(editor.runCommand('undo')).toBe(true);
        await flush();
        expect(editor.runCommand('redo')).toBe(true);
        await flush();
        editor.refreshFont();
        expect(grammar.prepare).toHaveBeenCalledTimes(3);
        expect(grammar.prepare.mock.results.map((result) => result.type)).toEqual(['return', 'return', 'return']);
        expect(await grammar.prepare.mock.results[2]!.value).toBe(false);
    });

    test('ignores a pending grammar after a theme switch', async () => {
        const flush = preparationClock();
        const first = tokenizer();
        const second = tokenizer();
        let finish = (_loaded: boolean): void => {};
        first.prepare.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
        const { editor } = setup(
            { text: 'head', theme: 'light' },
            { tokenizer: async (_language, theme) => (theme === 'light' ? first.source : second.source) }
        );
        keep(editor);
        await settle();
        editor.setText('head\n```ts');
        await flush();
        editor.setTheme('dark');
        await settle();
        first.stale.mockClear();
        second.stale.mockClear();
        finish(true);
        await settle();
        expect(first.stale).not.toHaveBeenCalled();
        expect(second.stale).not.toHaveBeenCalled();
    });

    test('pauses scans for external tokens and resumes with the whole document', async () => {
        const flush = preparationClock();
        const grammar = tokenizer();
        const { editor, host } = setup({ text: 'head' }, { tokenizer: async () => grammar.source });
        keep(editor);
        await settle();
        editor.setLineTokens((line) => [{ length: line === 0 ? 4 : 5, color: '#ff0000', fontStyle: 0 }]);
        editor.setText('head\n```ts');
        await flush();
        expect(grammar.prepare).not.toHaveBeenCalled();
        expect(host.querySelector('.se-run span')?.getAttribute('style')).toContain('#ff0000');
        editor.setLineTokens(null);
        await flush();
        editor.refreshFont();
        expect(grammar.prepare).toHaveBeenCalledWith('head\n```ts');
        expect(host.querySelector('.se-run span')?.getAttribute('style')).toContain('#336699');
    });

    test('disposal ignores a late answer and a large paste prepares the whole document', async () => {
        const flush = preparationClock();
        const grammar = tokenizer();
        let finish = (_loaded: boolean): void => {};
        grammar.prepare.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
        const { editor } = setup({ text: 'head' }, { tokenizer: async () => grammar.source });
        keep(editor);
        await settle();
        const text = 'head\n' + 'x'.repeat(65537) + '\n```ts';
        editor.setText(text);
        await flush();
        expect(grammar.prepare).toHaveBeenCalledWith(text);
        editor.dispose();
        grammar.stale.mockClear();
        finish(true);
        await settle();
        expect(grammar.stale).not.toHaveBeenCalled();
    });
});
