import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { occurrencesOf, renameKindOf, renamePreviewOf, renameRowsOf, renameTargetOf, wordRangeAt } from './rename-model.ts';

const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

describe('the word to rename', () => {
    test('is the identifier the caret is in or at the end of', () => {
        expect(wordRangeAt('const weights = 1;', at(0, 8))).toEqual(range(0, 6, 13));
        expect(wordRangeAt('const weights = 1;', at(0, 13))).toEqual(range(0, 6, 13));
        expect(wordRangeAt('const weights = 1;', at(0, 14))).toBeNull();
        expect(wordRangeAt('$value->name', at(0, 3))).toEqual(range(0, 0, 6));
    });

    test('follows what a server prepared, and falls back to the text when it leaves the name open', () => {
        const textOf = () => 'weights';
        expect(renameTargetOf(null, textOf, () => range(0, 0, 1))).toBeNull();
        expect(renameTargetOf({ range: range(0, 6, 13), placeholder: 'weights!' }, textOf, () => null)).toEqual({
            range: range(0, 6, 13),
            placeholder: 'weights!'
        });
        expect(renameTargetOf(range(0, 6, 13), textOf, () => null)).toEqual({ range: range(0, 6, 13), placeholder: 'weights' });
        expect(renameTargetOf({ defaultBehavior: true }, textOf, () => range(0, 6, 13))).toEqual({ range: range(0, 6, 13), placeholder: 'weights' });
        expect(renameTargetOf({ defaultBehavior: true }, textOf, () => null)).toBeNull();
    });
});

describe('occurrences', () => {
    test('counts every place and the files they are in, and keeps the ones in the open file', () => {
        const here = 'file:///a.ts';
        const result = occurrencesOf(
            [
                { uri: here, range: range(0, 0, 1) },
                { uri: here, range: range(3, 0, 1) },
                { uri: 'file:///b.ts', range: range(1, 0, 1) }
            ],
            here
        );
        expect(result).toEqual({ inFile: [range(0, 0, 1), range(3, 0, 1)], count: 3, files: 2 });
    });
});

describe('the rows of a rename preview', () => {
    const text = 'const weights = {};\nuse(weights, weights);\nreturn 1;\n';

    test('shows each changed line once, as it was and as it will be, in order', () => {
        const rows = renameRowsOf(text, [
            { range: range(1, 4, 11), newText: 'scores' },
            { range: range(1, 13, 20), newText: 'scores' },
            { range: range(0, 6, 13), newText: 'scores' }
        ]);
        expect(rows).toEqual([
            { line: 1, before: 'const weights = {};', after: 'const scores = {};' },
            { line: 2, before: 'use(weights, weights);', after: 'use(scores, scores);' }
        ]);
    });

    test('reads every file of an edit, an open one or not, and keeps the lines of an edit that deletes a file', async () => {
        const edit = {
            changes: { 'file:///a.ts': [{ range: range(0, 6, 13), newText: 'scores' }], 'file:///b.ts': [{ range: range(0, 0, 1), newText: 'x' }] }
        };
        const files = await renamePreviewOf(edit, async (uri) => (uri === 'file:///a.ts' ? text : null));
        expect(files).toEqual([
            { uri: 'file:///a.ts', rows: [{ line: 1, before: 'const weights = {};', after: 'const scores = {};' }] },
            { uri: 'file:///b.ts', rows: [] }
        ]);
        const deleting = {
            documentChanges: [
                { textDocument: { uri: 'file:///a.ts', version: null }, edits: [{ range: range(0, 6, 13), newText: 'scores' }] },
                { kind: 'delete' as const, uri: 'file:///b.ts' }
            ]
        };
        expect(await renamePreviewOf(deleting, async () => text)).toEqual([
            { uri: 'file:///a.ts', rows: [{ line: 1, before: 'const weights = {};', after: 'const scores = {};' }] }
        ]);
    });
});

describe('the kind of the symbol to rename', () => {
    const outline = [
        {
            name: 'Greeter',
            kind: 5 as const,
            range: range(0, 0, 9),
            selectionRange: range(0, 6, 13),
            children: [{ name: 'greetAll', kind: 6 as const, range: range(1, 4, 40), selectionRange: range(1, 4, 12) }]
        }
    ];

    test('is the kind of the deepest symbol whose name holds one of the places, in words', () => {
        expect(renameKindOf(outline, 'greetAll', [range(1, 4, 12)])).toBe('method');
        expect(renameKindOf(outline, 'greetAll', [range(7, 2, 10), range(1, 4, 12)])).toBe('method');
        expect(renameKindOf(outline, 'Greeter', [range(0, 6, 13)])).toBe('class');
        expect(renameKindOf([{ name: 'T', kind: 26, range: range(0, 0, 1), selectionRange: range(0, 0, 1) }], 'T', [range(0, 0, 1)])).toBe('type parameter');
    });

    test('is unknown for a name the outline does not list, or without an outline', () => {
        expect(renameKindOf(outline, 'names', [range(1, 20, 25)])).toBeUndefined();
        expect(renameKindOf(null, 'greetAll', [range(1, 4, 12)])).toBeUndefined();
        expect(renameKindOf([], 'greetAll', [range(1, 4, 12)])).toBeUndefined();
    });

    test('needs the name to match in a flat list, which only gives the whole span', () => {
        const flat = [
            { name: 'greetAll', kind: 12 as const, location: { uri: 'file:///a.ts', range: { start: at(1, 0), end: at(3, 1) } } },
            { name: 'names', kind: 13 as const, location: { uri: 'file:///a.ts', range: range(2, 4, 30) } }
        ];
        expect(renameKindOf(flat, 'greetAll', [range(1, 9, 17)])).toBe('function');
        expect(renameKindOf(flat, 'names', [range(1, 18, 23)])).toBeUndefined();
        expect(renameKindOf(flat, 'names', [range(2, 10, 15)])).toBe('variable');
    });
});
