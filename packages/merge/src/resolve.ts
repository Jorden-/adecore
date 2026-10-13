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
export function autoLines(block: MergeBlock): string[] | null {
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

const QUOTES = new Set(['"', "'", '`']);

/* A line with every run of whitespace outside a quoted string made one space; inside one, whitespace is the string's value. */
function squashedLine(body: string): string {
    let squashed = '';
    let quote: string | null = null;
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index]!;
        if (quote !== null) {
            squashed += char;
            if (char === '\\' && index + 1 < body.length) {
                index += 1;
                squashed += body[index];
            } else if (char === quote) {
                quote = null;
            }
        } else if (/\s/.test(char)) {
            if (!squashed.endsWith(' ')) {
                squashed += ' ';
            }
        } else {
            squashed += char;
            if (QUOTES.has(char)) {
                quote = char;
            }
        }
    }
    return squashed;
}

function squashed(lines: readonly string[]): string {
    return lines
        .map((line) => {
            const body = line.trim();
            // Indentation is meaning in Python, YAML or a Makefile, so only a blank line loses its own.
            const indent = body === '' ? '' : line.slice(0, line.length - line.trimStart().length);
            return `${indent}${squashedLine(body)}`;
        })
        .join('\n');
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
 * sides that differ in whitespace inside or after a line, outside a quoted string, and a side that
 * already holds every line of the other without putting back what the other deleted. Anything else
 * is a choice it never guesses. A regular expression or a string that spans lines is not told
 * from code, so whitespace in one still counts as spacing.
 */
export function wandLines(block: MergeBlock): string[] | null {
    if (block.kind !== 'conflict') {
        return autoLines(block);
    }
    if (squashed(block.ours) === squashed(block.theirs)) {
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
