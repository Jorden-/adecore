import { describe, expect, it } from 'bun:test';
import { applyContentChanges, endPosition, positionAt } from './edits.ts';
import type { ContentChange } from './protocol.ts';
import { TextMirror } from './text-mirror.ts';

/* A fixed generator, so a failing sequence can be replayed. */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

const PIECES = ['a', 'b', '\r', '\n', '\r\n', '🙂'];

function randomText(random: () => number, length: number): string {
    let text = '';
    for (let i = 0; i < length; i++) {
        text += PIECES[Math.floor(random() * PIECES.length)];
    }
    return text;
}

/* An offset between the two halves of a CRLF has no position, so it moves to before the pair. */
function randomOffset(random: () => number, text: string): number {
    const offset = Math.floor(random() * (text.length + 1));
    return text[offset - 1] === '\r' && text[offset] === '\n' ? offset - 1 : offset;
}

function randomChange(random: () => number, text: string): ContentChange {
    const one = randomOffset(random, text);
    const two = randomOffset(random, text);
    return {
        range: { start: positionAt(text, Math.min(one, two)), end: positionAt(text, Math.max(one, two)) },
        text: randomText(random, Math.floor(random() * 4))
    };
}

describe('text mirror', () => {
    it('keeps the text and its lines as applyContentChanges does, across every kind of line break', () => {
        const random = seeded(58);
        for (let round = 0; round < 200; round++) {
            let expected = randomText(random, Math.floor(random() * 12));
            const mirror = new TextMirror(expected);
            for (let step = 0; step < 30; step++) {
                const changes = [randomChange(random, expected)];
                const middle = applyContentChanges(expected, changes);
                changes.push(randomChange(random, middle));
                expected = applyContentChanges(expected, changes);
                mirror.applyChanges(changes);
                expect(mirror.text).toBe(expected);
                expect(mirror.lineCount).toBe(endPosition(expected).line + 1);
            }
        }
    });

    it('joins a lone CR and an LF that meet into one break', () => {
        const before = new TextMirror('a\rb\nc');
        before.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, text: '' }]);
        expect(before.text).toBe('a\r\nc');
        expect(before.lineCount).toBe(2);
        const after = new TextMirror('a\nb');
        after.applyChanges([{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: 'x\r' }]);
        expect(after.text).toBe('ax\r\nb');
        expect(after.lineCount).toBe(2);
    });

    it('changes nothing when one entry does not fit, also after the entries before it', () => {
        const mirror = new TextMirror('one\r\ntwo');
        const fits = { range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, text: '' };
        expect(() => mirror.applyChanges([fits, { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: 'x' }])).toThrow(
            'outside the document'
        );
        expect(() =>
            mirror.applyChanges([{ text: 'whole' }, { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, text: '' }])
        ).toThrow('outside the line');
        expect(() => mirror.applyChanges([{ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, text: '' }])).toThrow(
            'outside the line'
        );
        expect(() => mirror.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 0, character: 0 } }, text: '' }])).toThrow('reversed');
        expect(mirror.text).toBe('one\r\ntwo');
        expect(mirror.lineCount).toBe(2);
        mirror.applyChanges([fits]);
        expect(mirror.text).toBe('two');
    });

    it('takes a paste of more lines than fit in one call', () => {
        const mirror = new TextMirror('start\nend');
        const pasted = 'line\n'.repeat(50_000);
        mirror.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: pasted }]);
        expect(mirror.lineCount).toBe(50_002);
        expect(mirror.text).toBe(`start\n${pasted}end`);
    });

    it('updates a document of 5.7 MB in well under a millisecond per keystroke', () => {
        const line = 'const value = someFunction(argument, another) + 42; // c\n';
        const lines = Math.ceil(5.7e6 / line.length);
        const mirror = new TextMirror(line.repeat(lines));
        const keystrokes = 1_000;
        const start = performance.now();
        for (let i = 0; i < keystrokes; i++) {
            const at = { line: lines - 2 - (i % 100), character: 0 };
            mirror.applyChanges([{ range: { start: at, end: at }, text: i % 10 === 0 ? '\n' : 'x' }]);
        }
        // Scanning the text up to the change took about 7 ms per keystroke here; this bound is a millisecond.
        expect(performance.now() - start).toBeLessThan(keystrokes);
        expect(mirror.lineCount).toBe(lines + 1 + keystrokes / 10);
    });
});
