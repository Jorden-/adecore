import { describe, expect, test } from 'bun:test';
import type { CallHierarchyItem } from '@adecore/lsp';
import { CALL_LEVEL_LIMIT, childrenOf, moreIdOf, rootsOf, rowsOf, statusIdOf, stepsOf, targetOf, type CallNode } from './call-hierarchy-model.ts';

function at(line: number) {
    return { start: { line, character: 2 }, end: { line, character: 6 } };
}

function item(name: string, uri = 'file:///work/a.ts', line = 0): CallHierarchyItem {
    return { name, kind: 12, uri, range: at(line), selectionRange: at(line) };
}

function tree(nodes: CallNode[]): Map<string, CallNode> {
    return new Map(nodes.map((node) => [node.id, node]));
}

describe('call hierarchy model', () => {
    test('keeps the order the server gave the calls in', () => {
        const [root] = rootsOf([item('run')]);
        const calls = [
            { from: item('b', 'file:///work/b.ts'), fromRanges: [at(1)] },
            { from: item('a', 'file:///work/a.ts'), fromRanges: [at(2)] }
        ];
        expect(childrenOf('incoming', root!, calls).map((node) => node.item.name)).toEqual(['b', 'a']);
        expect(rootsOf([item('b'), item('a')]).map((node) => node.item.name)).toEqual(['b', 'a']);
    });

    test('lists the calls of a node in the server order and finds the call sites in the right file', () => {
        const [root] = rootsOf([item('run', 'file:///work/run.ts')]);
        const calls = [
            { from: item('zeta', 'file:///work/z.ts'), fromRanges: [at(4)] },
            { from: item('alpha', 'file:///work/a.ts'), fromRanges: [at(1), at(2)] }
        ];
        const callers = childrenOf('incoming', root!, calls);
        expect(callers.map((node) => node.item.name)).toEqual(['zeta', 'alpha']);
        expect(callers.map((node) => node.siteUri)).toEqual(['file:///work/z.ts', 'file:///work/a.ts']);
        expect(callers.map((node) => node.level)).toEqual([2, 2]);
        const callees = childrenOf('outgoing', root!, [{ to: item('helper', 'file:///work/h.ts'), fromRanges: [at(3)] }]);
        // The call is made in the file of the node that was asked about.
        expect(callees[0]!.siteUri).toBe('file:///work/run.ts');
        expect(new Set(callers.map((node) => node.id)).size).toBe(2);
    });

    test('draws a status line for a node that is loading, failed or has no calls', () => {
        const [root] = rootsOf([item('run')]);
        const rows = (change: Partial<CallNode>) =>
            rowsOf(tree([{ ...root!, ...change }]), [root!.id]).map((row) => (row.kind === 'status' ? row.status : row.kind));
        expect(rows({ load: 'idle' })).toEqual(['node']);
        expect(rows({ load: 'loading' })).toEqual(['node', 'loading']);
        expect(rows({ load: 'failed', error: 'boom' })).toEqual(['node', 'failed']);
        expect(rows({ load: 'loaded' })).toEqual(['node', 'empty']);
        expect(rows({ load: 'loaded', expanded: false })).toEqual(['node']);
        const [failed] = rowsOf(tree([{ ...root!, load: 'failed', error: 'boom' }]), [root!.id]).slice(1);
        expect(failed).toMatchObject({ message: 'boom', parent: root!.id, id: statusIdOf(root!.id) });
    });

    test('shows the first calls of a level and a row for the rest', () => {
        const [root] = rootsOf([item('run')]);
        const calls = Array.from({ length: CALL_LEVEL_LIMIT + 5 }, (_, index) => ({
            from: item(`caller${String(index).padStart(3, '0')}`),
            fromRanges: [at(index)]
        }));
        const children = childrenOf('incoming', root!, calls);
        const nodes = tree([{ ...root!, load: 'loaded', children: children.map((child) => child.id), shown: CALL_LEVEL_LIMIT }, ...children]);
        const rows = rowsOf(nodes, [root!.id]);
        expect(rows).toHaveLength(1 + CALL_LEVEL_LIMIT + 1);
        expect(rows.at(-1)).toEqual({ kind: 'more', id: moreIdOf(root!.id), level: 2, parent: root!.id, hidden: 5 });
        expect(stepsOf(rows).map((row) => row.kind)).toContain('more');
        expect(rows[1]).toMatchObject({ kind: 'node', position: 1, size: CALL_LEVEL_LIMIT + 5 });
    });

    test('marks a node without calls as a leaf and steps only through lines a key can land on', () => {
        const [root] = rootsOf([item('run')]);
        const rows = rowsOf(tree([{ ...root!, load: 'loaded' }]), [root!.id]);
        expect(rows[0]).toMatchObject({ kind: 'node', leaf: true });
        expect(stepsOf(rows).map((row) => row.id)).toEqual([root!.id]);
    });

    test('goes to the first call site, a later one, or the symbol itself for a root', () => {
        const [root] = rootsOf([item('run')]);
        const [caller] = childrenOf('incoming', root!, [{ from: item('main', 'file:///work/main.ts'), fromRanges: [at(7), at(9)] }]);
        expect(targetOf(caller!)).toEqual({ uri: 'file:///work/main.ts', range: at(7) });
        expect(targetOf(caller!, 1).range).toEqual(at(9));
        expect(targetOf(root!)).toEqual({ uri: 'file:///work/a.ts', range: at(0) });
        const [bare] = childrenOf('incoming', root!, [{ from: item('main', 'file:///work/main.ts', 3), fromRanges: [] }]);
        expect(targetOf(bare!)).toEqual({ uri: 'file:///work/main.ts', range: at(3) });
    });
});
