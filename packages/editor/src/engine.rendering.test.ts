import { describe, expect, jest, test } from 'bun:test';
import type { LineTokenizer } from './types.ts';
import { setup, settle } from './engine.fixture.test.ts';

describe('revealing a line', () => {
    test('puts the cursor at the start of the line', () => {
        const { editor, type } = setup();
        editor.revealLine(3);
        type('>');
        expect(editor.getText()).toBe('one\ntwo\n>three');
    });

    test('clamps a line outside the document', () => {
        const { editor, type } = setup();
        editor.revealLine(-4);
        type('>');
        editor.revealLine(40);
        type('<');
        expect(editor.getText()).toBe('>one\ntwo\n<three');
    });
});

describe('coloring', () => {
    function tokenizer(): LineTokenizer {
        return {
            tokenizeLine: (text) => ({ tokens: [{ length: text.length, color: '#112233', fontStyle: 0 }], state: null }),
            sameState: () => true
        };
    }

    test('draws what the language servers classified in the colors of the theme, over the grammar, and keeps it on its text through an edit', async () => {
        const { host, editor, type } = setup(
            { language: 'typescript', text: 'let name = call();' },
            {
                tokenizer: async () => tokenizer(),
                scopeColors: async () => (scopes) => (scopes.includes('entity.name.function') ? { color: '#ff0000', fontStyle: 0 } : undefined)
            }
        );
        await settle();
        editor.setSemanticTokens([
            { line: 0, character: 11, length: 4, scopes: ['meta.function-call', 'entity.name.function'] },
            { line: 0, character: 4, length: 4, scopes: ['variable'] }
        ]);
        const colored = (): string[] =>
            [...host.querySelectorAll('.se-run span')]
                .filter((span) => span.getAttribute('style')?.includes('255, 0, 0') || span.getAttribute('style')?.includes('#ff0000'))
                .map((span) => span.textContent!);
        expect(colored()).toEqual(['call']);
        editor.setCaret({ line: 0, character: 0 });
        type('xx');
        expect(colored()).toEqual(['call']);
        editor.setSemanticTokens(null);
        expect(colored()).toEqual([]);
    });

    test('colors the lines once the tokenizer arrives', async () => {
        const { host } = setup({ language: 'typescript' }, { tokenizer: async () => tokenizer() });
        expect(host.querySelector('.se-run span')).toBeNull();
        await settle();
        expect(host.querySelector('.se-run span')!.getAttribute('style')).toContain('color');
    });

    test('asks for a tokenizer for the language and theme, and again for a new theme', async () => {
        const asked: (string | undefined)[] = [];
        const { editor } = setup(
            { language: 'php', theme: 'light' },
            {
                tokenizer: async (language, theme) => {
                    asked.push(`${language}:${theme}`);
                    return null;
                }
            }
        );
        editor.setTheme('dark');
        editor.setTheme('dark');
        await settle();
        expect(asked).toEqual(['php:light', 'php:dark']);
    });

    test('keeps the latest theme when an earlier one answers last', async () => {
        let resolveFirst: (value: LineTokenizer | null) => void = () => {};
        let calls = 0;
        const { host, editor } = setup(
            { language: 'php', theme: 'light' },
            {
                tokenizer: (_language, _theme) => {
                    calls++;
                    return calls === 1 ? new Promise((resolve) => (resolveFirst = resolve)) : Promise.resolve(null);
                }
            }
        );
        editor.setTheme('dark');
        await settle();
        resolveFirst(tokenizer());
        await settle();
        expect(host.querySelector('.se-run span')).toBeNull();
    });
});

describe('markers', () => {
    const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

    test('draws a squiggle for an error, a tick in the scroll track, and none for a hint', () => {
        const { editor, host } = setup({ text: 'let a = 1;\nlet b = 2;' });
        editor.setMarkers([
            { range: range(0, 4, 5), severity: 'error' },
            { range: range(1, 4, 5), severity: 'hint', unnecessary: true }
        ]);
        expect(host.querySelectorAll('.se-squiggle-error')).toHaveLength(1);
        expect(host.querySelectorAll('.se-squiggle')).toHaveLength(1);
        expect(host.querySelectorAll('.se-faded')).toHaveLength(1);
        expect(host.querySelectorAll('.se-tick-error')).toHaveLength(1);
        expect(host.querySelectorAll('.se-tick-warning')).toHaveLength(0);
    });

    test('strikes through what is deprecated', () => {
        const { editor, host } = setup({ text: 'old()' });
        editor.setMarkers([{ range: range(0, 0, 3), severity: 'hint', deprecated: true }]);
        expect(host.querySelectorAll('.se-struck')).toHaveLength(1);
    });

    test('keeps a marker on its text through an edit before it, and takes them away when asked', () => {
        const { editor, host, type } = setup({ text: 'let a = 1;' });
        editor.setMarkers([{ range: range(0, 4, 5), severity: 'warning' }]);
        editor.setCaret({ line: 0, character: 0 });
        type('xx');
        const squiggle = host.querySelector('.se-squiggle-warning') as HTMLElement;
        const before = Number.parseFloat(squiggle.style.left);
        expect(before).toBeGreaterThan(0);
        editor.setMarkers([]);
        expect(host.querySelectorAll('.se-squiggle')).toHaveLength(0);
    });
});

describe('keys and positions', () => {
    test('lets a handler take a key before the editor does', () => {
        const { editor, press } = setup({ text: 'abc' });
        let seen = '';
        const off = editor.onKeyDown((event) => {
            seen += event.key;
            return event.key === 'Enter';
        });
        expect(press('Enter')).toBe(true);
        expect(editor.getText()).toBe('abc');
        press('Home');
        expect(seen).toBe('EnterHome');
        off();
        press('Enter');
        expect(editor.getText()).not.toBe('abc');
    });

    test('says where the caret is and moves it', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        const heard: unknown[] = [];
        editor.onCaret((position) => heard.push(position));
        editor.setCaret({ line: 1, character: 2 });
        expect(editor.getCaret()).toEqual({ line: 1, character: 2 });
        expect(heard).toEqual([{ line: 1, character: 2 }]);
    });

    test('applies edits in the coordinates of the current text, as one step', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });
        expect(
            editor.applyEdits([
                { range: range(0, 0, 3), text: 'uno' },
                { range: range(1, 0, 3), text: 'dos' }
            ])
        ).toBe(true);
        expect(editor.getText()).toBe('uno\ndos');
    });
});

describe('setRemoteCursors', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const carets = (host: HTMLElement) =>
        [...host.querySelectorAll('.se-remote-caret')].map((caret) => {
            const element = caret as HTMLElement;
            const label = element.querySelector('.se-remote-label') as HTMLElement;
            return `${label.textContent}@${element.style.left},${element.style.top}${label.dataset.below ? ' below' : ''}`;
        });

    test('draws a caret with its name, and the name under it on the first line where there is no room above', () => {
        const { editor, host } = setup({ text });
        editor.setRemoteCursors([
            { id: 'a', position: { line: 5, character: 3 }, name: 'Claude Code', color: '--agent-1' },
            { id: 'b', position: { line: 0, character: 0 }, name: 'Codex', color: '#336699' }
        ]);
        expect(carets(host)).toEqual(['Claude Code@23px,100px', 'Codex@0px,0px below']);
        const label = host.querySelector('.se-remote-label') as HTMLElement;
        expect(label.style.background).toBe('var(--agent-1)');
        expect(host.querySelector('.se-remote')!.getAttribute('aria-hidden')).toBe('true');
    });

    test('follows its text through an edit, and is gone once set again', () => {
        const { editor, host } = setup({ text });
        editor.setRemoteCursors([{ id: 'a', position: { line: 5, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'new\n' }]);
        expect(carets(host)).toEqual(['Claude Code@0px,120px']);
        editor.setRemoteCursors([]);
        expect(carets(host)).toEqual([]);
    });

    test('draws nothing for a cursor on a line a fold hides', () => {
        const { editor, host } = setup({
            text: 'one\nfunction a() {\n    body();\n}\ntwo',
            language: 'typescript',
            folds: { collapsed: [{ startLine: 1, endLine: 3 }], custom: [] }
        });
        editor.setRemoteCursors([{ id: 'a', position: { line: 2, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(carets(host)).toEqual([]);
        editor.setRemoteCursors([{ id: 'a', position: { line: 1, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(carets(host)).toEqual(['Claude Code@0px,20px']);
    });

    test('leaves the real caret and selection alone', () => {
        const { editor } = setup({ text });
        editor.setCaret({ line: 2, character: 1 });
        editor.setRemoteCursors([{ id: 'a', position: { line: 5, character: 0 }, name: 'Claude Code', color: '--agent-1' }]);
        expect(editor.getCaret()).toEqual({ line: 2, character: 1 });
    });
});

describe('setLineHighlights', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const tinted = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('.se-line-highlight')].map((element) => `${(element as HTMLElement).style.top}:${(element as HTMLElement).style.background}`);

    test('tints each row of the lines and follows them through an edit', () => {
        const { editor, host } = setup({ text });
        editor.setLineHighlights([{ startLine: 3, endLine: 4, color: '--agent-3' }]);
        const tint = 'color-mix(in srgb, var(--agent-3) 14%, transparent)';
        expect(tinted(host)).toEqual([`40px:${tint}`, `60px:${tint}`]);
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'new\n' }]);
        expect(tinted(host)).toEqual([`60px:${tint}`, `80px:${tint}`]);
        editor.setLineHighlights([]);
        expect(tinted(host)).toEqual([]);
    });

    test('fills the rows with the fill as it stands, and keeps the color for the sign', () => {
        const { editor, host } = setup({ text });
        editor.setLineHighlights([
            { startLine: 3, endLine: 3, color: '--accent', fill: '--editor-selection' },
            { startLine: 4, endLine: 4, color: '--accent' }
        ]);
        expect(tinted(host)).toEqual(['40px:var(--editor-selection)', '60px:color-mix(in srgb, var(--accent) 14%, transparent)']);
        const numbers = [...host.querySelectorAll('.se-line-number')] as HTMLElement[];
        expect(numbers.filter((number) => number.style.background !== '').map((number) => number.textContent)).toEqual(['3']);
    });

    test('keeps a row of a widget between two tinted lines clear, and puts the sign in the gutter', () => {
        jest.useFakeTimers();
        const { editor, host } = setup({ text });
        jest.runAllTimers();
        jest.useRealTimers();
        editor.setWidgets([{ id: 'removed', line: 3, height: 40, render: (container) => (container.textContent = 'old') }]);
        editor.setLineHighlights([{ startLine: 4, endLine: 5, color: '#336699', sign: '+' }]);
        expect(tinted(host).map((entry) => entry.split(':')[0])).toEqual(['60px', '120px']);
        const signs = [...host.querySelectorAll('.se-line-sign')].map((sign) => sign.textContent);
        expect(signs).toEqual(['+', '+']);
    });
});

describe('line emphasis', () => {
    const boxes = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll('.se-line-emphasis')] as HTMLElement[];

    test('follows characters through insertions and removes a replaced word', () => {
        const { editor, host } = setup({ text: 'one two three' });
        editor.setLineHighlights([{ startLine: 1, endLine: 1, color: '--editor-added', sign: '+', emphasis: [[[4, 7]]] }]);
        const before = parseFloat(boxes(host)[0]!.style.left);
        expect(boxes(host)[0]!.style.background).toContain('var(--editor-added) 22%');
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'new ' }]);
        expect(parseFloat(boxes(host)[0]!.style.left)).toBeGreaterThan(before);
        editor.applyEdits([{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } }, text: '' }]);
        expect(boxes(host)).toEqual([]);
        expect(host.querySelector('.se-line-sign')!.textContent).toBe('+');
    });

    test('splits emphasis at a newly inserted newline and removes it with its highlight', () => {
        const { editor, host } = setup({ text: 'one word end' });
        editor.setLineHighlights([{ startLine: 1, endLine: 1, color: '--editor-added', emphasis: [[[4, 8]]] }]);
        editor.applyEdits([{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, text: '\n' }]);
        expect(boxes(host).map((box) => box.style.top)).toEqual(['0px', '20px']);
        editor.setLineHighlights([]);
        expect(boxes(host)).toEqual([]);
    });

    test('uses tab geometry and UTF-16 ranges, and lets a later highlight replace emphasis', () => {
        const { editor, host } = setup({ text: '\t😀word', indentation: { tabSize: 4, insertSpaces: false } });
        editor.setLineHighlights([{ startLine: 1, endLine: 1, color: '--editor-added', emphasis: [[[3, 7]]] }]);
        const left = parseFloat(boxes(host)[0]!.style.left);
        expect(left).toBeGreaterThan(4 * 7.8);
        expect(parseFloat(boxes(host)[0]!.style.width)).toBeCloseTo(4 * 7.8);
        editor.setLineHighlights([
            { startLine: 1, endLine: 1, color: '--editor-added', emphasis: [[[3, 7]]] },
            { startLine: 1, endLine: 1, color: '--editor-deleted' }
        ]);
        expect(boxes(host)).toEqual([]);
    });

    test('draws an emphasized range on each wrapped row it reaches', () => {
        const { editor, host, viewport } = setup({ text: 'word '.repeat(80) });
        Object.defineProperty(viewport, 'clientWidth', { value: 400 });
        editor.setWrap(true);
        editor.setLineHighlights([{ startLine: 1, endLine: 1, color: '--editor-added', emphasis: [[[0, 400]]] }]);
        expect(boxes(host).length).toBeGreaterThan(1);
        expect(new Set(boxes(host).map((box) => box.style.top)).size).toBe(boxes(host).length);
        expect(boxes(host).every((box) => parseFloat(box.style.width) > 0)).toBe(true);
    });
});

describe('renderCode', () => {
    const tokenizer: LineTokenizer = {
        tokenizeLine: (text) => ({
            tokens: [
                { length: 3, color: '#112233', fontStyle: 0 },
                { length: Math.max(0, text.length - 3), color: '', fontStyle: 0 }
            ],
            state: null
        }),
        sameState: () => true
    };

    test('reuses prepared document tokens on every widget render without local tokenization', async () => {
        const tokenizeLine = jest.fn(tokenizer.tokenizeLine);
        const { editor, host } = setup({ language: 'typescript', text: 'source' }, { tokenizer: async () => ({ ...tokenizer, tokenizeLine }) });
        await settle();
        tokenizeLine.mockClear();
        for (let i = 0; i < 2; i++) {
            const container = host.ownerDocument.createElement('div');
            editor.renderCode(container, 'inside comment\r\nstill inside', {
                tokens: [[{ length: 14, color: '#336699', fontStyle: 1, kind: 'comment' }], [{ length: 12, color: '#336699', fontStyle: 1, kind: 'comment' }]],
                color: '--editor-deleted',
                emphasis: [[[7, 14]]]
            });
            expect([...container.querySelectorAll('.se-code-text')].map((line) => line.textContent)).toEqual(['inside comment', 'still inside']);
            expect(container.querySelector('.se-code-emphasis')!.textContent).toBe('comment');
            expect((container.querySelector('.se-code-emphasis') as HTMLElement).style.fontStyle).toBe('italic');
            expect((container.querySelector('.se-code-emphasis') as HTMLElement).style.color).toBe('#336699');
        }
        expect(tokenizeLine).not.toHaveBeenCalled();
        const plain = host.ownerDocument.createElement('div');
        editor.renderCode(plain, 'plain', { tokens: null });
        expect(plain.querySelector('.se-code-text')!.textContent).toBe('plain');
        expect(plain.querySelector('.se-code-text span')).toBeNull();
        expect(tokenizeLine).not.toHaveBeenCalled();
        editor.dispose();
    });

    test('draws lines in the editor colors with a gutter column, numbers, a sign and a tinted bar', async () => {
        const { editor, host } = setup({ language: 'typescript' }, { tokenizer: async () => tokenizer });
        await settle();
        const container = host.ownerDocument.createElement('div');
        editor.renderCode(container, 'let a = 1;\nlet b = 2;', { firstLine: 14, sign: '-', color: '--agent-1' });
        const rows = [...container.querySelectorAll('.se-code-row')];
        expect(rows.map((row) => row.querySelector('.se-code-text')!.textContent)).toEqual(['let a = 1;', 'let b = 2;']);
        expect(rows.map((row) => row.querySelector('.se-code-gutter span')!.textContent)).toEqual(['14', '15']);
        expect(rows[0]!.querySelector('.se-line-sign')!.textContent).toBe('-');
        expect((rows[0] as HTMLElement).style.background).toBe('color-mix(in srgb, var(--agent-1) 14%, transparent)');
        expect((rows[0]!.querySelector('.se-attribution') as HTMLElement).style.background).toBe('var(--agent-1)');
        expect(rows[0]!.querySelector('.se-code-text span')!.getAttribute('style')).toContain('#112233');
    });

    test('cuts a colored token at an emphasis, marks only that piece and fades the text', async () => {
        const { editor, host } = setup({ language: 'typescript' }, { tokenizer: async () => tokenizer });
        await settle();
        const container = host.ownerDocument.createElement('div');
        editor.renderCode(container, 'let a = 1;', { color: '--agent-1', faded: true, emphasis: [[[1, 5]]] });
        const text = container.querySelector('.se-code-text') as HTMLElement;
        expect(text.dataset.faded).toBe('true');
        expect(text.textContent).toBe('let a = 1;');
        expect([...text.querySelectorAll('.se-code-emphasis')].map((piece) => piece.textContent)).toEqual(['et', ' a']);
        expect((container.querySelector('.se-code-row') as HTMLElement).style.getPropertyValue('--se-emphasis')).toBe('var(--agent-1)');
    });

    test('marks an emphasis in text that has no colors', () => {
        const { editor, host } = setup();
        const container = host.ownerDocument.createElement('div');
        editor.renderCode(container, 'one two', { color: '#f26065', emphasis: [[[4, 7]]] });
        expect([...container.querySelectorAll('.se-code-emphasis')].map((piece) => piece.textContent)).toEqual(['two']);
    });

    test('draws plain text without a tokenizer, a gutter and a color', () => {
        const { editor, host } = setup();
        const container = host.ownerDocument.createElement('div');
        editor.renderCode(container, 'one');
        expect(container.querySelector('.se-code-text')!.textContent).toBe('one');
        expect(container.querySelector('.se-code-gutter')!.children).toHaveLength(0);
    });
});

describe('line actions', () => {
    const text = 'one\ntwo\nthree\n';

    test('draws the host element once after the last character of its line and keeps it through an edit above', () => {
        const { editor, host } = setup({ text });
        let renders = 0;
        editor.setLineActions([{ id: 'keep', line: 1, render: (container) => ((container.textContent = 'Keep'), renders++) }], 'review');
        const element = () => host.querySelector('.se-line-action') as HTMLElement;
        expect(element().textContent).toBe('Keep');
        expect(element().hidden).toBe(false);
        const before = element().style.top;
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'zero\n' }]);
        expect(element().style.top).not.toBe(before);
        expect(renders).toBe(1);
    });

    test('keeps one owner apart from another and takes the elements of an owner away with an empty set', () => {
        const { editor, host } = setup({ text });
        editor.setLineActions([{ id: 'a', line: 0, render: (container) => (container.textContent = 'a') }], 'one');
        editor.setLineActions([{ id: 'b', line: 1, render: (container) => (container.textContent = 'b') }], 'two');
        expect([...host.querySelectorAll('.se-line-action')].map((element) => element.textContent)).toEqual(['a', 'b']);
        editor.setLineActions([], 'one');
        expect([...host.querySelectorAll('.se-line-action')].map((element) => element.textContent)).toEqual(['b']);
    });

    test('a press on the element stops at it, so the editor never moves the caret for it', () => {
        const { editor, host, window } = setup({ text });
        editor.setLineActions([{ id: 'a', line: 0, render: (container) => container.append(container.ownerDocument.createElement('button')) }]);
        const reached: string[] = [];
        host.addEventListener('pointerdown', () => reached.push('host'));
        const press = new (window as unknown as { Event: typeof Event }).Event('pointerdown', { bubbles: true });
        host.querySelector('.se-line-action button')!.dispatchEvent(press);
        expect(reached).toEqual([]);
    });
});
