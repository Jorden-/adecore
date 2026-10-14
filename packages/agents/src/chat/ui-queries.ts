import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
    ChatUiLinkPayload,
    ChatUiLinkReading,
    ChatUiPlaceReading,
    ChatUiQueryState,
    ChatAssistantItem,
    ChatInfo,
    ChatUiChoicePayload,
    ChatUiQueryPayload,
    ChatUiQueryReading
} from '@adecore/agent-contracts';
import { ChatUiPlaceReadingSchema } from '@adecore/agent-contracts';
import { copyUiValue, UI_HOST_LIMITS, UiBudget, uiMayReferenceHost, type UiValue } from '@adecore/intelligent-ui';
import { uiPlaceQueries, type UiPlaceQuery } from '@adecore/intelligent-ui/places';
import { UiLinkResolutionSchema, uiLinkTargets, type UiLinkTarget } from '@adecore/intelligent-ui/links';
import { uiQueryArguments, uiQueryFallback } from '@adecore/intelligent-ui/query';
import type { UiBlock } from '@adecore/intelligent-ui/compiler';
import type { ChatSession } from './chat-session.ts';
import { ChatError } from './errors.ts';

export interface ChatUiSource {
    args: z.ZodType;
    result: z.ZodType;
    authorize(info: ChatInfo, access: unknown, args: Record<string, UiValue>): Promise<void>;
    read(info: ChatInfo, args: Record<string, UiValue>, signal: AbortSignal, access: unknown): Promise<unknown>;
}

export interface ChatUiHost {
    capture(info: ChatInfo): Promise<unknown>;
    sources: Readonly<Record<string, ChatUiSource>>;
    link?(info: ChatInfo, access: unknown, target: UiLinkTarget): Promise<ChatUiLinkReading>;
    /*
     * Looks up the point of a Place that names an address, once, when its reply settles; the reading is
     * frozen beside the block for every client. `signal` aborts after five seconds. A host without it
     * freezes nothing, and such a place reads as not found.
     */
    place?(info: ChatInfo, query: UiPlaceQuery, signal: AbortSignal): Promise<Omit<ChatUiPlaceReading, 'address'>>;
}

interface CachedReading {
    key: string;
    // The key without the arguments: one query of one block, whatever it was read with.
    identity: string;
    chatId: string;
    reading: ChatUiQueryReading;
}

/*
 * A failure a client can say in its own words: `reason` is a code that stays the same across versions,
 * the message is the fallback for a client that does not know the code.
 */
class UiQueryError extends ChatError<string> {
    readonly reason: string;

    constructor(code: string, reason: string, message: string) {
        super(code, message);
        this.reason = reason;
    }
}

/*
 * What a host's `authorize`, `read` or `link` throws to say why with a code: `code` reaches the reading's
 * `code` and should stay the same across versions, `reason` is the plain sentence a client shows without it.
 */
export class ChatUiRefusal extends UiQueryError {
    constructor(code: string, reason: string) {
        super('refused-query', code, reason);
    }
}

const MAX_QUERY_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const READ_TIMEOUT_MS = 8_000;
const PLACE_TIMEOUT_MS = 5_000;
// Lookups run a few at a time, share one budget per block, and stop trying once the host keeps timing out.
const PLACE_PARALLEL = 4;
const PLACE_BLOCK_BUDGET_MS = 15_000;
const PLACE_TIMEOUTS_IN_A_ROW = 3;
// A changed input reads at once, but a query never reads more often than this across its inputs.
const INPUT_READ_MS = 250;

export class ChatUiQueries {
    readonly schemas: Record<string, z.ZodType>;
    private readonly captures = new Map<string, Promise<unknown>>();
    private readonly freezing = new Map<string, Promise<void>>();
    // Ends with the chat, so a lookup that is under way stops when its chat does.
    private readonly lives = new Map<string, AbortController>();
    private readonly cache = new Map<string, CachedReading>();
    // The read id of the newest reading per cache key, which a remount or a second client is answered with.
    private readonly latest = new Map<string, string>();
    // The read id of the newest reading per query identity, whose options are the ones a person picks from.
    private readonly newest = new Map<string, string>();
    private readonly reading = new Map<string, Promise<ChatUiQueryReading>>();
    private readonly attempts = new Map<string, number>();
    private readonly active = new Map<string, number>();
    private totalActive = 0;

    private readonly host: ChatUiHost;

    constructor(host: ChatUiHost) {
        this.host = host;
        this.schemas = Object.fromEntries(Object.entries(host.sources).map(([name, source]) => [name, source.args]));
    }

    observe(session: ChatSession, item: ChatAssistantItem, final: boolean): void {
        const key = `${session.id}:${item.id}`;
        // Once a capture started, every delta of a streaming reply would scan its whole text again for nothing.
        const captured = this.captures.has(key) || item.uiQueries?.authorChatId === session.id;
        if (!captured && !uiMayReferenceHost(item.text) && !item.ui?.some((block) => Object.keys(block.queries).length)) {
            return;
        }
        const capture = this.access(session, item);
        if (!final || !item.ui?.length) {
            return;
        }
        if (this.freezing.has(key)) {
            return;
        }
        const frozen = capture
            .then(async () => {
                for (const block of (item.ui ?? []).slice(0, 16)) {
                    const current = session.thread.get(item.id);
                    if (current?.kind !== 'assistant' || current.ui?.find((entry) => entry.id === block.id)?.revision !== block.revision) {
                        return;
                    }
                    if (current.uiQueries?.blocks[block.id]?.revision === block.revision) {
                        continue;
                    }
                    const readings: Record<string, ChatUiQueryReading> = Object.create(null);
                    const values: Record<string, unknown> = Object.create(null);
                    for (const name of Object.keys(block.queries).slice(0, UI_HOST_LIMITS.queries)) {
                        const reading = await this.query(session, {
                            chatId: session.id,
                            itemId: item.id,
                            blockId: block.id,
                            revision: block.revision!,
                            query: name
                        });
                        readings[name] = reading;
                        if (reading.state === 'fresh') {
                            values[name] = reading.value;
                        }
                    }
                    const links: Record<string, ChatUiLinkReading> = Object.create(null);
                    if (this.host.link) {
                        const targets = uiLinkTargets(block, {}, values);
                        const access = await this.access(session, current);
                        for (const [id, target] of Object.entries(targets).slice(0, UI_HOST_LIMITS.links)) {
                            try {
                                links[id] = this.linkReading(await this.host.link(session.info, access, target));
                            } catch (error) {
                                links[id] = { state: 'plain', ...this.failure(error) };
                            }
                        }
                    }
                    const { places, found, ended } = await this.lookUpPlaces(session, item.id, block, values);
                    if (ended) {
                        return;
                    }
                    const latest = session.thread.get(item.id);
                    if (latest?.kind !== 'assistant' || !latest.uiQueries || latest.ui?.find((entry) => entry.id === block.id)?.revision !== block.revision) {
                        return;
                    }
                    const names = Object.entries(block.queries)
                        .map(([name, query]) => `${name}: ${query.source}`)
                        .join(', ');
                    const failures = Object.entries(readings)
                        .filter(([, reading]) => reading.state !== 'fresh')
                        .map(([name, reading]) => `${name}: ${reading.reason}`)
                        .join('\n');
                    const frozen: ChatUiQueryState['blocks'][string] = {
                        revision: block.revision!,
                        readings,
                        links,
                        ...(Object.keys(places).length > 0 ? { places } : {}),
                        fallback: `${uiQueryFallback(block, values).slice(0, 8192)}${names ? `\nSources: ${names}` : ''}${failures ? `\n${failures}` : ''}${found.length > 0 ? `\nPlaces: ${found.join('; ')}` : ''}`
                    };
                    const blocks = { ...latest.uiQueries.blocks, [block.id]: frozen };
                    if (Buffer.byteLength(JSON.stringify(blocks)) > MAX_SNAPSHOT_BYTES) {
                        frozen.readings = Object.fromEntries(
                            Object.keys(readings).map((name) => [
                                name,
                                { state: 'failed', readAt: Date.now(), code: 'snapshot-too-large', reason: 'The frozen query values are too large.' }
                            ])
                        );
                        frozen.links = Object.fromEntries(
                            Object.keys(links).map((id) => [id, { state: 'plain', code: 'link-unchecked', reason: 'This link must be checked again.' }])
                        );
                        if (frozen.places) {
                            frozen.places = Object.fromEntries(
                                Object.entries(places).map(([id, reading]) => [
                                    id,
                                    { state: 'missing', address: reading.address, code: 'snapshot-too-large', reason: 'The frozen places are too large.' }
                                ])
                            );
                        }
                        frozen.fallback = `${block.fallback.slice(0, 2048)}\nSources: ${names}\nThe frozen query values are too large.`;
                    }
                    if (Buffer.byteLength(JSON.stringify(blocks)) > MAX_SNAPSHOT_BYTES) {
                        // The block stays marked as frozen with nothing in it, so a reader stops waiting for readings that will not come.
                        blocks[block.id] = { revision: block.revision!, readings: {}, fallback: '' };
                    }
                    session.updateUiQueries(item.id, { ...latest.uiQueries, blocks });
                }
            })
            .catch(() => {})
            .finally(() => this.freezing.delete(key));
        this.freezing.set(key, frozen);
    }

    /* Settles once the reply's readings, links and places are frozen, or at once where nothing is being frozen. */
    async whenFrozen(session: ChatSession, itemId: string): Promise<void> {
        await this.freezing.get(`${session.id}:${itemId}`);
    }

    /*
     * The places of a block that name an address, looked up four at a time within one budget for the block.
     * Past the budget, or after the host timed out three times in a row, the rest freeze as missing without
     * asking. Nothing is asked once the chat ended, the reply is gone or the block changed; the caller then
     * drops the write.
     */
    private async lookUpPlaces(
        session: ChatSession,
        itemId: string,
        block: UiBlock,
        values: Record<string, unknown>
    ): Promise<{ places: Record<string, ChatUiPlaceReading>; found: string[]; ended: boolean }> {
        const places: Record<string, ChatUiPlaceReading> = Object.create(null);
        const found: string[] = [];
        if (!this.host.place) {
            return { places, found, ended: false };
        }
        let queries: Array<[string, UiPlaceQuery]>;
        try {
            queries = Object.entries(uiPlaceQueries(block, {}, values)).slice(0, UI_HOST_LIMITS.places);
        } catch {
            return { places, found, ended: false };
        }
        const life = this.lifeOf(session.id).signal;
        const budget = new AbortController();
        const timer = setTimeout(() => budget.abort(), PLACE_BLOCK_BUDGET_MS);
        timer.unref?.();
        const signal = AbortSignal.any([life, budget.signal]);
        const readings = new Map<string, ChatUiPlaceReading>();
        let timeouts = 0;
        let next = 0;
        const stillThere = (): boolean => {
            const current = session.thread.get(itemId);
            return !life.aborted && current?.kind === 'assistant' && current.ui?.find((entry) => entry.id === block.id)?.revision === block.revision;
        };
        const worker = async (): Promise<void> => {
            for (let index = next++; index < queries.length; index = next++) {
                const [id, query] = queries[index]!;
                if (!stillThere()) {
                    return;
                }
                if (budget.signal.aborted || timeouts >= PLACE_TIMEOUTS_IN_A_ROW) {
                    readings.set(id, { state: 'missing', address: query.address, code: 'timed-out', reason: 'The place lookup timed out.' });
                    continue;
                }
                const reading = await this.placeReading(session.info, query, signal);
                timeouts = reading.code === 'timed-out' ? timeouts + 1 : 0;
                readings.set(id, reading);
            }
        };
        try {
            await Promise.all(Array.from({ length: Math.min(PLACE_PARALLEL, queries.length) }, worker));
        } finally {
            clearTimeout(timer);
        }
        for (const [id, query] of queries) {
            const reading = readings.get(id);
            if (reading === undefined) {
                continue;
            }
            places[id] = reading;
            if (reading.state === 'found') {
                found.push(`${query.name || query.address}: ${reading.lat}, ${reading.lon}`);
            }
        }
        return { places, found, ended: life.aborted };
    }

    private lifeOf(chatId: string): AbortController {
        let life = this.lives.get(chatId);
        if (life === undefined) {
            life = new AbortController();
            this.lives.set(chatId, life);
        }
        return life;
    }

    /*
     * One lookup, cut off after five seconds or when `outer` aborts. Whatever goes wrong is a reading that says
     * the place is missing. Only a refusal the host chose its words for (`ChatUiRefusal`) carries them: any
     * other error stays out of the shared record, which every client reads.
     */
    private async placeReading(info: ChatInfo, query: UiPlaceQuery, outer: AbortSignal): Promise<ChatUiPlaceReading> {
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), PLACE_TIMEOUT_MS);
        timer.unref?.();
        const signal = AbortSignal.any([timeout.signal, outer]);
        try {
            const reading = await Promise.race([
                this.host.place!(info, query, signal),
                new Promise<never>((_, reject) =>
                    signal.addEventListener('abort', () => reject(new UiQueryError('refused-query', 'timed-out', 'The place lookup timed out.')), {
                        once: true
                    })
                )
            ]);
            const parsed = ChatUiPlaceReadingSchema.parse({ ...(copyUiValue(reading, new UiBudget()) as object), address: query.address });
            return parsed.state === 'found' && (parsed.lat === undefined || parsed.lon === undefined)
                ? { state: 'missing', address: query.address, code: 'place-unreadable', reason: 'The host found no point for this address.' }
                : parsed;
        } catch (error) {
            return error instanceof UiQueryError
                ? { state: 'missing', address: query.address, ...this.failure(error) }
                : { state: 'missing', address: query.address, code: 'lookup-failed', reason: 'The place could not be looked up.' };
        } finally {
            clearTimeout(timer);
        }
    }

    /* The writer's access for a reply, captured once; null where it was denied or is unavailable. */
    private access(session: ChatSession, item: ChatAssistantItem): Promise<unknown> {
        const key = `${session.id}:${item.id}`;
        const existing = this.captures.get(key);
        if (existing) {
            return existing;
        }
        if (item.uiQueries?.authorChatId === session.id) {
            return Promise.resolve(session.uiAccess(item.id) ?? null);
        }
        // A pending capture is persisted as denied, so a restart cannot widen the writer's rights.
        session.setUiAccess(item.id, null);
        session.updateUiQueries(item.id, { authorChatId: session.id, blocks: {} });
        const captured = this.host
            .capture(session.info)
            .then((access) => {
                const captured = copyUiValue(access, new UiBudget());
                if (Buffer.byteLength(JSON.stringify(captured)) > 32 * 1024) {
                    throw new Error('The UI access snapshot is too large.');
                }
                session.setUiAccess(item.id, captured);
                return captured as unknown;
            })
            .catch(() => null)
            .finally(() => this.captures.delete(key));
        this.captures.set(key, captured);
        return captured;
    }

    private storedBlock(
        session: ChatSession,
        payload: Pick<ChatUiQueryPayload, 'itemId' | 'blockId' | 'revision'>
    ): { item: ChatAssistantItem; block: UiBlock } {
        const item = session.thread.get(payload.itemId);
        const block =
            item?.kind === 'assistant' && !item.streaming && !item.parentToolUseId ? item.ui?.find((entry) => entry.id === payload.blockId) : undefined;
        if (item?.kind !== 'assistant' || !block?.complete || block.revision !== payload.revision) {
            throw new UiQueryError('stale-ui-block', 'block-stale', 'This completed UI block is no longer available.');
        }
        return { item, block };
    }

    private stored(session: ChatSession, payload: ChatUiQueryPayload): { item: ChatAssistantItem; block: UiBlock; source: ChatUiSource } {
        const { item, block } = this.storedBlock(session, payload);
        if (!Object.hasOwn(block.queries, payload.query) || Object.keys(block.queries).length > UI_HOST_LIMITS.queries) {
            throw new UiQueryError('refused-query', 'query-undeclared', 'This block does not declare an allowed query.');
        }
        const name = block.queries[payload.query].source;
        if (!Object.hasOwn(this.host.sources, name)) {
            throw new UiQueryError('refused-query', 'source-unregistered', 'This query source is not registered.');
        }
        return { item, block, source: this.host.sources[name] };
    }

    async query(session: ChatSession, payload: ChatUiQueryPayload): Promise<ChatUiQueryReading> {
        let args: Record<string, UiValue>;
        let source: ChatUiSource;
        let block: UiBlock;
        let item: ChatAssistantItem;
        let authorAccess: unknown;
        try {
            ({ source, block, item } = this.stored(session, payload));
            args = uiQueryArguments(block, payload.query, payload.values, {}, this.heldValues(session, item, block));
            args = source.args.parse(args) as Record<string, UiValue>;
            authorAccess = await this.access(session, item);
            if (authorAccess === null) {
                throw new UiQueryError('refused-query', 'access-unavailable', 'The writer’s original access is unavailable.');
            }
            await source.authorize(session.info, authorAccess, args);
        } catch (error) {
            return { state: 'refused', readAt: Date.now(), ...this.failure(error) };
        }
        const key = JSON.stringify([session.id, item.id, block.id, block.revision, payload.query, args]);
        const cached = this.cache.get(this.latest.get(key) ?? '');
        if (cached && Date.now() - cached.reading.readAt < UI_HOST_LIMITS.refreshMilliseconds) {
            return cached.reading;
        }
        const pending = this.reading.get(key);
        if (pending) {
            return pending;
        }
        const identity = JSON.stringify([session.id, item.id, block.id, block.revision, payload.query]);
        const now = Date.now();
        if (
            now - (this.attempts.get(key) ?? -Infinity) < UI_HOST_LIMITS.refreshMilliseconds ||
            now - (this.attempts.get(identity) ?? -Infinity) < INPUT_READ_MS
        ) {
            return { state: 'failed', readAt: now, code: 'refresh-limit', reason: 'This query may refresh once every ten seconds.' };
        }
        if ((this.active.get(session.id) ?? 0) >= 2 || this.totalActive >= 16) {
            return { state: 'failed', readAt: now, code: 'busy', reason: 'Too many UI queries are being read.' };
        }
        this.attempts.set(key, now);
        this.attempts.set(identity, now);
        while (this.attempts.size > 256) {
            this.attempts.delete(this.attempts.keys().next().value!);
        }
        this.active.set(session.id, (this.active.get(session.id) ?? 0) + 1);
        this.totalActive++;
        const controller = new AbortController();
        const work = Promise.resolve().then(() => source.read(session.info, args, controller.signal, authorAccess));
        const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
        timeout.unref?.();
        const read = Promise.race([
            work,
            new Promise<never>((_, reject) =>
                controller.signal.addEventListener('abort', () => reject(new UiQueryError('refused-query', 'timed-out', 'The UI query timed out.')), {
                    once: true
                })
            )
        ])
            .then((result): ChatUiQueryReading => {
                const value = copyUiValue(source.result.parse(result), new UiBudget());
                if (Buffer.byteLength(JSON.stringify(value)) > MAX_QUERY_BYTES) {
                    throw new UiQueryError('refused-query', 'result-too-large', 'The UI query result is too large.');
                }
                const reading: ChatUiQueryReading = { state: 'fresh', value, readId: randomUUID(), readAt: Date.now() };
                this.cache.set(reading.readId!, { key, identity, chatId: session.id, reading });
                this.latest.set(key, reading.readId!);
                this.newest.set(identity, reading.readId!);
                while (this.cache.size > 128) {
                    this.evict(this.cache.keys().next().value!);
                }
                return reading;
            })
            .catch((error): ChatUiQueryReading => ({ state: 'failed', readAt: Date.now(), ...this.failure(error) }))
            .finally(() => {
                clearTimeout(timeout);
                this.reading.delete(key);
            });
        // Timed-out sources still occupy their slot until their actual work ends.
        void work
            .catch(() => {})
            .finally(() => {
                const count = (this.active.get(session.id) ?? 1) - 1;
                if (count) {
                    this.active.set(session.id, count);
                } else {
                    this.active.delete(session.id);
                }
                this.totalActive--;
            });
        this.reading.set(key, read);
        return read;
    }

    /* The issued value of every query the block declares, each checked against the read id the person saw. */
    async choiceValues(session: ChatSession, payload: ChatUiChoicePayload | ChatUiLinkPayload): Promise<Record<string, unknown>> {
        const item = session.thread.get(payload.itemId);
        const block = item?.kind === 'assistant' ? item.ui?.find((entry) => entry.id === payload.blockId) : undefined;
        if (!block || item?.kind !== 'assistant' || ('choiceId' in payload && item.uiAnswers?.[block.id]?.revision === payload.revision)) {
            return {};
        }
        const names = Object.keys(block.queries);
        const values: Record<string, unknown> = Object.create(null);
        if (names.length === 0) {
            return values;
        }
        const access = await this.access(session, item);
        if (access === null) {
            throw new UiQueryError('refused-query', 'access-unavailable', 'The writer’s original access is unavailable.');
        }
        const frozen = item.uiQueries?.blocks[block.id];
        const readIdOf = (name: string): string | undefined =>
            payload.reads !== undefined && Object.hasOwn(payload.reads, name) ? payload.reads[name] : undefined;
        // What the person saw, by the read ids it names; each one is checked against its arguments below.
        const seen: Record<string, unknown> = Object.create(null);
        for (const name of names) {
            const readId = readIdOf(name);
            const cached = readId === undefined ? undefined : this.cache.get(readId);
            const reading =
                cached?.identity === JSON.stringify([session.id, item.id, block.id, block.revision, name])
                    ? cached.reading
                    : frozen?.revision === block.revision
                      ? frozen?.readings[name]
                      : undefined;
            if (readId !== undefined && reading?.readId === readId && reading.state === 'fresh') {
                seen[name] = reading.value;
            }
        }
        for (const name of names) {
            const { source } = this.stored(session, { ...payload, query: name });
            const args = source.args.parse(uiQueryArguments(block, name, payload.values, {}, seen)) as Record<string, UiValue>;
            await source.authorize(session.info, access, args);
            const readId = readIdOf(name);
            const key = JSON.stringify([session.id, item.id, block.id, block.revision, name, args]);
            const cached = readId === undefined ? undefined : this.cache.get(readId);
            const snapshot = frozen?.revision === block.revision ? frozen?.readings[name] : undefined;
            const reading =
                readId === undefined
                    ? undefined
                    : cached?.key === key
                      ? cached.reading
                      : snapshot?.readId === readId && JSON.stringify(args) === JSON.stringify(source.args.parse(uiQueryArguments(block, name)))
                        ? snapshot
                        : undefined;
            if (!reading || reading.state !== 'fresh') {
                throw new UiQueryError('stale-ui-query', 'stale-read', 'Refresh this query before sending its choice.');
            }
            values[name] = reading.value;
        }
        return values;
    }

    async link(session: ChatSession, payload: ChatUiLinkPayload): Promise<ChatUiLinkReading> {
        try {
            if (!this.host.link) {
                throw new UiQueryError('refused-query', 'links-unsupported', 'This host does not provide UI links.');
            }
            const { item, block } = this.storedBlock(session, payload);
            if (!item.uiQueries) {
                throw new UiQueryError('refused-query', 'access-unavailable', 'The writer’s original access is unavailable.');
            }
            const access = await this.access(session, item);
            if (access === null) {
                throw new UiQueryError('refused-query', 'access-unavailable', 'The writer’s original access is unavailable.');
            }
            const queries = await this.choiceValues(session, payload);
            const target = uiLinkTargets(block, payload.values, queries)[payload.nodeId];
            if (!target) {
                throw new UiQueryError('refused-query', 'link-unsupported', 'This visible node is not a supported link.');
            }
            return this.linkReading(await this.host.link(session.info, access, target));
        } catch (error) {
            return { state: 'plain', ...this.failure(error) };
        }
    }

    forget(chatId: string): void {
        this.lives.get(chatId)?.abort();
        this.lives.delete(chatId);
        for (const [id, cached] of this.cache) {
            if (cached.chatId === chatId) {
                this.evict(id);
            }
        }
    }

    private evict(readId: string): void {
        const cached = this.cache.get(readId);
        this.cache.delete(readId);
        if (cached && this.latest.get(cached.key) === readId) {
            this.latest.delete(cached.key);
        }
        if (cached && this.newest.get(cached.identity) === readId) {
            this.newest.delete(cached.identity);
        }
    }

    /* The newest fresh value of every query of a block, or the frozen one, for checking an input chosen from what they read. */
    private heldValues(session: ChatSession, item: ChatAssistantItem, block: UiBlock): Record<string, unknown> {
        const frozen = item.uiQueries?.blocks[block.id];
        const values: Record<string, unknown> = Object.create(null);
        for (const name of Object.keys(block.queries)) {
            const readId = this.newest.get(JSON.stringify([session.id, item.id, block.id, block.revision, name]));
            const reading =
                (readId === undefined ? undefined : this.cache.get(readId)?.reading) ??
                (frozen?.revision === block.revision ? frozen?.readings[name] : undefined);
            if (reading?.state === 'fresh') {
                values[name] = reading.value;
            }
        }
        return values;
    }

    private linkReading(value: unknown): ChatUiLinkReading {
        const reading = UiLinkResolutionSchema.parse(copyUiValue(value, new UiBudget()));
        if (reading.state === 'chip' && !reading.target) {
            throw new Error('The host did not resolve a link target.');
        }
        return reading;
    }

    private failure(error: unknown): { reason: string; code?: string } {
        // The reason is frozen into a record every client reads, so a message the host did not choose for that stays out of it.
        return error instanceof UiQueryError ? { reason: error.message.slice(0, 240), code: error.reason } : { reason: 'This query could not be read.' };
    }
}
