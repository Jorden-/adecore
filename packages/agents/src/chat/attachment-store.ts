import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { attachmentImageMime, type ChatAttachment, type ChatAttachmentUpload } from '@adecore/agent-contracts';

// The extension the file gets on disk when its name does not carry a usable one.
const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'text/plain': 'txt'
};

const SAFE_EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/* What the file is called on disk: the id, plus an extension the agent's tools can recognize. */
export function extensionFor(name: string, mime: string): string {
    const own = extname(name).slice(1).toLowerCase();
    if (SAFE_EXTENSION.test(own)) {
        return own;
    }
    const known = EXTENSIONS[mime.toLowerCase()];
    if (known) {
        return known;
    }
    const subtype = mime.split('/')[1]?.replace(/\+.*$/, '') ?? '';
    return SAFE_EXTENSION.test(subtype) ? subtype.toLowerCase() : 'bin';
}

/*
 * The files people attach to a message, under `<home>/attachments/<chatId>`. The thread keeps
 * only what a row needs (name, mime, size, path); the bytes stay on disk, so a thread with a video
 * in it is still a small JSON file.
 */
export class AttachmentStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'attachments');
    }

    /* Writes one upload and answers the metadata the thread stores. */
    async save(chatId: string, upload: ChatAttachmentUpload): Promise<ChatAttachment> {
        const bytes = Buffer.from(upload.data, 'base64');
        const mime = attachmentImageMime(upload) ?? upload.mime;
        const id = randomBytes(8).toString('hex');
        const folder = this.folderOf(chatId);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = join(folder, `${id}.${extensionFor(upload.name, mime)}`);
        await writeFile(path, bytes, { mode: 0o600 });
        return { id, name: upload.name, mime, size: bytes.byteLength, path };
    }

    async saveGenerated(chatId: string, ref: string, upload: ChatAttachmentUpload): Promise<ChatAttachment> {
        const id = createHash('sha256').update(`codex-image:${ref}`).digest('hex');
        const bytes = Buffer.from(upload.data, 'base64');
        const folder = this.folderOf(chatId);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = join(folder, `${id}.${extensionFor('', upload.mime)}`);
        const temporary = join(folder, `.${id}-${randomBytes(8).toString('hex')}.tmp`);
        try {
            await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
            try {
                // Publish complete bytes without replacing an image another replay has already saved.
                await link(temporary, path);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
                const previous = await readFile(path);
                if (!previous.equals(bytes)) {
                    throw new Error('The generated image id already belongs to another image');
                }
            }
        } finally {
            await rm(temporary, { force: true });
        }
        return { id, name: upload.name, mime: upload.mime, size: bytes.byteLength, path };
    }

    async copy(chatId: string, attachment: ChatAttachment): Promise<ChatAttachment> {
        const bytes = await readFile(attachment.path);
        const folder = this.folderOf(chatId);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = join(folder, `${createHash('sha256').update(attachment.id).digest('hex')}.${extensionFor(attachment.name, attachment.mime)}`);
        await writeFile(path, bytes, { mode: 0o600 });
        return { ...attachment, path };
    }

    /* Everything a chat attached; used when the chat itself is deleted. */
    async removeAll(chatId: string): Promise<void> {
        await rm(this.folderOf(chatId), { recursive: true, force: true });
    }

    /* Where the files of one chat are; a store that keeps more of a chat's files beside them writes them here. */
    folderOf(chatId: string): string {
        // `encodeURIComponent` leaves `.` and `..` as they are, and those would name this folder or the host's own.
        const segment = chatId === '.' || chatId === '..' ? chatId.replaceAll('.', '%2E') : encodeURIComponent(chatId);
        return join(this.dir, segment);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// What an attachment looked like before the files moved out of the thread: the bytes inline.
function isInline(value: unknown): value is { name: string; mediaType: string; data: string } {
    return isRecord(value) && typeof value.name === 'string' && typeof value.mediaType === 'string' && typeof value.data === 'string';
}

/*
 * Writes out the images a thread still carries inline and answers the record with metadata in their
 * place, or null when there was nothing to do. Old records are migrated on the read that opens the
 * chat, before the schema sees them, because the schema no longer knows the inline shape.
 */
export async function migrateInlineAttachments(chatId: string, record: unknown, store: AttachmentStore): Promise<unknown | null> {
    const items = isRecord(record) && Array.isArray(record.items) ? record.items : null;
    if (!items) {
        return null;
    }
    let migrated = false;
    const next = await Promise.all(
        items.map(async (item) => {
            if (!isRecord(item) || !Array.isArray(item.attachments) || !item.attachments.some(isInline)) {
                return item;
            }
            const attachments = await Promise.all(
                item.attachments.map(async (attachment) => {
                    if (!isInline(attachment)) {
                        return attachment;
                    }
                    migrated = true;
                    return await store.save(chatId, { name: attachment.name, mime: attachment.mediaType, data: attachment.data });
                })
            );
            return { ...item, attachments };
        })
    );
    return migrated ? { ...(record as Record<string, unknown>), items: next } : null;
}
