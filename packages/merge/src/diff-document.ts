import type { Hunk, ParsedPatch, PatchLine } from './patch-parser.ts';
import { shapeOf, splitLines, type TextShape } from './text.ts';

export interface DiffLineRef {
    readonly index: number;
    readonly number: number;
}

export interface DiffLineRow {
    readonly kind: 'line';
    readonly change: 'context' | 'delete' | 'insert' | 'pair';
    readonly old?: DiffLineRef;
    readonly new?: DiffLineRef;
    readonly noNewline?: 'old' | 'new' | 'both';
    readonly hunk?: number;
}

export interface DiffGapRow {
    readonly kind: 'gap';
    readonly id: number;
    readonly oldStart: number;
    readonly newStart: number;
    readonly oldCount: number;
    readonly newCount: number;
    readonly unfoldable: boolean;
}

export type DiffRow = DiffLineRow | DiffGapRow;

export interface DiffDocument {
    readonly hunks: readonly Hunk[];
    readonly sides: { readonly old: readonly string[]; readonly new: readonly string[] };
    readonly shapes?: { readonly old: TextShape; readonly new: TextShape };
    readonly offsets: readonly { readonly old: number; readonly new: number }[];
    readonly snapshots: boolean;
    readonly ignoreWhitespace: boolean;
    readonly partial: boolean;
}

function sourceText(line: PatchLine): string {
    return line.noNewline ? line.text : line.text.replace(/\r$/, '');
}

function snapshotsFit(parsed: ParsedPatch, contents: { old: string; new: string }, ignoreWhitespace: boolean): boolean {
    if (parsed.partial || parsed.hunks.length === 0) {
        return false;
    }
    const rawLines = (text: string): string[] => {
        if (text === '') {
            return [];
        }
        const lines = text.split('\n');
        if (text.endsWith('\n')) {
            lines.pop();
        }
        return lines;
    };
    const oldLines = rawLines(contents.old);
    const newLines = rawLines(contents.new);
    const oldShape = shapeOf(contents.old);
    const newShape = shapeOf(contents.new);
    const same = (left: string, right: string): boolean => (ignoreWhitespace ? left.replace(/\s+/g, '') === right.replace(/\s+/g, '') : left === right);
    let oldAt = 0;
    let newAt = 0;
    const gapFits = (oldEnd: number, newEnd: number): boolean => {
        if (oldEnd - oldAt !== newEnd - newAt) {
            return false;
        }
        while (oldAt < oldEnd && newAt < newEnd) {
            if (!same(oldLines[oldAt]!, newLines[newAt]!)) {
                return false;
            }
            oldAt += 1;
            newAt += 1;
        }
        return true;
    };
    for (const hunk of parsed.hunks) {
        if (hunk.oldStart + hunk.oldCount > oldLines.length || hunk.newStart + hunk.newCount > newLines.length || !gapFits(hunk.oldStart, hunk.newStart)) {
            return false;
        }
        for (const line of hunk.lines) {
            if (line.kind !== 'insert') {
                if (!same(line.text, oldLines[oldAt]!) || Boolean(line.noNewline) !== (oldAt === oldLines.length - 1 && !oldShape.finalNewline)) {
                    return false;
                }
                oldAt += 1;
            }
            if (line.kind !== 'delete') {
                if (!same(line.text, newLines[newAt]!) || Boolean(line.noNewline) !== (newAt === newLines.length - 1 && !newShape.finalNewline)) {
                    return false;
                }
                newAt += 1;
            }
        }
    }
    const endShown = oldAt === oldLines.length && newAt === newLines.length;
    return gapFits(oldLines.length, newLines.length) && (oldShape.finalNewline === newShape.finalNewline || endShown);
}

export function diffDocument(parsed: ParsedPatch, contents: { old: string; new: string } | undefined, ignoreWhitespace = false): DiffDocument {
    if (contents !== undefined && snapshotsFit(parsed, contents, ignoreWhitespace)) {
        return {
            hunks: parsed.hunks,
            sides: { old: splitLines(contents.old), new: splitLines(contents.new) },
            shapes: { old: shapeOf(contents.old), new: shapeOf(contents.new) },
            offsets: parsed.hunks.map((hunk) => ({ old: hunk.oldStart, new: hunk.newStart })),
            snapshots: true,
            ignoreWhitespace,
            partial: false
        };
    }
    const old: string[] = [];
    const fresh: string[] = [];
    const offsets = parsed.hunks.map((hunk) => {
        const offset = { old: old.length, new: fresh.length };
        for (const line of hunk.lines) {
            if (line.kind !== 'insert') {
                old.push(sourceText(line));
            }
            if (line.kind !== 'delete') {
                fresh.push(sourceText(line));
            }
        }
        return offset;
    });
    return { hunks: parsed.hunks, sides: { old, new: fresh }, offsets, snapshots: false, ignoreWhitespace, partial: true };
}

function newline(old: boolean, fresh: boolean): Pick<DiffLineRow, 'noNewline'> {
    return old || fresh ? { noNewline: old && fresh ? 'both' : old ? 'old' : 'new' } : {};
}

function hunkRows(document: DiffDocument, index: number, layout: 'unified' | 'split'): DiffLineRow[] {
    const hunk = document.hunks[index]!;
    const offset = document.offsets[index]!;
    let oldAt = 0;
    let newAt = 0;
    const rows: DiffLineRow[] = [];
    const deletes: DiffLineRow[] = [];
    const inserts: DiffLineRow[] = [];
    const flush = (): void => {
        for (let pair = 0; pair < Math.max(deletes.length, inserts.length); pair++) {
            const old = deletes[pair];
            const fresh = inserts[pair];
            rows.push({
                kind: 'line',
                change: old && fresh ? 'pair' : old ? 'delete' : 'insert',
                hunk: index,
                ...(old ? { old: old.old } : {}),
                ...(fresh ? { new: fresh.new } : {}),
                ...newline(old?.noNewline === 'old', fresh?.noNewline === 'new')
            });
        }
        deletes.length = 0;
        inserts.length = 0;
    };
    for (const line of hunk.lines) {
        const old = line.kind === 'insert' ? undefined : { index: offset.old + oldAt, number: hunk.oldStart + oldAt + 1 };
        const fresh = line.kind === 'delete' ? undefined : { index: offset.new + newAt, number: hunk.newStart + newAt + 1 };
        const row: DiffLineRow = {
            kind: 'line',
            change: line.kind,
            hunk: index,
            ...(old ? { old } : {}),
            ...(fresh ? { new: fresh } : {}),
            ...newline(Boolean(old && line.noNewline), Boolean(fresh && line.noNewline))
        };
        oldAt += old ? 1 : 0;
        newAt += fresh ? 1 : 0;
        if (layout === 'unified') {
            rows.push(row);
        } else if (line.kind === 'context') {
            flush();
            rows.push(row);
        } else {
            (line.kind === 'delete' ? deletes : inserts).push(row);
        }
    }
    flush();
    return rows;
}

export function diffRows(document: DiffDocument, layout: 'unified' | 'split', unfolded: ReadonlyMap<number, number> = new Map()): DiffRow[] {
    const rows: DiffRow[] = [];
    const gap = (id: number, oldStart: number, newStart: number, oldCount: number, newCount: number, position: 'before' | 'between' | 'after'): void => {
        if (oldCount <= 0 && newCount <= 0) {
            return;
        }
        oldCount = Math.max(0, oldCount);
        newCount = Math.max(0, newCount);
        const unfoldable = document.snapshots && oldCount === newCount;
        const amount = unfolded.get(id) ?? 0;
        const count = unfoldable
            ? Math.min(oldCount, amount === Number.POSITIVE_INFINITY ? oldCount : Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0)
            : 0;
        const leading = position === 'before' ? 0 : count;
        const trailing = position === 'after' ? 0 : Math.min(count, oldCount - leading);
        const context = (from: number, to: number): void => {
            for (let line = from; line < to; line++) {
                const old = oldStart + line;
                const fresh = newStart + line;
                rows.push({
                    kind: 'line',
                    change: 'context',
                    old: { index: old, number: old + 1 },
                    new: { index: fresh, number: fresh + 1 },
                    ...newline(
                        old === document.sides.old.length - 1 && document.shapes?.old.finalNewline === false,
                        fresh === document.sides.new.length - 1 && document.shapes?.new.finalNewline === false
                    )
                });
            }
        };
        context(0, leading);
        if (oldCount - leading - trailing > 0 || newCount - leading - trailing > 0) {
            rows.push({
                kind: 'gap',
                id,
                oldStart: oldStart + leading,
                newStart: newStart + leading,
                oldCount: Math.max(0, oldCount - leading - trailing),
                newCount: Math.max(0, newCount - leading - trailing),
                unfoldable
            });
        }
        context(oldCount - trailing, oldCount);
    };
    let oldAt = 0;
    let newAt = 0;
    document.hunks.forEach((hunk, index) => {
        gap(index, oldAt, newAt, hunk.oldStart - oldAt, hunk.newStart - newAt, index === 0 ? 'before' : 'between');
        for (const row of hunkRows(document, index, layout)) {
            rows.push(row);
        }
        oldAt = hunk.oldStart + hunk.oldCount;
        newAt = hunk.newStart + hunk.newCount;
    });
    if (document.snapshots) {
        gap(document.hunks.length, oldAt, newAt, document.sides.old.length - oldAt, document.sides.new.length - newAt, 'after');
    }
    return rows;
}
