import type { MergeBlock } from './blocks.ts';

export type MergeSide = 'ours' | 'theirs';

export function sideLines(block: MergeBlock, side: MergeSide): string[] {
    return side === 'ours' ? [...block.ours] : [...block.theirs];
}

/* Both sides, one after the other, for the conflict where the two additions both belong. */
export function bothLines(block: MergeBlock, first: MergeSide): string[] {
    return first === 'ours' ? [...block.ours, ...block.theirs] : [...block.theirs, ...block.ours];
}

/* What a block is worth without anyone choosing: the side that changed, or the change both made. */
function autoLines(block: MergeBlock): string[] | null {
    switch (block.kind) {
        case 'stable':
        case 'ours':
        case 'both':
            return [...block.ours];
        case 'theirs':
            return [...block.theirs];
        case 'conflict':
            return null;
    }
}

/* Where `inner` starts in `outer` as one run of lines, or -1. */
function runIn(outer: readonly string[], inner: readonly string[]): number {
    for (let start = 0; start + inner.length <= outer.length; start += 1) {
        if (inner.every((line, index) => outer[start + index] === line)) {
            return start;
        }
    }
    return -1;
}

/*
 * Whether `outer` holds every line of `inner` and adds nothing `inner` took out: a base line among
 * what `outer` adds is one `inner` deleted, and taking `outer` would put it back.
 */
function covers(base: readonly string[], outer: readonly string[], inner: readonly string[]): boolean {
    const start = runIn(outer, inner);
    if (inner.length === 0 || start < 0) {
        return false;
    }
    const added = [...outer.slice(0, start), ...outer.slice(start + inner.length)];
    return added.every((line) => !base.includes(line) || inner.includes(line));
}

/*
 * What the wand makes of a conflict, or null for one that needs a person after all. It closes only
 * identical sides and a side that already holds every line of the other without putting back what
 * the other deleted. Whitespace keeps its meaning because this function has no language context.
 */
export function wandLines(block: MergeBlock): string[] | null {
    if (block.kind !== 'conflict') {
        return autoLines(block);
    }
    if (block.ours.length === block.theirs.length && block.ours.every((line, index) => line === block.theirs[index])) {
        return [...block.ours];
    }
    if (covers(block.base, block.ours, block.theirs)) {
        return [...block.ours];
    }
    if (covers(block.base, block.theirs, block.ours)) {
        return [...block.theirs];
    }
    return null;
}

/*
 * A short name for the two sides of one block, so an answer written for it can be checked against
 * the block it lands on. FNV-1a, not a digest: it has to read the same on a server and in a browser,
 * and a browser has no synchronous crypto hash.
 */
export function fingerprint(block: MergeBlock): string {
    let hash = 0x811c9dc5;
    for (const line of [...block.ours, '\u0000', ...block.theirs]) {
        for (let index = 0; index < line.length; index += 1) {
            hash = Math.imul(hash ^ line.charCodeAt(index), 0x01000193);
        }
        hash = Math.imul(hash ^ 0x0a, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/* Where one block landed in the draft, `to` exclusive, so a block is a range a person can act on. */
export interface MergeSpan {
    block: number;
    kind: MergeBlock['kind'];
    from: number;
    to: number;
}

export interface MergeDraft {
    lines: string[];
    spans: MergeSpan[];
}

/*
 * The merged file to start from: everything that merges by itself is merged, and every conflict
 * holds our side until someone says otherwise. Never a conflict marker, so what a person edits is a
 * file that would compile. `answered` holds the lines of blocks already resolved, by block index.
 */
export function draftOf(blocks: readonly MergeBlock[], answered: ReadonlyMap<number, readonly string[]> = new Map()): MergeDraft {
    const lines: string[] = [];
    const spans: MergeSpan[] = [];
    for (const [index, block] of blocks.entries()) {
        const from = lines.length;
        // One push per line: a block of a few hundred thousand lines is more arguments than V8 takes in one call.
        for (const line of answered.get(index) ?? autoLines(block) ?? block.ours) {
            lines.push(line);
        }
        spans.push({ block: index, kind: block.kind, from, to: lines.length });
    }
    return { lines, spans };
}
