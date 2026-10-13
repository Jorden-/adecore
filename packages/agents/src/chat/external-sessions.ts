import { join } from 'node:path';
import { clipText, isRecord } from '@adecore/agent-contracts';
import { isForkOrSubagent } from '../usage/readers/codex.ts';
import { claudeProjectSlug, spokenText } from './claude-transcript.ts';

/* What the listing may do to the file system; a fake in tests, `node:fs` in a host. */
export interface SessionFs {
    /* The names in a folder; empty when it is not there. */
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ mtimeMs: number } | null>;
    /* The first `maxBytes` of a file as text; the last line may be cut short. */
    readHead(path: string, maxBytes: number): Promise<string>;
}

/* A conversation a CLI keeps on disk, started outside the app that lists it. */
export interface ExternalSession {
    provider: 'claude' | 'codex';
    sessionId: string;
    /* The first thing the person said, on one line. */
    title: string;
    updatedAt: number;
    cwd: string;
}

const TITLE_LENGTH = 120;
// Claude writes hook output and attachments ahead of the first prompt, and Codex its instructions.
const HEAD_BYTES = 256 * 1024;
const CLAUDE_MAX_FILES = 200;

function titleOf(text: string): string {
    return clipText(text.replace(/\s+/g, ' ').trim(), TITLE_LENGTH);
}

function records(head: string): Array<Record<string, unknown>> {
    const lines = head.split('\n');
    // The head ends wherever the byte limit fell, so its last line may not parse.
    return lines.flatMap((line) => {
        if (line === '') {
            return [];
        }
        try {
            const parsed: unknown = JSON.parse(line);
            return isRecord(parsed) ? [parsed] : [];
        } catch {
            return [];
        }
    });
}

const CLAUDE_BOOKKEEPING = new Set(['summary', 'file-history-snapshot', 'queue-operation']);

/* A reminder or the wrapper of a slash command is written as a user line too, but nobody said it. */
function claudePrompt(entry: Record<string, unknown>): string | null {
    if (CLAUDE_BOOKKEEPING.has(String(entry.type)) || entry.type !== 'user' || entry.isSidechain === true || entry.isMeta === true) {
        return null;
    }
    const message = typeof entry.message === 'object' && entry.message !== null ? (entry.message as Record<string, unknown>) : {};
    const said = spokenText(message.content);
    if (said === null || said.trim() === '' || said.startsWith('<command-') || said.startsWith('<local-command-')) {
        return null;
    }
    return said;
}

/*
 * The conversations Claude Code kept for a folder, newest first. Only the folder's own directory is
 * read, and only the `.jsonl` files in it, so the transcripts of subagents in `<session>/subagents` stay out.
 * A file without a prompt somebody said is no conversation.
 */
export async function listClaudeSessions({ projectsDir, folder, fs }: { projectsDir: string; folder: string; fs: SessionFs }): Promise<ExternalSession[]> {
    const dir = join(projectsDir, claudeProjectSlug(folder));
    const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.jsonl'));
    const stats = await Promise.all(names.map(async (name) => ({ name, stat: await fs.stat(join(dir, name)) })));
    const newest = stats
        .flatMap(({ name, stat }) => (stat === null ? [] : [{ name, mtimeMs: stat.mtimeMs }]))
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, CLAUDE_MAX_FILES);
    const sessions: ExternalSession[] = [];
    for (const { name, mtimeMs } of newest) {
        const prompt = records(await fs.readHead(join(dir, name), HEAD_BYTES))
            .map(claudePrompt)
            .find((said) => said !== null);
        if (prompt !== undefined && prompt !== null) {
            sessions.push({ provider: 'claude', sessionId: name.slice(0, -'.jsonl'.length), title: titleOf(prompt), updatedAt: mtimeMs, cwd: folder });
        }
    }
    return sessions;
}

function codexPrompt(entry: Record<string, unknown>): string | null {
    const payload = typeof entry.payload === 'object' && entry.payload !== null ? (entry.payload as Record<string, unknown>) : null;
    if (payload === null) {
        return null;
    }
    if (entry.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
        return payload.message.trim() === '' ? null : payload.message;
    }
    return null;
}

/* The newest names first; the folders are named by year, month and day, and the files by when they began. */
function newestFirst(names: string[]): string[] {
    return [...names].sort().reverse();
}

async function rolloutFiles(sessionsDir: string, fs: SessionFs, max: number): Promise<string[]> {
    const files: string[] = [];
    for (const year of newestFirst(await fs.readdir(sessionsDir))) {
        for (const month of newestFirst(await fs.readdir(join(sessionsDir, year)))) {
            for (const day of newestFirst(await fs.readdir(join(sessionsDir, year, month)))) {
                const names = newestFirst(
                    (await fs.readdir(join(sessionsDir, year, month, day))).filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl'))
                );
                for (const name of names) {
                    files.push(join(sessionsDir, year, month, day, name));
                    if (files.length >= max) {
                        return files;
                    }
                }
            }
        }
    }
    return files;
}

/*
 * The conversations Codex kept for a folder, newest first, out of the newest `maxFiles` rollouts. A
 * rollout counts when its first line, the session's metadata, names this folder and is no fork or subagent.
 */
export async function listCodexSessions({
    sessionsDir,
    folder,
    fs,
    maxFiles = 400
}: {
    sessionsDir: string;
    folder: string;
    fs: SessionFs;
    maxFiles?: number;
}): Promise<ExternalSession[]> {
    const sessions: ExternalSession[] = [];
    for (const path of await rolloutFiles(sessionsDir, fs, maxFiles)) {
        const entries = records(await fs.readHead(path, HEAD_BYTES));
        const meta = entries[0];
        const payload =
            meta?.type === 'session_meta' && typeof meta.payload === 'object' && meta.payload !== null ? (meta.payload as Record<string, unknown>) : null;
        if (payload === null || payload.cwd !== folder || typeof payload.id !== 'string' || isForkOrSubagent(payload)) {
            continue;
        }
        const prompt = entries.map(codexPrompt).find((said) => said !== null);
        if (prompt === undefined || prompt === null) {
            continue;
        }
        const stat = await fs.stat(path);
        sessions.push({ provider: 'codex', sessionId: payload.id, title: titleOf(prompt), updatedAt: stat?.mtimeMs ?? 0, cwd: folder });
    }
    return sessions;
}

/* A `node:fs` behind the seam, for a host that lists the real thing. */
export async function nodeSessionFs(): Promise<SessionFs> {
    const { readdir, stat, open } = await import('node:fs/promises');
    return {
        readdir: async (path) => readdir(path).catch(() => []),
        stat: async (path) => stat(path).catch(() => null),
        readHead: async (path, maxBytes) => {
            const handle = await open(path, 'r');
            try {
                const buffer = Buffer.alloc(maxBytes);
                const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
                return buffer.subarray(0, bytesRead).toString('utf8');
            } finally {
                await handle.close();
            }
        }
    };
}
