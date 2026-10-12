import type { DocumentChange, DocumentModel, FindMatch, TextEdit } from '@adecore/editor-core';
import { mapOffset } from './offsets.ts';
import { FindSearchQueue, scheduleFind, type FindSearchOptions } from './find-search.ts';
import { EditorSearchError } from './search-client.ts';
import type { EditorSearchSnapshot } from './search-protocol.ts';
import { SEARCH_LIMIT, MAX_REPLACEMENT_PAGE, MAX_REPLACEMENT_CHARACTERS } from './search-protocol.ts';
import type { EditorFindQuery, EditorFindState } from './types.ts';

export interface FindMark {
    from: number;
    to: number;
}

export const FIND_LIMIT = SEARCH_LIMIT;
const LIVE_REGEX_LIMIT = 8_000_000;

export interface FindControllerOptions extends FindSearchOptions {
    readonly changed: (reveal?: boolean) => void;
}

/*
 * The find of the host's find bar: every match marked, one of them current. It searches the model on
 * its own and never touches the selection until the find ends.
 */
export class FindController {
    private query: EditorFindQuery | null = null;
    private marks: readonly FindMark[] = [];
    private cache?: { revision: number; key: string; matches: FindMatch[]; complete: boolean };
    private index: number | null = null;
    private outside: FindMark | null = null;
    private seeking = false;
    private replacing = 0;
    private replaceEpoch = -1;
    private replaced: number | undefined;
    private replaceFailed: EditorFindState['replaceFailed'];
    /* The text a search in the selection is held to, which follows the text through edits; null when nothing was selected. */
    private bounds: { from: number; to: number } | null = null;
    /* Where the next refresh looks for the current match from, once: right after what a replace wrote. */
    pendingAnchor: number | undefined;

    private readonly model: DocumentModel;
    private readonly options: FindControllerOptions | undefined;
    private readonly search: FindSearchQueue | undefined;
    private regexCache: { revision: number; key: string; complete: boolean } | undefined;
    private snapshotMemo: EditorSearchSnapshot | undefined;
    private retained: FindMatch | null = null;
    private epoch = 0;
    private searching = false;
    private failed: EditorFindState['failed'];
    private captureFailed: EditorFindState['captureFailed'];
    private pendingStep: 1 | -1 | undefined;
    private cancelSearch: (() => void) | undefined;
    private cancelMatch: (() => void) | undefined;
    private preview = false;
    private disposed = false;

    constructor(model: DocumentModel, options?: FindControllerOptions) {
        this.model = model;
        this.options = options;
        this.search = options === undefined ? undefined : new FindSearchQueue(options);
    }

    get activeQuery(): EditorFindQuery | null {
        return this.query;
    }

    get active(): boolean {
        return this.query !== null;
    }

    get matches(): readonly FindMark[] {
        return this.marks;
    }

    get current(): number | null {
        return this.index;
    }

    get state(): EditorFindState {
        return {
            count: this.marks.length,
            current: this.index,
            ...(this.cache?.complete === false || (this.failed === undefined && this.regexCache?.complete === false) ? { limited: true } : {}),
            ...(this.searching || this.seeking || (this.replacing > 0 && this.replaceEpoch === this.epoch) ? { searching: true } : {}),
            ...(this.replaced === undefined ? {} : { replaced: this.replaced }),
            ...(this.replaceFailed === undefined ? {} : { replaceFailed: this.replaceFailed }),
            ...(this.failed === undefined ? {} : { failed: this.failed }),
            ...(this.captureFailed === undefined ? {} : { captureFailed: this.captureFailed }),
            ...(this.search !== undefined && this.query?.regex && this.model.getLength() > LIVE_REGEX_LIMIT && !this.freshRegex ? { large: true } : {}),
            ...(this.query?.inSelection === true && this.bounds === null ? { noSelection: true } : {})
        };
    }

    /* The range a search in the selection is held to. */
    get scope(): { from: number; to: number } | null {
        return this.query?.inSelection === true ? this.bounds : null;
    }

    get currentMark(): FindMark | null {
        return this.outside ?? (this.index === null ? null : (this.marks[this.index] ?? null));
    }

    matchesBetween(from: number, to: number): readonly FindMark[] {
        let low = 0;
        let high = this.marks.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (this.marks[middle]!.to < from) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        const first = low;
        high = this.marks.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (this.marks[middle]!.from <= to) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return this.marks.slice(first, low);
    }

    get currentMatch(): FindMatch | null {
        if (this.search !== undefined && this.query?.regex) {
            const mark = this.currentMark;
            return this.freshRegex && this.retained?.from === mark?.from && this.retained?.to === mark?.to ? this.retained : null;
        }
        const matches = this.cachedMatches;
        if (this.outside !== null && matches !== null) {
            return {
                ...this.outside,
                text: this.model.slice(this.outside.from, this.outside.to),
                captures: [],
                regex: false,
                revision: this.model.getRevision()
            };
        }
        return this.index === null || matches === null ? null : (matches[this.index] ?? null);
    }

    get completeMatches(): readonly FindMatch[] | null {
        return this.cache?.complete === true ? this.cachedMatches : null;
    }

    private get cachedMatches(): readonly FindMatch[] | null {
        return this.query !== null && this.cache?.revision === this.model.getRevision() && this.cache.key === this.cacheKey() ? this.cache.matches : null;
    }

    private cacheKey(): string {
        const query = this.query;
        const scope = this.scope;
        return JSON.stringify([
            query?.text,
            query?.caseSensitive === true,
            query?.wholeWord === true,
            query?.regex === true,
            query?.inSelection === true,
            scope?.from,
            scope?.to
        ]);
    }

    /* A new query, or null to end the find. */
    set(query: EditorFindQuery | null): void {
        const oldKey = this.cacheKey();
        const wasInSelection = this.query?.inSelection === true;
        this.query = query === null || query.text === '' ? null : { ...query };
        if (this.query?.inSelection !== true) {
            this.bounds = null;
        } else if (!wasInSelection) {
            const selection = this.model.getPrimary();
            this.bounds =
                selection.anchor === selection.head
                    ? null
                    : { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
        }
        if (this.cacheKey() !== oldKey) {
            this.pendingAnchor = undefined;
            this.pendingStep = undefined;
            this.outside = null;
            this.replaceFailed = undefined;
            this.replaced = undefined;
        }
        this.refresh();
    }

    /* The text of a search in the selection moved with an edit. */
    mapBounds(changes: readonly DocumentChange[]): void {
        if (this.pendingAnchor !== undefined) {
            this.pendingAnchor = mapOffset(this.pendingAnchor, changes);
        }
        if (this.bounds !== null) {
            this.bounds = { from: mapOffset(this.bounds.from, changes), to: mapOffset(this.bounds.to, changes) };
        }
    }

    /*
     * The matches again, after a new query or an edit. The current one is the first from where the
     * previous one was, or from the cursor, so each letter typed keeps the place instead of starting over.
     */
    refresh(): void {
        const previous = this.currentMark;
        const query = this.query;
        if (this.search !== undefined && query?.regex) {
            this.refreshRegex(previous);
            return;
        }
        this.resetRegex(true);

        if (query === null) {
            this.marks = [];
            this.cache = undefined;
            this.index = null;
            return;
        }
        const revision = this.model.getRevision();
        const key = this.cacheKey();
        if (this.cache?.revision !== revision || this.cache.key !== key) {
            let found: FindMatch[] = [];
            try {
                const inSelection = query.inSelection === true;
                if (!inSelection || this.bounds !== null) {
                    found = this.model.find(query.text, {
                        caseSensitive: query.caseSensitive,
                        wholeWord: query.wholeWord,
                        regex: query.regex,
                        maxResults: FIND_LIMIT + 1,
                        ...(inSelection ? this.bounds : {})
                    });
                }
            } catch {
                // A pattern that does not parse finds nothing; the find bar says it is invalid.
            }
            this.cache = { revision, key, matches: found.slice(0, FIND_LIMIT), complete: found.length <= FIND_LIMIT };
        }
        const found = this.cache.matches;
        this.marks = found;
        const selection = this.model.getPrimary();
        const anchor = this.pendingAnchor ?? previous?.from ?? Math.min(selection.anchor, selection.head);
        this.pendingAnchor = undefined;
        this.chooseCurrent(anchor, 1, !this.cache.complete);
    }

    step(direction: 1 | -1): void {
        if (this.seeking) {
            this.pendingStep = direction;
            return;
        }
        if (this.search !== undefined && this.query?.regex && !this.freshRegex) {
            this.pendingStep = direction;
            if (!this.searching) {
                this.startRegex(true);
            }
            return;
        }
        const count = this.marks.length;
        if (count === 0) {
            return;
        }
        const incomplete = this.regexCache?.complete === false || this.cache?.complete === false;
        const current = this.currentMark;
        if (
            this.search !== undefined &&
            incomplete &&
            current !== null &&
            (this.outside !== null || (direction === 1 ? this.index === count - 1 : this.index === 0))
        ) {
            let offset = direction === -1 ? current.from : current.to;
            if (direction === 1 && current.from === current.to) {
                offset += (this.model.getText().codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
            }
            if (offset > this.model.getLength()) {
                offset = 0;
            }
            this.seek(offset, direction);
            return;
        }
        this.outside = null;
        this.index = this.index === null ? (direction === 1 ? 0 : count - 1) : (this.index + direction + count) % count;
        this.captureFailed = undefined;
        this.preparePreview();
    }

    private get freshRegex(): boolean {
        return (
            this.failed === undefined && !this.searching && this.regexCache?.revision === this.model.getRevision() && this.regexCache.key === this.cacheKey()
        );
    }

    private resetRegex(release: boolean): void {
        this.epoch++;
        this.cancelSearch?.();
        this.cancelSearch = undefined;
        this.cancelMatch?.();
        this.cancelMatch = undefined;
        this.regexCache = undefined;
        this.outside = null;
        this.seeking = false;
        this.snapshotMemo = undefined;
        this.retained = null;
        this.searching = false;
        this.failed = undefined;
        this.captureFailed = undefined;
        if (release) {
            this.search?.release();
        }
    }

    private refreshRegex(previous: FindMark | null): void {
        if (this.freshRegex) {
            return;
        }
        const failure = this.failed;
        const retryBlocked = failure === 'timeout' || failure === 'unavailable';
        const sameQuery = this.regexCache?.key === this.cacheKey();
        this.resetRegex(false);
        this.cache = undefined;
        this.marks = [];
        this.index = null;
        if (retryBlocked && sameQuery) {
            this.failed = failure;
            this.regexCache = { revision: this.model.getRevision(), key: this.cacheKey(), complete: false };
            return;
        }
        this.pendingAnchor ??= previous?.from;
        this.startRegex(false);
    }

    private startRegex(explicit: boolean): void {
        const query = this.query;
        if (query === null || this.search === undefined || this.disposed) {
            return;
        }
        if (query.inSelection && this.bounds === null) {
            return;
        }
        if (!explicit && this.model.getLength() > LIVE_REGEX_LIMIT) {
            this.pendingStep = undefined;
            this.pendingAnchor = undefined;
            return;
        }
        const epoch = this.epoch;
        const key = this.cacheKey();
        const revision = this.model.getRevision();
        this.failed = undefined;
        this.searching = true;
        this.cancelSearch?.();
        this.cancelSearch = (this.options?.schedule ?? scheduleFind)(
            () => {
                this.cancelSearch = undefined;
                const snapshot = this.snapshot();
                void this.search!.request(
                    (client) => {
                        if (epoch !== this.epoch || this.disposed) {
                            throw new EditorSearchError('superseded', 'The find query changed.');
                        }
                        return client.search(snapshot, query, { ...this.scope, maxResults: FIND_LIMIT, ...(explicit ? { deadline: 10000 } : {}) });
                    },
                    explicit ? 'command' : 'live',
                    () => epoch === this.epoch && revision === this.model.getRevision() && !this.disposed
                )
                    .then((result) => {
                        if (epoch !== this.epoch || revision !== this.model.getRevision() || this.disposed) {
                            return;
                        }
                        this.regexCache = { revision, key, complete: !result.limited };
                        const marks: FindMark[] = [];
                        for (let index = 0; index < result.ranges.length; index += 2) {
                            marks.push({ from: result.ranges[index]!, to: result.ranges[index + 1]! });
                        }
                        this.marks = marks;
                        const selection = this.model.getPrimary();
                        const anchor = this.pendingAnchor ?? Math.min(selection.anchor, selection.head);
                        this.pendingAnchor = undefined;
                        const direction = this.pendingStep;
                        this.pendingStep = undefined;
                        this.searching = false;
                        this.chooseCurrent(anchor, direction ?? 1, result.limited);
                        this.options?.changed(true);
                        this.preparePreview();
                    })
                    .catch((error) => {
                        if (epoch !== this.epoch || this.disposed) {
                            return;
                        }
                        this.searching = false;
                        if (error instanceof EditorSearchError && error.kind === 'superseded') {
                            this.options?.changed();
                            this.startRegex(this.pendingStep !== undefined);
                            return;
                        }
                        this.pendingAnchor = undefined;
                        this.pendingStep = undefined;
                        this.failed =
                            error instanceof EditorSearchError
                                ? error.kind === 'syntax'
                                    ? 'invalid'
                                    : error.kind === 'timeout' || error.kind === 'unavailable'
                                      ? error.kind
                                      : 'error'
                                : 'error';
                        this.regexCache = { revision, key, complete: false };
                        this.options?.changed();
                    });
            },
            explicit || this.model.getLength() <= 1_000_000 ? 0 : 150
        );
    }

    private snapshot(): EditorSearchSnapshot {
        const revision = this.model.getRevision();
        if (this.snapshotMemo?.revision !== revision) {
            this.snapshotMemo = { revision, text: this.model.getText() };
        }
        return this.snapshotMemo;
    }

    setPreview(active: boolean): void {
        this.preview = active;
        this.preparePreview();
    }

    private preparePreview(): void {
        this.cancelMatch?.();
        this.cancelMatch = undefined;
        if (
            this.preview &&
            this.search !== undefined &&
            this.query?.regex &&
            this.freshRegex &&
            this.currentMatch === null &&
            this.captureFailed === undefined
        ) {
            this.cancelMatch = (this.options?.schedule ?? scheduleFind)(() => {
                this.cancelMatch = undefined;
                void this.ensureMatch().catch(() => {});
            }, 50);
        }
    }

    async ensureMatch(command = false): Promise<FindMatch | null> {
        if (this.currentMatch !== null || this.search === undefined || !this.query?.regex || !this.freshRegex) {
            return this.currentMatch;
        }
        const mark = this.currentMark;
        if (mark === null) {
            return null;
        }
        const query = this.query;
        const epoch = this.epoch;
        const snapshot = this.snapshot();
        if (command) {
            this.captureFailed = undefined;
        }
        const current = (): boolean =>
            !this.disposed &&
            epoch === this.epoch &&
            this.model.getRevision() === snapshot.revision &&
            this.currentMark?.from === mark.from &&
            this.currentMark?.to === mark.to;
        try {
            const found = await this.search.request(
                (client) => {
                    if (!current()) {
                        throw new EditorSearchError('superseded', 'The current find match changed.');
                    }
                    return client.match(snapshot, query, { ...mark, deadline: 10000 });
                },
                command ? 'command' : 'preview'
            );
            if (!current()) {
                return null;
            }
            this.retained = found;
            this.captureFailed = undefined;
            this.options?.changed();
            return found;
        } catch (error) {
            if (current() && !(error instanceof EditorSearchError && error.kind === 'superseded')) {
                this.captureFailed = error instanceof EditorSearchError && (error.kind === 'timeout' || error.kind === 'unavailable') ? error.kind : 'error';
                this.options?.changed();
            }
            return null;
        }
    }

    private chooseCurrent(anchor: number, direction: 1 | -1, limited: boolean): void {
        if (this.marks.length === 0) {
            this.index = null;
            return;
        }
        const next = direction === 1 ? this.marks.findIndex((mark) => mark.from >= anchor) : this.marks.findLastIndex((mark) => mark.from < anchor);
        if (next === -1 && limited && this.search !== undefined) {
            this.index = null;
            this.seek(anchor, direction);
        } else {
            this.index = next === -1 ? (direction === 1 ? 0 : this.marks.length - 1) : next;
        }
    }

    private seek(offset: number, direction: 1 | -1): void {
        const query = this.query;
        if (this.search === undefined || query === null) {
            return;
        }
        const epoch = this.epoch;
        const snapshot = this.snapshot();
        const scope = this.scope;
        const valid = (): boolean => !this.disposed && epoch === this.epoch && snapshot.revision === this.model.getRevision();
        this.seeking = true;
        this.failed = undefined;
        this.retained = null;
        this.captureFailed = undefined;
        void this.search
            .request((client) => client.next(snapshot, query, offset, { ...scope, backwards: direction === -1, wrap: true, deadline: 10000 }), 'command', valid)
            .then((range) => {
                if (!valid()) {
                    return;
                }
                this.seeking = false;
                this.outside = null;
                this.index = range === null ? null : this.marks.findIndex((mark) => mark.from === range.from && mark.to === range.to);
                if (this.index === -1) {
                    this.index = null;
                    this.outside = range;
                }
                this.options?.changed(true);
                this.preparePreview();
                const pending = this.pendingStep;
                this.pendingStep = undefined;
                if (pending !== undefined) {
                    this.step(pending);
                }
            })
            .catch((error) => {
                if (valid()) {
                    this.seeking = false;
                    this.failed = searchFailure(error);
                    this.options?.changed();
                }
            });
    }

    async nextFromCursor(query: EditorFindQuery, offset: number, direction: 1 | -1): Promise<FindMark | null> {
        if (this.search === undefined) {
            return null;
        }
        const snapshot = this.snapshot();
        const epoch = this.epoch;
        const valid = (): boolean => !this.disposed && epoch === this.epoch && snapshot.revision === this.model.getRevision();
        try {
            const range = await this.search.request(
                (client) => client.next(snapshot, query, offset, { backwards: direction === -1, wrap: true, deadline: 10000 }),
                'command',
                valid
            );
            return valid() ? range : null;
        } catch (error) {
            if (valid()) {
                this.failed = searchFailure(error);
                this.options?.changed();
            }
            return null;
        }
    }

    reportReplaceFailed(failure: NonNullable<EditorFindState['replaceFailed']>): void {
        this.replaceFailed = failure;
        this.replaced = undefined;
        this.options?.changed();
    }

    reportReplaced(count: number): void {
        this.replaced = count;
        this.replaceFailed = undefined;
        this.options?.changed();
    }

    async replaceOne(replacement: string, preserveCase: boolean, canApply: () => boolean): Promise<boolean> {
        const query = this.query,
            mark = this.currentMark;
        if (query === null || mark === null || this.search === undefined || !canApply()) {
            return false;
        }
        const snapshot = this.snapshot();
        const epoch = this.epoch;
        const valid = (): boolean =>
            !this.disposed &&
            epoch === this.epoch &&
            snapshot.revision === this.model.getRevision() &&
            canApply() &&
            this.currentMark?.from === mark.from &&
            this.currentMark?.to === mark.to;
        this.replacing++;
        this.replaceEpoch = epoch;
        this.replaceFailed = undefined;
        this.options?.changed();
        try {
            const page = await this.search.request(
                (client) =>
                    client.replacements(snapshot, query, replacement, {
                        from: mark.from,
                        to: mark.to,
                        preserveCase,
                        maxEdits: 1,
                        maxCharacters: MAX_REPLACEMENT_CHARACTERS,
                        deadline: 10000
                    }),
                'command',
                valid
            );
            if (!valid() || page.ranges.length !== 3 || page.ranges[0] !== mark.from || page.ranges[1] !== mark.to || page.next !== null) {
                return false;
            }
            this.pendingAnchor = mark.to;
            const changed = this.model.applyEdits([{ from: mark.from, to: mark.to, text: page.text }], {
                source: 'command',
                expectedRevision: snapshot.revision
            });
            this.reportReplaced(changed ? 1 : 0);
            return changed;
        } catch (error) {
            if (valid()) {
                const failure = searchFailure(error);
                this.reportReplaceFailed(error instanceof EditorSearchError && error.kind === 'range' ? 'limit' : failure === 'invalid' ? 'error' : failure);
            }
            return false;
        } finally {
            this.replacing--;
            if (!this.disposed) {
                this.options?.changed();
            }
        }
    }

    async replaceAll(replacement: string, preserveCase: boolean, canApply: () => boolean): Promise<number> {
        const query = this.query;
        if (query === null || this.search === undefined || this.state.noSelection || !canApply()) {
            return 0;
        }
        const snapshot = this.snapshot();
        const epoch = this.epoch;
        const scope = this.scope;
        const valid = (): boolean => !this.disposed && epoch === this.epoch && snapshot.revision === this.model.getRevision() && canApply();
        this.replacing++;
        this.replaceEpoch = epoch;
        this.replaceFailed = undefined;
        this.replaced = undefined;
        this.options?.changed();
        try {
            const page = await this.search.request(
                (client) =>
                    client.replacements(snapshot, query, replacement, {
                        ...scope,
                        preserveCase,
                        maxEdits: MAX_REPLACEMENT_PAGE,
                        maxCharacters: MAX_REPLACEMENT_CHARACTERS,
                        deadline: 10000
                    }),
                'command',
                valid
            );
            if (!valid()) {
                return 0;
            }
            if (page.next !== null) {
                this.replaceFailed = 'limit';
                return 0;
            }
            const edits: TextEdit[] = [];
            let position = 0;
            for (let index = 0; index < page.ranges.length; index += 3) {
                const length = page.ranges[index + 2]!;
                edits.push({ from: page.ranges[index]!, to: page.ranges[index + 1]!, text: page.text.slice(position, position + length) });
                position += length;
            }
            const changed = this.model.applyEdits(edits, { source: 'command', expectedRevision: snapshot.revision });
            const count = changed ? edits.length : 0;
            this.reportReplaced(count);
            return count;
        } catch (error) {
            if (!this.disposed && epoch === this.epoch) {
                const failure = searchFailure(error);
                this.replaceFailed = error instanceof EditorSearchError && error.kind === 'range' ? 'limit' : failure === 'invalid' ? 'error' : failure;
            }
            return 0;
        } finally {
            this.replacing--;
            if (!this.disposed) {
                this.options?.changed();
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.resetRegex(false);
        this.search?.dispose();
    }
}

function searchFailure(error: unknown): NonNullable<EditorFindState['failed']> {
    return error instanceof EditorSearchError
        ? error.kind === 'syntax'
            ? 'invalid'
            : error.kind === 'timeout' || error.kind === 'unavailable'
              ? error.kind
              : 'error'
        : 'error';
}
