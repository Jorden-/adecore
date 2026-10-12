import { expect, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { EditorLayout, scanLine, scanDenseLine, type LayoutMetrics, type TextRow } from './layout.ts';
import { offsetOfStop, rowOfStop, stopAtOffset, stopCount, xOfStop } from './geometry-stops.ts';

function metrics(charWidth: number): LayoutMetrics {
    return { charWidth, lineHeight: 20, tabSize: 4, measureText: (text) => text.length * charWidth, measureInlay: (text) => text.length * charWidth };
}

function verify(text: string, charWidth: number, limit: number): void {
    const line = { start: 17, end: 17 + text.length, text };
    const compact = scanLine(line, metrics(charWidth), limit, []);
    const dense = scanDenseLine(line, metrics(charWidth), limit, []);
    expect(compact.uniform).toBeDefined();
    expect(compact.offsets).toHaveLength(0);
    expect(compact.before).toHaveLength(0);
    expect(compact.after).toHaveLength(0);
    expect(compact.rowOf).toHaveLength(0);
    for (const key of ['start', 'end', 'next', 'text', 'rowStarts', 'rowEnds', 'rowTriggers', 'runs', 'inlays', 'subRows', 'width'] as const) {
        expect(compact[key]).toEqual(dense[key]);
    }
    const stops = new Set([0, 1, text.length - 1, text.length]);
    for (const first of compact.rowStarts) {
        stops.add(first);
        stops.add(Math.min(text.length, first + 1));
    }
    for (const stop of stops) {
        expect(offsetOfStop(compact, stop)).toBe(dense.offsets[stop]!);
        expect(rowOfStop(compact, stop)).toBe(dense.rowOf[stop]!);
        expect(xOfStop(compact, stop)).toBe(dense.before[stop]!);
        expect(xOfStop(compact, stop, 'after')).toBe(dense.after[stop]!);
        expect(stopAtOffset(compact, stop + 0.5)).toBe(stopAtOffset(dense, stop + 0.5));
    }
    expect(stopCount(compact)).toBe(stopCount(dense));
}

for (const charWidth of [10, 7.8, 8.4140625, 0.1]) {
    test(`compact wrap matches dense geometry exactly with character width ${charWidth}`, () => {
        for (const text of ['abc def xyz; '.repeat(2000), 'x'.repeat(24000), '    ' + 'a   b    c '.repeat(2400)]) {
            verify(text, charWidth, charWidth * 13.7);
        }
    });
}

test('nonuniform text, inlays, very wide visual rows and unwrapped lines use dense geometry', () => {
    const values = ['x'.repeat(24000) + '\t', 'x'.repeat(24000) + '😀', ' '.repeat(24000)];
    for (const text of values) {
        const line = { start: 0, end: text.length, text };
        expect(scanLine(line, metrics(7.8), 200, []).uniform).toBeUndefined();
    }
    const line = { start: 0, end: 24000, text: 'x'.repeat(24000) };
    expect(scanLine(line, metrics(7.8), null, []).uniform).toBeUndefined();
    expect(scanLine(line, metrics(7.8), 200, [{ id: 'ime', at: 6, text: 'か', composition: true }]).uniform).toBeUndefined();
});

test('compact geometry retains caret, hit testing, navigation and selection across edits', () => {
    const model = new DocumentModel('abc def '.repeat(3000));
    const layout = new EditorLayout(model, metrics(7.8));
    layout.configure({ wrapWidth: 213 });
    const subscription = model.subscribe((snapshot) => layout.configure({ textChanged: true, changes: snapshot.changes }));
    let seed = 12345;
    const random = (limit: number): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % limit;
    };
    for (let edit = 0; edit < 24; edit++) {
        const from = random(model.getLength() - 1);
        model.applyEdits([{ from, to: from + 1, text: ['Z', ' ', 'xyz', ''][random(4)]! }]);
        layout.syncRows(layout.rows);
        const compact = layout.geometry(layout.rows[0] as TextRow);
        const dense = scanDenseLine(model.getLine(0), metrics(7.8), 213, []);
        expect(compact.uniform).toBeDefined();
        expect(compact.rowStarts).toEqual(dense.rowStarts);
        expect(compact.rowTriggers).toEqual(dense.rowTriggers);
        for (let sample = 0; sample < 12; sample++) {
            const offset = random(model.getLength());
            const caret = layout.caret(offset);
            expect(caret.x).toBe(dense.after[offset]!);
            expect(caret.y).toBe(dense.rowOf[offset]! * 20);
            expect(layout.hitTest(caret.x, caret.y + 1)).toBe(offset);
            expect(layout.horizontalOffset(offset, 1)).toBe(offset + 1);
        }
        const row = random(compact.subRows);
        const window = { top: row * 20, bottom: row * 20 + 80 };
        const rects = layout.rectangles(0, model.getLength(), layout.rows, window);
        expect(rects.length).toBeLessThanOrEqual(4);
    }
    subscription.dispose();
});
