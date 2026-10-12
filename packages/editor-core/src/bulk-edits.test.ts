import { expect, test } from 'bun:test';
import { DocumentModel } from './document.ts';
import { TextRope } from './rope.ts';
import { mapOffset, offsetMapper } from './offsets.ts';
import type { ContentEdit, TextEdit } from './types.ts';

function sequential(source: string, edits: readonly TextEdit[]): string {
    let rope = TextRope.from(source);
    for (let index = edits.length - 1; index >= 0; index--) {
        const edit = edits[index]!;
        rope = rope.replace(edit.from, edit.to, edit.text);
    }
    return rope.slice();
}

test('dense Unicode and CRLF batches preserve sequential text, selections and one undo', () => {
    const line = 'a😀 b\r\n';
    const source = line.repeat(600);
    for (let variant = 0; variant < 5; variant++) {
        const edits = Array.from({ length: 600 }, (_, index) => {
            const base = index * line.length;
            const from = base + (index % 2 === 0 ? 1 : 4);
            return { from, to: from + (index % 2 === 0 ? 2 : 1), text: ['X', '😀\n', '\r\n', '', 'Z\r\nx'][(index + variant) % 5]! };
        });
        const model = new DocumentModel(source);
        model.setSelections([
            { anchor: 7, head: 10 },
            { anchor: source.length - 7, head: source.length }
        ]);
        const before = model.getSelections();
        const expectedText = sequential(source, edits);
        const reference = new DocumentModel(expectedText);
        reference.setSelections(before.map((selection) => ({ anchor: mapOffset(selection.anchor, edits), head: mapOffset(selection.head, edits) })));
        let content: readonly ContentEdit[] = [];
        let batches = 0;
        model.subscribe((snapshot) => {
            if (snapshot.changes) {
                batches++;
                content = snapshot.contentEdits ?? [];
            }
        });
        expect(model.applyEdits(edits)).toBe(true);
        expect(model.getText()).toBe(expectedText);
        expect(model.getSelections()).toEqual(reference.getSelections());
        expect(batches).toBe(1);
        expect(content).toHaveLength(1);
        expect(model.getLineCount()).toBe(reference.getLineCount());
        expect(model.undo()).toBe(true);
        expect(model.getText()).toBe(source);
        expect(model.getSelections()).toEqual(before);
        expect(model.getSnapshot().canUndo).toBe(false);
        expect(model.redo()).toBe(true);
        expect(model.getText()).toBe(expectedText);
        expect(model.getSelections()).toEqual(reference.getSelections());
    }
});

test('dense adjacent inserts and replacements match the old right affinity', () => {
    const source = 'abc'.repeat(300);
    const edits = Array.from({ length: 300 }, (_, index) => [
        { from: index * 3, to: index * 3, text: '>' },
        { from: index * 3, to: index * 3 + 1, text: '😀' }
    ]).flat();
    const model = new DocumentModel(source);
    model.setSelections([{ anchor: 0, head: 3 }]);
    const before = model.getPrimary();
    expect(model.applyEdits(edits)).toBe(true);
    expect(model.getText()).toBe(sequential(source, edits));
    expect(model.getPrimary()).toEqual({ anchor: mapOffset(before.anchor, edits), head: mapOffset(before.head, edits) });
});

test('random dense batches rebuild the same text as persistent replacement', () => {
    let seed = 2718;
    const next = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    for (let run = 0; run < 30; run++) {
        const source = 'abcdefgh\r\n'.repeat(400);
        const edits = Array.from({ length: 400 }, (_, index) => {
            const from = index * 10 + (next() % 4);
            return { from, to: from + (next() % 5), text: ['x', '😀', '\n', '\r\n', ''][next() % 5]! };
        });
        const model = new DocumentModel(source);
        model.applyEdits(edits);
        expect(model.getText()).toBe(sequential(source, edits));
    }
});

test('sparse batches keep separate content edits instead of a large stretch', () => {
    const source = 'x'.repeat(1_000_000);
    const edits = Array.from({ length: 256 }, (_, index) => ({ from: index * 3900, to: index * 3900 + 1, text: 'y' }));
    const model = new DocumentModel(source);
    let count = 0;
    model.subscribe((snapshot) => {
        count = snapshot.contentEdits?.length ?? 0;
    });
    model.applyEdits(edits);
    expect(count).toBe(256);
    expect(model.getText()).toBe(sequential(source, edits));
});

test('selection offset indices retain both affinities across adjacent edits', () => {
    const edits = [
        { from: 0, to: 1, text: 'XX' },
        { from: 1, to: 1, text: 'Y' },
        { from: 1, to: 3, text: 'Z' },
        { from: 3, to: 3, text: 'P' },
        { from: 5, to: 7, text: '' }
    ];
    const map = offsetMapper(edits);
    for (let offset = 0; offset < 10; offset++) {
        for (const stayBefore of [false, true]) {
            expect(map(offset, stayBefore)).toBe(mapOffset(offset, edits, stayBefore));
        }
    }
});
