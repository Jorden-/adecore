import { describe, expect, it } from 'bun:test';
import { BracketTracker, type BracketText } from './bracket-tracker.ts';
import { scanBrackets } from './brackets.ts';
import { DocumentModel } from './document.ts';
import { TextRope } from './rope.ts';

function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const PIECES = [
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '"',
    "'",
    '`',
    '${',
    '/',
    '//',
    '/*',
    '*/',
    '#',
    '--',
    '<!--',
    '-->',
    '\\',
    '\n',
    '\r\n',
    '\r',
    ' ',
    'return ',
    'x',
    'value',
    '=',
    ';'
];

function piece(next: () => number, length: number): string {
    let text = '';
    for (let index = 0; index < length; index++) {
        text += PIECES[Math.floor(next() * PIECES.length)];
    }
    return text;
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

/* Each bracket of the text as `scanBrackets` sees it, against what `match` says. */
function expectSameAsScan(text: string, match: (offset: number) => unknown, language: string): void {
    const index = scanBrackets(text, language);
    for (let offset = 0; offset < text.length; offset++) {
        if (!/[()[\]{}]/.test(text[offset]!)) {
            continue;
        }
        const expected = index.pairs.has(offset) ? { mate: index.pairs.get(offset) } : index.unmatched.has(offset) ? { mate: undefined } : undefined;
        expect([offset, match(offset)]).toEqual([offset, expected]);
    }
}

/* A rope that counts the characters the tracker reads, which is the work an edit costs it. */
function counted(rope: () => TextRope): { text: () => BracketText; read: () => number } {
    let read = 0;
    const text = (): BracketText => {
        const current = rope();
        return {
            get length() {
                return current.length;
            },
            get lineCount() {
                return current.lineCount;
            },
            charAt: (offset) => current.charAt(offset),
            lineAt: (offset) => current.lineAt(offset),
            lineBounds: (line) => current.lineBounds(line),
            slice: (from, to) => {
                const slice = current.slice(from, to);
                read += slice.length;
                return slice;
            }
        };
    };
    return {
        text,
        read: () => {
            const result = read;
            read = 0;
            return result;
        }
    };
}

describe('the bracket tracker', () => {
    for (const language of ['typescript', 'python', 'html', 'php', 'css', 'sql']) {
        it(`pairs as scanBrackets does through random edits in ${language}`, () => {
            const next = random(language.length * 7919);
            let rope = TextRope.from(piece(next, 1500));
            // Stretches of a few lines, so the edits cross and drop checkpoints all the time.
            const tracker = new BracketTracker(() => rope, 48);
            for (let step = 0; step < 80; step++) {
                const length = rope.length;
                const edits = apart(
                    Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
                        const from = Math.floor(next() * (length + 1));
                        return {
                            from,
                            to: Math.min(length, from + Math.floor(next() * (step % 9 === 0 ? 400 : 6))),
                            text: piece(next, Math.floor(next() * 5))
                        };
                    })
                );
                const before = rope;
                for (const edit of [...edits].reverse()) {
                    rope = rope.replace(edit.from, edit.to, edit.text);
                }
                tracker.edited(
                    before,
                    rope,
                    edits.map((edit) => ({ from: edit.from, to: edit.to, insertedLength: edit.text.length }))
                );
                // Queries in between leave checkpoints behind for the next edits to move, drop and prove again.
                for (let query = 0; query < 3; query++) {
                    tracker.match(Math.floor(next() * rope.length), language);
                }
                if (step % 10 === 0) {
                    expectSameAsScan(rope.slice(), (offset) => tracker.match(offset, language), language);
                }
            }
            expectSameAsScan(rope.slice(), (offset) => tracker.match(offset, language), language);
        });
    }
});

it('lexes the line above an edit again, whose lone `\\r` the edit can join to a `\\n`', () => {
    let rope = TextRope.from('// c\r(x)');
    const tracker = new BracketTracker(() => rope, 1);
    expect(tracker.match(5, 'typescript')).toBeUndefined();
    const before = rope;
    rope = rope.replace(5, 5, '\n');
    tracker.edited(before, rope, [{ from: 5, to: 5, insertedLength: 1 }]);
    expect(tracker.match(6, 'typescript')).toEqual({ mate: 8 });
});

describe('matchBracket', () => {
    it('follows edits, undo and redo of a document', () => {
        const body = Array.from({ length: 3000 }, (_, line) => `    call(${line}, [a, { b: "}" }]); // )`).join('\n');
        const document = new DocumentModel(`function outer() {\n${body}\n}\n`);
        const expectSame = (): void => expectSameAsScan(document.getText(), (offset) => document.matchBracket(offset), 'typescript');
        expectSame();
        const middle = document.getLine(1500).start + 4;
        document.applyEdits([{ from: middle, to: middle, text: '/*' }]);
        expectSame();
        document.applyEdits([{ from: document.getLine(2500).start, to: document.getLine(2500).start, text: '*/' }]);
        expectSame();
        document.undo();
        document.undo();
        expectSame();
        document.redo();
        expectSame();
    });

    it('is undefined where no bracket of the code stands', () => {
        const document = new DocumentModel('call("(", x) // (');
        expect(document.matchBracket(4)).toEqual({ mate: 11 });
        expect(document.matchBracket(6)).toBeUndefined();
        expect(document.matchBracket(16)).toBeUndefined();
        expect(document.matchBracket(0)).toBeUndefined();
    });
});

describe('the work of an edit', () => {
    const lines = Array.from({ length: 100_000 }, (_, line) => `    const value${line} = compute(alpha, beta) + other[${line}]; // note`);

    it('lexes a few kilobytes per keystroke next to a bracket of a large document', () => {
        let rope = TextRope.from(lines.join('\n'));
        const reads = counted(() => rope);
        const tracker = new BracketTracker(reads.text);
        let caret = rope.lineBounds(50_000).start + lines[50_000]!.indexOf('(');
        expect(tracker.match(caret, 'typescript')).toEqual({ mate: caret + 12 });
        reads.read();
        for (let key = 0; key < 20; key++) {
            const before = rope;
            rope = rope.replace(caret, caret, 'x');
            tracker.edited(before, rope, [{ from: caret, to: caret, insertedLength: 1 }]);
            caret++;
            expect(tracker.match(caret, 'typescript')).toEqual({ mate: caret + 12 });
            expect(reads.read()).toBeLessThan(20_000);
        }
        expect(rope.length).toBeGreaterThan(5_000_000);
    });

    it('steps over whole stretches to a mate at the other end of the document', () => {
        let rope = TextRope.from(`function outer() {\n${lines.join('\n')}\n}`);
        const reads = counted(() => rope);
        const tracker = new BracketTracker(reads.text);
        const brace = rope.lineBounds(0).end - 1;
        expect(tracker.match(brace, 'typescript')).toEqual({ mate: rope.length - 1 });
        expect(tracker.match(rope.length - 1, 'typescript')).toEqual({ mate: brace });
        reads.read();
        for (let key = 0; key < 20; key++) {
            const before = rope;
            rope = rope.replace(brace - 2, brace - 2, 'x');
            tracker.edited(before, rope, [{ from: brace - 2, to: brace - 2, insertedLength: 1 }]);
            expect(tracker.match(brace + key + 1, 'typescript')).toEqual({ mate: rope.length - 1 });
            expect(reads.read()).toBeLessThan(20_000);
        }
    });
});
