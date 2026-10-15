import { randomUUID } from 'node:crypto';
import type {
    ChatAttachment,
    ChatCheckpointDiff,
    ChatEvent,
    ChatGoalAction,
    ChatInfo,
    ChatItem,
    ChatQueuedMessage,
    ChatQuoteSource,
    ChatSkill,
    ChatSubagentItem,
    ChatToolItem,
    ChatTurnItem,
    ChatUiAnswer,
    ChatUiChoiceOrigin,
    ChatUiChoicePayload,
    ChatUiQueryState,
    ModelSelection,
    RuntimeMode
} from '@adecore/agent-contracts';
import { ENDED_NOTE_PREFIX, HOST_TASK_ORIGIN, notResumedNote } from '@adecore/agent-contracts';
import { resolveUiChoice, UI_FENCE_LANGUAGE, UiFailure } from '@adecore/intelligent-ui';
import type { ChatProvider } from '../providers/provider.ts';
import type { LimitsUpdate } from '../usage/limits/normalize.ts';
import type { BackendEvent, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { commandLabel, isBackgroundWork, reportsOnBackgroundWork, runningInBackground, type BackgroundWork } from './background-work.ts';
import type { SpawnChatProcess } from './chat-process.ts';
import type { ChatTitleInput } from './chat-title.ts';
import { ChatError } from './errors.ts';
import { limitedTurn, limitResumeAt, limitResumeWake } from './limit-resume.ts';
import { isMainAgentOutput, ThreadProjector } from './projector.ts';
import { readableAssistantText } from './readable-text.ts';
import type { SubagentSettlement } from './subagent-settlement.ts';
import { ChatThread } from './thread.ts';
import { UiReplies, type UiReplyHost } from './ui-replies.ts';
import { errorText } from '../error-text.ts';
import { systemClock, type OutboxClock } from '../outbox/outbox-worker.ts';

/* What a host keeps of a chat's turns in git (or anything like it), so a turn can show what it changed. */
export interface TurnCheckpoints {
    take(cwd: string): Promise<string | null>;
    diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null>;
    /* The diff of a turn that ended, with the tree of the folder it was taken against: where that turn left the files. */
    settle(cwd: string, tree: string): Promise<{ diff: ChatCheckpointDiff; after: string } | null>;
    /* The commit HEAD points at, or null when unborn or outside a repository. A host without it records no heads. */
    head?(cwd: string): Promise<string | null>;
}

/* What a host says in front of the next real prompt, beside the preambles a chat keeps itself. */
export interface PromptNotes {
    /* `shown` also lands in the thread as a note a person reads; `heard` only reaches the CLI. */
    next(): { shown: string[]; heard: string[] };
    /* The chat started over, so the next prompt is its first again. */
    reset(): void;
}

/* Chats a person attached to a message: the ones the host knows, and what the agent is told about them. */
export type ChatReferences = (ids: readonly string[] | undefined) => { ids: string[]; note: string | null };

export interface ChatSessionOptions {
    info: ChatInfo;
    clock?: OutboxClock;
    items?: ChatItem[];
    // Said once, in front of the next real prompt, and kept in the record until then (a fork's note for its agent).
    preambles?: string[];
    // The access a UI host captured per reply, from the record; never on the wire.
    uiAccess?: Readonly<Record<string, unknown>>;
    provider: ChatProvider;
    // The executable and leading arguments; a test points this at a fake CLI.
    command: string[];
    /* The environment of the CLI under the chat's account, asked at every start; throws for an account that cannot start. */
    env(account: string | undefined): Record<string, string>;
    spawn?: SpawnChatProcess;
    saveGeneratedImage?: BackendLaunch['saveGeneratedImage'];
    // What the agent is told at the start of every process, and what of it a resumed thread hears again; see `BackendLaunch`.
    instructions?(): string | null;
    resumeNote?(): string | null;
    // The folders beside the working directory, asked before every turn; a change starts the next turn in a new process.
    folders?(): readonly string[];
    // False runs the CLI without the configuration of the working folder; asked before every turn like the folders.
    projectConfig?(): boolean;
    promptNotes?: PromptNotes;
    references?: ChatReferences;
    // Trees per turn, so a settled turn can show what the working tree holds against its start.
    checkpoints?: TurnCheckpoints;
    // The info string of the host's UI fences; `UI_FENCE_LANGUAGE` without one.
    uiFenceLanguage?: string;
    ui?: UiReplyHost;
    emit(event: ChatEvent): void;
    /* What a turn said about the plan it runs on. It belongs to the machine, so it leaves the chat. */
    onLimits?(update: LimitsUpdate): void;
    persist(): void;
    save?(): Promise<void>;
    // A write that may wait a moment, for a small change the log already holds.
    persistSoon(): void;
    // The name the CLI gave its session, where it writes one down; absent for a CLI that does not.
    readTitle?(agentSessionId: string): Promise<string | null>;
    // A name asked of a one-shot CLI, for a CLI that names nothing itself; null when none came.
    nameThread?(input: ChatTitleInput): Promise<string | null>;
    // How a subagent's own transcript says it ended, for a row whose CLI is gone; absent for a CLI that keeps none.
    subagentSettlement?(toolUseId: string): Promise<SubagentSettlement | null>;
    // What the host owes a turn that stopped on a limit; absent, nothing takes one up on its own.
    limitResume?: LimitResumeHooks;
}

export interface LimitResumeHooks {
    // The host's switch; the chat's own `resumeAtReset` can still say no.
    allowed(): boolean;
    now(): number;
    // Owes what takes the turn up at `at`, in place of anything this chat was owed before.
    owe(turnId: string, at: number): Promise<void>;
    lapse(): Promise<void>;
    owed(): boolean;
}

// Claude Code names a session about six seconds after its first prompt, and a first turn can run for minutes.
const TITLE_RECHECK_MS = 10_000;

export interface ChatSendExtras {
    uiChoice?: ChatUiChoiceOrigin;
    delivery?: 'steer' | 'queue';
    mentions?: string[];
    skills?: string[];
    chats?: string[];
    quoteSource?: ChatQuoteSource;
    attachments?: ChatAttachment[];
}

/* How a turn the host went down in is taken up: what the CLI is told, the note a person reads, and what goes in front. */
export interface ResumeWords {
    prompt: string;
    note: string;
    preamble: string | null;
}

/* One per limited turn, so a second fork of the same turn writes no second note. */
function continuedNoteId(turnId: string): string {
    return `continued-${turnId}`;
}

function newId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/*
 * Item and request ids carry the generation of the CLI that made them, and a restart of the host
 * must not hand out one a stored thread already holds. Starting from the clock puts every run above
 * the ones before it, as long as it handed out fewer than one per millisecond it ran.
 */
let lastGeneration = Date.now();
function nextGeneration(): number {
    lastGeneration = Math.max(lastGeneration + 1, Date.now());
    return lastGeneration;
}

function sameFolders(first: readonly string[], second: readonly string[]): boolean {
    return first.length === second.length && first.every((folder, i) => folder === second[i]);
}

/*
 * Provider-neutral chat state. Backends live between turns and resume by CLI session id after a
 * crash, host restart, or model and mode change.
 */
export class ChatSession {
    readonly thread: ChatThread;
    private readonly options: ChatSessionOptions;
    private readonly projector: ThreadProjector;
    private backend: ChatBackend | null = null;
    private starting: Promise<ChatBackend> | null = null;
    private pendingStart: { turnId: string; warning: unknown } | null = null;
    private sendAfterStop = false;
    // A message the person sent while a settings change waited goes out once it applies, paused queue or not.
    private sendAfterReplacement = false;
    private readonly workflowWarnings = new Map<string, unknown>();
    // New per backend, so thread items of a resumed CLI never overwrite older ones.
    private generation = nextGeneration();
    // Claude's task notification precedes the turn that reports its result.
    private awaitingBackgroundReport = false;
    // The selection the running CLI was started on; a window it reports is that one's, not a newer pick's.
    private launchedSelection: ModelSelection | null = null;
    // The account the running CLI was started under, which what it reports about a plan belongs to.
    private launchedAccount: string | undefined = undefined;
    private launchedCwd: string | null = null;
    // Set while the host moves the chat's folder: messages queue and nothing starts a process until it ends.
    private relocating = false;
    private launchedRuntimeMode: RuntimeMode | null = null;
    private launchedFolders: readonly string[] = [];
    private launchedProjectConfig = true;
    // The checkpoint of the turn in flight; everything queued for that turn waits for it.
    private turnReady: Promise<void> = Promise.resolve();
    // Turns we settled ourselves whose `result` is still on its way; it may not close the turn after them.
    private staleResults = 0;
    // The last turn the main agent spoke in; a turn opened only for a subagent's request gets no `result`.
    private spokenTurnId: string | null = null;
    private titleTimer: ReturnType<typeof setTimeout> | null = null;
    // A name is asked for once per chat this host holds; the turn count keeps it once across restarts.
    private naming = false;
    // Set while the host goes down: a CLI dying with it must not end the turn a restart takes up again.
    private frozen = false;
    // Which CLI process (generation) announced each subagent of its own, by call id; only that one can stop it.
    private readonly subagentOwners = new Map<string, number>();
    // Subagents a stop_task went out for, as task id to call id, until their notification settles them.
    private readonly stopping = new Map<string, string>();
    // Background subagents a load found running whose transcript did not show an end yet; no CLI here will report them.
    private readonly orphans = new Set<string>();
    private pendingPreambles: readonly string[];
    private submission: { turnId: string; input: TurnInput } | null = null;
    private readonly steering = new Set<string>();
    private readonly capturedUiAccess: Map<string, unknown>;
    private readonly uiReplies: UiReplies;

    constructor(options: ChatSessionOptions) {
        this.options = options;
        this.pendingPreambles = options.preambles ?? [];
        this.capturedUiAccess = new Map(Object.entries(options.uiAccess ?? {}));
        this.thread = new ChatThread(options.info, options.items);
        this.projector = new ThreadProjector(this.thread, { providerName: options.provider.name });
        this.uiReplies = new UiReplies({
            thread: this.thread,
            fenceLanguage: options.uiFenceLanguage ?? UI_FENCE_LANGUAGE,
            clock: options.clock ?? systemClock,
            ...(options.ui ? { host: options.ui } : {}),
            emit: (event) => options.emit(event),
            repair: (note) => {
                if (!this.pendingPreambles.includes(note)) {
                    this.pendingPreambles = [...this.pendingPreambles, note];
                }
            }
        });
    }

    get uiPreviews(): ChatEvent[] {
        return this.uiReplies.previews();
    }

    previewItems(items: ChatItem[]): ChatItem[] {
        return this.uiReplies.previewItems(items);
    }

    get id(): string {
        return this.thread.info.chatId;
    }

    get info(): ChatInfo {
        return this.thread.info;
    }

    get running(): boolean {
        return this.backend?.running === true;
    }

    /* What still waits for the next real prompt, for the record. */
    get preambles(): readonly string[] {
        return [...this.pendingPreambles, ...(this.submission?.input.preamble ? [this.submission.input.preamble] : [])];
    }

    get pid(): number | null {
        return this.backend?.pid ?? null;
    }

    /* Whether the person has to wait. A turn the CLI opened itself is stepped on by the next message. */
    get busy(): boolean {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        // A turn the CLI opened toward a goal is the goal's own: a message waits for it like for any turn of the person's.
        return turnId !== null && (turn?.kind !== 'turn' || turn.origin !== 'agent' || this.goalWorks());
    }

    /* Whether the CLI works toward a goal, which goes on in turns of its own until the goal is met, paused or cleared. */
    private goalWorks(): boolean {
        return this.thread.info.goal?.status === 'active';
    }

    /*
     * Pauses, resumes or clears the chat's goal. A CLI with calls for it takes them at once, even while a goal
     * turn runs; resuming an idle goal and clearing a goal of a CLI without them go out as `/goal` in a turn of
     * their own, which a goal turn still running is in the way of.
     */
    async goal(action: ChatGoalAction): Promise<void> {
        const supported = this.options.provider.capabilities.goals;
        if (supported === undefined || (supported === 'command' && action !== 'clear')) {
            throw new ChatError('chat-unsupported', `${this.options.provider.name} cannot ${action} a goal`);
        }
        if (this.thread.info.goal === undefined) {
            throw new ChatError('goal-not-found', 'This chat has no goal');
        }
        const backend = this.backend;
        if (supported === 'native' && backend?.goal && backend.running && (action !== 'resume' || this.busy)) {
            await backend.goal(action);
            return;
        }
        if (this.busy) {
            throw new ChatError('chat-busy', 'Stop the turn that works toward the goal first');
        }
        this.send(`/goal ${action}`);
    }

    /* The next process uses these settings; live work keeps the process it started in. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; resumeAtReset?: boolean }): ChatInfo {
        if (patch.resumeAtReset !== undefined && patch.resumeAtReset !== this.thread.info.resumeAtReset) {
            this.emit([this.thread.patchInfo({ resumeAtReset: patch.resumeAtReset })]);
            this.options.persist();
            this.resumeSettingChanged();
        }
        const catalog = this.options.provider.catalog;
        const selection = patch.selection ? catalog.normalize(patch.selection) : this.thread.info.selection;
        const next: Partial<ChatInfo> = {
            selection,
            runtimeMode: patch.runtimeMode ?? this.thread.info.runtimeMode
        };
        const changed = JSON.stringify(next.selection) !== JSON.stringify(this.thread.info.selection) || next.runtimeMode !== this.thread.info.runtimeMode;
        if (!changed) {
            return this.thread.info;
        }
        if (patch.selection) {
            next.usage = { ...this.thread.info.usage, contextWindow: catalog.contextWindowFor(selection) };
        }
        this.emit([this.thread.patchInfo(next)]);
        this.options.persist();
        this.drainQueue();
        return this.thread.info;
    }

    /* The next process uses this account; current usage still belongs to the launched account. */
    setAccount(account: string | undefined): ChatInfo {
        if (account === this.thread.info.account) {
            return this.thread.info;
        }
        this.emit([this.thread.patchInfo({ account })]);
        this.options.persist();
        this.drainQueue();
        return this.thread.info;
    }

    /* The next process starts in this folder; the host moves the chat through `ChatCore.relocate`, which has already ended the old one. */
    setCwd(cwd: string): ChatInfo {
        if (cwd === this.thread.info.cwd) {
            return this.thread.info;
        }
        this.emit([this.thread.patchInfo({ cwd })]);
        this.options.persist();
        return this.thread.info;
    }

    get relocatable(): boolean {
        return (
            !this.frozen &&
            !this.relocating &&
            this.thread.info.activeTurnId === null &&
            !this.processInUse() &&
            this.pendingStart === null &&
            !this.thread.held
        );
    }

    get isRelocating(): boolean {
        return this.relocating;
    }

    /* Messages sent from here on queue, and the queue stays put until `endRelocate`. */
    beginRelocate(): void {
        this.relocating = true;
    }

    /*
     * Lets the queue go, in whichever folder the chat has now. A wake that found the chat relocating
     * was turned away and waits for an event of this chat, so one goes out even when the queue was empty.
     */
    endRelocate(): void {
        this.relocating = false;
        this.drainQueue();
        this.emit([this.thread.patchInfo({})]);
    }

    /*
     * Internal follow-ups wait for a new turn. User input goes through `sendInput`, which can steer native work.
     */
    send(text: string, sent: ChatSendExtras = {}): { queued: boolean; turnId: string } {
        const extras = this.vetted(sent);
        const turnId = newId('turn');
        // Behind whatever still waits (a CLI that crashed leaves its queue), so everything goes out in the order it was sent.
        if (this.busy || this.queue.length > 0 || this.replacementWaits() || this.relocating) {
            if (this.busy && this.info.queuePaused) {
                this.sendAfterStop = true;
            }
            const message: ChatQueuedMessage = {
                id: newId('queued'),
                turnId,
                text,
                createdAt: Date.now(),
                ...(extras.uiChoice ? { uiChoice: extras.uiChoice } : {}),
                ...(extras.mentions?.length ? { mentions: extras.mentions } : {}),
                ...(extras.skills?.length ? { skills: extras.skills } : {}),
                ...(extras.chats?.length ? { chats: extras.chats } : {}),
                ...(extras.quoteSource ? { quoteSource: extras.quoteSource } : {}),
                ...(extras.attachments?.length ? { attachments: extras.attachments } : {})
            };
            this.setQueue([...this.queue, message]);
            this.lapseResume();
            this.drainQueue(true);
            return { queued: true, turnId };
        }
        this.dispatch(text, extras, turnId);
        return { queued: false, turnId };
    }

    /* What a UI host captured for a reply; null where the capture was denied or is still out, undefined where none started. */
    uiAccess(itemId: string): unknown {
        return this.capturedUiAccess.get(itemId);
    }

    setUiAccess(itemId: string, access: unknown): void {
        if (this.frozen) {
            return;
        }
        this.capturedUiAccess.set(itemId, access);
        this.options.persistSoon();
    }

    /* The captured access of the replies still in the thread, for the record. */
    get uiAccessRecord(): Record<string, unknown> {
        return Object.fromEntries([...this.capturedUiAccess].filter(([itemId]) => this.thread.get(itemId) !== undefined));
    }

    updateUiQueries(itemId: string, uiQueries: ChatUiQueryState): void {
        const item = this.thread.get(itemId);
        if (this.frozen || item?.kind !== 'assistant' || item.parentToolUseId) {
            return;
        }
        this.thread.upsert({ ...item, uiQueries });
        this.options.emit({ type: 'delta', itemId, text: '', uiQueries });
        this.options.persistSoon();
    }

    choose(payload: ChatUiChoicePayload, queries: Readonly<Record<string, unknown>> = {}): { queued: boolean; turnId: string } {
        const item = this.thread.get(payload.itemId);
        const block =
            item?.kind === 'assistant' && !item.streaming && !item.parentToolUseId ? item.ui?.find((block) => block.id === payload.blockId) : undefined;
        if (item?.kind !== 'assistant' || !block?.revision || block.revision !== payload.revision) {
            throw new ChatError('stale-ui-block', 'This completed UI block is no longer available at the requested revision');
        }
        const sameBlock = (origin: ChatUiChoiceOrigin | undefined) =>
            origin?.itemId === item.id && origin.blockId === block.id && origin.revision === block.revision;
        let previous = item.uiAnswers?.[block.id];
        if (previous?.revision !== block.revision) {
            previous = undefined;
        }
        // The message is logged first: a crash before its answer marker must not send it a second time.
        if (!previous) {
            const sent = this.thread.list().find((entry) => entry.kind === 'user' && sameBlock(entry.uiChoice));
            const queued = this.queue.find((entry) => sameBlock(entry.uiChoice));
            const origin = sent?.kind === 'user' ? sent.uiChoice : queued?.uiChoice;
            const turnId = sent?.turnId ?? queued?.turnId;
            if (origin && turnId) {
                previous = { ...origin, turnId, queued: !sent };
                this.recordUiAnswer(previous);
            }
        }
        if (previous) {
            if (previous.choiceId !== payload.choiceId) {
                throw new ChatError('ui-already-answered', 'This UI block was already answered');
            }
            return { queued: previous.queued, turnId: previous.turnId };
        }
        let selected;
        try {
            selected = resolveUiChoice(block, payload.choiceId, payload.values, queries);
        } catch (error) {
            throw new ChatError(
                error instanceof UiFailure ? error.code : 'refused-choice',
                error instanceof Error ? error.message : 'This choice could not be read'
            );
        }
        const origin: ChatUiChoiceOrigin = {
            itemId: item.id,
            blockId: block.id,
            revision: block.revision,
            choiceId: payload.choiceId,
            label: selected.label,
            sourceAt: item.createdAt,
            older: this.thread.list().findLast((entry) => entry.kind === 'assistant' && !entry.parentToolUseId)?.id !== item.id,
            values: selected.values,
            at: Date.now()
        };
        const result = this.send(selected.context, { uiChoice: origin });
        this.recordUiAnswer({ ...origin, ...result });
        return result;
    }

    private recordUiAnswer(answer: ChatUiAnswer): void {
        const item = this.thread.get(answer.itemId);
        if (item?.kind !== 'assistant') {
            return;
        }
        if (JSON.stringify(item.uiAnswers?.[answer.blockId]) === JSON.stringify(answer)) {
            return;
        }
        this.options.emit(this.thread.upsert({ ...item, uiAnswers: { ...item.uiAnswers, [answer.blockId]: answer } }));
        this.options.persist();
    }

    /* A quote whose source is no reply of this thread is sent as the plain text it is; the message itself is never refused for it. */
    private vetted(extras: ChatSendExtras): ChatSendExtras {
        if (extras.quoteSource === undefined || this.thread.get(extras.quoteSource.itemId)?.kind === 'assistant') {
            return extras;
        }
        const plain = { ...extras };
        delete plain.quoteSource;
        return plain;
    }

    sendInput(text: string, extras: ChatSendExtras = {}): Promise<{ queued: boolean; turnId: string }> {
        return this.submitInput(text, extras);
    }

    private async submitInput(text: string, sent: ChatSendExtras): Promise<{ queued: boolean; turnId: string }> {
        const extras = this.vetted(sent);
        const backend = this.backend;
        const turnId = this.info.activeTurnId;
        if (
            extras.delivery !== 'steer' ||
            this.info.queuePaused ||
            text.startsWith('/') ||
            // A goal runs as turns of its own; a message waits for the one running instead of joining it.
            this.goalWorks() ||
            !this.busy ||
            !turnId ||
            !backend?.steerTurn ||
            this.pendingStart ||
            this.replacementWaits()
        ) {
            return this.send(text, extras);
        }
        const queued = this.send(text, extras);
        const message = this.queue.find((entry) => entry.turnId === queued.turnId);
        if (!message) {
            return queued;
        }
        this.steering.add(message.id);
        try {
            const references = this.options.references?.(extras.chats) ?? { ids: extras.chats ?? [], note: null };
            const accepted = await backend.steerTurn({
                promptId: message.id,
                text,
                preamble: references.note,
                attachments: extras.attachments ?? [],
                mentions: extras.mentions ?? [],
                skills: extras.skills ?? []
            });
            if (!accepted) {
                return queued;
            }
            this.emit([
                this.thread.upsert({
                    id: `user-${message.id}`,
                    kind: 'user',
                    createdAt: message.createdAt,
                    turnId,
                    text,
                    mentions: extras.mentions,
                    skills: extras.skills,
                    chats: references.ids,
                    attachments: extras.attachments,
                    ...(extras.quoteSource ? { quoteSource: extras.quoteSource } : {})
                }),
                this.thread.patchInfo({ queue: this.queue.filter((entry) => entry.id !== message.id) })
            ]);
            this.options.persist();
            return { queued: false, turnId };
        } catch (error) {
            // A lost acknowledgement does not prove rejection. Keep the message for an explicit retry.
            this.pauseQueue(true);
            this.options.persist();
            throw error;
        } finally {
            this.steering.delete(message.id);
            this.drainQueue();
        }
    }

    /* Drops a queued message and hands it back; null when nothing waits under that id, as once it went out. */
    unqueue(messageId: string): ChatQueuedMessage | null {
        const queue = this.queue;
        const message = queue.find((entry) => entry.id === messageId);
        if (!message || this.steering.has(message.id)) {
            return null;
        }
        this.setQueue(queue.filter((entry) => entry.id !== messageId));
        return message;
    }

    /* Puts a queued message first and stops the turn in its way; the settle sends it. */
    sendNow(messageId: string): boolean {
        const queue = this.queue;
        const message = queue.find((entry) => entry.id === messageId);
        if (!message || this.steering.has(message.id)) {
            return false;
        }
        this.setQueue([message, ...queue.filter((entry) => entry.id !== messageId)]);
        if (this.busy) {
            this.cancel(true);
            return true;
        }
        this.lapseResume();
        this.drainQueue(true);
        return true;
    }

    private get queue(): ChatQueuedMessage[] {
        return this.thread.info.queue ?? [];
    }

    private setQueue(queue: ChatQueuedMessage[]): void {
        this.emit([this.thread.patchInfo({ queue })]);
        this.options.persist();
    }

    /* The next queued message, once nothing is in its way. */
    private drainQueue(asked = false): void {
        const [next, ...rest] = this.queue;
        const limited = limitedTurn(this.thread.list());
        const explicit = asked || this.sendAfterReplacement;
        if (
            !next ||
            this.steering.size > 0 ||
            this.busy ||
            this.relocating ||
            (!explicit && (this.info.queuePaused || (limited !== null && (limited.limit.kind === 'usage' || this.info.resumeAt !== undefined))))
        ) {
            return;
        }
        if (this.replacementWaits()) {
            this.sendAfterReplacement = explicit;
            const id = `settings-wait-${this.generation}`;
            if (!this.thread.get(id)) {
                this.emit([
                    this.thread.upsert({
                        id,
                        kind: 'note',
                        createdAt: Date.now(),
                        turnId: null,
                        level: 'info',
                        text: 'Your message is queued until the current work and open requests finish. The changes to this chat will apply then.'
                    })
                ]);
                this.options.persist();
            }
            return;
        }
        this.sendAfterReplacement = false;
        this.pauseQueue(false);
        this.setQueue(rest);
        this.dispatch(
            next.text,
            {
                mentions: next.mentions,
                skills: next.skills,
                chats: next.chats,
                attachments: next.attachments,
                uiChoice: next.uiChoice,
                quoteSource: next.quoteSource
            },
            next.turnId
        );
    }

    private dispatch(text: string, extras: ChatSendExtras, requestedTurnId?: string): void {
        this.pauseQueue(false);
        this.settleAgentTurn();
        // A goal that was met has said what it had to; the next message of the person leaves it behind.
        if (this.thread.info.goal?.status === 'complete') {
            this.emit([this.thread.patchInfo({ goal: undefined })]);
        }
        const { preamble, note } = this.contextNote(text);
        // A slash command must stay the first thing the CLI reads, as `contextNote` keeps it.
        const references = text.startsWith('/') || !this.options.references ? { ids: [], note: null } : this.options.references(extras.chats);
        const turnId = this.openTurn(text, note, { ...extras, chats: references.ids }, requestedTurnId);
        const choiceNote = extras.uiChoice
            ? `The person chose ${JSON.stringify(extras.uiChoice.label)} from your UI reply. Their message is the visible context of that choice.`
            : null;
        const said = [preamble, references.note, choiceNote].filter((part): part is string => part !== null);
        const input = {
            text,
            preamble: said.length === 0 ? null : said.join('\n\n'),
            attachments: extras.attachments ?? [],
            mentions: extras.mentions ?? [],
            skills: extras.skills ?? []
        };
        // The prompt waits for the checkpoint, so the tree is the folder as it was before the agent edited it.
        this.turnReady = this.checkpoint(turnId);
        this.submit(turnId, input);
    }

    /* Asks the CLI to fold its context: a call of its own, or the slash command as a turn. */
    compact(): void {
        const compaction = this.options.provider.capabilities.compaction;
        if (compaction === 'none') {
            throw new ChatError('chat-unsupported', `${this.options.provider.name} cannot fold its context`);
        }
        if (compaction === 'prompt') {
            this.send('/compact');
            return;
        }
        if (this.replacementWaits()) {
            throw new ChatError('chat-busy', 'The current work and open requests must finish before the changes to this chat can apply');
        }
        // A native compaction has no message of the person in front of it, only a turn to fold behind.
        this.openTurn(null, null, {});
        // Folding the context changes no file, so this turn needs no checkpoint.
        this.turnReady = Promise.resolve();
        this.run((backend) => backend.compact());
    }

    cancel(advanceQueue = false): void {
        this.sendAfterStop = advanceQueue;
        this.sendAfterReplacement = false;
        this.pauseQueue(true);
        this.lapseResume();
        const turnId = this.thread.info.activeTurnId;
        // A turn still waiting to be resumed has no process to interrupt; stopping it is ending it here.
        if (!this.backend && turnId !== null) {
            this.clearStartWarning();
            this.abandon(turnId, null);
            return;
        }
        if (!this.backend || turnId === null) {
            if (turnId === null && this.backend) {
                for (const item of this.thread.pending()) {
                    if (this.backend.declineRequest?.(item.requestId, 'The user stopped the turn')) {
                        this.receive(this.generation, { type: 'request.withdrawn', requestId: item.requestId });
                    }
                }
                this.options.persist();
            }
            return;
        }
        if (this.pendingStart?.turnId === turnId) {
            this.clearStartWarning();
            const backend = this.backend;
            this.backend = null;
            this.starting = null;
            backend.stop();
            this.emit([this.thread.patchInfo({ running: false })]);
            this.receive(this.generation, { type: 'turn.done', state: 'aborted', costUsd: 0 });
            return;
        }
        this.backend.interrupt();
    }

    /* Ends a command or a monitor the CLI runs in the background; the CLI's own report takes it off the list. */
    stopTask(taskId: string): void {
        const workflow = this.thread
            .list()
            .some((item) => item.kind === 'tool' && item.name === 'Workflow' && item.state === 'running' && item.workflow?.taskId === taskId);
        if (!workflow && !this.thread.info.background?.some((task) => task.id === taskId)) {
            throw new ChatError('task-not-found', 'This chat runs no such task');
        }
        if (!this.backend?.stopTask) {
            throw new ChatError('chat-unsupported', 'This CLI cannot stop a task on its own');
        }
        this.backend.stopTask(taskId);
    }

    /* Answers a pending approval; false when nothing waits under that id. */
    approve(requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        if (item?.kind !== 'approval' || item.decision !== 'pending' || this.backend?.respondApproval(requestId, decision, message) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, decision }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /* Answers a pending question; false when nothing waits under that id. */
    answer(requestId: string, answers: Record<string, string>): boolean {
        const item = this.thread.get(`question-${requestId}`);
        if (item?.kind !== 'question' || item.state !== 'pending' || this.backend?.respondQuestion(requestId, answers) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, answers, state: 'answered' }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /*
     * Leaves an asynchronous question alone. The CLI is not told: it asked beside its turn and
     * carries on either way, so the item only has to stop waiting for the person.
     */
    dismiss(itemId: string): boolean {
        const item = this.thread.get(itemId);
        if (item?.kind !== 'question' || item.state !== 'pending' || item.async !== true) {
            return false;
        }
        this.backend?.dismissRequest?.(item.requestId);
        this.emit([this.thread.upsert({ ...item, state: 'dismissed' }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /*
     * Marks the chat as waiting on a person for something the host asks beside the CLI, such as a
     * card a verb holds its call for. The chat reads `needs-you` until every key is released.
     */
    holdForPerson(key: string): void {
        if (this.thread.hold(key)) {
            this.emit([this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        }
    }

    releaseHold(key: string): void {
        if (this.thread.release(key) && this.thread.info.status === 'needs-you') {
            this.emit([this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        }
    }

    /*
     * Starts the chat over: the CLI goes, and the next send starts one without a session to resume.
     * The thread resets at once; the returned promise lets the host wait for pending attachment
     * writes before removing their files. Writing the empty thread is the caller's.
     */
    clear(force: boolean): Promise<void> {
        if (this.busy && !force) {
            throw new ChatError('chat-busy', `Chat ${this.id} is still working on the previous message`);
        }
        const ended = this.dispose();
        this.generation = nextGeneration();
        this.projector.reset();
        // The fresh CLI hears what the host tells it at launch, as it would on a first turn.
        this.options.promptNotes?.reset();
        // A cleared chat starts a new conversation, which what was waiting to be said no longer describes.
        this.pendingPreambles = [];
        this.submission = null;
        this.staleResults = 0;
        this.sendAfterStop = false;
        this.sendAfterReplacement = false;
        this.awaitingBackgroundReport = false;
        this.launchedSelection = null;
        this.turnReady = Promise.resolve();
        this.lapseResume();
        const usage = this.thread.info.usage;
        this.emit([
            this.thread.reset({
                agentSessionId: null,
                limit: undefined,
                running: false,
                status: 'idle',
                activeTurnId: null,
                queue: [],
                queuePaused: false,
                background: [],
                delegating: undefined,
                goal: undefined,
                effectiveRuntimeMode: undefined,
                permissionMode: undefined,
                slashCommands: [],
                // The next CLI starts on the current pick, so the window the one that just went reported is not its.
                usage: {
                    ...usage,
                    contextTokens: 0,
                    contextWindow: this.options.provider.catalog.contextWindowFor(this.thread.info.selection),
                    breakdown: undefined
                }
            })
        ]);
        return ended;
    }

    /*
     * A thread read from disk cannot still be streaming or waiting, so whatever was open is closed,
     * except the turn a restart takes up again. Said as events, so a client that comes back with a
     * seq from before the restart hears it as well.
     */
    settleStored(selection: ModelSelection, resume: ResumeDecision): void {
        const events: ChatEvent[] = [];
        const resumeTurnId = resume.resumeTurnId;
        const now = Date.now();
        for (const item of this.thread.list()) {
            const settled = settleStoredItem(item, resumeTurnId);
            if (settled === item) {
                continue;
            }
            if (isBackgroundWork(item)) {
                this.recordLostBackground(item);
            }
            events.push(this.thread.upsert(settled));
            if (item.kind === 'turn' && settled.kind === 'turn' && settled.state === 'aborted') {
                const reason = item.id === this.thread.info.activeTurnId && resume.reason !== null ? resume.reason : 'it was not the turn the chat was running';
                events.push(
                    this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId: item.id, level: 'warning', text: notResumedNote(reason) })
                );
            }
        }
        const info = this.thread.info;
        const patch: Partial<ChatInfo> = {
            selection,
            running: false,
            status: resumeTurnId === null ? 'idle' : 'running',
            activeTurnId: resumeTurnId,
            effectiveRuntimeMode: undefined,
            permissionMode: undefined
        };
        // No process of the host that went down is left to run what it kept in the background.
        if (info.background?.length) {
            for (const command of info.background) {
                const text = `The machine restarted while background command "${commandLabel(command)}" was running. It will not send a result. Do not wait for it.`;
                this.deliverNote({ noteId: `lost-command-${command.id}`, note: text, preamble: text });
            }
            patch.background = [];
        }
        // The window stored is whatever the session that went left behind; the next CLI starts on the pick.
        const contextWindow = this.options.provider.catalog.contextWindowFor(selection);
        if (contextWindow !== info.usage.contextWindow) {
            patch.usage = { ...info.usage, contextWindow };
        }
        if (
            JSON.stringify(selection) !== JSON.stringify(info.selection) ||
            patch.usage !== undefined ||
            info.running ||
            info.effectiveRuntimeMode !== undefined ||
            info.permissionMode !== undefined ||
            patch.background !== undefined ||
            info.status !== patch.status ||
            info.activeTurnId !== resumeTurnId
        ) {
            events.push(this.thread.patchInfo(patch));
        }
        this.emit(events);
    }

    /*
     * Takes up a turn the host went down in: a new process on the CLI's own session, the same turn
     * with the next attempt, and a prompt that says what happened. Nothing happens when the turn has
     * ended or already has that attempt, so the host may run it twice. A CLI that will not start
     * throws and leaves the turn waiting for the next try.
     */
    async resume(turnId: string, attempt: number, words: ResumeWords): Promise<void> {
        if (!this.awaitsResume(turnId, attempt)) {
            return;
        }
        const original = this.thread.get(turnId);
        if (original?.kind !== 'turn') {
            return;
        }
        const now = Date.now();
        this.emit([
            this.thread.upsert({ ...original, attempt, resumePending: true }),
            this.thread.upsert({ id: `resume-${turnId}-${attempt}`, kind: 'note', createdAt: now, turnId, level: 'info', text: words.note })
        ]);
        this.options.persist();
        const pending = this.watchStart(turnId);
        let backend: ChatBackend;
        try {
            await this.options.save?.();
            if (this.pendingStart !== pending || !this.awaitsResume(turnId, attempt)) {
                return;
            }
            backend = await this.ensureBackend();
        } catch (e) {
            if (this.pendingStart !== pending) {
                return;
            }
            this.clearStartWarning();
            if (this.backend === null) {
                this.emit([this.thread.patchInfo({ running: false })]);
            }
            this.addNote('warning', `The resume attempt could not start: ${errorText(e)}`);
            throw e;
        }
        const turn = this.thread.get(turnId);
        if (this.pendingStart !== pending || !this.awaitsResume(turnId, attempt) || this.backend !== backend || turn?.kind !== 'turn') {
            return;
        }
        this.clearStartWarning();
        // The turn keeps the checkpoint it started with, so its card still shows everything it changed.
        this.turnReady = Promise.resolve();
        const context = this.contextNote(words.prompt);
        const preamble = [words.preamble, context.preamble].filter(Boolean).join('\n\n') || null;
        if (context.note) {
            this.emit([this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: context.note })]);
        }
        const input: TurnInput = { promptId: randomUUID(), text: words.prompt, preamble, attachments: [], mentions: [], skills: [] };
        this.submission = { turnId, input };
        this.options.persist();
        await this.options.save?.();
        if (this.backend !== backend || this.info.activeTurnId !== turnId || this.frozen) {
            return;
        }
        backend.sendTurn(input);
        if (!backend.acknowledgesTurns) {
            this.acceptPrompt(input.promptId!);
        }
    }

    /* Ends a running turn nobody is working on and keeps queued messages for a person's next send. */
    abandon(turnId: string, reason: string | null): void {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn' || turn.state !== 'running' || this.thread.info.activeTurnId !== turnId || this.running) {
            return;
        }
        const now = Date.now();
        this.pauseQueue(true);
        this.emit([
            this.thread.upsert({ ...turn, state: 'aborted', endedAt: now }),
            ...(reason === null ? [] : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'warning', text: reason })]),
            this.thread.patchInfo({ status: 'idle', activeTurnId: null })
        ]);
        this.options.persist();
        this.drainQueue(this.sendAfterStop);
        this.sendAfterStop = false;
    }

    /*
     * Opens a turn nobody typed a prompt for (a settled task, a message left by another node), with the
     * turn carrying what woke it, so a turn it opens cannot itself wake anyone. A caller passes `note`
     * only when its news is not already written in the thread. Checked and opened in one step, so null
     * means a turn (or a shutdown) was in the way. Never through `send`, which would step on a turn
     * with `origin: 'agent'` and close the wake it just made.
     */
    wake(wake: { text: string; label: string; note?: string; taskIds: string[]; summaryFor?: string; messageFrom?: string[] }): string | null {
        if (this.frozen || this.relocating || this.thread.info.activeTurnId !== null || this.replacementWaits()) {
            return null;
        }
        this.turnOpened();
        const { preamble, note } = this.contextNote(wake.text);
        const turnId = newId('turn');
        const now = Date.now();
        this.emit([
            this.thread.upsert({
                id: turnId,
                kind: 'turn',
                createdAt: now,
                turnId,
                state: 'running',
                origin: 'agent',
                deliveryPending: true,
                label: wake.label,
                ...(wake.taskIds.length === 0 ? {} : { taskIds: wake.taskIds }),
                ...(wake.messageFrom === undefined || wake.messageFrom.length === 0 ? {} : { messageFrom: wake.messageFrom }),
                ...(wake.summaryFor === undefined ? {} : { summaryFor: wake.summaryFor }),
                endedAt: null,
                costUsd: 0
            }),
            ...(wake.note === undefined
                ? []
                : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: wake.note })]),
            ...(note === null ? [] : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note })]),
            this.thread.patchInfo({ status: this.thread.statusFor(turnId), activeTurnId: turnId })
        ]);
        this.options.persist();
        this.turnReady = this.checkpoint(turnId);
        this.submit(turnId, { text: wake.text, preamble, attachments: [], mentions: [], skills: [] });
        return turnId;
    }

    /* The host's switch or this chat's own changed: a limit still ahead is owed a resume now, or what was owed lapses. */
    resumeSettingChanged(): void {
        if (this.resumeAllowed()) {
            this.oweResume(false);
        } else {
            this.lapseResume();
        }
    }

    /*
     * Opens the turn that takes up the limited turn `turnId` again, carrying the tasks and messages that
     * one answered. `wait` while a settings change waits on the CLI's work, which keeps the owed entry
     * until that work ends; `lapsed` when anything stepped in since (a person wrote, the switch went off,
     * the chat stopped or was cleared), which takes the resume time off with the entry.
     */
    takeUpAfterLimit(turnId: string): 'opened' | 'wait' | 'lapsed' {
        const turn = limitedTurn(this.thread.list());
        if (turn === null || turn.id !== turnId || !this.resumeAllowed()) {
            this.lapseResume();
            return 'lapsed';
        }
        const wake = limitResumeWake(turn.limit.kind);
        const opened = this.wake({
            ...wake,
            taskIds: turn.taskIds ?? [],
            ...(turn.messageFrom === undefined ? {} : { messageFrom: turn.messageFrom })
        });
        if (opened === null) {
            return 'wait';
        }
        this.pauseQueue(false);
        return 'opened';
    }

    /* Whether a change that needs a new CLI waits now: a turn, work beside it or an open request holds the one there is. */
    get replacementWouldWait(): boolean {
        return this.backend !== null && (this.info.activeTurnId !== null || this.processInUse());
    }

    /* A limited turn a fork went on with is that fork's to take up, never this chat's. */
    private wentOn(turn: ChatTurnItem): boolean {
        return this.thread.get(continuedNoteId(turn.id)) !== undefined;
    }

    private resumeAllowed(): boolean {
        return this.options.limitResume?.allowed() === true && this.thread.info.resumeAtReset !== false;
    }

    /*
     * Owes a resume of the last turn when it stopped on a limit. Right after that turn every limit is
     * owed; a switch turned on later only owes a usage limit whose reset is still ahead, so an old
     * error is never taken up out of the blue.
     */
    private oweResume(fresh: boolean): void {
        const hooks = this.options.limitResume;
        const turn = limitedTurn(this.thread.list());
        if (!hooks || turn === null || this.thread.info.activeTurnId !== null || this.frozen || !this.resumeAllowed() || this.wentOn(turn)) {
            return;
        }
        const now = hooks.now();
        if (!fresh && (turn.limit.kind !== 'usage' || (turn.limit.resetsAt ?? 0) <= now)) {
            return;
        }
        const at = limitResumeAt(this.thread.list(), turn, now);
        if (at === null || at === this.thread.info.resumeAt) {
            return;
        }
        this.emit([this.thread.patchInfo({ resumeAt: at })]);
        this.options.persist();
        void hooks.owe(turn.id, at).catch((e: unknown) => console.error(`Owing a resume of chat ${this.id} failed:`, errorText(e)));
    }

    /*
     * A resume time the record shows while the host holds no entry for it, which a host that went
     * down between the two leaves: owed again at that time, or taken off when nothing may owe it now.
     */
    settleOwedResume(): void {
        const hooks = this.options.limitResume;
        const at = this.thread.info.resumeAt;
        if (at === undefined || hooks?.owed() === true) {
            return;
        }
        const turn = limitedTurn(this.thread.list());
        if (!hooks || turn === null || this.thread.info.activeTurnId !== null || !this.resumeAllowed()) {
            this.emit([this.thread.patchInfo({ resumeAt: undefined })]);
            this.options.persist();
            return;
        }
        void hooks.owe(turn.id, at).catch((e: unknown) => console.error(`Owing a resume of chat ${this.id} failed:`, errorText(e)));
    }

    /* Whatever the last turn stopped on is behind the chat once another turn opens. */
    private turnOpened(): void {
        if (this.thread.info.limit !== undefined) {
            this.emit([this.thread.patchInfo({ limit: undefined })]);
        }
        this.lapseResume();
    }

    /*
     * The limited turn went on elsewhere (a fork), so what the host owes for it lapses, and the note says where
     * it went. The note is also the mark that keeps a switch turned on later from owing that turn again.
     */
    continuedElsewhere(note: string): void {
        this.lapseResume();
        const turn = limitedTurn(this.thread.list());
        if (turn === null || this.wentOn(turn)) {
            return;
        }
        this.emit([this.thread.upsert({ id: continuedNoteId(turn.id), kind: 'note', createdAt: Date.now(), turnId: turn.id, level: 'info', text: note })]);
        this.options.persist();
    }

    /* Drops the resume owed after a limit, the time the thread shows for it included. */
    lapseResume(): void {
        const hooks = this.options.limitResume;
        if (this.thread.info.resumeAt === undefined || !hooks) {
            return;
        }
        this.emit([this.thread.patchInfo({ resumeAt: undefined })]);
        this.options.persist();
        void hooks.lapse().catch((e: unknown) => console.error(`Dropping the resume of chat ${this.id} failed:`, errorText(e)));
    }

    /*
     * A note a person reads and a preamble the CLI hears in front of the next real prompt, whether or
     * not a turn runs now: a fork's summary, a child that waits. Written under the id the delivery
     * names, so a delivery that runs twice leaves one of each; false when it was here already.
     */
    deliverNote(delivery: { noteId: string; note: string; from?: string; preamble: string }): boolean {
        if (this.thread.get(delivery.noteId) !== undefined) {
            return false;
        }
        this.pendingPreambles = [...this.pendingPreambles, delivery.preamble];
        this.emit([
            this.thread.upsert({
                id: delivery.noteId,
                kind: 'note',
                createdAt: Date.now(),
                turnId: null,
                level: 'info',
                text: delivery.note,
                ...(delivery.from === undefined ? {} : { from: delivery.from })
            })
        ]);
        this.options.persist();
        return true;
    }

    /* Writes items a host draws in the thread itself (a row for work it delegated), leaving the ones that did not change alone. */
    upsertItems(items: readonly ChatItem[]): void {
        const changed = items.filter((item) => JSON.stringify(this.thread.get(item.id)) !== JSON.stringify(item));
        if (changed.length === 0) {
            return;
        }
        this.emit(changed.map((item) => this.thread.upsert(item)));
        this.options.persistSoon();
    }

    /* A line in the thread outside any turn, for something the host has to say about work it gave up on. */
    addNote(level: 'info' | 'warning' | 'error', text: string): void {
        this.emit([this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: Date.now(), turnId: null, level, text })]);
        this.options.persist();
    }

    /*
     * Ends the CLI because the agent that opened this chat was stopped: whatever ran or waited is
     * closed with the reason in the thread, the queue goes, and the thread stays for a person to read
     * or to carry on in, which starts the CLI again like any send.
     */
    end(reason: string): void {
        this.clearStartWarning();
        this.clearWorkflowWarnings();
        this.sendAfterStop = false;
        this.sendAfterReplacement = false;
        this.lapseResume();
        const backend = this.backend;
        this.backend = null;
        this.starting = null;
        this.awaitingBackgroundReport = false;
        void backend?.dispose();
        const now = Date.now();
        const turnId = this.thread.info.activeTurnId;
        const events: ChatEvent[] = [];
        for (const item of this.thread.list()) {
            const settled =
                item.kind === 'turn' && item.state === 'running'
                    ? { ...item, state: 'aborted' as const, endedAt: now }
                    : item.kind === 'subagent' && item.origin !== HOST_TASK_ORIGIN && item.status === 'running'
                      ? { ...item, status: 'failed' as const, finishedAt: now }
                      : settleStoredItem(item, null);
            if (settled !== item) {
                events.push(this.thread.upsert(settled));
            }
        }
        if (turnId !== null) {
            events.push(this.thread.upsert({ id: newId(`${ENDED_NOTE_PREFIX}note`), kind: 'note', createdAt: now, turnId, level: 'warning', text: reason }));
        }
        events.push(
            this.thread.patchInfo({
                running: false,
                effectiveRuntimeMode: undefined,
                permissionMode: undefined,
                status: 'idle',
                activeTurnId: null,
                ...(this.queue.length > 0 ? { queue: [] } : {}),
                ...(this.thread.info.background?.length ? { background: [] } : {})
            })
        );
        this.emit(events);
        this.options.persist();
    }

    /*
     * Ends the CLI and keeps the conversation: the next message starts a fresh process that resumes it,
     * and with it the skills, plugins and servers the CLI reads at its start. Refused while a turn runs or
     * the process still holds work, a request or a background command, since those would end with it.
     */
    restart(): Promise<void> {
        if (this.thread.info.activeTurnId !== null || this.processInUse()) {
            throw new ChatError('chat-busy', `Chat ${this.id} is still working; stop it before restarting its agent session`);
        }
        return this.dropProcess();
    }

    /*
     * Ends the CLI and keeps the conversation, like `restart` without its refusal: the caller has
     * checked `relocatable` and holds the queue. Settles once the process exited or was sent the SIGKILL.
     */
    dropProcess(): Promise<void> {
        this.clearStartWarning();
        this.clearWorkflowWarnings();
        const backend = this.backend;
        this.backend = null;
        this.starting = null;
        this.launchedSelection = null;
        // What the init frame of the process that goes announced; a skill added since would be filtered out by it.
        this.emit([this.thread.patchInfo({ running: false, effectiveRuntimeMode: undefined, permissionMode: undefined, skills: undefined })]);
        this.options.persist();
        return backend?.dispose() ?? Promise.resolve();
    }

    /* Ends the process and stops listening to it, as the host goes down; the thread stays as it is. */
    freeze(): void {
        this.uiReplies.clear();
        this.clearStartWarning();
        this.clearWorkflowWarnings();
        this.frozen = true;
        this.backend?.stop();
    }

    /* Ends the CLI and everything it started; settles once it exited or was sent the SIGKILL. */
    dispose(): Promise<void> {
        this.uiReplies.clear();
        this.clearStartWarning();
        this.clearWorkflowWarnings();
        if (this.titleTimer !== null) {
            clearTimeout(this.titleTimer);
            this.titleTimer = null;
        }
        const ended = this.backend?.dispose() ?? Promise.resolve();
        this.backend = null;
        this.starting = null;
        return ended;
    }

    /* What a turn changed against its checkpoint: the stored answer, or one taken now while it runs. */
    async turnDiff(turnId: string): Promise<ChatCheckpointDiff | null> {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn') {
            throw new ChatError('request-not-found', `No turn ${turnId} in chat ${this.id}`);
        }
        if (turn.checkpointDiff) {
            return turn.checkpointDiff;
        }
        if (turn.checkpoint === undefined || !this.options.checkpoints) {
            return null;
        }
        return await this.options.checkpoints.diff(this.thread.info.cwd, turn.checkpoint);
    }

    /* A page of a thread the CLI keeps, through the process that runs now; null when none runs that can answer. */
    listThreadItems(params: { threadId: string; cursor?: string; limit: number; sortDirection: 'asc' | 'desc' }): Promise<unknown> | null {
        const backend = this.backend;
        return backend?.running === true && backend.listThreadItems ? backend.listThreadItems(params) : null;
    }

    /* A completed transcript survives the process; unfinished work cannot send a result after a restart. */
    async settleOrphanedSubagents(): Promise<void> {
        const rows = this.runningBackgroundRows();
        if (this.info.provider === 'claude') {
            for (const row of rows) {
                this.orphans.add(row.toolUseId);
            }
            await this.settleFromTranscripts(rows);
        }
        const lost = this.runningBackgroundRows();
        for (const row of lost) {
            this.recordLostBackground(row);
        }
        this.settleRows(lost.map((row) => ({ ...row, status: 'failed', finishedAt: Date.now() })));
    }

    private recordLostBackground(item: BackgroundWork): void {
        const label = item.kind === 'subagent' ? item.description || item.subagentType || item.toolUseId : item.name;
        const text = `The machine restarted before background work "${label}" completed. It will not send a result. Do not wait for it.`;
        this.deliverNote({ noteId: `lost-background-${item.id}`, note: text, preamble: text });
    }

    /*
     * Stops one subagent of the CLI's own. The process that announced it ends it with `stop_task` and the
     * parent goes on; a process that did not start it has nothing to address, so while a turn runs that
     * is refused, and otherwise the row is only marked.
     */
    stopSubagent(toolUseId: string): 'stopping' | 'marked' {
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        const agentId = row?.native?.agentId;
        const owned = this.subagentOwners.get(toolUseId) === this.generation;
        if (agentId !== undefined && owned && this.backend?.stopTask) {
            this.stopping.set(agentId, toolUseId);
            this.backend.stopTask(agentId);
            return 'stopping';
        }
        if (agentId !== undefined && !owned && this.thread.info.activeTurnId !== null) {
            throw new ChatError('subagent-stale', 'This sub-agent belongs to a process that has ended');
        }
        this.markSubagentStopped(toolUseId);
        return 'marked';
    }

    private trackSubagentOwner(generation: number, event: BackendEvent): void {
        if (event.type === 'task.started' && event.taskId) {
            this.subagentOwners.set(event.ref, generation);
        } else if (event.type === 'task.done') {
            this.noteStopped(event);
            if (event.ref !== null) {
                this.subagentOwners.delete(event.ref);
            }
        } else if (event.type === 'exit') {
            this.stopping.clear();
        }
    }

    /* The CLI would not stop it: with no turn running the row is only marked, and while one runs a note says it still goes on. */
    private refuseStop(agentId: string, message: string): void {
        const toolUseId = this.stopping.get(agentId);
        if (toolUseId === undefined) {
            return;
        }
        this.stopping.delete(agentId);
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (row?.status !== 'running') {
            return;
        }
        if (this.thread.info.activeTurnId === null) {
            this.markSubagentStopped(toolUseId);
            return;
        }
        this.emit([
            this.thread.upsert({
                id: `stop-refused-${toolUseId}-${Date.now()}`,
                kind: 'note',
                createdAt: Date.now(),
                turnId: null,
                level: 'warning',
                text: `"${row.description || row.subagentType || 'Sub-agent'}" could not be stopped: ${message}`
            })
        ]);
        this.options.persist();
    }

    /* The line under a subagent that `stop_task` ended, once the CLI reported it settled. */
    private noteStopped(event: Extract<BackendEvent, { type: 'task.done' }>): void {
        const stopped = [...this.stopping].find(([agentId, toolUseId]) => agentId === event.taskId || toolUseId === event.ref);
        if (stopped === undefined) {
            return;
        }
        this.stopping.delete(stopped[0]);
        // It finished on its own just before the stop arrived; the row already says so.
        if (event.ok) {
            return;
        }
        const row = this.thread.find('subagent', (item) => item.toolUseId === stopped[1]);
        if (!row) {
            return;
        }
        const now = Date.now();
        this.emit([
            ...(row.status === 'running' ? [this.thread.upsert({ ...row, status: 'failed' as const, finishedAt: now })] : []),
            this.thread.upsert({
                id: `stopped-${row.toolUseId}`,
                kind: 'note',
                createdAt: now,
                turnId: null,
                level: 'info',
                text: `"${row.description || row.subagentType || 'Sub-agent'}" was stopped.`
            })
        ]);
        this.options.persist();
    }

    /*
     * Marks a subagent of the CLI's own as stopped: `failed` with a note that says what it means, since
     * no CLI stops one subagent on its own. Refused while a turn runs, which may still be waiting on it.
     */
    markSubagentStopped(toolUseId: string): void {
        if (this.thread.info.activeTurnId !== null) {
            throw new ChatError('chat-busy', 'A turn is running; stop the turn instead');
        }
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (row?.status !== 'running') {
            return;
        }
        this.markStopped([row]);
    }

    /* Marks every running subagent of the CLI's own as stopped, for a person stopping the turn together with them. */
    markSubagentsStopped(): void {
        this.markStopped(
            this.thread
                .list()
                .filter((item): item is ChatSubagentItem => item.kind === 'subagent' && item.status === 'running' && item.origin !== HOST_TASK_ORIGIN)
        );
    }

    private markStopped(rows: readonly ChatSubagentItem[]): void {
        if (rows.length === 0) {
            return;
        }
        const now = Date.now();
        for (const row of rows) {
            this.orphans.delete(row.toolUseId);
        }
        const names = rows.map((row) => `"${row.description || row.subagentType || 'Sub-agent'}"`).join(', ');
        this.emit([
            ...rows.map((row) => this.thread.upsert({ ...row, status: 'failed', finishedAt: now })),
            this.thread.upsert({
                id: newId('note'),
                kind: 'note',
                createdAt: now,
                turnId: null,
                level: 'info',
                text: `${names} ${rows.length === 1 ? 'was' : 'were'} marked as stopped. ${this.options.provider.name} cannot stop one sub-agent on its own, so ${rows.length === 1 ? 'it' : 'they'} may keep working until the chat's process ends.`
            })
        ]);
        this.options.persist();
    }

    /* Asks the transcript again for a row a load left running, when somebody looks at it. */
    async recheckOrphan(toolUseId: string): Promise<void> {
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (this.orphans.has(toolUseId) && (row?.status === 'running' || row?.status === 'failed')) {
            await this.settleFromTranscripts([row]);
        }
    }

    /* Writes down where a subagent's conversation was found, so the next question about it reads no folder. */
    noteSubagentNative(toolUseId: string, native: { agentId?: string; threadId?: string }): void {
        const item = this.thread.find('subagent', (candidate) => candidate.toolUseId === toolUseId);
        if (!item || (item.native?.agentId === native.agentId && item.native?.threadId === native.threadId)) {
            return;
        }
        this.emit([this.thread.upsert({ ...item, native: { ...item.native, ...native } })]);
        this.options.persistSoon();
    }

    /*
     * What this chat's CLI would run as a skill. A running backend that answers the question itself
     * (Codex) is the authority; otherwise the host's own scan is, narrowed to what the CLI's init
     * frame said it has, so a skill turned off in its settings drops out after the first message.
     */
    async skills(scan: () => Promise<ChatSkill[]>): Promise<ChatSkill[]> {
        const backend = this.backend;
        if (backend?.running === true && backend.listSkills) {
            try {
                const own = await backend.listSkills();
                if (own.length > 0) {
                    return own;
                }
            } catch {
                // The CLI could not answer; the scan below is what is left.
            }
        }
        const scanned = await scan();
        const announced = this.thread.info.skills;
        if (!announced?.length) {
            return scanned;
        }
        const known = new Set(announced);
        return scanned.filter((skill) => known.has(skill.name));
    }

    private openTurn(text: string | null, note: string | null, extras: ChatSendExtras, requestedTurnId?: string): string {
        this.turnOpened();
        const turnId = requestedTurnId ?? newId('turn');
        const now = Date.now();
        const events = [this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', origin: 'user', endedAt: null, costUsd: 0 })];
        if (note !== null) {
            events.push(this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note }));
        }
        if (text !== null) {
            const mentions = extras.mentions?.length ? extras.mentions : undefined;
            const skills = extras.skills?.length ? extras.skills : undefined;
            const chats = extras.chats?.length ? extras.chats : undefined;
            const attachments = extras.attachments?.length ? extras.attachments : undefined;
            events.push(
                this.thread.upsert({
                    id: newId('user'),
                    kind: 'user',
                    createdAt: now,
                    turnId,
                    text,
                    mentions,
                    skills,
                    chats,
                    attachments,
                    ...(extras.uiChoice ? { uiChoice: extras.uiChoice } : {}),
                    ...(extras.quoteSource ? { quoteSource: extras.quoteSource } : {})
                })
            );
        }
        events.push(this.thread.patchInfo({ status: this.thread.statusFor(turnId), activeTurnId: turnId }));
        this.emit(events);
        if (extras.uiChoice) {
            this.recordUiAnswer({ ...extras.uiChoice, turnId, queued: false });
        }
        // On disk before the CLI answers, so a host that goes down mid-turn still shows the question.
        this.options.persist();
        return turnId;
    }

    /*
     * A turn the CLI opened itself is closed the moment the person types: they are steering now, and
     * a `result` still coming for that turn must not settle the one they just started.
     */
    private settleAgentTurn(): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (turn?.kind !== 'turn' || turn.origin !== 'agent') {
            return;
        }
        if (this.spokenTurnId === turn.id) {
            this.staleResults += 1;
        }
        this.emit([this.thread.upsert({ ...turn, state: 'done', endedAt: Date.now() }), this.thread.patchInfo({ status: 'idle', activeTurnId: null })]);
        this.settleCheckpoint(turn.id);
    }

    /* Records the folder's tree on the turn; a folder without git leaves the turn as it is. */
    private checkpoint(turnId: string): Promise<void> {
        const checkpoints = this.options.checkpoints;
        if (!checkpoints) {
            return Promise.resolve();
        }
        const cwd = this.thread.info.cwd;
        return Promise.all([checkpoints.take(cwd), checkpoints.head?.(cwd) ?? null])
            .then(([tree, head]) => {
                const turn = this.thread.get(turnId);
                if (tree === null || turn?.kind !== 'turn' || turn.state !== 'running' || this.info.activeTurnId !== turnId) {
                    return;
                }
                this.emit([this.thread.upsert({ ...turn, checkpoint: tree, ...(head === null ? {} : { checkpointHead: head }) })]);
            })
            .catch(() => undefined);
    }

    /* The diff of a turn that just ended, so a reload shows it without asking git again, and the tree a fork after it starts from. */
    private settleCheckpoint(turnId: string): void {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn' || turn.checkpoint === undefined || turn.checkpointDiff || !this.options.checkpoints) {
            return;
        }
        const { checkpoints } = this.options;
        const cwd = this.thread.info.cwd;
        void Promise.all([checkpoints.settle(cwd, turn.checkpoint), checkpoints.head?.(cwd) ?? null])
            .then(([answer, head]) => {
                const settled = this.thread.get(turnId);
                if (answer === null || settled?.kind !== 'turn') {
                    return;
                }
                this.emit([
                    this.thread.upsert({
                        ...settled,
                        checkpointDiff: answer.diff,
                        checkpointAfter: answer.after,
                        ...(head === null ? {} : { checkpointHeadAfter: head })
                    })
                ]);
                this.options.persist();
            })
            .catch(() => undefined);
    }

    /*
     * What the agent has to hear before this prompt: what the chat kept for it and what the host says.
     * Each is said once, and only in front of a real prompt. The thread gets only what the host shows.
     */
    private contextNote(text: string): { preamble: string | null; note: string | null } {
        // A slash command must stay the first thing the CLI reads; the rest waits for a real prompt.
        if (text.startsWith('/')) {
            return { preamble: null, note: null };
        }
        const host = this.options.promptNotes?.next() ?? { shown: [], heard: [] };
        // Keep consumed notes in the submission until the CLI acknowledges them.
        const preambles = this.preambles;
        this.pendingPreambles = [];
        this.submission = null;
        const read = [...preambles, ...host.shown];
        const joined = (parts: string[]): string | null => (parts.length === 0 ? null : parts.join('\n\n'));
        return { preamble: joined([...read, ...host.heard]), note: joined(read) };
    }

    private submit(turnId: string, input: TurnInput): void {
        this.pendingPreambles = this.preambles;
        this.submission = { turnId, input: { ...input, promptId: randomUUID() } };
        const submission = this.submission;
        this.options.persist();
        this.run((backend) => {
            backend.sendTurn(submission.input);
            if (!backend.acknowledgesTurns) {
                this.acceptPrompt(submission.input.promptId!);
            }
        });
    }

    private acceptPrompt(promptId: string): void {
        const submission = this.submission;
        if (submission?.input.promptId !== promptId) {
            return;
        }
        this.submission = null;
        const turn = this.thread.get(submission.turnId);
        if (turn?.kind === 'turn' && (turn.deliveryPending || turn.resumePending)) {
            this.emit([this.thread.upsert({ ...turn, deliveryPending: undefined, resumePending: undefined })]);
        }
        this.options.persist();
    }

    /* Runs one turn against the backend; a backend that will not start ends the turn with the reason. */
    private run(work: (backend: ChatBackend) => void): void {
        const turnId = this.info.activeTurnId;
        if (turnId === null) {
            return;
        }
        const pending = this.watchStart(turnId);
        const backend = this.ensureBackend();
        const generation = this.generation;
        void Promise.all([backend, this.turnReady, this.options.save?.()])
            .then(([started]) => {
                if (this.pendingStart !== pending || this.backend !== started || this.info.activeTurnId !== turnId || this.frozen) {
                    return;
                }
                this.clearStartWarning();
                work(started);
            })
            .catch((error: unknown) => {
                if (this.pendingStart === pending || (this.backend !== null && this.generation === generation && this.info.activeTurnId === turnId)) {
                    this.clearStartWarning();
                    if (error instanceof ChatError && error.code === 'chat-busy') {
                        this.pendingPreambles = this.preambles;
                        this.submission = null;
                        this.pauseQueue(true);
                        this.emit(this.projector.project(generation, { type: 'turn.done', state: 'error', costUsd: 0, error: error.message }));
                        this.settleCheckpoint(turnId);
                        this.options.persist();
                        return;
                    }
                    this.receive(generation, { type: 'failed', message: errorText(error), processAlive: this.running });
                }
            });
    }

    private watchStart(turnId: string): { turnId: string; warning: unknown } {
        this.clearStartWarning();
        const clock = this.options.clock ?? systemClock;
        const pending = {
            turnId,
            warning: clock.setTimeout(() => {
                if (this.pendingStart?.turnId === turnId && this.info.activeTurnId === turnId && !this.frozen) {
                    this.emit([
                        this.thread.upsert({
                            id: newId('note'),
                            kind: 'note',
                            createdAt: clock.now(),
                            turnId,
                            level: 'warning',
                            text: 'The agent is still starting. You can stop this turn and try again.'
                        })
                    ]);
                    this.options.persist();
                }
            }, 30_000)
        };
        this.pendingStart = pending;
        return pending;
    }

    private clearStartWarning(): void {
        if (this.pendingStart === null) {
            return;
        }
        (this.options.clock ?? systemClock).clearTimeout(this.pendingStart.warning);
        this.pendingStart = null;
    }

    private requiresReplacement(): boolean {
        return (
            this.backend !== null &&
            (JSON.stringify(this.info.selection) !== JSON.stringify(this.launchedSelection) ||
                this.info.runtimeMode !== this.launchedRuntimeMode ||
                this.info.account !== this.launchedAccount ||
                this.info.cwd !== this.launchedCwd ||
                !sameFolders(this.options.folders?.() ?? [], this.launchedFolders) ||
                this.loadsProjectConfig() !== this.launchedProjectConfig)
        );
    }

    private loadsProjectConfig(): boolean {
        return this.options.projectConfig?.() !== false;
    }

    private hasNativeWork(): boolean {
        return runningInBackground(this.thread.list()).length > 0 || (this.info.background?.length ?? 0) > 0;
    }

    private processInUse(): boolean {
        return this.hasNativeWork() || this.thread.pending().length > 0 || this.awaitingBackgroundReport || this.goalWorks();
    }

    private replacementWaits(): boolean {
        return this.requiresReplacement() && (this.info.activeTurnId !== null || this.processInUse());
    }

    private ensureBackend(): Promise<ChatBackend> {
        if (this.backend && this.requiresReplacement()) {
            if (this.processInUse()) {
                return Promise.reject(new ChatError('chat-busy', 'The current work and open requests must finish before the changes to this chat can apply'));
            }
            // Let the old one go quietly; its events are dropped and its exit must not end the chat.
            this.backend.stop();
            this.backend = null;
            this.starting = null;
        }
        if (this.backend && this.starting) {
            return this.starting;
        }
        const projectConfig = this.loadsProjectConfig();
        if (!projectConfig && !this.options.provider.ignoresProjectConfig) {
            return Promise.reject(
                new ChatError('project-config-unsupported', `${this.options.provider.name} cannot run without the configuration of its folder`)
            );
        }
        let env: Record<string, string>;
        try {
            env = this.options.env(this.thread.info.account);
            this.launchedAccount = this.thread.info.account;
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.generation = nextGeneration();
        const generation = this.generation;
        const info = this.thread.info;
        this.launchedSelection = info.selection;
        this.launchedRuntimeMode = info.runtimeMode;
        this.launchedCwd = info.cwd;
        const folders = this.options.folders?.() ?? [];
        this.launchedFolders = folders;
        this.launchedProjectConfig = projectConfig;
        const launch: BackendLaunch = {
            command: this.options.command,
            cwd: info.cwd,
            env,
            selection: info.selection,
            modelName: this.options.provider.catalog.nameOf(info.selection.model),
            runtimeMode: info.runtimeMode,
            resume: info.agentSessionId,
            generation,
            saveGeneratedImage: this.options.saveGeneratedImage,
            instructions: this.options.instructions?.() ?? null,
            resumeNote: this.options.resumeNote?.() ?? null,
            ...(info.goal === undefined ? {} : { goal: info.goal }),
            ...(folders.length > 0 ? { folders } : {}),
            ...(projectConfig ? {} : { projectConfig }),
            ...(this.options.spawn ? { spawn: this.options.spawn } : {})
        };
        const made: { backend: ChatBackend | null } = { backend: null };
        try {
            made.backend = this.options.provider.createBackend(launch, {
                onEvent: (event) => {
                    if (made.backend === this.backend) {
                        this.receive(generation, event);
                    }
                }
            });
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        const backend = made.backend;
        this.backend = backend;
        this.emit([this.thread.patchInfo({ running: true, effectiveRuntimeMode: undefined, permissionMode: undefined })]);
        let started: Promise<void>;
        try {
            started = backend.start();
        } catch (error) {
            // A spawn that throws on the spot (no such executable) is a start that failed like any other.
            started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.starting = started
            .then(() => backend)
            .catch((error: unknown) => {
                // A CLI that will not start leaves nothing to talk to; the next send tries again.
                if (this.backend === backend) {
                    this.backend = null;
                    this.starting = null;
                }
                throw error;
            });
        return this.starting;
    }

    private awaitsResume(turnId: string, attempt: number): boolean {
        const turn = this.thread.get(turnId);
        return (
            !this.frozen &&
            turn?.kind === 'turn' &&
            turn.state === 'running' &&
            this.thread.info.activeTurnId === turnId &&
            ((turn.attempt ?? 1) < attempt || (turn.attempt === attempt && turn.resumePending === true))
        );
    }

    private receive(generation: number, event: BackendEvent): void {
        if (this.frozen) {
            return;
        }
        if (event.type === 'turn.accepted') {
            this.acceptPrompt(event.promptId);
            return;
        }
        if (event.type === 'limits') {
            this.options.onLimits?.(this.launchedAccount === undefined ? event.update : { ...event.update, account: this.launchedAccount });
            return;
        }
        if (event.type === 'title') {
            this.applyTitle(event.title);
            return;
        }
        if (event.type === 'stop.refused') {
            this.refuseStop(event.taskId, event.message);
            return;
        }
        /*
         * A CLI reports the window it was started on. A pick made since waits for the restart the next
         * send does, so its report may not put the old size back under a meter that already reads the new one.
         */
        if (event.type === 'usage' && event.contextWindow !== undefined && !this.reportsCurrentWindow()) {
            if (event.contextTokens === undefined) {
                return;
            }
            this.emit(this.projector.project(generation, { type: 'usage', contextTokens: event.contextTokens }));
            return;
        }
        if (event.type === 'exit') {
            this.backend = null;
            this.starting = null;
            this.awaitingBackgroundReport = false;
        }
        // A turn we settled ourselves still has its own `result` coming; it may not close the turn after it.
        if (event.type === 'turn.done' && event.promptId === undefined && this.staleResults > 0) {
            this.staleResults -= 1;
            return;
        }
        if (event.type === 'exit' || event.type === 'failed') {
            this.staleResults = 0;
        }
        if (event.type === 'turn.done') {
            if (event.promptId !== undefined && this.submission !== null && this.submission.input.promptId !== event.promptId) {
                return;
            }
            if (event.promptId !== undefined) {
                this.staleResults = 0;
            }
            const promptId = event.promptId ?? this.submission?.input.promptId;
            if (promptId !== undefined) {
                this.acceptPrompt(promptId);
            }
        }
        const openTurnId = this.thread.info.activeTurnId;
        if ((event.type === 'turn.done' && event.state !== 'done') || ((event.type === 'failed' || event.type === 'exit') && openTurnId !== null)) {
            this.pauseQueue(true);
        }
        // Settled as failed by the exit below; the transcript may still show that they finished first.
        const orphaned = event.type === 'exit' && this.info.provider === 'claude' ? this.runningBackgroundRows() : [];
        if (event.type === 'turn.done' && event.state === 'aborted') {
            // A request of work beside the turn outlives the interrupt; turned down, that work goes on instead of waiting forever.
            for (const item of this.thread.pending()) {
                this.backend?.declineRequest?.(item.requestId, 'The user stopped the turn');
            }
        }
        const hadNativeWork = (event.type === 'task.done' || event.type === 'tool.done' || event.type === 'background.ended') && this.hasNativeWork();
        const projected = this.projector.project(generation, event);
        if (event.type === 'turn.done' || (event.type === 'failed' && event.processAlive !== true)) {
            this.awaitingBackgroundReport = false;
        } else if (event.type !== 'exit' && event.type !== 'failed' && hadNativeWork && !this.hasNativeWork() && reportsOnBackgroundWork(this.info.provider)) {
            this.awaitingBackgroundReport = true;
        }
        this.emit(projected);
        this.trackSubagentOwner(generation, event);
        this.watchWorkflows(generation, event);
        if (isMainAgentOutput(event)) {
            this.spokenTurnId = this.thread.info.activeTurnId;
        }
        if (orphaned.length > 0) {
            void this.settleFromTranscripts(orphaned.flatMap((row) => this.thread.get(row.id) ?? []).filter((item) => item.kind === 'subagent'));
        }
        const activeTurnId = this.thread.info.activeTurnId;
        if (openTurnId === null && activeTurnId !== null) {
            // The CLI opened this turn itself; it takes a checkpoint like any other, so the card can
            // show what the agent changed while nobody was watching.
            this.turnOpened();
            void this.checkpoint(activeTurnId);
            this.options.persist();
        }
        if (event.type === 'turn.done' || event.type === 'exit' || event.type === 'failed') {
            this.options.persist();
        }
        if (event.type === 'permissions' || event.type === 'session') {
            this.options.persist();
        }
        if (openTurnId !== null && activeTurnId === null) {
            this.settleCheckpoint(openTurnId);
        }
        if (event.type === 'session' && typeof event.title === 'string') {
            this.applyTitle(event.title);
        }
        if (event.type === 'session' && this.thread.info.agentSessionId !== null) {
            this.refreshTitle();
            if (this.titleTimer === null && this.thread.info.suggestedTitle === undefined) {
                this.titleTimer = setTimeout(() => {
                    this.titleTimer = null;
                    this.refreshTitle();
                }, TITLE_RECHECK_MS);
            }
        }
        // The turn is over and the CLI is still there, so whatever waited behind it can go out now.
        if (event.type === 'turn.done') {
            this.refreshTitle();
            if (event.state === 'done') {
                this.nameThread();
            }
            if (event.limit !== undefined) {
                this.oweResume(true);
            }
            this.drainQueue(event.state === 'aborted' && this.sendAfterStop);
            this.sendAfterStop = false;
        } else if (
            event.type === 'request.withdrawn' ||
            (!reportsOnBackgroundWork(this.info.provider) && (event.type === 'task.done' || event.type === 'tool.done' || event.type === 'background.ended'))
        ) {
            this.drainQueue();
        }
    }

    private pauseQueue(paused: boolean): void {
        if ((this.info.queuePaused ?? false) !== paused) {
            this.emit([this.thread.patchInfo({ queuePaused: paused })]);
            this.options.persist();
        }
    }

    private clearWorkflowWarnings(): void {
        const clock = this.options.clock ?? systemClock;
        for (const timer of this.workflowWarnings.values()) {
            clock.clearTimeout(timer);
        }
        this.workflowWarnings.clear();
    }

    private watchWorkflows(generation: number, event: BackendEvent): void {
        if (event.type === 'tool.output' || event.type === 'tool.progress') {
            // These come by the thousand, and only the call they name can be a workflow they move.
            const item = this.projector.itemOf(generation, event.ref);
            if (item?.kind === 'tool' && item.name === 'Workflow') {
                this.watchWorkflow(item, true);
            }
            return;
        }
        if (!['tool.started', 'tool.done', 'workflow.progress', 'task.started', 'task.done', 'exit', 'failed'].includes(event.type)) {
            return;
        }
        const ref = 'ref' in event ? event.ref : null;
        for (const item of this.thread.list()) {
            if (item.kind === 'tool' && item.name === 'Workflow') {
                this.watchWorkflow(item, ref === item.toolUseId && ['workflow.progress', 'tool.started', 'tool.done', 'task.started'].includes(event.type));
            }
        }
    }

    private watchWorkflow(item: ChatToolItem, progress: boolean): void {
        const clock = this.options.clock ?? systemClock;
        const existing = this.workflowWarnings.get(item.id);
        if (item.state !== 'running' || progress) {
            if (existing !== undefined) {
                clock.clearTimeout(existing);
                this.workflowWarnings.delete(item.id);
            }
        }
        if (item.state !== 'running' || (!progress && existing !== undefined) || (!progress && item.workflow?.stalledAt !== undefined)) {
            return;
        }
        if (progress) {
            this.emit([
                this.thread.upsert({
                    ...item,
                    workflow: { name: null, phases: [], agents: [], ...item.workflow, lastProgressAt: clock.now(), stalledAt: undefined }
                })
            ]);
        }
        this.workflowWarnings.set(
            item.id,
            clock.setTimeout(() => {
                this.workflowWarnings.delete(item.id);
                const current = this.thread.get(item.id);
                if (this.frozen || current?.kind !== 'tool' || current.state !== 'running') {
                    return;
                }
                this.emit([this.thread.upsert({ ...current, workflow: { name: null, phases: [], agents: [], ...current.workflow, stalledAt: clock.now() } })]);
                this.options.persist();
            }, 5 * 60_000)
        );
    }

    /* Whether the CLI that reports was started on a pick standing for the same window as the chat's own. */
    private reportsCurrentWindow(): boolean {
        const catalog = this.options.provider.catalog;
        return this.launchedSelection === null || catalog.contextWindowFor(this.launchedSelection) === catalog.contextWindowFor(this.thread.info.selection);
    }

    /* Rides on the info patch: a client that has the chat open hears it, and a reload finds it stored. */
    private refreshTitle(): void {
        const agentSessionId = this.thread.info.agentSessionId;
        if (!this.options.readTitle || agentSessionId === null) {
            return;
        }
        void this.options
            .readTitle(agentSessionId)
            .then((title) => {
                // A clear in between started another session, whose name this is not.
                if (title === null || title === this.thread.info.suggestedTitle || this.thread.info.agentSessionId !== agentSessionId) {
                    return;
                }
                this.emit([this.thread.patchInfo({ suggestedTitle: title })]);
                this.options.persistSoon();
            })
            .catch(() => undefined);
    }

    private applyTitle(title: string): void {
        if (title === this.thread.info.suggestedTitle) {
            return;
        }
        this.emit([this.thread.patchInfo({ suggestedTitle: title })]);
        this.options.persistSoon();
    }

    /*
     * Names a chat whose CLI names nothing, after its first turn that went well: the prompt alone is
     * often too little to name, and the start of the answer says what the conversation became. Once,
     * and not for a thread that already has a name, as a resumed one may.
     */
    private nameThread(): void {
        const name = this.options.nameThread;
        if (!name || this.naming || this.thread.info.suggestedTitle !== undefined) {
            return;
        }
        const items = this.thread.list();
        const done = items.filter((item) => item.kind === 'turn' && item.state === 'done');
        const prompt = items.find((item) => item.kind === 'user');
        if (done.length !== 1 || prompt?.kind !== 'user' || prompt.text.trim() === '') {
            return;
        }
        this.naming = true;
        const turnId = done[0]!.id;
        const answer = items
            .map((item) => (item.kind === 'assistant' && item.turnId === turnId ? readableAssistantText(item) : ''))
            .filter((text) => text !== '')
            .join('\n\n');
        const agentSessionId = this.thread.info.agentSessionId;
        void name({ cwd: this.thread.info.cwd, prompt: prompt.text, answer })
            .then((title) => {
                // A clear in between started another conversation, and a name that came meanwhile is the CLI's own.
                if (title === null || this.thread.info.agentSessionId !== agentSessionId || this.thread.info.suggestedTitle !== undefined) {
                    return;
                }
                this.applyTitle(title);
                this.backend?.setTitle?.(title);
            })
            .catch(() => undefined);
    }

    private runningBackgroundRows(): ChatSubagentItem[] {
        return runningInBackground(this.thread.list()).filter((item) => item.kind === 'subagent');
    }

    /* Done for every row whose transcript shows the end, unless something else settled the row while it was read. */
    private async settleFromTranscripts(rows: ChatSubagentItem[]): Promise<void> {
        const lookup = this.options.subagentSettlement;
        if (!lookup || rows.length === 0) {
            return;
        }
        const settled: ChatSubagentItem[] = [];
        for (const row of rows) {
            const settlement = await lookup(row.toolUseId);
            const current = this.thread.get(row.id);
            if (settlement === null || current?.kind !== 'subagent' || current.status !== row.status || current.finishedAt !== row.finishedAt) {
                continue;
            }
            this.orphans.delete(row.toolUseId);
            settled.push({
                ...current,
                status: 'done',
                finishedAt: settlement.finishedAt ?? current.finishedAt ?? Date.now(),
                result: settlement.report ?? current.result
            });
        }
        this.settleRows(settled);
    }

    private settleRows(rows: ChatSubagentItem[]): void {
        if (this.frozen || rows.length === 0) {
            return;
        }
        this.emit(rows.map((row) => this.thread.upsert(row)));
        this.options.persist();
    }

    private emit(events: ChatEvent[]): void {
        const delegating = this.delegatingChange(events);
        for (const event of delegating === null ? events : [...events, delegating]) {
            this.uiReplies.pass(event);
        }
    }

    /* Said on the info as well as by the rows, since a client with the thread closed sees only the info. */
    private delegatingChange(events: ChatEvent[]): ChatEvent | null {
        if (!events.some((event) => event.type === 'item' && isBackgroundWork(event.item))) {
            return null;
        }
        const delegating = runningInBackground(this.thread.list()).length > 0;
        if (delegating === (this.thread.info.delegating ?? false)) {
            return null;
        }
        return this.thread.patchInfo({ delegating: delegating || undefined });
    }
}

/* The turn a restart takes up again, or else why the turn the host went down in ends (null when none was running). */
export interface ResumeDecision {
    resumeTurnId: string | null;
    reason: string | null;
}

// Whatever was open when the host went down: nobody is going to answer it now.
function settleStoredItem(item: ChatItem, resumeTurnId: string | null): ChatItem {
    if (item.kind === 'assistant' && item.streaming) {
        return { ...item, streaming: false };
    }
    if (item.kind === 'approval' && item.decision === 'pending') {
        return { ...item, decision: 'cancelled' };
    }
    if (item.kind === 'question' && item.state === 'pending') {
        return { ...item, state: 'cancelled' };
    }
    if (item.kind === 'tool' && item.state === 'running') {
        return { ...item, state: 'error' };
    }
    // Aborted rather than error: the turn did not fail, the machine went down under it.
    if (item.kind === 'turn' && item.state === 'running' && item.id !== resumeTurnId) {
        return { ...item, state: 'aborted', endedAt: item.endedAt ?? item.createdAt };
    }
    return item;
}
