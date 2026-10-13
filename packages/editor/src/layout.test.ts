import { describe, expect, test, spyOn } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { EditorLayout, type LayoutConfig, type LayoutMetrics, type TextRow, scanLine, wrapIndent, wrapStops } from './layout.ts';

/* Every character is 10px wide, a line 20px tall, so the numbers in an assertion can be read off the text. */
const METRICS: LayoutMetrics = {
    lineHeight: 20,
    charWidth: 10,
    tabSize: 4,
    measureText: (text) => Array.from(text).length * 20,
    measureInlay: (text) => text.length * 6
};

function layoutOf(text: string, wrapWidth: number | null = null): { layout: EditorLayout; model: DocumentModel } {
    const model = new DocumentModel(text);
    const layout = new EditorLayout(model, METRICS);
    if (wrapWidth !== null) {
        layout.configure({ wrapWidth });
    }
    return { layout, model };
}

describe('rows', () => {
    test('stack one row per line from the top', () => {
        const { layout } = layoutOf('one\ntwo\nthree');
        expect(layout.rows.map((row) => [row.key, row.top, row.height])).toEqual([
            ['line:0', 0, 20],
            ['line:1', 20, 20],
            ['line:2', 40, 20]
        ]);
        expect(layout.height).toBe(60 + 8);
    });

    test('find the row at a height and list the rows around a viewport', () => {
        const { layout } = layoutOf(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'));
        expect(layout.rowAt(45).line).toBe(2);
        expect(layout.rowAt(-10).line).toBe(0);
        expect(layout.rowAt(1e6).line).toBe(99);
        const visible = layout.visibleRows(400, 100, 0);
        expect(visible[0]!.line).toBe(20);
        expect(visible.at(-1)!.line).toBe(24);
    });

    test('hide the lines a collapsed fold covers', () => {
        const { layout } = layoutOf('a\nb\nc\nd\ne');
        layout.configure({ folds: [{ startLine: 1, endLine: 3, collapsed: true }] });
        expect(layout.rows.map((row) => row.line)).toEqual([0, 1, 4]);
        expect(layout.isHidden(2)).toBe(true);
        expect(layout.isHidden(4)).toBe(false);
        expect(layout.rowForLine(3).line).toBe(1);
    });

    test('put a widget above or below its line with its own height', () => {
        const { layout } = layoutOf('one\ntwo');
        layout.configure({
            blocks: [
                { id: 'a', at: 4, placement: 'above', height: 30 },
                { id: 'b', at: 0, placement: 'below', height: 10 }
            ]
        });
        expect(layout.rows.map((row) => [row.key, row.top, row.height])).toEqual([
            ['line:0', 0, 20],
            ['block:b', 20, 10],
            ['block:a', 30, 30],
            ['line:1', 60, 20]
        ]);
        expect(layout.setMeasuredHeight('block:a', 50)).toBe(true);
        expect(layout.rows.at(-1)!.top).toBe(80);
    });
});

describe('lens rows', () => {
    test('are one code line high whatever they were given, and sit above the line they follow', () => {
        const { layout } = layoutOf('one\n    two');
        layout.configure({ blocks: [{ id: 'l', at: 8, placement: 'above', height: 99, lens: true }] });
        expect(layout.rows.map((row) => [row.key, row.top, row.height])).toEqual([
            ['line:0', 0, 20],
            ['block:l', 20, 20],
            ['line:1', 40, 20]
        ]);
        expect(layout.setMeasuredHeight('block:l', 99)).toBe(true);
        layout.configure({ metrics: { ...METRICS, lineHeight: 24 } });
        expect(layout.rows[1]!.height).toBe(24);
    });

    test('begin where the indentation of their line ends, tabs included', () => {
        const { layout } = layoutOf('one\n    two\n\tthree\n');
        expect(layout.indentX(0)).toBe(0);
        expect(layout.indentX(1)).toBe(40);
        expect(layout.indentX(2)).toBe(40);
    });
});

describe('geometry', () => {
    test('places each character at its width and tabs on the next stop', () => {
        const { layout } = layoutOf('a\tb');
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.before).toEqual([0, 10, 40, 50]);
        expect(geometry.runs.map((run) => [run.text, run.x])).toEqual([
            ['a', 0],
            ['b', 40]
        ]);
    });

    test('keeps a combined character whole', () => {
        const { layout } = layoutOf('éx');
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.offsets).toEqual([0, 2, 3]);
    });

    test('draws a composition as text, without the padding of an inlay', () => {
        const { layout } = layoutOf('ab');
        layout.configure({ inlays: [{ id: 'composition', at: 1, text: "'", composition: true }] });
        expect(layout.geometry(layout.rows[0] as never).inlays[0]).toMatchObject({ x: 10, width: 20 });
    });

    test('adds an inlay between two characters', () => {
        const { layout } = layoutOf('ab');
        layout.configure({ inlays: [{ id: 'hint', at: 1, text: 'xx' }] });
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.inlays[0]).toMatchObject({ x: 10, width: 24 });
        expect(geometry.before[1]).toBe(10);
        expect(geometry.after[1]).toBe(34);
        expect(geometry.width).toBe(44);
    });
});

describe('hit testing and caret', () => {
    test('map a point to the nearest offset and back', () => {
        const { layout } = layoutOf('hello\nworld');
        expect(layout.hitTest(0, 5)).toBe(0);
        expect(layout.hitTest(14, 5)).toBe(1);
        expect(layout.hitTest(16, 5)).toBe(2);
        expect(layout.hitTest(500, 5)).toBe(5);
        expect(layout.hitTest(26, 30)).toBe(9);
        expect(layout.caret(9)).toMatchObject({ x: 30, y: 20, height: 20 });
    });

    test('answer a click below the last line with the end of the document', () => {
        const { layout } = layoutOf('ab\ncd');
        expect(layout.hitTest(0, 9999)).toBe(3);
    });

    test('draw a range as one box per line, and a line break as one extra character', () => {
        const { layout, model } = layoutOf('abc\ndef');
        const rects = layout.rectangles(1, 6, layout.rows);
        expect(rects).toEqual([
            { x: 10, y: 0, width: 20 + 10, height: 20 },
            { x: 0, y: 20, width: 20, height: 20 }
        ]);
        expect(model.getLength()).toBe(7);
    });
});

describe('movement', () => {
    test('step a character at a time over the end of a line', () => {
        const { layout } = layoutOf('ab\ncd');
        expect(layout.horizontalOffset(1, 1)).toBe(2);
        expect(layout.horizontalOffset(2, 1)).toBe(3);
        expect(layout.horizontalOffset(3, -1)).toBe(2);
        expect(layout.horizontalOffset(0, -1)).toBe(0);
        expect(layout.horizontalOffset(5, 1)).toBe(5);
    });

    test('go up and down at a column and stop at the ends of the document', () => {
        const { layout } = layoutOf('abcdef\nab\nabcdef');
        expect(layout.verticalOffset(4, 1, 40)).toBe(9);
        expect(layout.verticalOffset(9, 1, 40)).toBe(14);
        expect(layout.verticalOffset(14, -1, 40)).toBe(9);
        expect(layout.verticalOffset(2, -1, 20)).toBe(0);
        expect(layout.verticalOffset(14, 1, 40)).toBe(16);
    });

    test('go to the ends of the document when a rendered row is all that lies beyond the caret', () => {
        const first = layoutOf('/** a */\nab\ncd');
        first.layout.configure({ replacements: [{ id: 'r', from: 0, to: 8, render: () => undefined }] });
        expect(first.layout.verticalOffset(10, -1, 10)).toBe(0);
        const last = layoutOf('ab\ncd\n/** a */');
        last.layout.configure({ replacements: [{ id: 'r', from: 6, to: 14, render: () => undefined }] });
        expect(last.layout.verticalOffset(4, 1, 10)).toBe(14);
    });

    test('walk over a widget between two lines', () => {
        const { layout } = layoutOf('ab\ncd');
        layout.configure({ blocks: [{ id: 'w', at: 3, placement: 'above', height: 30 }] });
        expect(layout.verticalOffset(1, 1, 10)).toBe(4);
    });
});

describe('soft wrap', () => {
    const offsetsOf = (text: string): number[] => Array.from({ length: text.length + 1 }, (_, i) => i);

    test('breaks after the space a word ends in', () => {
        const text = 'aaa bbb ccc';
        expect(wrapStops(text, offsetsOf(text), METRICS, 60)).toEqual([4, 8]);
        expect(wrapStops(text, offsetsOf(text), METRICS, 1000)).toEqual([]);
    });

    test('breaks in the middle of a word that is longer than the line', () => {
        const text = 'abcdefghijkl';
        // Continuation rows start two characters in, so they hold two characters fewer.
        expect(wrapStops(text, offsetsOf(text), METRICS, 60)).toEqual([6, 10]);
    });

    test('lets trailing spaces hang over the edge instead of wrapping them', () => {
        const text = 'ab     cd';
        expect(wrapStops(text, offsetsOf(text), METRICS, 40)).toEqual([7]);
    });

    test('indents continuation rows to the line indentation plus a step', () => {
        const text = '    aaa bbb ccc';
        expect(wrapIndent(text, METRICS, 200)).toBe(60);
        const geometry = scanLine({ start: 0, end: text.length, text }, METRICS, 120, []);
        expect(geometry.runs.filter((run) => run.subRow > 0).every((run) => run.x === 60)).toBe(true);
        expect(geometry.before[geometry.rowStarts[1]!]).toBe(60);
    });

    test('keeps the indent of a deeply indented line to half the row', () => {
        expect(wrapIndent(' '.repeat(30) + 'x', METRICS, 100)).toBe(50);
    });

    test('lays a wrapped line over several visual lines', () => {
        const geometry = scanLine({ start: 0, end: 11, text: 'aaa bbb ccc' }, METRICS, 60, []);
        expect(geometry.subRows).toBe(3);
        expect(geometry.rowOf).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
        expect(geometry.runs.map((run) => [run.text, run.subRow, run.x])).toEqual([
            ['aaa bbb ccc'.slice(0, 4), 0, 0],
            ['bbb ', 1, 20],
            ['ccc', 2, 20]
        ]);
    });

    test('grows a row to the lines it wraps into once the row is drawn', () => {
        const { layout } = layoutOf('aaa bbb ccc\nshort', 60);
        // The estimate is by length alone, which a wrap at word ends can exceed.
        const before = layout.rows[0]!.height;
        expect(layout.syncRows(layout.rows)).toBe(before !== 60);
        expect(layout.rows[0]).toMatchObject({ subRows: 3, height: 60 });
        expect(layout.rows[1]).toMatchObject({ top: 60, height: 20 });
    });

    test('puts the caret on the visual line a character is on', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.caret(5)).toMatchObject({ x: 30, y: 20 });
        expect(layout.caret(9)).toMatchObject({ x: 30, y: 40 });
    });

    test('hits the character under a point on a wrapped line, and the end of a visual line', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.hitTest(34, 25)).toBe(5);
        expect(layout.hitTest(400, 5)).toBe(4);
        expect(layout.hitTest(400, 45)).toBe(11);
    });

    test('says a click past the end of a visual line is at its end, and draws the caret there', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.hitTestRow(400, 5)).toEqual({ offset: 4, rowEnd: true });
        expect(layout.hitTestRow(400, 45)).toEqual({ offset: 11, rowEnd: false });
        expect(layout.caret(4)).toMatchObject({ x: 20, y: 20 });
        expect(layout.caret(4, 'after', true)).toMatchObject({ x: 40, y: 0 });
    });

    test('goes down a visual line and not a document line', () => {
        const { layout } = layoutOf('aaa bbb ccc\nx', 60);
        layout.syncRows(layout.rows);
        expect(layout.verticalOffset(5, 1, 30)).toBe(9);
        expect(layout.verticalOffset(9, 1, 30)).toBe(13);
    });

    test('draws a selection across a wrap as a box on each visual line', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.rectangles(2, 9, layout.rows)).toEqual([
            { x: 20, y: 0, width: 20, height: 20 },
            { x: 20, y: 20, width: 40, height: 20 },
            { x: 20, y: 40, width: 10, height: 20 }
        ]);
    });
});

describe('visual lines', () => {
    test('are the rows of a wrapped line, each with where the next one starts', () => {
        const { layout } = layoutOf('aaaa bbbb cccc\nz', 100);
        expect(layout.visualLine(0)).toMatchObject({ start: 0, end: 10, next: 10 });
        expect(layout.visualLine(7)).toMatchObject({ start: 0, end: 10, next: 10 });
        expect(layout.visualLine(12)).toMatchObject({ start: 10, end: 14, next: 15 });
        expect(layout.visualLine(15)).toMatchObject({ start: 15, end: 16, next: 16 });
    });

    test('take a collapsed fold as one line that ends where the fold does', () => {
        const { layout } = layoutOf('a\nb\nc\nd');
        layout.configure({ folds: [{ startLine: 1, endLine: 2, collapsed: true }] });
        expect(layout.visualLine(3)).toMatchObject({ start: 2, end: 5, next: 6 });
        expect(layout.visualLine(4)).toMatchObject({ start: 2, end: 5, next: 6 });
    });
});

describe('visible range geometry', () => {
    test('clips a full selection to the viewport without changing its visible boxes', () => {
        const text = 'word '.repeat(2000);
        const { layout } = layoutOf(text, 100);
        layout.syncRows(layout.rows);
        const window = { top: 2003, bottom: 2117 };
        const all = layout.rectangles(0, text.length, layout.rows);
        const visible = layout.rectangles(0, text.length, layout.rows, window);
        expect(visible).toEqual(all.filter((rect) => rect.y < window.bottom && rect.y + rect.height > window.top));
        expect(visible.length).toBeLessThanOrEqual(7);
        expect(layout.rectangles(0, 4, layout.rows, window)).toEqual([]);
    });

    test('keeps affinity around inlays when the viewport clips a range', () => {
        const { layout } = layoutOf('word '.repeat(100), 100);
        layout.configure({ inlays: [{ id: 'hint', at: 205, text: 'hint' }] });
        layout.syncRows(layout.rows);
        const window = { top: 380, bottom: 460 };
        const all = layout.rectangles(202, 231, layout.rows);
        expect(layout.rectangles(202, 231, layout.rows, window)).toEqual(all.filter((rect) => rect.y < window.bottom && rect.y + rect.height > window.top));
    });
});

test('a narrow wrapped line with more subrows than a function argument limit keeps its width', () => {
    const text = 'x'.repeat(150000);
    const geometry = scanLine({ start: 0, end: text.length, text }, METRICS, 20, []);
    expect(geometry.subRows).toBeGreaterThan(100000);
    expect(geometry.width).toBe(20);
});

describe('geometry across edits', () => {
    test('an edit outside a long line retains its geometry and measured wrap height', () => {
        const { model, layout } = layoutOf('word '.repeat(2000) + '\nshort', 100);
        layout.syncRows(layout.rows);
        const before = layout.geometry(layout.rows[0] as TextRow);
        const height = layout.rows[0]!.height;
        const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes }));
        model.applyEdits([{ from: model.getLength() - 1, to: model.getLength(), text: 'Z' }]);
        expect(layout.geometry(layout.rows[0] as TextRow) === before).toBe(true);
        expect(layout.rows[0]!.height).toBe(height);
        subscription.dispose();
    });

    test('newlines before a cached line move its origin without copying character arrays', () => {
        const { model, layout } = layoutOf('first\nword '.repeat(20) + '\nlast', 100);
        layout.syncRows(layout.rows);
        const before = layout.geometry(layout.rows[1] as TextRow);
        const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes }));
        model.applyEdits([{ from: 0, to: 1, text: 'new\nlines' }]);
        const after = layout.geometry(layout.rows[2] as TextRow);
        expect(after.offsets === before.offsets).toBe(true);
        expect(after.runs === before.runs).toBe(true);
        expect(after).toEqual(scanLine(model.getLine(2), METRICS, 100, []));
        subscription.dispose();
    });

    test('cached geometry stays equal to a fresh scan across edits, undo and redo', () => {
        const { model, layout } = layoutOf('first\nword '.repeat(20) + '\n😀 é\r\nlast', 100);
        const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes }));
        let seed = 913;
        const random = (limit: number): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed % limit;
        };
        const verify = (): void => {
            layout.syncRows(layout.rows);
            for (const row of layout.rows) {
                if (row.kind === 'text') {
                    expect(layout.geometry(row)).toEqual(scanLine(model.getLine(row.line), METRICS, 100, []));
                }
            }
        };
        verify();
        for (let index = 0; index < 100; index++) {
            let from = random(model.getLength() + 1);
            let to = Math.min(model.getLength(), from + random(5));
            const split = (at: number): boolean => /[\uD800-\uDBFF]/.test(model.slice(at - 1, at)) && /[\uDC00-\uDFFF]/.test(model.slice(at, at + 1));
            if (from > 0 && split(from)) {
                from--;
            }
            if (to < model.getLength() && split(to)) {
                to++;
            }
            const text = ['x', '\n', '\r\n', '\t', '😀', 'é', ''][random(7)]!;
            model.applyEdits([{ from, to, text }]);
            verify();
            if (index % 9 === 0) {
                model.undo();
                verify();
                model.redo();
                verify();
            }
        }
        subscription.dispose();
    });
});

test('moving an inlay across a newline invalidates only the geometry that carries it', () => {
    const { model, layout } = layoutOf('first\nword text\nlast', 100);
    layout.configure({ inlays: [{ id: 'hint', at: 8, text: 'hint' }] });
    layout.syncRows(layout.rows);
    const before = layout.geometry(layout.rows[2] as TextRow);
    const subscription = model.subscribe((snapshot) =>
        layout.configure({ textChanged: true, changes: snapshot.changes, inlays: [{ id: 'hint', at: 12, text: 'hint' }] })
    );
    model.applyEdits([{ from: 0, to: 1, text: 'new\nx' }]);
    const untouched = layout.geometry(layout.rows[3] as TextRow);
    expect(untouched.offsets === before.offsets).toBe(true);
    expect(layout.geometry(layout.rows[2] as TextRow)).toEqual(scanLine(model.getLine(2), METRICS, 100, [{ id: 'hint', at: 12, text: 'hint' }]));
    subscription.dispose();
});

test('grouped undo and redo remap cached lines through every transaction', () => {
    const { model, layout } = layoutOf('first\nword '.repeat(20), 100);
    let transactions = 0;
    const subscription = model.subscribe((snapshot) => {
        transactions = snapshot.changes?.length ?? 0;
        layout.configure({ textChanged: true, changes: snapshot.changes });
    });
    layout.syncRows(layout.rows);
    model.applyEdits([{ from: 0, to: 1, text: 'x' }], { historyGroup: 'typing' });
    model.applyEdits([{ from: 1, to: 1, text: '\n' }], { historyGroup: 'typing' });
    for (const action of ['undo', 'redo'] as const) {
        model[action]();
        expect(transactions).toBe(2);
        layout.syncRows(layout.rows);
        for (const row of layout.rows) {
            if (row.kind === 'text') {
                expect(layout.geometry(row)).toEqual(scanLine(model.getLine(row.line), METRICS, 100, []));
            }
        }
    }
    subscription.dispose();
});

for (const wrap of [false, true]) {
    test(`scroll history keeps edit mapping bounded, wrap=${wrap}`, () => {
        const { model, layout } = layoutOf('a short line\n'.repeat(3000), wrap ? 100 : null);
        for (let first = 0; first < layout.rows.length; first += 20) {
            layout.syncRows(layout.rows.slice(first, first + 20));
        }
        const positions = spyOn(model, 'positionAt');
        const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes }));
        model.applyEdits([{ from: 0, to: 1, text: 'Z' }]);
        // One per remembered line, and the two ends of the edit.
        expect(positions.mock.calls.length).toBeLessThanOrEqual((wrap ? 800 : 400) + 2);
        positions.mockRestore();
        subscription.dispose();
    });
}

/* Sorted by where they start, without the ones that overlap one before them. */
function apart<Edit extends { from: number; to: number }>(edits: Edit[]): Edit[] {
    const kept: Edit[] = [];
    for (const edit of edits.sort((left, right) => left.from - right.from)) {
        if (kept.length === 0 || edit.from >= kept.at(-1)!.to) {
            kept.push(edit);
        }
    }
    return kept;
}

describe('an edit', () => {
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state + 0x6d2b79f5) | 0;
            let value = Math.imul(state ^ (state >>> 15), 1 | state);
            value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    const PIECES = ['a', 'word ', 'longer words that wrap ', '\n', '\r\n', '\r', '\t'];

    function piece(next: () => number, length: number): string {
        return Array.from({ length }, () => PIECES[Math.floor(next() * PIECES.length)]).join('');
    }

    /* What a row is, apart from the object it is. */
    function described(layout: EditorLayout): unknown[] {
        const rows = layout.rows.map((row) => [
            row.key,
            row.index,
            row.line,
            row.top,
            row.height,
            row.kind === 'text' ? [row.lastLine, row.tail, row.head, row.subRows, row.replacement?.id] : row.widget.id
        ]);
        const lines = Array.from({ length: layout.document.getLineCount() }, (_, line) => layout.rowForLine(line).index);
        return [layout.height, rows, lines];
    }

    for (const wrapWidth of [null, 100]) {
        test(`lays out the rows a full build would, wrap=${wrapWidth !== null}`, () => {
            const next = random(wrapWidth ?? 7);
            const model = new DocumentModel(piece(next, 300));
            const layout = new EditorLayout(model, METRICS);
            layout.configure({ wrapWidth });
            let structure: LayoutConfig = {};
            const structureOf = (): LayoutConfig => {
                const length = model.getLength();
                const lines = model.getLineCount();
                const at = (): number => Math.floor(next() * (length + 1));
                const line = (): number => Math.floor(next() * lines);
                return {
                    inlays: Array.from({ length: Math.floor(next() * 4) }, (_, index) => ({ id: `inlay${index}`, at: at(), text: 'hint' })),
                    blocks: Array.from({ length: Math.floor(next() * 4) }, (_, index) => ({
                        id: `block${index}`,
                        at: at(),
                        placement: next() < 0.5 ? ('above' as const) : ('below' as const),
                        height: 10 + index
                    })),
                    folds: Array.from({ length: Math.floor(next() * 4) }, () => {
                        const startLine = line();
                        const endLine = startLine + Math.floor(next() * 6);
                        return { startLine, endLine, collapsed: next() < 0.7, closer: at(), ...(next() < 0.3 ? { head: at() } : {}) };
                    }),
                    replacements: Array.from({ length: Math.floor(next() * 3) }, (_, index) => {
                        const from = at();
                        return { id: `replaced${index}`, from, to: Math.min(length, from + Math.floor(next() * 40)), render: () => {} };
                    })
                };
            };
            const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes, ...structure }));
            for (let step = 0; step < 150; step++) {
                if (step % 3 === 0) {
                    structure = structureOf();
                }
                const length = model.getLength();
                const edits = apart(
                    Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
                        const from = Math.floor(next() * (length + 1));
                        return { from, to: Math.min(length, from + Math.floor(next() * 12)), text: piece(next, Math.floor(next() * 4)) };
                    })
                );
                if (!model.applyEdits(edits, { historyGroup: 'typing' })) {
                    layout.configure(structure);
                }
                if (step % 13 === 6) {
                    model.undo();
                }
                const reference = new EditorLayout(model, METRICS);
                reference.configure({ wrapWidth, ...structure });
                expect(described(layout)).toEqual(described(reference));
            }
            subscription.dispose();
        });
    }

    test('lays out only the lines it touched, of a large wrapped document', () => {
        const { model, layout } = layoutOf(Array.from({ length: 100_000 }, (_, line) => `const value${line} = compute(alpha, beta);`).join('\n'), 300);
        const subscription = model.subscribe((snapshot) =>
            layout.configure({ textChanged: true, changes: snapshot.changes, inlays: [], blocks: [], folds: [] })
        );
        const first = layout.rows[0];
        const last = layout.rows.at(-1);
        const lines = spyOn(model, 'getLine');
        const caret = model.getLine(50_000).start + 10;
        model.applyEdits([{ from: caret, to: caret, text: 'x' }]);
        expect(lines.mock.calls.length).toBeLessThan(10);
        expect(layout.rows[0]).toBe(first!);
        expect(layout.rows.at(-1)).toBe(last!);
        lines.mockClear();
        model.applyEdits([{ from: caret, to: caret, text: '\n' }]);
        expect(lines.mock.calls.length).toBeLessThan(10);
        expect(layout.rows.at(-1)).toBe(last!);
        expect(last!.key).toBe('line:100000');
        lines.mockRestore();
        subscription.dispose();
    });
});
