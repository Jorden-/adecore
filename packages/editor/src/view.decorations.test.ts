import { describe, expect, test } from 'bun:test';
import { pointer } from './testing.ts';
import { mount } from './view.fixture.test.ts';

describe('inlays and widgets', () => {
    test('draws an inlay between two characters and keeps it at its character through edits', () => {
        const { host, model, view } = mount('foo(bar)');
        view.setInlays([{ id: 'hint', at: 4, text: 'name:' }]);
        expect(host.querySelector('.se-inlay')!.textContent).toBe('name:');
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(view.layout.geometry(view.layout.rows[0] as never).inlays[0]!.inlay.at).toBe(5);
    });

    test('draws a ghost suggestion after the caret, with its other lines in a row under the line, and drops it on an edit', () => {
        const { host, model, view } = mount('const a = 1;\nreturn a;');
        model.setSelections([{ anchor: 12, head: 12 }]);
        view.setGhost({ at: 12, text: ' // one\n    two\n    three', accessory: (container) => (container.textContent = 'Tab') });
        expect(host.querySelector('.se-ghost')!.textContent).toBe(' // one');
        const rows = [...host.querySelectorAll('.se-ghost-rows .se-code-row')].map((row) => row.textContent);
        expect(rows).toEqual(['    two', '    three']);
        expect(view.layout.rows.map((row) => row.key)).toEqual(['line:0', 'block:__ghost', 'line:1']);
        expect(host.querySelector('.se-line-action')!.textContent).toBe('Tab');
        expect(host.querySelector('.se-ghost-rows.se-widget')).not.toBeNull();
        expect(host.querySelector('.se-line-action.se-ghost-accessory')).not.toBeNull();
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(host.querySelector('.se-ghost')).toBeNull();
        expect(host.querySelector('.se-ghost-rows')).toBeNull();
        expect(host.querySelector('.se-line-action')).toBeNull();
    });

    test('draws a ghost suggestion in front of the stop after it, and takes it away on null', () => {
        const { host, view } = mount('foo');
        const before = view.layout.caret(3, 'after').x;
        view.setGhost({ at: 3, text: '(bar)', accessory: undefined });
        expect(host.querySelector('.se-ghost')).not.toBeNull();
        expect(view.layout.caret(3, 'before').x).toBe(before);
        expect(view.layout.caret(3, 'after').x).toBeGreaterThan(before);
        view.setGhost(null);
        expect(host.querySelector('.se-ghost')).toBeNull();
        expect(view.layout.caret(3, 'after').x).toBe(before);
    });

    test('draws a widget row above a line', () => {
        const { host, view } = mount('a\nb');
        view.setBlockWidgets('test', [{ id: 'w', at: 2, placement: 'above', text: 'hello', height: 30 }]);
        expect(host.querySelector('.se-block')!.textContent).toBe('hello');
        expect(view.layout.rows.map((row) => row.key)).toEqual(['line:0', 'block:w', 'line:1']);
    });

    test('draws a row of the host as wide as the editor, over the gutter', () => {
        const { host, view } = mount('a\nb');
        view.setBlockWidgets('test', [{ id: 'w', at: 2, placement: 'below', height: 30, render: (container) => (container.textContent = 'peek') }]);
        const block = host.querySelector('.se-block') as HTMLElement;
        expect(block.style.left).toBe('-64px');
        expect(block.style.width).toBe('800px');
    });

    test('marks occurrences the host asks for and drops them on an edit', () => {
        const { host, model, view } = mount('ab ab');
        view.setOccurrences([
            { from: 0, to: 2 },
            { from: 3, to: 5 }
        ]);
        expect(host.querySelectorAll('.se-occurrence').length).toBe(2);
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(host.querySelectorAll('.se-occurrence').length).toBe(0);
    });
});

describe('occurrences of the selected text', () => {
    const marks = (host: HTMLElement): number => host.querySelectorAll('.se-occurrence').length;

    test('marks the other places a selection is, softly, in the text and in the scroll track', () => {
        const { host, model, view } = mount('foo bar foo baz Foo');
        model.setSelections([{ anchor: 0, head: 3 }]);
        view.render();
        expect(marks(host)).toBe(2);
        expect(host.querySelectorAll('.se-tick-occurrence').length).toBeGreaterThan(0);
        model.setSelections([{ anchor: 5, head: 5 }]);
        view.render();
        expect(marks(host)).toBe(0);
        expect(host.querySelectorAll('.se-tick-occurrence').length).toBe(0);
    });

    test('leaves out blank text, several lines, several selections and a text that is everywhere', () => {
        const { host, model, view } = mount('a b a\nb a b\n' + 'x '.repeat(60));
        model.setSelections([{ anchor: 1, head: 2 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 0, head: 8 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([
            { anchor: 0, head: 1 },
            { anchor: 4, head: 5 }
        ]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 12, head: 13 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 0, head: 1 }]);
        view.render();
        expect(marks(host)).toBe(2);
    });
});

describe('indent guides, the right margin, whitespace and wrap signs', () => {
    const source = 'class A {\n    method() {\n        body();\n\n        more();\n    }\n}';
    const lefts = (host: HTMLElement, selector: string): string[] =>
        [...host.querySelectorAll(selector)].map((element) => `${(element as HTMLElement).style.left}/${(element as HTMLElement).style.height}`);

    test('draw a line at each level, through blank lines, and the one of the caret`s scope stronger', () => {
        const { host, model, view } = mount(source);
        model.setSelections([{ anchor: model.getLine(2).start + 9, head: model.getLine(2).start + 9 }]);
        view.render();
        expect(lefts(host, '.se-guide:not(.se-guide-active)')).toEqual(['0px/100px']);
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
    });

    test('light the guide a line opens or closes, and the scope of a blank line', () => {
        const { host, model, view } = mount(source);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(1).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
        model.setSelections([{ anchor: model.getLine(6).start, head: model.getLine(6).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['0px/100px']);
        model.setSelections([{ anchor: model.getLine(3).start, head: model.getLine(3).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
    });

    test('light the guide the caret stands on as well, past the first column', () => {
        const nested = 'class A {\n    method() {\n        if (x) {\n            body();\n        }\n    }\n}';
        const { host, model, view } = mount(nested);
        model.setSelections([{ anchor: model.getLine(3).start + 4, head: model.getLine(3).start + 4 }]);
        view.render();
        expect(lefts(host, '.se-guide-active').sort()).toEqual(['31.2px/60px', '62.4px/20px']);
        model.setSelections([{ anchor: model.getLine(3).start, head: model.getLine(3).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['62.4px/20px']);
        model.setSelections([{ anchor: model.getLine(3).start + 14, head: model.getLine(3).start + 14 }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['62.4px/20px']);
    });

    test('draw none when they are off, and the margin only when a column is given', () => {
        const off = mount(source, { guides: false });
        expect(off.host.querySelectorAll('.se-guide').length).toBe(0);
        expect(off.host.querySelector('.se-margin')).toBeNull();
        const margin = mount(source, { rightMargin: 80 });
        expect((margin.host.querySelector('.se-margin') as HTMLElement).style.left).toBe('624px');
    });

    test('draw spaces as dots and tabs as arrows when whitespace shows', () => {
        const plain = mount('a b\n\tc');
        expect(plain.host.querySelector('.se-ws')).toBeNull();
        const shown = mount('a b\n\tc', { whitespace: true });
        expect(shown.host.querySelector('.se-ws')!.textContent).toBe('·');
        expect(shown.host.querySelectorAll('.se-tab-sign').length).toBe(1);
    });

    test('draw an arrow where a wrapped row ends and where the next one starts', () => {
        const { host, view } = mount('abcd '.repeat(40).trimEnd(), { wrap: true });
        Object.defineProperty(view.viewport, 'clientWidth', { value: 400 });
        view.applySettings();
        const signs = [...host.querySelectorAll('.se-wrap-sign')].map((sign) => (sign as HTMLElement).style.left);
        expect(signs.length).toBeGreaterThanOrEqual(2);
        expect(signs).toContain('0px');
    });
});

describe('brackets', () => {
    test('marks a bracket at the caret and its mate', () => {
        const { host, model } = mount('f(a)');
        model.setSelections([{ anchor: 2, head: 2 }]);
        expect(host.querySelectorAll('.se-bracket-match').length).toBe(2);
    });

    test('marks a bracket that has none', () => {
        const { host, model } = mount('f(a');
        model.setSelections([{ anchor: 2, head: 2 }]);
        expect(host.querySelectorAll('.se-bracket-unmatched').length).toBe(1);
    });

    test('marks the mates a frame had no time to lex for in the frames after it', async () => {
        const { host, model, view } = mount(`${'const value = compute(alpha, beta);\n'.repeat(60_000)}f(a)`);
        const caret = model.getLength() - 2;
        model.setSelections([{ anchor: caret, head: caret }]);
        view.revealCaret();
        view.render();
        expect(host.querySelectorAll('.se-bracket-match').length).toBe(0);
        for (let frame = 0; frame < 40 && host.querySelectorAll('.se-bracket-match').length === 0; frame++) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(host.querySelectorAll('.se-bracket-match').length).toBe(2);
    });
});

describe('the notice', () => {
    test('shows a message and takes it away on dispose', () => {
        const { host, view } = mount('a');
        view.notify('Read only');
        expect(host.querySelector('.se-notice')!.textContent).toBe('Read only');
        view.dispose();
        expect(host.querySelector('.se-editor')).toBeNull();
    });
});

describe('change marks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

    test('draw a bar in the gutter beside each marked line and a triangle for a removal', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 2, endLine: 3 },
            { kind: 'modified', startLine: 5, endLine: 5 },
            { kind: 'deleted', startLine: 8, endLine: 8 },
            { kind: 'deleted', startLine: 2, endLine: 2 }
        ]);
        const marked = [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
            const mark = item.querySelector('.se-change');
            return mark ? [`${item.textContent}:${mark.className.replace('se-change se-change-', '')}`] : [];
        });
        expect(marked).toEqual(['2:added', '3:added', '5:modified', '8:deleted']);
    });

    test('give way to the bar of a highlight that draws the gutter as a review, and keep the scroll ticks', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 2, endLine: 3 },
            { kind: 'deleted', startLine: 5, endLine: 5 }
        ]);
        view.setLineHighlights([
            { startLine: 2, endLine: 3, color: '--editor-added', bar: 'solid' },
            { startLine: 5, endLine: 5, color: '--editor-deleted', bar: 'hatched' }
        ]);
        expect(host.querySelectorAll('.se-change').length).toBe(0);
        expect(host.querySelectorAll('.se-line-bar-solid').length).toBe(2);
        expect(host.querySelectorAll('.se-line-bar-hatched').length).toBe(1);
        expect(host.querySelectorAll('.se-line-sign').length).toBe(0);
        expect(host.querySelectorAll('.se-tick-added').length).toBe(1);
        view.setLineHighlights([]);
        expect(host.querySelectorAll('.se-change-deleted').length).toBe(1);
        expect(host.querySelectorAll('.se-line-bar').length).toBe(0);
    });

    test('follow their lines through an edit above them', () => {
        const { host, model, view } = mount(text);
        view.setChangeMarks([{ kind: 'modified', startLine: 5, endLine: 5 }]);
        model.applyEdits([{ from: 0, to: 0, text: 'new\nnew\n' }]);
        const marked = [...host.querySelectorAll('.se-line-number')].filter((item) => item.querySelector('.se-change')).map((item) => item.textContent);
        expect(marked).toEqual(['7']);
    });

    test('layers draw together, the later layer wins a shared line and clearing one leaves the other', () => {
        const { host, view } = mount(text);
        const marked = (): string[] =>
            [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
                const mark = item.querySelector('.se-change');
                return mark ? [`${item.textContent}:${mark.className.replace('se-change se-change-', '')}`] : [];
            });
        view.setChangeMarks([{ kind: 'added', startLine: 2, endLine: 3 }]);
        view.setChangeMarks([{ kind: 'modified', startLine: 3, endLine: 4 }], 'patch');
        expect(marked()).toEqual(['2:added', '3:modified', '4:modified']);
        view.setChangeMarks([], 'patch');
        expect(marked()).toEqual(['2:added', '3:added']);
    });

    test('let the later layer win a shared line for every kind, in the gutter and in the scroll track', () => {
        const { host, view } = mount(text);
        const marked = (): string[] =>
            [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
                const mark = item.querySelector('.se-change');
                return mark ? [`${item.textContent}:${mark.className.replace('se-change se-change-', '')}`] : [];
            });
        const ticks = (): string[] => [...new Set([...host.querySelectorAll('.se-tick')].map((tick) => tick.className.replace('se-tick se-tick-', '')))];
        view.setChangeMarks([{ kind: 'added', startLine: 2, endLine: 3 }]);
        view.setChangeMarks([{ kind: 'deleted', startLine: 3, endLine: 3 }], 'patch');
        expect(marked()).toEqual(['2:added', '3:deleted']);
        view.setChangeMarks([], 'patch');
        view.setChangeMarks([{ kind: 'added', startLine: 10, endLine: 12 }], 'base');
        view.setChangeMarks([{ kind: 'modified', startLine: 10, endLine: 12 }], 'patch');
        expect(marked()).toEqual(['2:added', '3:added', '10:modified', '11:modified', '12:modified']);
        expect(ticks()).toEqual(['added', 'modified']);
    });

    test('keep a removal below an added line of the same layer', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 4, endLine: 4 },
            { kind: 'deleted', startLine: 4, endLine: 4 }
        ]);
        const marked = [...host.querySelectorAll('.se-line-number')].flatMap((item) => (item.querySelector('.se-change-added') ? [item.textContent] : []));
        expect(marked).toEqual(['4']);
    });

    test('and the find matches are ticks in the scroll track', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([{ kind: 'added', startLine: 10, endLine: 12 }]);
        view.setFind({ text: 'line 2', caseSensitive: true, wholeWord: false, regex: false }, false);
        view.render();
        const kinds = [...host.querySelectorAll('.se-tick')].map((tick) => tick.className.replace('se-tick se-tick-', ''));
        expect(kinds).toContain('added');
        expect(kinds).toContain('find-current');
        expect(kinds).toContain('find');
    });
});

describe('attribution marks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const barred = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
            const bar = item.querySelector('.se-attribution') as HTMLElement | null;
            return bar ? [`${item.textContent}:${bar.dataset.attributionId}:${bar.style.background}`] : [];
        });

    test('draw a bar in the gutter on each line of a run, in the color of the mark', () => {
        const { host, view } = mount(text);
        view.setAttributionMarks([
            { id: 'a', startLine: 2, endLine: 3, color: '--agent-1' },
            { id: 'b', startLine: 6, endLine: 6, color: '#c4602f' }
        ]);
        expect(barred(host)).toEqual(['2:a:var(--agent-1)', '3:a:var(--agent-1)', '6:b:#c4602f']);
    });

    test('stand where the change mark of the same line would, and leave a removal', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 2, endLine: 4 },
            { kind: 'deleted', startLine: 6, endLine: 6 },
            { kind: 'modified', startLine: 8, endLine: 8 }
        ]);
        view.setAttributionMarks([
            { id: 'a', startLine: 2, endLine: 3, color: '--agent-1' },
            { id: 'b', startLine: 6, endLine: 6, color: '--agent-1' }
        ]);
        const marks = [...host.querySelectorAll('.se-line-number')].map(
            (item) =>
                `${item.textContent}:${[...item.querySelectorAll('.se-attribution, .se-change')].map((mark) => mark.className.replace('se-change se-change-', 'git-')).join('+')}`
        );
        expect(marks.slice(1, 6)).toEqual(['2:se-attribution', '3:se-attribution', '4:git-added', '5:', '6:se-attribution+git-deleted']);
        expect(marks[7]).toBe('8:git-modified');
    });

    test('follow their lines through an edit above them and are gone once set again', () => {
        const { host, model, view } = mount(text);
        view.setAttributionMarks([{ id: 'a', startLine: 5, endLine: 6, color: '--agent-1' }]);
        model.applyEdits([{ from: 0, to: 0, text: 'new\nnew\n' }]);
        expect(barred(host).map((bar) => bar.split(':')[0])).toEqual(['7', '8']);
        view.setAttributionMarks([]);
        expect(barred(host)).toEqual([]);
    });

    test('report the bar under the pointer and its leaving', () => {
        const { view, window, gutterEdge } = hoverable(text);
        const seen: (string | null)[] = [];
        view.onAttributionHover((hover) => seen.push(hover === null ? null : `${hover.id}:${hover.rect.top}-${hover.rect.bottom}:${hover.rect.right}`));
        view.setAttributionMarks([{ id: 'a', startLine: 2, endLine: 3, color: '--agent-1' }]);
        gutterEdge('pointermove', 1, 2);
        gutterEdge('pointermove', 1, 4);
        gutterEdge('pointermove', 2, 2);
        gutterEdge('pointermove', 2, 20);
        view.gutterElement.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('pointerleave'));
        expect(seen).toEqual(['a:20-40:64', 'a:40-60:64', null]);
        gutterEdge('pointermove', 1, 6);
        gutterEdge('pointermove', 1, 7);
        expect(seen).toEqual(['a:20-40:64', 'a:40-60:64', null, 'a:20-40:64', null]);
    });

    test('are not hovered once taken away, even under a pointer that has not moved', () => {
        const { view, gutterEdge } = hoverable(text);
        const seen: (string | null)[] = [];
        view.onAttributionHover((hover) => seen.push(hover?.id ?? null));
        view.setAttributionMarks([{ id: 'a', startLine: 2, endLine: 3, color: '--agent-1' }]);
        gutterEdge('pointermove', 1, 2);
        view.setAttributionMarks([]);
        expect(seen).toEqual(['a', null]);
    });
});

function hoverable(text: string) {
    const mounted = mount(text);
    mounted.view.render();
    return {
        ...mounted,
        /* A pointer move in the gutter, `fromEdge` pixels left of the text and `line` rows down, zero-based. */
        gutterEdge: (type: 'pointermove', line: number, fromEdge: number) =>
            pointer(mounted.window, mounted.view.gutterElement, type, 64 - fromEdge, line * 20 + 5)
    };
}

describe('scope', () => {
    test('reports the named blocks around the caret when they change', () => {
        const { model, view } = mount('class A {\n  run() {\n    one();\n  }\n}\nconst x = 1;');
        const seen: string[][] = [];
        view.onScope((scope) => seen.push(scope.map((block) => block.name ?? '')));
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(2).start, head: model.getLine(2).start }]);
        model.setSelections([{ anchor: model.getLine(2).start + 1, head: model.getLine(2).start + 1 }]);
        model.setSelections([{ anchor: model.getLine(5).start, head: model.getLine(5).start }]);
        expect(seen).toEqual([['A'], ['A', 'run'], []]);
    });
});

describe('drawing for the host', () => {
    const firstNumber = (host: HTMLElement): Element | null => host.querySelector('.se-line-number');

    test('does not draw again for a setter that has nothing new to say', () => {
        const { host, view } = mount('one\ntwo\nthree');
        view.render();
        let drawn = firstNumber(host);
        const unchanged = (call: () => void): void => {
            call();
            expect(firstNumber(host)).toBe(drawn);
        };
        const changed = (call: () => void): void => {
            call();
            expect(firstNumber(host)).not.toBe(drawn);
            drawn = firstNumber(host);
        };
        unchanged(() => view.setGutterAction(null));
        changed(() => view.setGutterAction({ line: 1, label: 'Show' }));
        unchanged(() => view.setGutterAction({ line: 1, label: 'Show' }));
        changed(() => view.setGutterAction(null));
        unchanged(() => view.setGutterMarkers('inline', []));
        changed(() => view.setGutterMarkers('inline', [{ id: 'a', line: 0, label: 'Open' }]));
        unchanged(() => view.setGutterMarkers('inline', [{ id: 'a', line: 0, label: 'Open' }]));
        changed(() => view.setGutterMarkers('inline', [{ id: 'a', line: 2, label: 'Open' }]));
        unchanged(() => view.setLineActions('ghost', []));
        unchanged(() => view.setOccurrences([]));
    });

    test('reads the size and scroll of the viewport once for a draw, however much it draws', () => {
        const { host, view } = mount('one\ntwo\nthree');
        view.render();
        const viewport = host.querySelector('.se-viewport') as HTMLElement;
        const reads: Record<string, number> = { clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollLeft: 0 };
        for (const name of Object.keys(reads)) {
            Object.defineProperty(viewport, name, {
                get: () => {
                    reads[name]!++;
                    return 0;
                },
                set: () => undefined,
                configurable: true
            });
        }
        view.setGutterAction({ line: 0, label: 'Show' });
        expect(reads).toEqual({ clientWidth: 1, clientHeight: 1, scrollTop: 1, scrollLeft: 1 });
    });
});
