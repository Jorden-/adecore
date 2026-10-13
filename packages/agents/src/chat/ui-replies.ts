import { createHash } from 'node:crypto';
import { GeneratedImageInputSchema, type ChatAssistantItem, type ChatEvent, type ChatItem } from '@adecore/agent-contracts';
import { uiHasFence, uiMayReferenceHost } from '@adecore/intelligent-ui';
import type { UiCompileOptions } from '@adecore/intelligent-ui/compiler';
import { UiStream, type UiStreamPreview } from '@adecore/intelligent-ui/stream';
import type { OutboxClock } from '../outbox/outbox-worker.ts';
import type { ChatThread } from './thread.ts';

// Longer than any fence line or the name of a tag a scan looks for, so a match never falls between two deltas.
const UI_SCAN_OVERLAP = 64;

/* What a host answers about the UI blocks of a reply: the schemas of its query sources, and a look at each reply that may read them. */
export interface UiReplyHost {
    schemas: UiCompileOptions['querySchemas'];
    observe(item: ChatAssistantItem, final: boolean): void;
}

export interface UiRepliesOptions {
    thread: ChatThread;
    fenceLanguage: string;
    clock: OutboxClock;
    host?: UiReplyHost;
    emit(event: ChatEvent): void;
    // What the agent hears in front of its next prompt about a block that compiled with diagnostics.
    repair(note: string): void;
}

/*
 * The UI blocks in the replies of a chat's main agent: every event of the chat passes through here on
 * its way out, and a reply with a UI fence in it is compiled as it streams, with a preview per delta
 * and the finished blocks on the item once it settles.
 */
export class UiReplies {
    private readonly options: UiRepliesOptions;
    private readonly streams = new Map<string, UiStream>();
    private readonly compiled = new Map<string, UiStreamPreview>();
    // How much of a streaming reply's text the fence and host scans already covered, so a delta scans only its tail.
    private readonly scanned = new Map<string, number>();
    private readonly referencing = new Set<string>();
    private readonly attachments = new Map<string | null, string | undefined>();

    constructor(options: UiRepliesOptions) {
        this.options = options;
    }

    /* The preview of every reply still streaming, as deltas, for a client that attached in the middle of one. */
    previews(): ChatEvent[] {
        const events: ChatEvent[] = [];
        for (const [itemId, preview] of this.compiled) {
            const item = this.options.thread.get(itemId);
            if (item?.kind === 'assistant' && item.streaming && item.text.length === preview.textLength) {
                events.push({ type: 'delta', itemId, text: '', ui: preview.blocks, textLength: preview.textLength });
            }
        }
        return events;
    }

    previewItems(items: ChatItem[]): ChatItem[] {
        return items.map((item) => {
            const preview = this.compiled.get(item.id);
            return item.kind === 'assistant' && preview?.textLength === item.text.length ? { ...item, ui: preview.blocks } : item;
        });
    }

    /* Hands one event of the chat on, with the blocks of a reply it finished in place of its fences. */
    pass(event: ChatEvent): void {
        const { thread, emit } = this.options;
        if (event.type === 'reset') {
            this.clear();
        }
        if (event.type === 'item' && event.item.kind === 'tool') {
            this.attachments.delete(event.item.turnId);
        }
        const item = event.type === 'item' ? event.item : event.type === 'delta' ? thread.get(event.itemId) : null;
        if (item?.kind !== 'assistant' || item.parentToolUseId) {
            emit(event);
            return;
        }
        const tail = this.unscannedText(item, event.type === 'item');
        if (uiMayReferenceHost(tail)) {
            this.referencing.add(item.id);
        }
        let stream = this.streams.get(item.id);
        if (!stream && !uiHasFence(tail, this.options.fenceLanguage)) {
            this.forgetScan(item);
            emit(event);
            return;
        }
        if (!stream) {
            stream = new UiStream({
                querySchemas: this.options.host?.schemas,
                fenceLanguage: this.options.fenceLanguage,
                id: item.id,
                clock: this.options.clock,
                emit: (preview) => {
                    this.compiled.set(item.id, preview);
                    emit({ type: 'delta', itemId: item.id, text: '', ui: preview.blocks, textLength: preview.textLength });
                }
            });
            this.streams.set(item.id, stream);
        }
        if (this.referencing.has(item.id)) {
            this.options.host?.observe(item, false);
        }
        this.forgetScan(item);
        const latestAttachment = this.latestAttachment(item.turnId);
        if (event.type !== 'item' || item.streaming) {
            emit(event);
            stream.update(item.text, latestAttachment);
            return;
        }
        const ui = stream
            .finish(item.text, latestAttachment)
            .map((block) => ({ ...block, revision: createHash('sha256').update(JSON.stringify(block)).digest('hex') }));
        this.streams.delete(item.id);
        this.compiled.delete(item.id);
        const diagnostics = [...new Set(ui.flatMap((block) => block.diagnostics.map((diagnostic) => diagnostic.message)))].slice(0, 6);
        if (diagnostics.length > 0) {
            this.options.repair(
                `Your last ${this.options.fenceLanguage} block had these diagnostics: ${diagnostics.join(' ')} Use the catalog's supported props and components.`.slice(
                    0,
                    1200
                )
            );
        }
        const current = thread.get(item.id);
        const completed = { ...item, ui, ...(current?.kind === 'assistant' && current.uiQueries ? { uiQueries: current.uiQueries } : {}) };
        emit(thread.upsert(completed));
        this.options.host?.observe(completed, true);
    }

    clear(): void {
        for (const stream of this.streams.values()) {
            stream.dispose();
        }
        this.streams.clear();
        this.compiled.clear();
        this.scanned.clear();
        this.referencing.clear();
        this.attachments.clear();
    }

    /*
     * The text a scan has not covered yet, from the start of the line the last scan ended in, since a fence
     * is one line; a long line is cut short, behind a character no fence or tag can follow.
     */
    private unscannedText(item: ChatAssistantItem, whole: boolean): string {
        const scanned = whole ? 0 : (this.scanned.get(item.id) ?? 0);
        this.scanned.set(item.id, item.text.length);
        if (scanned === 0 || scanned > item.text.length) {
            return item.text;
        }
        const line = item.text.lastIndexOf('\n', scanned - 1) + 1;
        const from = Math.max(line, scanned - UI_SCAN_OVERLAP);
        return from === line ? item.text.slice(from) : `\0${item.text.slice(from)}`;
    }

    private forgetScan(item: ChatAssistantItem): void {
        if (!item.streaming) {
            this.scanned.delete(item.id);
            this.referencing.delete(item.id);
        }
    }

    /* Looked up once per turn, and again only after one of its tool calls changed. */
    private latestAttachment(turnId: string | null): string | undefined {
        if (this.attachments.has(turnId)) {
            return this.attachments.get(turnId);
        }
        const attachment = this.findAttachment(turnId);
        this.attachments.set(turnId, attachment);
        return attachment;
    }

    private findAttachment(turnId: string | null): string | undefined {
        for (const item of this.options.thread.list().toReversed()) {
            if (item.kind !== 'tool' || item.turnId !== turnId || item.name !== 'ImageGeneration' || item.state !== 'done') {
                continue;
            }
            const input = GeneratedImageInputSchema.safeParse(item.input);
            if (input.success && input.data.attachment?.mime.startsWith('image/')) {
                return input.data.attachment.id;
            }
        }
        return undefined;
    }
}
