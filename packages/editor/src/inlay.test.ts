import { describe, expect, test } from 'bun:test';
import type { EditorInlayClick, EditorInlayTarget } from './types.ts';
import { mountEditor, pointer } from './testing.ts';

function setup() {
    const mounted = mountEditor({ text: 'one\ntwo\nthree' });
    const { editor, page, viewport } = mounted;
    const pills = (): HTMLElement[] => Array.from(page.host.querySelectorAll<HTMLElement>('.se-inlay'));
    const press = (element: Element, options = {}): void => pointer(page.window, element, 'pointerdown', 0, 0, options);
    const move = (element: Element): void => pointer(page.window, element, 'pointermove', 0, 0, { buttons: 0 } as never);
    return { ...mounted, viewport, pills, press, move, editor };
}

describe('inlay hints', () => {
    test('draws a label without parts as one text', () => {
        const { editor, pills } = setup();
        editor.setInlayHints([{ position: { line: 0, character: 1 }, label: ': string' }]);
        expect(pills().map((pill) => pill.textContent)).toEqual([': string']);
        expect(pills()[0]!.querySelector('.se-inlay-part')).toBeNull();
    });

    test('draws parts as elements of their own that add up to the label', () => {
        const { editor, pills } = setup();
        editor.setInlayHints([{ position: { line: 0, character: 1 }, label: ': Map<K>', parts: [': ', 'Map', '<K>'] }]);
        const parts = Array.from(pills()[0]!.querySelectorAll<HTMLElement>('.se-inlay-part'));
        expect(parts.map((part) => [part.dataset.part, part.textContent])).toEqual([
            ['0', ': '],
            ['1', 'Map'],
            ['2', '<K>']
        ]);
        expect(pills()[0]!.textContent).toBe(': Map<K>');
    });

    test('keeps whole pixels of padding clear on the sides asked for', () => {
        const { editor, pills } = setup();
        editor.setInlayHints([{ position: { line: 0, character: 1 }, label: 'a' }]);
        const plain = pills()[0]!;
        const { left, width } = { left: parseFloat(plain.style.left), width: parseFloat(plain.style.width) };
        editor.setInlayHints([{ position: { line: 0, character: 1 }, label: 'a', paddingLeft: true, paddingRight: true }]);
        const padded = pills()[0]!;
        expect(parseFloat(padded.style.left)).toBe(left + 4);
        expect(parseFloat(padded.style.width)).toBe(width);
    });

    test('says which hint and part the pointer is on, and when it left', () => {
        const { editor, pills, move } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab', parts: ['a', 'b'] }]);
        const seen: (Pick<EditorInlayTarget, 'id' | 'part'> | null)[] = [];
        editor.onInlayHover!((target) => seen.push(target === null ? null : { id: target.id, part: target.part }));
        const parts = pills()[0]!.querySelectorAll('.se-inlay-part');
        move(parts[0]!);
        move(parts[0]!);
        move(parts[1]!);
        move(pills()[0]!.parentElement!);
        expect(seen).toEqual([{ id: 'h', part: 0 }, { id: 'h', part: 1 }, null]);
    });

    test('hands a press to the host and leaves the caret alone when it takes it', () => {
        const { editor, pills, press, type } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 1, character: 1 }, label: 'ab', parts: ['a', 'b'] }]);
        editor.setCaret({ line: 0, character: 0 });
        const clicks: EditorInlayClick[] = [];
        editor.onInlayClick!((click) => {
            clicks.push(click);
            return true;
        });
        press(pills()[0]!.querySelectorAll('.se-inlay-part')[1]!, { ctrlKey: true });
        expect(clicks).toEqual([{ id: 'h', part: 1, mod: true, alt: false, shift: false, clicks: 1, touch: false }]);
        type('X');
        expect(editor.getText()).toBe('Xone\ntwo\nthree');
    });

    test('counts a second press on the same hint as a double click', () => {
        const { editor, pills, press } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab' }]);
        const clicks: number[] = [];
        editor.onInlayClick!((click) => {
            clicks.push(click.clicks);
            return true;
        });
        press(pills()[0]!);
        press(pills()[0]!);
        press(pills()[0]!);
        expect(clicks).toEqual([1, 2, 1]);
    });

    test('lets the editor have a press the host did not take', () => {
        const { editor, pills, press } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab' }]);
        editor.onInlayClick!(() => false);
        press(pills()[0]!);
        expect(editor.getSelection().start.line).toBe(0);
    });

    test('draws the link on the part it was told to and takes it away', () => {
        const { editor, pills } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab', parts: ['a', 'b'] }]);
        editor.setInlayLink!({ id: 'h', part: 1 });
        const parts = pills()[0]!.querySelectorAll('.se-inlay-part');
        expect(parts[0]!.classList.contains('se-inlay-link')).toBe(false);
        expect(parts[1]!.classList.contains('se-inlay-link')).toBe(true);
        editor.setInlayLink!(null);
        expect(parts[1]!.classList.contains('se-inlay-link')).toBe(false);
    });

    test('keeps the link when the line is painted again', () => {
        const { editor, pills } = setup();
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab', parts: ['a', 'b'] }]);
        editor.setInlayLink!({ id: 'h', part: 1 });
        editor.setText('x');
        editor.setInlayHints([{ id: 'h', position: { line: 0, character: 1 }, label: 'ab', parts: ['a', 'b'] }]);
        expect(pills()[0]!.querySelectorAll('.se-inlay-link')).toHaveLength(1);
        expect(pills()[0]!.querySelectorAll('.se-inlay-part')[1]!.classList.contains('se-inlay-link')).toBe(true);
    });
});
