import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import { decoratePatch, type PatchLineLabels, type PatchTimer } from './patch-decorations.ts';

const PATCH = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -10,3 +10,3 @@ fn()', ' keep', '-old', '+new', ' tail', ''].join('\n');

const LABELS: PatchLineLabels = {
    added: (number) => `Added, new line ${number}`,
    removed: (number) => `Removed, old line ${number}`,
    unchanged: (old, fresh) => `Old line ${old}, new line ${fresh}`
};

function numbers(host: HTMLElement): (string | null)[] {
    return [...host.querySelectorAll('.se-line-number')].map((item) => item.querySelector('span')?.textContent ?? null);
}

function spoken(host: HTMLElement): string[] {
    return [...host.querySelectorAll('.se-line-number .se-sr-only')].map((item) => item.textContent ?? '');
}

function fakeTimer(): PatchTimer & { pending(): number; run(): void } {
    const callbacks = new Map<number, () => void>();
    let next = 0;
    return {
        set: (callback) => {
            callbacks.set(++next, callback);
            return next;
        },
        clear: (handle) => {
            callbacks.delete(handle as number);
        },
        pending: () => callbacks.size,
        run: () => {
            const due = [...callbacks.values()];
            callbacks.clear();
            due.forEach((callback) => callback());
        }
    };
}

const settle = (): Promise<void> => Promise.resolve();

describe('decoratePatch', () => {
    test('draws old and new numbers from the hunk header, bars on changed lines and no sign or triangle', () => {
        const { editor, page } = mountEditor({ text: PATCH });
        const decoration = decoratePatch(editor, { labels: LABELS });
        expect(decoration.layout.files).toHaveLength(1);
        expect(numbers(page.host).slice(0, 8)).toEqual(['', '', '', '', '10', '11', '11', '12']);
        expect(page.host.querySelectorAll('.se-line-bar-hatched')).toHaveLength(1);
        expect(page.host.querySelectorAll('.se-line-bar-solid')).toHaveLength(1);
        expect(page.host.querySelectorAll('.se-line-sign, .se-change')).toHaveLength(0);
        expect(spoken(page.host)).toEqual(['Old line 10, new line 10', 'Removed, old line 11', 'Added, new line 11', 'Old line 12, new line 12']);
        const removed = [...page.host.querySelectorAll('.se-line-number')].find((item) => item.querySelector('.se-line-bar-hatched'))!;
        expect(removed.querySelectorAll('.se-sr-only')).toHaveLength(1);
        expect(removed.classList.contains('se-line-marked')).toBe(true);
    });

    test('shows both numbers when asked', () => {
        const { editor, page } = mountEditor({ text: PATCH });
        decoratePatch(editor, { numbers: 'both' });
        expect(numbers(page.host).slice(4, 8)).toEqual(['10 10', '11   ', '   11', '12 12']);
    });

    test('joins consecutive changed lines into one stripe', () => {
        const { editor, page } = mountEditor({ text: ['@@ -1,3 +1,3 @@', '-a', '-b', '-c', '+d', '+e', '+f'].join('\n') });
        decoratePatch(editor);
        const bars = [...page.host.querySelectorAll('.se-line-bar')].map((bar) => bar.className);
        expect(bars).toHaveLength(6);
        expect(bars.slice(0, 3).every((name) => name.includes('hatched'))).toBe(true);
        expect(bars.slice(3).every((name) => name.includes('solid'))).toBe(true);
    });

    test('reads the layout again after an edit and tells the listeners once per turn', async () => {
        const { editor, page, type } = mountEditor({ text: PATCH });
        const seen: number[] = [];
        const timer = fakeTimer();
        const decoration = decoratePatch(editor, { timer, onLayout: (layout) => seen.push(layout.lines.length) });
        expect(seen).toHaveLength(1);
        seen.length = 0;
        editor.setCaret({ line: 7, character: 5 });
        type('x');
        type('y');
        expect(seen).toEqual([]);
        await settle();
        expect(seen).toEqual([]);
        expect(decoration.layout.lines[7]).toEqual({ role: 'context', old: 12, new: 12 });
        timer.run();
        expect(seen).toHaveLength(1);
        editor.setCaret({ line: 7, character: 0 });
        type('+inserted\n');
        await settle();
        expect(decoration.layout.files[0]!.hunks[0]!.consistent).toBe(false);
        expect(decoration.layout.files[0]!.added).toBe(2);
        expect(numbers(page.host)[7]).toBe('12');
    });

    test('keeps the file list quiet while typing and tells it once the edits rest', async () => {
        const { editor, type } = mountEditor({ text: PATCH });
        const timer = fakeTimer();
        const seen: number[] = [];
        decoratePatch(editor, { timer, onLayout: (layout) => seen.push(layout.lines.length) });
        seen.length = 0;
        editor.setCaret({ line: 8, character: 0 });
        for (const key of 'abc') {
            type(key);
            await settle();
        }
        expect(seen).toEqual([]);
        expect(timer.pending()).toBe(1);
        timer.run();
        expect(seen).toHaveLength(1);
    });

    test('waits for the edits to rest before decorating a patch past the threshold', async () => {
        const { editor, page, type } = mountEditor({ text: PATCH });
        const timer = fakeTimer();
        decoratePatch(editor, { timer, immediateBelow: 10 });
        editor.setCaret({ line: 7, character: 0 });
        type('+');
        await settle();
        expect(page.host.querySelectorAll('.se-line-bar-solid')).toHaveLength(1);
        timer.run();
        expect(page.host.querySelectorAll('.se-line-bar-solid')).toHaveLength(2);
    });

    test('draws its change marks in a layer of its own and leaves the host marks when disposed', () => {
        const { editor, page } = mountEditor({ text: PATCH });
        editor.setChangeMarks([{ kind: 'modified', startLine: 1, endLine: 1 }]);
        const decoration = decoratePatch(editor);
        decoration.dispose();
        expect(page.host.querySelectorAll('.se-change-modified')).toHaveLength(1);
    });

    test('stays editable and stops following the editor when disposed', async () => {
        const { editor, page, type } = mountEditor({ text: PATCH });
        const decoration = decoratePatch(editor);
        editor.setCaret({ line: 8, character: 0 });
        type('z');
        await settle();
        expect(editor.getText()).toContain('z');
        decoration.dispose();
        expect(page.host.querySelectorAll('.se-line-bar')).toHaveLength(0);
        expect(numbers(page.host)[4]).toBe('5');
        type('q');
        await settle();
        expect(page.host.querySelectorAll('.se-line-bar')).toHaveLength(0);
    });

    test('goes quiet past the limits', () => {
        const { editor, page } = mountEditor({ text: PATCH });
        const decoration = decoratePatch(editor, { limits: { maxLines: 5 } });
        expect(decoration.layout.truncated).toBe(true);
        expect(page.host.querySelectorAll('.se-line-bar')).toHaveLength(0);
    });
});
