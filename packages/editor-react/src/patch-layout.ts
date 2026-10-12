import { parseHunkHeader } from '@adecore/merge';

export type PatchLineRole = 'file-header' | 'hunk-header' | 'context' | 'added' | 'removed' | 'no-newline' | 'binary' | 'other';

export type PatchFileStatus = 'added' | 'deleted' | 'renamed' | 'copied' | 'modified' | 'binary';

/* What a line of a patch is, and the one-based numbers it has in the files; null where the file has no such line. */
export interface PatchLayoutLine {
    readonly role: PatchLineRole;
    readonly old: number | null;
    readonly new: number | null;
}

export interface PatchHunkLayout {
    /* Zero-based line of the `@@` header in the patch text. */
    readonly line: number;
    /* As the header says them, `oldStart` and `newStart` one-based. */
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly section: string;
    /* False when the lines under the header no longer add up to its counts, such as after an edit. */
    readonly consistent: boolean;
}

export interface PatchFileLayout {
    /* Null for `/dev/null`, or when the patch does not say. Quotes and prefixes such as `a/` are gone. */
    readonly oldPath: string | null;
    readonly newPath: string | null;
    readonly status: PatchFileStatus;
    /* Zero-based lines of the section in the patch text, `lastLine` included. */
    readonly firstLine: number;
    readonly lastLine: number;
    readonly added: number;
    readonly removed: number;
    readonly hunks: readonly PatchHunkLayout[];
}

export interface PatchLayout {
    /* One entry per line of the text, `split('\n')`, up to the limit. */
    readonly lines: readonly PatchLayoutLine[];
    readonly files: readonly PatchFileLayout[];
    /* The text went past a limit: the lines after it have no role and no file. */
    readonly truncated: boolean;
}

export interface PatchLimits {
    /* Lines read before the layout stops; defaults to 50,000. */
    readonly maxLines?: number;
    /* Characters read before the layout stops; defaults to 4,000,000. */
    readonly maxCharacters?: number;
}

export const DEFAULT_PATCH_LIMITS = { maxLines: 50_000, maxCharacters: 4_000_000 } as const;

const OTHER: PatchLayoutLine = { role: 'other', old: null, new: null };
const FILE_HEADER: PatchLayoutLine = { role: 'file-header', old: null, new: null };
const HUNK_HEADER: PatchLayoutLine = { role: 'hunk-header', old: null, new: null };
const NO_NEWLINE: PatchLayoutLine = { role: 'no-newline', old: null, new: null };
const BINARY: PatchLayoutLine = { role: 'binary', old: null, new: null };

const GIT_HEADERS =
    /^(?:index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Section {
    oldPath: string | null;
    newPath: string | null;
    git: boolean;
    /* Whether the `diff --git` line showed `a/X b/Y`, which is the only time `a/` and `b/` are not part of the path. */
    prefixed: boolean;
    created: boolean;
    deleted: boolean;
    renamed: boolean;
    copied: boolean;
    binary: boolean;
    /* Whether `---` and `+++` named the files, which then beat the `diff --git` line. */
    named: boolean;
    firstLine: number;
    lastLine: number;
    added: number;
    removed: number;
    hunks: Mutable<PatchHunkLayout>[];
}

/* The hunk lines are being read into, with what its header still promises. */
interface OpenHunk {
    layout: Mutable<PatchHunkLayout>;
    oldLeft: number;
    newLeft: number;
    oldNumber: number;
    newNumber: number;
}

const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, '\\': 92 };

/* Reads a path as git writes it: bare, or in quotes with C escapes and octal bytes. */
function unquote(raw: string): string {
    if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
        return raw;
    }
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const body = raw.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
        if (body[i] !== '\\') {
            const point = String.fromCodePoint(body.codePointAt(i)!);
            bytes.push(...encoder.encode(point));
            i += point.length - 1;
            continue;
        }
        const octal = /^[0-3][0-7]{2}/.exec(body.slice(i + 1, i + 4));
        const escaped = ESCAPES[body[i + 1] ?? ''];
        if (octal !== null) {
            bytes.push(Number.parseInt(octal[0], 8));
            i += 3;
        } else if (escaped !== undefined) {
            bytes.push(escaped);
            i++;
        } else {
            bytes.push(92);
        }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/* The name on a `---`, `+++`, `rename` or `copy` line: a timestamp after a tab goes, and `/dev/null` is no file. */
function pathOf(raw: string): string | null {
    const tab = raw.indexOf('\t');
    const name = unquote(tab === -1 ? raw : raw.slice(0, tab));
    return name === '/dev/null' ? null : name;
}

function stripPrefix(path: string | null, prefix: 'a/' | 'b/'): string | null {
    return path !== null && path.startsWith(prefix) ? path.slice(2) : path;
}

/* The two names of a `diff --git a/x b/y` line; with spaces in an unquoted name, the split that gives both halves the same name wins. */
function gitPaths(rest: string): { oldPath: string | null; newPath: string | null; prefixed: boolean } {
    if (rest.startsWith('"')) {
        const end = rest.indexOf('" ', 1);
        if (end !== -1) {
            const oldName = unquote(rest.slice(0, end + 1));
            const newName = unquote(rest.slice(end + 2));
            const prefixed = oldName.startsWith('a/') && newName.startsWith('b/');
            return prefixed ? { oldPath: oldName.slice(2), newPath: newName.slice(2), prefixed } : { oldPath: oldName, newPath: newName, prefixed };
        }
    }
    const middle = rest.indexOf(' b/');
    if (rest.startsWith('a/') && middle !== -1) {
        for (let at = middle; at !== -1; at = rest.indexOf(' b/', at + 1)) {
            if (rest.slice(2, at) === rest.slice(at + 3)) {
                return { oldPath: rest.slice(2, at), newPath: rest.slice(at + 3), prefixed: true };
            }
        }
        return { oldPath: rest.slice(2, middle), newPath: unquote(rest.slice(middle + 3)), prefixed: true };
    }
    const split = rest.indexOf(' ');
    return split === -1
        ? { oldPath: unquote(rest), newPath: null, prefixed: false }
        : { oldPath: unquote(rest.slice(0, split)), newPath: unquote(rest.slice(split + 1)), prefixed: false };
}

function emptySection(firstLine: number, git: boolean): Section {
    return {
        oldPath: null,
        newPath: null,
        git,
        created: false,
        deleted: false,
        renamed: false,
        copied: false,
        binary: false,
        firstLine,
        lastLine: firstLine,
        added: 0,
        removed: 0,
        hunks: [],
        named: false,
        prefixed: false
    };
}

function statusOf(section: Section): PatchFileStatus {
    if (section.binary) {
        return 'binary';
    }
    if (section.created || (!section.git && section.oldPath === null && section.newPath !== null)) {
        return 'added';
    }
    if (section.deleted || (!section.git && section.newPath === null && section.oldPath !== null)) {
        return 'deleted';
    }
    if (section.renamed) {
        return 'renamed';
    }
    return section.copied ? 'copied' : 'modified';
}

function linesOf(text: string, limits: Required<PatchLimits>): { lines: string[]; truncated: boolean } {
    const lines: string[] = [];
    let start = 0;
    while (lines.length < limits.maxLines && start <= limits.maxCharacters) {
        const end = text.indexOf('\n', start);
        if (end === -1) {
            lines.push(text.slice(start).replace(/\r$/, ''));
            return { lines, truncated: false };
        }
        lines.push(text.slice(start, end).replace(/\r$/, ''));
        start = end + 1;
    }
    // Stopping right after a final newline leaves nothing unread.
    return { lines, truncated: start < text.length };
}

/*
 * What every line of a patch is, with the file numbers of its lines and the files it touches. It reads
 * git patches and plain `diff -u` output, tolerates a text that was edited so its hunks no longer add up
 * (the hunk is marked inconsistent and the reading goes on) and never throws. Past the limits it stops
 * and says so in `truncated`.
 */
export function patchLayoutOf(text: string, limits: PatchLimits = {}): PatchLayout {
    const { lines: source, truncated } = linesOf(text, { ...DEFAULT_PATCH_LIMITS, ...limits });
    const lines: PatchLayoutLine[] = [];
    const sections: Section[] = [];
    let section: Section | undefined;
    let hunk: OpenHunk | undefined;
    let binaryData = false;
    const seal = (): void => {
        if (hunk !== undefined && (hunk.oldLeft > 0 || hunk.newLeft > 0)) {
            hunk.layout.consistent = false;
        }
        hunk = undefined;
    };
    const open = (line: number, git: boolean): Section => {
        seal();
        binaryData = false;
        section = emptySection(line, git);
        sections.push(section);
        return section;
    };
    // A removed line can read `-- x`, so `---` starts a file only with `+++` under it.
    const startsFile = (index: number): boolean => source[index]!.startsWith('--- ') && (source[index + 1]?.startsWith('+++ ') ?? false);
    const push = (line: PatchLayoutLine, index: number): void => {
        lines.push(line);
        if (section !== undefined) {
            section.lastLine = index;
        }
    };
    for (let index = 0; index < source.length; index++) {
        const line = source[index]!;
        const remaining = hunk !== undefined && (hunk.oldLeft > 0 || hunk.newLeft > 0);
        const gitStart = line.startsWith('diff --git ');
        const header = line.startsWith('@@') ? parseHunkHeader(line) : undefined;
        const fileStart = startsFile(index) && (!remaining || source[index + 2]?.startsWith('@@') === true);
        if (remaining && !gitStart && header === undefined && !fileStart) {
            if (isContent(line) || line === '' || line.startsWith('\\')) {
                push(contentLine(line, hunk!, section!), index);
            } else {
                hunk!.layout.consistent = false;
                push(OTHER, index);
            }
            continue;
        }
        if (gitStart) {
            const created = open(index, true);
            ({ oldPath: created.oldPath, newPath: created.newPath, prefixed: created.prefixed } = gitPaths(line.slice('diff --git '.length)));
            push(FILE_HEADER, index);
            continue;
        }
        if (fileStart) {
            const reuse = section !== undefined && section.git && !section.named && section.hunks.length === 0;
            const target = reuse ? section! : open(index, false);
            seal();
            nameSides(target, line, source[index + 1]!);
            push(FILE_HEADER, index);
            push(FILE_HEADER, index + 1);
            index++;
            continue;
        }
        if (header !== undefined) {
            seal();
            const target = section ?? open(index, false);
            const layout: Mutable<PatchHunkLayout> = { line: index, ...header, consistent: true };
            target.hunks.push(layout);
            hunk = { layout, oldLeft: header.oldCount, newLeft: header.newCount, oldNumber: header.oldStart, newNumber: header.newStart };
            push(HUNK_HEADER, index);
            continue;
        }
        if (section === undefined) {
            push(OTHER, index);
        } else if (hunk !== undefined && line.startsWith('\\')) {
            push(NO_NEWLINE, index);
        } else if (hunk !== undefined && isContent(line) && line !== '-- ') {
            // The counts ran out, so a line a person typed below the hunk extends it. The `-- ` of a mail signature does not.
            hunk.layout.consistent = false;
            push(contentLine(line, hunk, section), index);
        } else if (hunk === undefined && section.git && GIT_HEADERS.test(line)) {
            readGitHeader(section, line);
            push(FILE_HEADER, index);
        } else if (/^Binary files .* differ$/.test(line) || line === 'GIT binary patch') {
            section.binary = true;
            binaryData = line === 'GIT binary patch';
            push(BINARY, index);
        } else if (binaryData && line !== '') {
            push(BINARY, index);
        } else if (line === '') {
            lines.push(OTHER);
        } else {
            push(OTHER, index);
        }
    }
    seal();
    return {
        lines,
        truncated,
        files: sections.map((entry) => ({
            oldPath: entry.oldPath,
            newPath: entry.newPath,
            status: statusOf(entry),
            firstLine: entry.firstLine,
            lastLine: entry.lastLine,
            added: entry.added,
            removed: entry.removed,
            hunks: entry.hunks
        }))
    };
}

function isContent(line: string): boolean {
    return line.startsWith('+') || line.startsWith('-') || line.startsWith(' ');
}

/* A line under a hunk header; an empty line is a context line whose space an editor trimmed. */
function contentLine(line: string, hunk: OpenHunk, section: Section): PatchLayoutLine {
    if (line.startsWith('\\')) {
        return NO_NEWLINE;
    }
    const kind = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
    const takesOld = kind !== 'added';
    const takesNew = kind !== 'removed';
    if ((takesOld && hunk.oldLeft === 0) || (takesNew && hunk.newLeft === 0)) {
        hunk.layout.consistent = false;
    }
    if (kind === 'added') {
        section.added++;
    } else if (kind === 'removed') {
        section.removed++;
    }
    const oldNumber = takesOld ? hunk.oldNumber++ : null;
    const newNumber = takesNew ? hunk.newNumber++ : null;
    hunk.oldLeft = takesOld ? Math.max(0, hunk.oldLeft - 1) : hunk.oldLeft;
    hunk.newLeft = takesNew ? Math.max(0, hunk.newLeft - 1) : hunk.newLeft;
    return { role: kind, old: oldNumber, new: newNumber };
}

function nameSides(section: Section, oldLine: string, newLine: string): void {
    const oldName = pathOf(oldLine.slice(4));
    const newName = pathOf(newLine.slice(4));
    const prefixed = section.git ? section.prefixed : (oldName?.startsWith('a/') ?? false) && (newName?.startsWith('b/') ?? false);
    section.oldPath = prefixed ? stripPrefix(oldName, 'a/') : oldName;
    section.newPath = prefixed ? stripPrefix(newName, 'b/') : newName;
    section.created ||= oldName === null;
    section.deleted ||= newName === null;
    section.named = true;
}

function readGitHeader(section: Section, line: string): void {
    if (line.startsWith('new file mode ')) {
        section.created = true;
    } else if (line.startsWith('deleted file mode ')) {
        section.deleted = true;
    } else if (line.startsWith('rename from ')) {
        section.renamed = true;
        section.oldPath = pathOf(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
        section.renamed = true;
        section.newPath = pathOf(line.slice('rename to '.length));
    } else if (line.startsWith('copy from ')) {
        section.copied = true;
        section.oldPath = pathOf(line.slice('copy from '.length));
    } else if (line.startsWith('copy to ')) {
        section.copied = true;
        section.newPath = pathOf(line.slice('copy to '.length));
    }
}
