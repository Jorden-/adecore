import { describe, expect, test } from 'bun:test';
import type { Value } from '../protocol/index.ts';
import { formatCopy } from './copy-formats.ts';
import type { Shown } from './display.ts';
import { loadWholeCells, WHOLE_COPY_LIMIT } from './whole-cells.ts';

const LONG = 'x'.repeat(5000);

const preview = (text: string): Shown => ({ kind: 'longText', preview: text.slice(0, 1024), length: text.length });

describe('loadWholeCells', () => {
    test('copies a long text cell as SQL with all of its characters', async () => {
        const whole = await loadWholeCells([[1, preview(LONG)]], async () => LONG);
        const sql = formatCopy('sql', {
            columns: [
                { name: 'id', kind: 'integer' },
                { name: 'body', kind: 'text' }
            ],
            rows: whole.rows,
            target: { engine: 'sqlite', table: 'posts' }
        });

        expect(whole.previews).toBe(0);
        expect(sql).toBe(`INSERT INTO "posts" ("id", "body") VALUES (1, '${LONG}');`);
        expect(sql.match(/x+/)![0].length).toBe(5000);
    });

    test('loads only the previews, by their place in the block', async () => {
        const asked: [number, number][] = [];
        const binary: Shown = { kind: 'binary', hex: 'ab', length: 3 };
        const whole = await loadWholeCells(
            [
                ['a', binary],
                [preview(LONG), 2]
            ],
            async (row, column) => {
                asked.push([row, column]);
                return row === 0 ? ({ kind: 'binary', hex: 'abcdef' } satisfies Value) : LONG;
            }
        );

        expect(asked.sort()).toEqual([
            [0, 1],
            [1, 0]
        ]);
        expect(whole.rows).toEqual([
            ['a', { kind: 'binary', hex: 'abcdef', length: 3 }],
            [LONG, 2]
        ]);
    });

    test('keeps the cells a block without previews holds, and asks for nothing', async () => {
        const rows: Shown[][] = [[1, 'a', null]];
        const whole = await loadWholeCells(rows, async () => {
            throw new Error('Nothing to load.');
        });

        expect(whole).toEqual({ rows, previews: 0, tooLarge: false });
    });

    test('counts the cells it could not load, which stay previews', async () => {
        const rows = [[preview(LONG), preview(LONG), preview(LONG)]];
        const whole = await loadWholeCells(rows, async (_row, column) => {
            if (column === 1) {
                throw new Error('Gone.');
            }
            return column === 0 ? LONG : undefined;
        });

        expect(whole.previews).toBe(2);
        expect(whole.tooLarge).toBe(false);
        expect(whole.rows[0]).toEqual([LONG, rows[0]![1]!, rows[0]![2]!]);
    });

    test('keeps every preview without a way to load them', async () => {
        const rows = [[preview(LONG)]];

        expect(await loadWholeCells(rows, undefined)).toEqual({ rows, previews: 1, tooLarge: false });
    });

    test('keeps every preview when the whole values pass the limit', async () => {
        let asked = 0;
        const rows: Shown[][] = [[{ kind: 'binary', hex: '00', length: WHOLE_COPY_LIMIT / 2 + 1 }]];
        const whole = await loadWholeCells(rows, async () => {
            asked += 1;
            return null;
        });

        expect(whole).toEqual({ rows, previews: 1, tooLarge: true });
        expect(asked).toBe(0);
    });
});
