import { describe, expect, test } from 'bun:test';
import { appendToolOutput, clipText, TOOL_OUTPUT_TAIL } from './text.ts';

describe('clipText', () => {
    test('leaves a text that fits as it is', () => {
        expect(clipText('hello', 5)).toBe('hello');
        expect(clipText('', 0)).toBe('');
    });

    test('cuts in UTF-16 units, never between the halves of a surrogate pair', () => {
        expect(clipText('abcdef', 3)).toBe('abc');
        // The emoji takes units 2 and 3; a cut at 3 would keep only its first half.
        expect(clipText('ab😀cd', 3)).toBe('ab');
        expect(clipText('ab😀cd', 4)).toBe('ab😀');
    });

    test('keeps a character a person sees as one whole: a joined emoji, a flag and an accent', () => {
        const family = '👩‍👩‍👧';
        expect(clipText(`a${family}b`, 4)).toBe('a');
        expect(clipText('a🇳🇱b', 3)).toBe('a');
        expect(clipText('aéb', 2)).toBe('a');
        expect(clipText('aéb', 3)).toBe('aé');
    });
});

describe('appendToolOutput', () => {
    test('grows an output that fits as it is', () => {
        expect(appendToolOutput(null, 'a')).toBe('a');
        expect(appendToolOutput('a\n', 'b')).toBe('a\nb');
    });

    test('keeps the last units of a long output', () => {
        let output: string | null = null;
        for (let i = 0; i < 2000; i++) {
            output = appendToolOutput(output, `${String(i).padStart(4, '0')}${'x'.repeat(95)}\n`);
        }
        expect(output!.length).toBe(TOOL_OUTPUT_TAIL);
        expect(output!.endsWith(`1999${'x'.repeat(95)}\n`)).toBe(true);
    });

    test('cuts one long line without leaving half of a surrogate pair', () => {
        const even = appendToolOutput('a', '😀'.repeat(TOOL_OUTPUT_TAIL / 2));
        expect(even).toBe('😀'.repeat(TOOL_OUTPUT_TAIL / 2));
        // The plain cut would start on the second half of the first emoji.
        const odd = appendToolOutput('a', `${'😀'.repeat(TOOL_OUTPUT_TAIL / 2)}b`);
        expect(odd).toBe(`${'😀'.repeat(TOOL_OUTPUT_TAIL / 2 - 1)}b`);
    });
});
