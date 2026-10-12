import { afterEach, describe, expect, jest, test } from 'bun:test';
import { column, row } from './controller.fixture.test.ts';
import { createSmartEditorEngine } from './engine.ts';
import { EditorView } from './view.ts';
import { createPage, mountEditor, pointer } from './testing.ts';

afterEach(() => {
    jest.useRealTimers();
});

function touchPage(text = 'alpha beta\nnext') {
    const mounted = mountEditor({ text });
    const { page, viewport } = mounted;
    const root = page.document.documentElement;
    return {
        ...mounted,
        down: (x: number, y: number, target: Element = viewport) => pointer(page.window, target, 'pointerdown', x, y, { pointerType: 'touch' }),
        move: (x: number, y: number) => pointer(page.window, root, 'pointermove', x, y, { pointerType: 'touch' }),
        up: (x: number, y: number) => pointer(page.window, root, 'pointerup', x, y, { pointerType: 'touch' }),
        cancel: (x: number, y: number) => pointer(page.window, root, 'pointercancel', x, y, { pointerType: 'touch' })
    };
}

describe('touch', () => {
    test('a tap places the caret and focuses the input', () => {
        const { editor, input, down, up, type } = touchPage();
        let focused = 0;
        input.focus = () => {
            focused++;
        };
        down(column(3) + 1, row(1));
        up(column(3) + 1, row(1));
        expect(focused).toBe(1);
        type('X');
        expect(editor.getText()).toBe('alpha beta\nnexXt');
    });

    test('a tap the host handles reaches its click handler and places no caret', () => {
        const { editor, down, up, type } = touchPage();
        const presses: { line: number; character: number }[] = [];
        editor.onClick((press) => {
            presses.push(press.position);
            return true;
        });
        down(column(3) + 1, row(1));
        up(column(3) + 1, row(1));
        expect(presses).toEqual([{ line: 1, character: 3 }]);
        type('X');
        expect(editor.getText()).toBe('Xalpha beta\nnext');
    });

    test('a scroll does not reach the click handler', () => {
        const { editor, down, move, up } = touchPage();
        let calls = 0;
        editor.onClick(() => {
            calls++;
            return true;
        });
        down(column(3), row(0));
        move(column(3), row(0) + 40);
        up(column(3), row(0) + 40);
        expect(calls).toBe(0);
    });

    test('a drag makes no selection and no caret', () => {
        const first = touchPage();
        first.down(column(1), row(0));
        first.move(column(1), row(0) + 40);
        first.up(column(1), row(0) + 40);
        first.type('X');
        expect(first.editor.getText()).toBe('Xalpha beta\nnext');
        const second = touchPage();
        second.down(column(4) + 1, row(0));
        second.move(column(4) + 1, row(1) + 30);
        second.cancel(column(4) + 1, row(1) + 30);
        second.type('X');
        expect(second.editor.getText()).toBe('Xalpha beta\nnext');
    });

    test('a double tap selects a word', () => {
        const { editor, down, up, type } = touchPage();
        down(column(7), row(0));
        up(column(7), row(0));
        down(column(7), row(0));
        up(column(7), row(0));
        type('X');
        expect(editor.getText()).toBe('alpha X\nnext');
    });

    test('a long press selects the word under the finger and the lift that follows changes nothing', () => {
        const mounted = touchPage();
        jest.useFakeTimers();
        mounted.down(column(7), row(0));
        jest.advanceTimersByTime(499);
        expect(mounted.editor.getSelections()[0]!.start).toEqual(mounted.editor.getSelections()[0]!.end);
        jest.advanceTimersByTime(1);
        mounted.up(column(7), row(0));
        mounted.type('X');
        expect(mounted.editor.getText()).toBe('alpha X\nnext');
    });

    test('moving before the long press stops it', () => {
        const mounted = touchPage();
        jest.useFakeTimers();
        mounted.down(column(7), row(0));
        mounted.move(column(7), row(0) + 40);
        jest.advanceTimersByTime(1000);
        mounted.cancel(column(7), row(0) + 40);
        mounted.type('X');
        expect(mounted.editor.getText()).toBe('Xalpha beta\nnext');
    });

    test('a tap on a line number selects the line', () => {
        const mounted = touchPage();
        const gutter = mounted.page.host.querySelector('.se-gutter')!;
        mounted.down(4, row(1), gutter);
        mounted.up(4, row(1));
        mounted.type('X');
        expect(mounted.editor.getText()).toBe('alpha beta\nX');
    });

    test('a pen still selects like a mouse', () => {
        const { editor, page, viewport, type } = touchPage();
        const root = page.document.documentElement;
        pointer(page.window, viewport, 'pointerdown', column(1), row(0), { pointerType: 'pen' });
        pointer(page.window, root, 'pointermove', column(6), row(0), { pointerType: 'pen' });
        pointer(page.window, root, 'pointerup', column(6), row(0), { pointerType: 'pen' });
        type('X');
        expect(editor.getText()).toBe('aXbeta\nnext');
    });
});

describe('the input', () => {
    test('asks a virtual keyboard for plain text', () => {
        const { input } = mountEditor();
        expect(input.getAttribute('autocapitalize')).toBe('off');
        expect(input.getAttribute('autocorrect')).toBe('off');
        expect(input.spellcheck).toBe(false);
        expect(input.getAttribute('enterkeyhint')).toBe('enter');
        expect(input.getAttribute('inputmode')).toBe('text');
    });
});

describe('the virtual keyboard', () => {
    test('reveals the caret only when the visual viewport shrinks while the input has focus', () => {
        const listeners = new Set<() => void>();
        const viewport = { height: 800, addEventListener: (_type: string, listener: () => void) => listeners.add(listener), removeEventListener: () => {} };
        const page = createPage();
        Object.defineProperty(page.window, 'visualViewport', { configurable: true, value: viewport });
        const editor = createSmartEditorEngine({ tokenizer: async () => null }).mount(page.host, { text: 'one\ntwo', theme: 'dark' });
        const input = page.host.querySelector('.se-input')!;
        Object.defineProperty(page.document, 'activeElement', { configurable: true, get: () => input });
        const reveal = jest.spyOn(EditorView.prototype, 'revealCaret');
        const resize = (height: number): void => {
            viewport.height = height;
            listeners.forEach((listener) => listener());
        };
        resize(500);
        expect(reveal).toHaveBeenCalledTimes(1);
        resize(700);
        expect(reveal).toHaveBeenCalledTimes(1);
        resize(600);
        expect(reveal).toHaveBeenCalledTimes(2);
        reveal.mockRestore();
        editor.dispose();
    });

    test('does not reveal the caret while the person zooms in', () => {
        const listeners = new Set<() => void>();
        const viewport = {
            height: 800,
            scale: 1,
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: () => {}
        };
        const page = createPage();
        Object.defineProperty(page.window, 'visualViewport', { configurable: true, value: viewport });
        const editor = createSmartEditorEngine({ tokenizer: async () => null }).mount(page.host, { text: 'one\ntwo', theme: 'dark' });
        const input = page.host.querySelector('.se-input')!;
        Object.defineProperty(page.document, 'activeElement', { configurable: true, get: () => input });
        const reveal = jest.spyOn(EditorView.prototype, 'revealCaret');
        viewport.height = 400;
        viewport.scale = 2;
        listeners.forEach((listener) => listener());
        expect(reveal).toHaveBeenCalledTimes(0);
        viewport.height = 300;
        listeners.forEach((listener) => listener());
        expect(reveal).toHaveBeenCalledTimes(1);
        reveal.mockRestore();
        editor.dispose();
    });

    test('keeps pinch zoom on the viewport', async () => {
        const css = await Bun.file(new URL('./editor.css', import.meta.url)).text();
        expect(css).toMatch(/touch-action: pan-x pan-y pinch-zoom;/);
    });

    test('listens for a resize of the visual viewport while mounted and lets go on dispose', () => {
        const listeners = new Set<() => void>();
        const page = createPage();
        Object.defineProperty(page.window, 'visualViewport', {
            configurable: true,
            value: {
                addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
                removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
            }
        });
        const editor = createSmartEditorEngine({ tokenizer: async () => null }).mount(page.host, { text: 'one\ntwo', theme: 'dark' });
        expect(listeners.size).toBe(1);
        editor.focus();
        expect(() => listeners.forEach((listener) => listener())).not.toThrow();
        editor.dispose();
        expect(listeners.size).toBe(0);
    });

    test('mounts where there is no visual viewport', () => {
        expect(() => mountEditor().editor.dispose()).not.toThrow();
    });
});
