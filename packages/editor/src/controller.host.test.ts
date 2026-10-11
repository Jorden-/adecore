import { describe, expect, jest, test } from 'bun:test';
import { mountEditor, pointer } from './testing.ts';
import { column, row } from './controller.fixture.test.ts';

describe('the folds a server names', () => {
    test('take the characters it gives as where a collapsed fold hides from and shows again from', () => {
        const { editor, page } = mountEditor({ text: '<?php\nuse A;\nuse B;\n\nfinal class C {}', language: 'php' });
        editor.setFoldHints({ ranges: [{ startLine: 1, endLine: 2, kind: 'imports', startCharacter: 3, endCharacter: 5 }] });
        editor.runCommand('collapseAllRegions');
        const runs = [...page.host.querySelectorAll('.se-line[data-line="1"] .se-run')].map((run) => run.textContent);
        expect(runs).toEqual(['use', ';']);
    });
});

describe('the fold control', () => {
    test('folds on the first press, whatever repaints before the button is released', () => {
        jest.useFakeTimers();
        const { page, viewport } = mountEditor({ text: 'function a() {\n    one();\n}\nconst b = 1;\n' });
        jest.runAllTimers();
        jest.useRealTimers();
        const toggle = (): HTMLElement => page.host.querySelector('.se-fold-toggle') as HTMLElement;
        expect(toggle()).not.toBeNull();
        pointer(page.window, toggle(), 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(toggle().className).toContain('se-folded');
        pointer(page.window, toggle(), 'pointerdown', 0, 0);
        expect(toggle().className).not.toContain('se-folded');
    });
});

describe('the gutter action', () => {
    test('draws one button on its line and reports a press without moving the caret', () => {
        jest.useFakeTimers();
        const { editor, page, viewport } = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        const pressed: number[] = [];
        editor.onGutterAction((line) => pressed.push(line));
        editor.setGutterAction({ line: 1, label: 'Show code actions' });
        const button = page.host.querySelector('.se-gutter-action') as HTMLElement;
        expect(button.getAttribute('aria-label')).toBe('Show code actions');
        expect(page.host.querySelectorAll('.se-gutter-action')).toHaveLength(1);
        pointer(page.window, button, 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(pressed).toEqual([1]);
        editor.setGutterAction(null);
        expect(page.host.querySelectorAll('.se-gutter-action')).toHaveLength(0);
    });
});

describe('gutter markers', () => {
    test('draw one button per line for every owner, report a press without moving the caret and go with their owner', () => {
        jest.useFakeTimers();
        const { editor, page, viewport } = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        const pressed: string[] = [];
        editor.onGutterMarker((id) => pressed.push(id));
        editor.setGutterMarkers([{ id: 'edit', line: 2, label: 'Show inline edit' }], 'inline-edit');
        editor.setGutterMarkers([{ id: 'other', line: 0, label: 'Other' }], 'other');
        const buttons = () => [...page.host.querySelectorAll('.se-gutter-marker')] as HTMLElement[];
        expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Other', 'Show inline edit']);
        const caret = editor.getCaret();
        pointer(page.window, buttons()[1]!, 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(pressed).toEqual(['edit']);
        expect(editor.getCaret()).toEqual(caret);
        editor.setGutterMarkers([], 'other');
        expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Show inline edit']);
    });
});

describe('clicks the host answers', () => {
    test('offers a press on a character to the host, which can take it and leave the caret alone', () => {
        const { editor, click, type } = mountEditor({ text: 'abcdef' }, { apple: false });
        const seen: unknown[] = [];
        editor.onClick((press) => {
            seen.push(press);
            return press.mod;
        });
        click(column(2) + 1, row(0));
        click(column(4) + 1, row(0), { ctrlKey: true });
        type('-');
        expect(editor.getText()).toBe('ab-cdef');
        expect(seen).toEqual([
            { position: { line: 0, character: 2 }, mod: false, alt: false, shift: false },
            { position: { line: 0, character: 4 }, mod: true, alt: false, shift: false }
        ]);
    });

    test('leaves a press past the end of a line to the editor', () => {
        const { editor, click, type } = mountEditor({ text: 'ab' });
        editor.onClick(() => true);
        click(400, row(0));
        type('!');
        expect(editor.getText()).toBe('ab!');
    });
});

describe('the context menu', () => {
    test('is the host to draw, with the character it was asked on and whether it lies in the selection', () => {
        const { editor, page, viewport } = mountEditor({ text: 'abcdef' });
        const asked: unknown[] = [];
        editor.onContextMenu((menu) => asked.push(menu));
        const event = new (page.window as unknown as { Event: typeof Event }).Event('contextmenu', { bubbles: true, cancelable: true });
        Object.assign(event, { clientX: column(3) + 1, clientY: row(0) });
        viewport.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(asked).toEqual([{ position: { line: 0, character: 3 }, inSelection: false, x: column(3) + 1, y: row(0) }]);
    });
});

describe('widgets', () => {
    test("draws the host's own row under its line and takes it away when the widgets are set again", () => {
        jest.useFakeTimers();
        const { editor, page } = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        editor.setWidgets([{ id: 'peek', line: 0, height: 40, render: (container) => (container.textContent = 'references') }]);
        const widget = page.host.querySelector('.se-widget') as HTMLElement;
        expect(widget.textContent).toBe('references');
        editor.setWidgets([]);
        expect(page.host.querySelectorAll('.se-widget')).toHaveLength(0);
    });

    function mountRows() {
        jest.useFakeTimers();
        const mounted = mountEditor({ text: 'one\ntwo\nthree' });
        jest.runAllTimers();
        jest.useRealTimers();
        return mounted;
    }
    const row = (id: string, line: number, placement?: 'above' | 'below') => ({
        id,
        line,
        height: 40,
        placement,
        render: (container: HTMLElement) => (container.textContent = id)
    });
    const drawn = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('.se-widget')]
            .sort((left, right) => Number.parseFloat((left as HTMLElement).style.top) - Number.parseFloat((right as HTMLElement).style.top))
            .map((element) => element.textContent!);

    test('keeps the rows of each owner until that owner sets its own again', () => {
        const { editor, page } = mountRows();
        editor.setWidgets([row('peek', 0)]);
        editor.setWidgets([row('keep', 1)], 'review');
        expect(drawn(page.host)).toEqual(['peek', 'keep']);
        editor.setWidgets([row('swap', 1)], 'review');
        expect(drawn(page.host)).toEqual(['peek', 'swap']);
        editor.setWidgets([]);
        expect(drawn(page.host)).toEqual(['swap']);
        editor.setWidgets([], 'review');
        expect(drawn(page.host)).toEqual([]);
    });

    test('orders rows under one line by the name of their owner, whichever set its rows last', () => {
        const { editor, page } = mountRows();
        editor.setWidgets([row('second', 0)], 'review');
        editor.setWidgets([row('third', 0)], 'review-b');
        editor.setWidgets([row('first', 0), row('first-b', 0)], 'conflict');
        expect(drawn(page.host)).toEqual(['first', 'first-b', 'second', 'third']);
        editor.setWidgets([row('first', 0), row('first-b', 0)], 'conflict');
        editor.setWidgets([row('second', 0)], 'review');
        expect(drawn(page.host)).toEqual(['first', 'first-b', 'second', 'third']);
    });

    test('puts a row above its line, and moves the rows of every owner with their lines', () => {
        const { editor, page, type } = mountRows();
        editor.setWidgets([row('over', 1, 'above')], 'a');
        editor.setWidgets([row('under', 1)], 'b');
        expect(drawn(page.host)).toEqual(['over', 'under']);
        expect((page.host.querySelector('[data-line="1"]') as HTMLElement).style.top).toBe('60px');
        editor.setCaret({ line: 0, character: 3 });
        type('\nnew');
        expect((page.host.querySelector('[data-line="2"]') as HTMLElement).style.top).toBe('80px');
        expect(drawn(page.host)).toEqual(['over', 'under']);
    });
});

describe('code vision', () => {
    function mountLens(text = 'one\n    two\nthree') {
        jest.useFakeTimers();
        const mounted = mountEditor({ text });
        jest.runAllTimers();
        jest.useRealTimers();
        return mounted;
    }
    const pressed: string[] = [];
    const entry = (id: string, text: string, icon?: 'user' | 'users') => ({ id, text, ...(icon ? { icon } : {}), activate: () => void pressed.push(id) });

    test('draws a row above the declaration, in its indentation, and the entries as buttons', () => {
        const { editor, page } = mountLens();
        editor.setCodeVision([{ id: 'two', line: 1, entries: [entry('usages', '2 usages'), entry('authors', 'Ada', 'user')] }]);
        const row = page.host.querySelector('.se-lens') as HTMLElement;
        expect(Number.parseFloat(row.style.left)).toBeCloseTo(4 * 7.8, 1);
        expect(row.style.top).toBe('20px');
        expect([...row.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['2 usages', 'Ada']);
        expect(row.querySelectorAll('.se-lens-icon-user')).toHaveLength(1);
    });

    test('holds its height with no entries, so the text stays put when they arrive', () => {
        const { editor, page } = mountLens();
        const second = () => (page.host.querySelector('[data-line="1"]') as HTMLElement).style.top;
        editor.setCodeVision([{ id: 'two', line: 1, entries: [] }]);
        const reserved = second();
        expect(reserved).toBe('40px');
        editor.setCodeVision([{ id: 'two', line: 1, entries: [entry('usages', 'No usages')] }]);
        expect(second()).toBe(reserved);
        expect(page.host.querySelector('.se-lens')!.textContent).toBe('No usages');
    });

    test('draws an entry again only when its words change, and a press reaches the entry set last', () => {
        const { editor, page } = mountLens();
        editor.setCodeVision([{ id: 'two', line: 1, entries: [entry('usages', '2 usages')] }]);
        const first = page.host.querySelector('.se-lens-entry');
        const calls: string[] = [];
        editor.setCodeVision([{ id: 'two', line: 1, entries: [{ id: 'usages', text: '2 usages', activate: () => void calls.push('new') }] }]);
        expect(page.host.querySelector('.se-lens-entry')).toBe(first);
        (first as HTMLElement).click();
        expect(calls).toEqual(['new']);
        editor.setCodeVision([{ id: 'two', line: 1, entries: [entry('usages', '3 usages')] }]);
        expect(page.host.querySelector('.se-lens-entry')).not.toBe(first);
        expect(page.host.querySelector('.se-lens')!.textContent).toBe('3 usages');
    });

    test('follows its declaration through an edit above it, and leaves the widgets alone', () => {
        const { editor, page, type } = mountLens();
        editor.setWidgets([{ id: 'peek', line: 2, height: 40, render: (container) => (container.textContent = 'peek') }]);
        editor.setCodeVision([{ id: 'two', line: 1, entries: [entry('usages', '2 usages')] }]);
        editor.setCaret({ line: 0, character: 3 });
        type('\nnew');
        expect((page.host.querySelector('.se-lens') as HTMLElement).style.top).toBe('40px');
        expect(page.host.querySelector('.se-widget')!.textContent).toBe('peek');
        editor.setCodeVision([]);
        expect(page.host.querySelectorAll('.se-lens')).toHaveLength(0);
        expect(page.host.querySelectorAll('.se-widget')).toHaveLength(1);
    });
});
