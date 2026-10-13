import { expect, test } from 'bun:test';
import { z } from 'zod';
import { compileUiBlock } from './compiler.ts';
import { uiLinkTargets } from './links.ts';
import { uiQueryArguments, uiQueryFallback, uiValidatedState } from './query.ts';
import { resolveUiChoice } from './runtime.ts';

const schemas = { rows: z.object({ limit: z.number().int().min(1).max(10), repo: z.string() }).strict() };

test('query arguments use only declared validated local inputs', () => {
    const block = compileUiBlock('$rows = @Query("rows", {limit: $limit, repo: "."})\n$limit = 3\n<Slider min={1} max={10} value={$limit}>Rows</Slider>', {
        id: 'b',
        final: true,
        querySchemas: schemas
    });
    expect(block.diagnostics).toEqual([]);
    expect(uiQueryArguments(block, '$rows', { $limit: 5 })).toEqual({ limit: 5, repo: '.' });
    expect(() => uiQueryArguments(block, '$rows', { $limit: 50 })).toThrow('allowed values');
    expect(() => uiQueryArguments(block, '$rows', { repo: '/outside' })).toThrow('bindings');
});

test('an input chosen from options a query read is checked against that reading', () => {
    const block = compileUiBlock(
        '$picked = "a"\n$rows = @Query("rows", {limit: 3, repo: "."})\n<Segmented value={$picked}><Each items={$rows} as="row"><Option value={row.id}>{row.name}</Option></Each></Segmented>',
        { id: 'b', final: true, querySchemas: schemas }
    );
    expect(block.diagnostics).toEqual([]);
    const rows = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
    ];
    expect(uiQueryArguments(block, '$rows', { $picked: 'b' }, {}, { $rows: rows })).toEqual({ limit: 3, repo: '.' });
    expect(() => uiQueryArguments(block, '$rows', { $picked: 'c' }, {}, { $rows: rows })).toThrow('allowed values');
    expect(() => uiQueryArguments(block, '$rows', { $picked: 'b' })).toThrow('allowed values');
});

test('a query cannot change its source or depend on another query result', () => {
    const block = compileUiBlock('$source = "rows"\n$a = @Query($source, {limit: 1, repo: "."})\n$b = @Query("rows", {limit: $a.count, repo: "."})', {
        id: 'b',
        final: true,
        querySchemas: schemas
    });
    expect(block.queries).toEqual({});
    expect(block.diagnostics.map((entry) => entry.code)).toEqual(['invalid_query', 'invalid_query']);
});

test('the query fallback reads every node the way the compiled fallback does', () => {
    const block = compileUiBlock(
        '$rows = @Query("rows", {limit: 2, repo: "."})\n<Stats><Stat label="Rows" value={$rows.count}/></Stats><Sources><Source title="Docs" url="https://adecore.dev"/></Sources><File path="src/a.ts">Entry</File>',
        { id: 'b', final: true, querySchemas: schemas }
    );
    expect(block.diagnostics).toEqual([]);
    expect(uiQueryFallback(block, { $rows: { count: 4 } })).toBe('Rows: 4\nDocs: https://adecore.dev\nsrc/a.ts Entry');
});

test('a host passes its own limits to every budget behind query arguments, links and choices', () => {
    const block = compileUiBlock(
        '$rows = @Query("rows", {limit: $limit, repo: "."})\n$limit = 3\n<Slider min={1} max={10} value={$limit}>Rows</Slider><File path="src/a.ts"/><Choices><Choice context="Go">Go</Choice></Choices>',
        { id: 'b', final: true, querySchemas: schemas }
    );
    expect(block.diagnostics).toEqual([]);
    const choiceId = block.nodes.find((node) => node.type === 'Choices')!.children[0].id;
    const tight = { steps: 1 };
    expect(uiValidatedState(block, { $limit: 5 }).scope().$limit).toBe(5);
    expect(() => uiValidatedState(block, { $limit: 5 }, {}, tight)).toThrow(expect.objectContaining({ code: 'budget_exceeded' }));
    expect(uiQueryArguments(block, '$rows', { $limit: 5 })).toEqual({ limit: 5, repo: '.' });
    expect(() => uiQueryArguments(block, '$rows', { $limit: 5 }, tight)).toThrow(expect.objectContaining({ code: 'budget_exceeded' }));
    expect(Object.values(uiLinkTargets(block))).toEqual([{ type: 'File', path: 'src/a.ts' }]);
    expect(() => uiLinkTargets(block, {}, {}, tight)).toThrow(expect.objectContaining({ code: 'budget_exceeded' }));
    expect(resolveUiChoice(block, choiceId).context).toBe('Go');
    expect(() => resolveUiChoice(block, choiceId, {}, {}, tight)).toThrow(expect.objectContaining({ code: 'budget_exceeded' }));
});
