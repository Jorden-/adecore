import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUGGESTED_TITLE_LIMIT } from '@adecore/agent-contracts';
import { cleanTitle, readLines } from './title-file.ts';

describe('cleanTitle', () => {
    test('makes one line of words with one space between them', () => {
        expect(cleanTitle('  Fix the\nflaky\t\ttest\u0007 ')).toBe('Fix the flaky test');
    });

    test('answers null for anything that is not text, or nothing but blanks', () => {
        expect(cleanTitle(42)).toBeNull();
        expect(cleanTitle(null)).toBeNull();
        expect(cleanTitle(' \n\u0000 ')).toBeNull();
    });

    test('cuts a long title to the limit with an ellipsis, never inside a character', () => {
        const title = cleanTitle(`${'a'.repeat(SUGGESTED_TITLE_LIMIT - 2)}😀😀`)!;
        expect(title.length).toBeLessThanOrEqual(SUGGESTED_TITLE_LIMIT);
        expect(title.endsWith('…')).toBe(true);
        expect(title).not.toContain('\ud83d…');
        expect(cleanTitle('b'.repeat(SUGGESTED_TITLE_LIMIT))).toBe('b'.repeat(SUGGESTED_TITLE_LIMIT));
    });
});

describe('readLines', () => {
    let folder: string;
    let path: string;

    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'adecore-title-file-'));
        path = join(folder, 'transcript.jsonl');
    });

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    const read = async (from: number, chunkBytes: number): Promise<{ lines: string[]; next: number }> => {
        const lines: string[] = [];
        const size = Buffer.byteLength(await Bun.file(path).text());
        const next = await readLines(path, from, size, chunkBytes, (line) => lines.push(line));
        return { lines, next };
    };

    test('hands on every whole line and stops just past the last one', async () => {
        await writeFile(path, 'first\nsecond\nhalf');
        expect(await read(0, 1024)).toEqual({ lines: ['first', 'second'], next: 13 });
    });

    test('reads on from where the last read stopped once the line is whole', async () => {
        await writeFile(path, 'first\nhalf');
        const { next } = await read(0, 1024);
        await writeFile(path, 'first\nhalf done\n');
        expect(await read(next, 1024)).toEqual({ lines: ['half done'], next: 16 });
    });

    test('reads the same in pieces smaller than a line, cut inside a character', async () => {
        await writeFile(path, 'Übersicht\nÄnderungen\n');
        expect((await read(0, 3)).lines).toEqual(['Übersicht', 'Änderungen']);
    });

    test('a file without a line break hands on nothing and stays where it was', async () => {
        await writeFile(path, 'no break yet');
        expect(await read(0, 4)).toEqual({ lines: [], next: 0 });
    });
});
