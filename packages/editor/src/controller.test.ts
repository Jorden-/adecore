import { describe, expect, test } from 'bun:test';
import { mountEditor, pointer, release } from './testing.ts';

describe('the focus', () => {
    test('leaving the editor is a blur, and moving inside it is not', () => {
        const { editor, page, input } = mountEditor();
        let blurs = 0;
        editor.onBlur(() => blurs++);
        const focusOut = (relatedTarget: EventTarget | null): void => {
            const event = new page.window.Event('focusout', { bubbles: true });
            Object.assign(event, { relatedTarget });
            input.dispatchEvent(event);
        };
        focusOut(page.host.querySelector('.se-viewport'));
        expect(blurs).toBe(0);
        focusOut(page.document.body);
        focusOut(null);
        expect(blurs).toBe(2);
    });
});

describe('a double tap of the modifier', () => {
    const tap = (mounted: ReturnType<typeof mountEditor>, timeStamp: number): void => {
        mounted.press('Control', { ctrlKey: true, timeStamp } as never);
        release(mounted.page.window, mounted.input, 'Control', { timeStamp: timeStamp + 40 } as never);
    };

    test('held the second time adds a caret below with the arrow', () => {
        const mounted = mountEditor();
        tap(mounted, 0);
        mounted.press('Control', { ctrlKey: true, timeStamp: 100 } as never);
        expect(mounted.press('ArrowDown', { ctrlKey: true, timeStamp: 150 } as never)).toBe(true);
        expect(mounted.editor.getSelections()).toHaveLength(2);
    });

    test('starts over when the input loses the focus between the taps', () => {
        const mounted = mountEditor();
        tap(mounted, 0);
        mounted.input.dispatchEvent(new mounted.page.window.Event('blur'));
        mounted.press('Control', { ctrlKey: true, timeStamp: 100 } as never);
        mounted.press('ArrowDown', { ctrlKey: true, timeStamp: 150 } as never);
        expect(mounted.editor.getSelections()).toHaveLength(1);
    });
});

describe('a pinned header', () => {
    test('takes a press to its line and leaves the caret there, though it draws itself anew under the pointer', () => {
        const body = Array.from({ length: 200 }, (_, line) => `        call${line}();`).join('\n');
        const mounted = mountEditor({ text: `class A {\n    run() {\n${body}\n    }\n}` });
        Object.defineProperties(mounted.viewport, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
        mounted.editor.setBlocks([
            { startLine: 1, endLine: 204, name: 'A' },
            { startLine: 2, endLine: 203, name: 'run' }
        ]);
        mounted.editor.setScrollTop(20 * 100);
        mounted.viewport.dispatchEvent(new mounted.page.window.Event('scroll'));
        const header = [...mounted.page.host.querySelectorAll<HTMLElement>('.se-sticky-row')].find((row) => row.dataset.line === '1')!;
        pointer(mounted.page.window, header, 'pointerdown', 10, 10);
        expect(mounted.editor.getCaret()).toEqual({ line: 1, character: 4 });
        expect(mounted.editor.getScrollTop()).toBe(0);
    });
});
