import type { ChatFileChange, ChatToolItem } from '@adecore/agent-contracts';
import { isRecord } from './json';
import { toolEntry } from './tool-catalog';

export interface FileChange {
    path: string;
    before: string;
    after: string;
}

function str(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/* The one line that says what a tool call is about: the command, the file, the pattern. */
export function toolSummary(name: string, input: unknown): string {
    if (!isRecord(input)) {
        return '';
    }
    const known = toolEntry(name);
    if (known === undefined) {
        // A tool nobody wrote down, an MCP one above all, gets its best guess from the first string it was given.
        const first = Object.values(input).find((value) => typeof value === 'string');
        return typeof first === 'string' ? first : '';
    }
    for (const key of known.summary) {
        const value = str(input[key]);
        if (value !== null) {
            return value;
        }
    }
    return '';
}

/* The command of a shell call, as it was run; null for any other call or one without a command. */
export function shellCommand(name: string, input: unknown): string | null {
    if (toolEntry(name)?.shell !== true || !isRecord(input)) {
        return null;
    }
    const command = str(input.command);
    return command === null || command.trim() === '' ? null : command;
}

/* What a call was asked to do, as the lines its opened row shows. */
export interface ToolCallLines {
    /* The command of a shell call, whole. */
    readonly command: string | null;
    /* The rest of the input as key and value: a string as it is, anything else as compact JSON. */
    readonly args: ReadonlyArray<readonly [key: string, value: string]>;
    /* An input that is not an object, as text. */
    readonly text: string | null;
}

// A shell call's description is already the detail of its row.
const SHELL_SHOWN = new Set(['command', 'description']);

function valueText(value: unknown): string {
    // An empty string can be the point of a call (clearing a field), so it shows as one.
    return typeof value === 'string' && value !== '' ? value : (JSON.stringify(value) ?? String(value));
}

/* The input of a call as lines: a shell command as itself, every other key as `key value`, null included. */
export function toolCallLines(name: string, input: unknown): ToolCallLines {
    if (!isRecord(input)) {
        const text = input === null || input === undefined || input === '' ? null : valueText(input);
        return { command: null, args: [], text };
    }
    const command = shellCommand(name, input);
    const args = Object.entries(input)
        .filter(([key, value]) => value !== undefined && !(command !== null && SHELL_SHOWN.has(key)))
        .map(([key, value]) => [key, valueText(value)] as const);
    return { command, args, text: null };
}

/* A failed call's output with the exit code its tool put on the first line ("Exit code 1"), as Claude Code's shell does. */
export function exitCodeOf(output: string): { code: number | null; rest: string } {
    const match = /^Exit code (-?\d+)[ \t]*(?:\r?\n|$)/.exec(output);
    if (match === null || Number(match[1]) === 0) {
        return { code: null, rest: output };
    }
    return { code: Number(match[1]), rest: output.slice(match[0].length) };
}

/* Whether an output says anything; whitespace alone does not. */
export function hasOutput(output: string | null): output is string {
    return output !== null && output.trim() !== '';
}

/* Whether opening a call shows anything: a diff, the input it was given or what it answered. */
export function hasToolBody(tool: ChatToolItem): boolean {
    if (hasFileChanges(tool) || hasOutput(tool.output)) {
        return true;
    }
    const lines = toolCallLines(tool.name, tool.input);
    return lines.command !== null || lines.args.length > 0 || lines.text !== null;
}

// What `GET /fs/file` will serve; a path with another suffix is not worth asking the host about.
const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/* The image file a tool call looked at, so the row can draw it; null for every other call. */
export function readImagePath(name: string, input: unknown): string | null {
    if (toolEntry(name)?.readsImage !== true) {
        return null;
    }
    const path = isRecord(input) ? str(input.file_path) : null;
    if (path === null) {
        return null;
    }
    const lowered = path.toLowerCase();
    return IMAGE_SUFFIXES.some((suffix) => lowered.endsWith(suffix)) ? path : null;
}

/* The before and after text of a file-changing tool call, so the thread can show it as a diff. */
export function fileChanges(name: string, input: unknown): FileChange[] {
    if (!isRecord(input)) {
        return [];
    }
    const path = str(input.file_path) ?? '';
    if (name === 'Edit') {
        return [{ path, before: str(input.old_string) ?? '', after: str(input.new_string) ?? '' }];
    }
    if (name === 'Write') {
        return [{ path, before: '', after: str(input.content) ?? '' }];
    }
    if (name === 'MultiEdit' && Array.isArray(input.edits)) {
        return input.edits.filter(isRecord).map((edit) => ({ path, before: str(edit.old_string) ?? '', after: str(edit.new_string) ?? '' }));
    }
    return [];
}

export function isFileChange(name: string): boolean {
    return toolEntry(name)?.changesFiles === true;
}

/* The unified diffs a provider put next to a tool call; empty for one that reports before and after. */
export function unifiedChanges(tool: ChatToolItem): ChatFileChange[] {
    return (tool.changes ?? []).filter((change) => change.diff !== '');
}

/* The same, for the copy an approval carries so the person can read what they are approving. */
export function approvalChanges(input: unknown): ChatFileChange[] {
    const changes = isRecord(input) ? input.changes : null;
    if (!Array.isArray(changes)) {
        return [];
    }
    return changes.filter(
        (change): change is ChatFileChange => isRecord(change) && typeof change.path === 'string' && typeof change.diff === 'string' && change.diff !== ''
    );
}

/* Whether a settled call is worth a row in the turn's changed files card. */
export function hasFileChanges(tool: ChatToolItem): boolean {
    return unifiedChanges(tool).length > 0 || fileChanges(tool.name, tool.input).length > 0;
}

/* When a running call started: what the CLI reported, or the moment the call appeared. */
export function toolStartedAt(tool: ChatToolItem): number {
    return tool.progress?.startedAt ?? tool.createdAt;
}

// Keep the full buffer so the renderer can carry ANSI state into the visible tail.
export function liveOutput(tool: ChatToolItem): string | null {
    return tool.progress?.output || null;
}
