import { diffLines, type Change } from './diff.ts';
import type { Hunk, ParsedPatch, PatchLine } from './patch-parser.ts';
import { shapeOf } from './text.ts';

function fileLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split('\n');
    if (text.endsWith('\n')) {
        lines.pop();
    }
    return lines;
}

function keysOf(lines: readonly string[], finalNewline: boolean): string[] {
    return lines.map((line, index) => `${index === lines.length - 1 && !finalNewline ? 'unterminated:' : 'terminated:'}${line}`);
}

function alignChanges(changes: Change[], old: readonly string[], fresh: readonly string[]): void {
    for (const [index, change] of changes.entries()) {
        const previous = changes[index - 1];
        const oldBound = previous?.baseEnd ?? 0;
        const newBound = previous?.otherEnd ?? 0;
        const insert = change.baseStart === change.baseEnd;
        const remove = change.otherStart === change.otherEnd;
        if (!insert && !remove) {
            continue;
        }
        // Move a repeated blank from the end of an edit to its start, between adjacent functions.
        while (change.baseStart > oldBound && change.otherStart > newBound) {
            const tail = insert ? fresh[change.otherEnd - 1]! : old[change.baseEnd - 1]!;
            if (tail.slice(tail.indexOf(':') + 1).trim() !== '' || old[change.baseStart - 1] !== tail || fresh[change.otherStart - 1] !== tail) {
                break;
            }
            change.baseStart -= 1;
            change.baseEnd -= 1;
            change.otherStart -= 1;
            change.otherEnd -= 1;
        }
    }
}

function rangeText(start: number, count: number): string {
    return `${start + (count === 0 ? 0 : 1)},${count}`;
}

export function patchOf(oldText: string, newText: string, context = 3): ParsedPatch {
    if (!Number.isSafeInteger(context) || context < 0) {
        throw new RangeError('Patch context must be a nonnegative safe integer.');
    }
    const old = fileLines(oldText);
    const fresh = fileLines(newText);
    const oldShape = shapeOf(oldText);
    const newShape = shapeOf(newText);
    const oldKeys = keysOf(old, oldShape.finalNewline);
    const newKeys = keysOf(fresh, newShape.finalNewline);
    const changes = diffLines(oldKeys, newKeys);
    alignChanges(changes, oldKeys, newKeys);
    const hunks: Hunk[] = [];
    let group: Change[] = [];
    const finish = (): void => {
        if (group.length === 0) {
            return;
        }
        const first = group[0]!;
        const last = group.at(-1)!;
        const before = Math.min(context, first.baseStart, first.otherStart);
        const after = Math.min(context, old.length - last.baseEnd, fresh.length - last.otherEnd);
        const oldStart = first.baseStart - before;
        const newStart = first.otherStart - before;
        const lines: PatchLine[] = [];
        const line = (kind: PatchLine['kind'], at: number): void => {
            const source = kind === 'insert' ? fresh : old;
            const shape = kind === 'insert' ? newShape : oldShape;
            lines.push({ kind, text: source[at]!, ...(at === source.length - 1 && !shape.finalNewline ? { noNewline: true as const } : {}) });
        };
        let oldAt = oldStart;
        for (const change of group) {
            for (; oldAt < change.baseStart; oldAt++) {
                line('context', oldAt);
            }
            for (; oldAt < change.baseEnd; oldAt++) {
                line('delete', oldAt);
            }
            for (let newAt = change.otherStart; newAt < change.otherEnd; newAt++) {
                line('insert', newAt);
            }
        }
        for (; oldAt < last.baseEnd + after; oldAt++) {
            line('context', oldAt);
        }
        const coarse = group.some((change) => change.baseEnd - change.baseStart + change.otherEnd - change.otherStart > 4000);
        hunks.push({
            oldStart,
            newStart,
            oldCount: last.baseEnd + after - oldStart,
            newCount: last.otherEnd + after - newStart,
            section: '',
            lines,
            ...(coarse ? { coarse: true as const } : {})
        });
        group = [];
    };
    for (const change of changes) {
        const previous = group.at(-1);
        if (previous !== undefined && change.baseStart - previous.baseEnd > 2 * context) {
            finish();
        }
        group.push(change);
    }
    finish();
    const parts: string[] = [];
    for (const hunk of hunks) {
        parts.push(`@@ -${rangeText(hunk.oldStart, hunk.oldCount)} +${rangeText(hunk.newStart, hunk.newCount)} @@`);
        for (const line of hunk.lines) {
            parts.push(`${line.kind === 'context' ? ' ' : line.kind === 'delete' ? '-' : '+'}${line.text}`);
            if (line.noNewline) {
                parts.push('\\ No newline at end of file');
            }
        }
    }
    return { text: parts.length === 0 ? '' : `${parts.join('\n')}\n`, hunks, missing: { old: false, new: false }, partial: false };
}
