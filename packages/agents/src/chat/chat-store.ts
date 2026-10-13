import { mkdirSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatInfoSchema, ChatItemSchema, type ChatInfo, type ChatItem } from '@adecore/agent-contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic, writeAtomicSync } from '../fs.ts';
import { recordFileName } from '../record-directory.ts';
import { migrateInlineAttachments, type AttachmentStore } from './attachment-store.ts';
import { isBookmarkFileName } from './bookmark-store.ts';
import { parseLog, type ChatLogLine } from './chat-log.ts';
import { ChatThread } from './thread.ts';
import { isVisualFileName } from './visual-store.ts';

// zod strips what it does not know inside the info and the items, so a file written by an older build
// (with `interactionMode`, say) still parses and loses only the dropped field. A record without `seq`
// predates the log. Keys beside these are the host's own, and come back to it as they were written.
const RecordSchema = z.looseObject({
    info: ChatInfoSchema,
    items: z.array(ChatItemSchema),
    seq: z.number().int().nonnegative().optional(),
    resetSeq: z.number().int().nonnegative().optional(),
    // Never on the wire: what goes in front of the next real prompt, once (a fork's note for its agent).
    preambles: z.array(z.string()).optional(),
    // Never on the wire: the access a UI host captured for each reply that reads it, by item id.
    uiAccess: z.record(z.string(), z.unknown()).optional()
});

const OWN_KEYS = new Set(['info', 'items', 'seq', 'resetSeq', 'preambles', 'uiAccess']);

/* What a host keeps in a chat's record beside the thread; it never reaches the wire. */
export type ChatRecordExtras = Record<string, unknown>;

function withoutOwnKeys(record: Record<string, unknown>): ChatRecordExtras {
    return Object.fromEntries(Object.entries(record).filter(([key]) => !OWN_KEYS.has(key)));
}

/* A thread as it stood when the host last wrote down anything about it: the snapshot with the log played over it. */
export interface ChatRecord {
    info: ChatInfo;
    items: ChatItem[];
    seq: number;
    resetSeq: number;
    preambles: string[];
    uiAccess: Record<string, unknown>;
    extras: ChatRecordExtras;
    // The log as it is on disk, for the lines an attach with `since` may still be answered from.
    lines: ChatLogLine[];
}

/* Where a snapshot stands in the chat's stream. */
export interface ChatSeq {
    seq: number;
    resetSeq: number;
}

function logName(chatId: string): string {
    return `${encodeURIComponent(chatId)}.log`;
}

// `settled` reads the info from the head of the record, so it stays the first key.
function recordBody(
    info: ChatInfo,
    items: ChatItem[],
    at: ChatSeq,
    preambles: readonly string[],
    extras: ChatRecordExtras,
    uiAccess: Readonly<Record<string, unknown>>
): string {
    return JSON.stringify({
        info,
        items,
        ...at,
        ...(preambles.length === 0 ? {} : { preambles }),
        ...(Object.keys(uiAccess).length === 0 ? {} : { uiAccess }),
        ...withoutOwnKeys(extras)
    });
}

/* A record from before `uiAccess` kept the access inside each reply's `uiQueries`, which the item schema now drops. */
function liftUiAccess(record: unknown): unknown {
    if (typeof record !== 'object' || record === null || 'uiAccess' in record || !Array.isArray((record as { items?: unknown }).items)) {
        return record;
    }
    const uiAccess: Record<string, unknown> = {};
    for (const item of (record as { items: unknown[] }).items) {
        const queries = (item as { uiQueries?: unknown } | null)?.uiQueries;
        if (typeof queries === 'object' && queries !== null && 'access' in queries) {
            uiAccess[String((item as { id: unknown }).id)] = queries.access;
        }
    }
    return Object.keys(uiAccess).length === 0 ? record : { ...record, uiAccess };
}

export interface ChatStoreOptions {
    attachments?: AttachmentStore | null;
    // Files a host keeps beside a record under names that also end in .json (a chat's plans), which are no chats.
    isSidecar?(name: string): boolean;
}

/*
 * One JSON file per chat under `<home>/chats`, written while a turn runs and on shutdown, with
 * the log of what happened since beside it (`ChatLog` appends to it; reading plays it back).
 */
export class ChatStore {
    readonly dir: string;
    private readonly attachments: AttachmentStore | null;
    private readonly isSidecar: (name: string) => boolean;

    constructor(home: string, options: ChatStoreOptions = {}) {
        this.dir = join(home, 'chats');
        this.attachments = options.attachments ?? null;
        this.isSidecar = options.isSidecar ?? (() => false);
    }

    logPath(chatId: string): string {
        return join(this.dir, logName(chatId));
    }

    /* Every chat with a record or a log, for the scan at start. */
    async list(): Promise<string[]> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        const ids = names
            // A chat's bookmarks and visuals, and whatever a host keeps per chat, sit beside its record under names that also end in .json.
            .filter(
                (name) => (name.endsWith('.json') && !isBookmarkFileName(name) && !isVisualFileName(name) && !this.isSidecar(name)) || name.endsWith('.log')
            )
            .map((name) => decodeURIComponent(name.replace(/\.(json|log)$/, '')));
        return [...new Set(ids)];
    }

    /* Whether anything of the chat is on disk, without reading it: a record or a log. */
    async has(chatId: string): Promise<boolean> {
        const found = await Promise.all([exists(join(this.dir, recordFileName(chatId))), exists(this.logPath(chatId))]);
        return found.includes(true);
    }

    /* Removes a log no record can be made of and answers the last seq it handed out, zero without one. */
    async discardLog(chatId: string): Promise<number> {
        const lines = parseLog((await readOrNull(this.logPath(chatId))) ?? '');
        await rm(this.logPath(chatId), { force: true });
        return lines.at(-1)?.seq ?? 0;
    }

    /* Answers how many bytes the record took, which is what tells a caller whether writing it is cheap. */
    async write(
        chatId: string,
        info: ChatInfo,
        items: ChatItem[],
        at: ChatSeq = { seq: 0, resetSeq: 0 },
        preambles: readonly string[] = [],
        extras: ChatRecordExtras = {},
        uiAccess: Readonly<Record<string, unknown>> = {}
    ): Promise<number> {
        const body = recordBody(info, items, at, preambles, extras, uiAccess);
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, recordFileName(chatId)), body);
        return body.length;
    }

    /*
     * The same write without a turn of the event loop. A `bun --watch` reload restarts the module
     * before an awaited write comes back, so a shutdown has to put the threads down synchronously.
     */
    writeSync(
        chatId: string,
        info: ChatInfo,
        items: ChatItem[],
        at: ChatSeq = { seq: 0, resetSeq: 0 },
        preambles: readonly string[] = [],
        extras: ChatRecordExtras = {},
        uiAccess: Readonly<Record<string, unknown>> = {}
    ): void {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeAtomicSync(join(this.dir, recordFileName(chatId)), recordBody(info, items, at, preambles, extras, uiAccess));
    }

    /* Null for a chat with nothing on disk to make it of, and for one whose record does not parse (see `unreadable`). */
    async read(chatId: string): Promise<ChatRecord | null> {
        const lines = parseLog((await readOrNull(this.logPath(chatId))) ?? '');
        const snapshot = await this.readSnapshot(chatId);
        if (snapshot === UNREADABLE) {
            return null;
        }
        if (snapshot === null) {
            return fromLogAlone(lines);
        }
        const seq = snapshot.seq ?? 0;
        const thread = new ChatThread(snapshot.info, snapshot.items);
        let resetSeq = snapshot.resetSeq ?? 0;
        for (const line of lines) {
            // A crash between writing a snapshot and folding the log into it leaves lines the snapshot already holds.
            if (line.seq <= seq) {
                continue;
            }
            thread.apply(line.event);
            if (line.event.type === 'reset') {
                resetSeq = line.seq;
            }
        }
        return {
            ...thread.snapshot(),
            seq,
            resetSeq,
            preambles: snapshot.preambles ?? [],
            uiAccess: snapshot.uiAccess ?? {},
            extras: withoutOwnKeys(snapshot),
            lines
        };
    }

    /*
     * Whether a record is on disk that this host cannot read: one a newer version wrote, one cut short,
     * one edited by hand. It is left alone rather than written over, together with its log.
     */
    async unreadable(chatId: string): Promise<boolean> {
        return (await this.readSnapshot(chatId)) === UNREADABLE;
    }

    /*
     * Whether the chat has neither a turn in flight nor a resume after a limit, by the info its record
     * starts with and the last one its log wrote, without parsing the thread. False whenever that
     * cannot be told so cheaply, which leaves the decision to `read`.
     */
    async settled(chatId: string): Promise<boolean> {
        if (!settledInfo(await leadingInfo(join(this.dir, recordFileName(chatId))))) {
            return false;
        }
        const last = lastLoggedInfo((await readOrNull(this.logPath(chatId))) ?? '');
        return last === undefined || settledInfo(last);
    }

    private async readSnapshot(chatId: string): Promise<z.infer<typeof RecordSchema> | typeof UNREADABLE | null> {
        const raw = await readOrNull(join(this.dir, recordFileName(chatId)));
        if (raw === null) {
            return null;
        }
        let record: unknown;
        try {
            record = JSON.parse(raw);
        } catch {
            return UNREADABLE;
        }
        // Before the schema sees it: an image written inline no longer has a shape the schema knows.
        if (this.attachments) {
            const migrated = await migrateInlineAttachments(chatId, record, this.attachments).catch(() => null);
            if (migrated !== null) {
                record = migrated;
                await writeAtomic(join(this.dir, recordFileName(chatId)), JSON.stringify(migrated));
            }
        }
        const parsed = RecordSchema.safeParse(liftUiAccess(record));
        return parsed.success ? parsed.data : UNREADABLE;
    }

    async delete(chatId: string): Promise<void> {
        await Promise.all([rm(join(this.dir, recordFileName(chatId)), { force: true }), rm(this.logPath(chatId), { force: true })]);
    }
}

const UNREADABLE = Symbol('unreadable');

const RECORD_HEAD = Buffer.from('{"info":{');
const HEAD_CHUNK_BYTES = 16384;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;

/*
 * The info a record starts with, read only as far as it goes; undefined for a record that is missing,
 * starts otherwise (an older or hand-edited one) or ends before its info does. Scanning bytes is safe
 * in UTF-8, where no byte of a multibyte character equals a quote, a backslash or a brace.
 */
async function leadingInfo(path: string): Promise<unknown> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
        handle = await open(path, 'r');
    } catch (e) {
        if (isNotFound(e)) {
            return undefined;
        }
        throw e;
    }
    try {
        let head = Buffer.alloc(0);
        let at = RECORD_HEAD.length;
        let depth = 1;
        let inString = false;
        let escaped = false;
        const chunk = Buffer.alloc(HEAD_CHUNK_BYTES);
        let { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
        while (bytesRead > 0) {
            head = Buffer.concat([head, chunk.subarray(0, bytesRead)]);
            if (!head.subarray(0, RECORD_HEAD.length).equals(RECORD_HEAD.subarray(0, Math.min(head.length, RECORD_HEAD.length)))) {
                return undefined;
            }
            for (; at < head.length; at++) {
                const byte = head[at]!;
                if (escaped) {
                    escaped = false;
                } else if (inString) {
                    escaped = byte === BACKSLASH;
                    inString = byte !== QUOTE;
                } else if (byte === QUOTE) {
                    inString = true;
                } else if (byte === OPEN_BRACE) {
                    depth += 1;
                } else if (byte === CLOSE_BRACE) {
                    depth -= 1;
                    if (depth === 0) {
                        return parseOrUndefined(head.subarray(RECORD_HEAD.length - 1, at + 1).toString('utf8'));
                    }
                }
            }
            ({ bytesRead } = await handle.read(chunk, 0, chunk.length, head.length));
        }
        return undefined;
    } finally {
        await handle.close();
    }
}

/* The info of the last info or reset line in a log, unvalidated; undefined when no line carries one. */
function lastLoggedInfo(raw: string): unknown {
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        // Most lines are items and deltas, which are larger and never carry this key.
        if (!lines[i]!.includes('"info"')) {
            continue;
        }
        const event = (parseOrUndefined(lines[i]!) as { event?: { type?: unknown; info?: unknown } } | null | undefined)?.event;
        if (event?.type === 'info' || event?.type === 'reset') {
            return event.info;
        }
    }
    return undefined;
}

function settledInfo(info: unknown): boolean {
    return typeof info === 'object' && info !== null && (info as { activeTurnId?: unknown }).activeTurnId === null && !('resumeAt' in info);
}

function parseOrUndefined(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (e) {
        if (isNotFound(e)) {
            return false;
        }
        throw e;
    }
}

async function readOrNull(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
}

/*
 * A chat whose first snapshot never reached the disk (the host went down within moments of its
 * first turn) is rebuilt from its log when the log starts at the beginning and says what the chat
 * is. Otherwise the chat starts over, and its stream goes on after the last seq the log handed out
 * with a reset marked there, so a client holding a seq from before cannot be answered from after.
 */
function fromLogAlone(lines: ChatLogLine[]): ChatRecord | null {
    if (lines.length === 0) {
        return null;
    }
    const first = lines.find((line) => line.event.type === 'info' || line.event.type === 'reset')?.event;
    if (lines[0]!.seq !== 1 || (first?.type !== 'info' && first?.type !== 'reset')) {
        return null;
    }
    const thread = new ChatThread(first.info);
    let resetSeq = 0;
    for (const line of lines) {
        thread.apply(line.event);
        if (line.event.type === 'reset') {
            resetSeq = line.seq;
        }
    }
    return { ...thread.snapshot(), seq: 0, resetSeq, preambles: [], uiAccess: {}, extras: {}, lines };
}
