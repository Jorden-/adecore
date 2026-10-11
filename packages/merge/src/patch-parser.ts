export interface PatchLine {
    readonly kind: 'context' | 'delete' | 'insert';
    readonly text: string;
    readonly noNewline?: true;
}

export interface Hunk {
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly section: string;
    readonly coarse?: true;
    readonly lines: readonly PatchLine[];
}

export interface ParsedPatch {
    readonly text: string;
    readonly hunks: readonly Hunk[];
    readonly missing: { readonly old: boolean; readonly new: boolean };
    readonly partial: boolean;
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: ?(.*))?$/;

export function parsePatch(patch: string): ParsedPatch {
    const hunks: Hunk[] = [];
    const lines = patch.split('\n');
    let current: (Omit<Hunk, 'lines'> & { lines: PatchLine[] }) | undefined;
    let oldCount = 0;
    let newCount = 0;
    let partial = false;
    let oldEnded = false;
    let newEnded = false;
    const header: string[] = [];
    const finish = (): void => {
        if (current !== undefined && (oldCount !== current.oldCount || newCount !== current.newCount)) {
            partial = true;
        }
        current = undefined;
    };
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        const metadata = line.replace(/\r$/, '');
        if (metadata.startsWith('@@')) {
            finish();
            const match = HEADER.exec(metadata);
            if (match === null) {
                partial = true;
                continue;
            }
            const oldLength = Number(match[2] ?? 1);
            const newLength = Number(match[4] ?? 1);
            const oldStart = Number(match[1]) - (oldLength === 0 ? 0 : 1);
            const newStart = Number(match[3]) - (newLength === 0 ? 0 : 1);
            if (
                ![oldStart, newStart, oldLength, newLength, oldStart + oldLength, newStart + newLength].every(
                    (value) => Number.isSafeInteger(value) && value >= 0
                )
            ) {
                partial = true;
                continue;
            }
            const previous = hunks.at(-1);
            if (previous !== undefined && (oldStart < previous.oldStart + previous.oldCount || newStart < previous.newStart + previous.newCount)) {
                partial = true;
            }
            current = { oldStart, oldCount: oldLength, newStart, newCount: newLength, section: match[5] ?? '', lines: [] };
            hunks.push(current);
            oldCount = 0;
            newCount = 0;
            continue;
        }
        if (metadata.startsWith('diff --git ') && hunks.length > 0) {
            finish();
            partial = true;
            break;
        }
        if (current === undefined) {
            if (hunks.length === 0) {
                header.push(metadata);
            } else if (line !== '') {
                partial = true;
            }
            continue;
        }
        if (metadata === '\\ No newline at end of file') {
            const previous = current.lines.at(-1);
            if (previous === undefined || previous.noNewline) {
                partial = true;
            } else {
                current.lines[current.lines.length - 1] = { ...previous, noNewline: true };
                oldEnded ||= previous.kind !== 'insert';
                newEnded ||= previous.kind !== 'delete';
            }
            continue;
        }
        // The last empty split field is the patch's terminator, not a source line.
        if (line === '' && index === lines.length - 1) {
            continue;
        }
        const kind = line.startsWith('-') ? 'delete' : line.startsWith('+') ? 'insert' : line.startsWith(' ') || line === '' ? 'context' : undefined;
        if (kind === undefined) {
            partial = true;
            continue;
        }
        if (kind !== 'insert') {
            partial ||= oldEnded;
            oldCount += 1;
        }
        if (kind !== 'delete') {
            partial ||= newEnded;
            newCount += 1;
        }
        current.lines.push({ kind, text: line === '' ? '' : line.slice(1) });
    }
    finish();
    return {
        text: patch,
        hunks,
        missing: { old: header.some((line) => /^--- \/dev\/null(?:\t|$)/.test(line)), new: header.some((line) => /^\+\+\+ \/dev\/null(?:\t|$)/.test(line)) },
        partial
    };
}
