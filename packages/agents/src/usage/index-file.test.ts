import { describe, expect, test } from 'bun:test';
import { decodeIndex, encodeIndex, type IndexedFile, type UsageIndex } from './index-file.ts';
import type { UsageRecord } from './record.ts';

function record(patch: Partial<UsageRecord> = {}): UsageRecord {
    return {
        provider: 'claude',
        timestampMs: 1_700_000_000_000,
        model: 'claude-sonnet-5',
        sessionId: 'session-1',
        cwd: '/work/demo',
        totals: { calls: 1, input: 10, cacheRead: 20, cacheWrite: 30, cacheWrite1h: 5, output: 40, reasoning: 0 },
        dedupeKey: 'msg_1',
        ...patch
    };
}

function file(patch: Partial<IndexedFile> = {}): IndexedFile {
    return { provider: 'claude', size: 1200, mtimeMs: 1_700_000_000_500, offset: 1100, records: [record()], tail: [], codex: null, head: 'v1:abc', ...patch };
}

describe('the usage index file', () => {
    test('reads back what it wrote, accounts, tails and missing keys included', () => {
        const index: UsageIndex = new Map([
            [
                '/claude/a.jsonl',
                file({
                    records: [record(), record({ account: 'work', dedupeKey: null, timestampMs: 1_700_000_001_000 })],
                    tail: [record({ sessionId: 'session-2' })]
                })
            ],
            ['/claude/b.jsonl', file({ head: null, records: [] })]
        ]);
        expect(decodeIndex(encodeIndex(index))).toEqual(index);
    });

    test('writes each model, session and folder once', () => {
        const index: UsageIndex = new Map([['/claude/a.jsonl', file({ records: [record(), record(), record({ account: 'work' })] })]]);
        const document = JSON.parse(encodeIndex(index)) as { models: string[]; sessions: string[]; folders: string[]; accounts: string[] };
        expect(document).toMatchObject({ models: ['claude-sonnet-5'], sessions: ['session-1'], folders: ['/work/demo'], accounts: ['work'] });
    });

    test('reads a version 1 index as the default account', () => {
        const row = [1_700_000_000_000, 0, 0, 0, 1, 10, 20, 30, 5, 40, 0, 'msg_1'];
        const text = JSON.stringify({
            version: 1,
            models: ['claude-sonnet-5'],
            sessions: ['session-1'],
            folders: ['/work/demo'],
            files: { '/claude/a.jsonl': { p: 'claude', s: 1200, m: 1_700_000_000_500, o: 1100, r: [row], t: [], c: null } }
        });
        const decoded = decodeIndex(text).get('/claude/a.jsonl');
        expect(decoded?.records).toEqual([record()]);
        expect(decoded?.head).toBeNull();
    });

    test('drops a whole file whose rows do not read back, and keeps the others', () => {
        const document = JSON.parse(
            encodeIndex(
                new Map([
                    ['/claude/a.jsonl', file()],
                    ['/claude/b.jsonl', file()]
                ])
            )
        ) as {
            files: Record<string, { r: unknown[][] }>;
        };
        document.files['/claude/a.jsonl']!.r[0]![1] = 99;
        const decoded = decodeIndex(JSON.stringify(document));
        expect([...decoded.keys()]).toEqual(['/claude/b.jsonl']);
    });

    test('skips a file of another provider or with a broken header', () => {
        const document = JSON.parse(
            encodeIndex(
                new Map([
                    ['/claude/a.jsonl', file()],
                    ['/claude/b.jsonl', file()]
                ])
            )
        ) as {
            files: Record<string, Record<string, unknown>>;
        };
        document.files['/claude/a.jsonl']!.p = 'gemini';
        document.files['/claude/b.jsonl']!.o = -1;
        expect(decodeIndex(JSON.stringify(document)).size).toBe(0);
    });

    test('starts over from an empty index for text that is no index of this version', () => {
        expect(decodeIndex('not json').size).toBe(0);
        expect(decodeIndex(JSON.stringify({ version: 3, models: [], sessions: [], folders: [], files: {} })).size).toBe(0);
        expect(decodeIndex(JSON.stringify({ version: 2, models: 'x', sessions: [], folders: [], files: {} })).size).toBe(0);
        expect(decodeIndex('null').size).toBe(0);
    });
});
