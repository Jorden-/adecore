import type { DocumentChange, DocumentModel, FindMatch } from '@adecore/editor-core';
import { mapOffset } from './offsets.ts';
import { FindSearchQueue, scheduleFind, type FindSearchOptions } from './find-search.ts';
import { EditorSearchError } from './search-client.ts';
import type { EditorSearchSnapshot } from './search-protocol.ts';
import { SEARCH_LIMIT } from './search-protocol.ts';
import type { EditorFindQuery, EditorFindState } from './types.ts';

export interface FindMark {
    from: number;
    to: number;
}

export const FIND_LIMIT = SEARCH_LIMIT;
const LIVE_REGEX_LIMIT = 8_000_000;

export interface FindControllerOptions extends FindSearchOptions {
    readonly changed: () => void;
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
            ...(this.searching ? { searching: true } : {}),
            ...(this.failed === undefined ? {} : { failed: this.failed }),
            ...(this.search !== undefined && this.query?.regex && this.model.getLength() > LIVE_REGEX_LIMIT ? { large: true } : {}),
            ...(this.query?.inSelection === true && this.bounds === null ? { noSelection: true } : {})
        };
    }

    /* The range a search in the selection is held to. */
    get scope(): { from: number; to: number } | null {
        return this.query?.inSelection === true ? this.bounds : null;
    }

    get currentMark(): FindMark | null {
        return this.index === null ? null : (this.marks[this.index] ?? null);
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
        this.refresh();
    }

    /* The text of a search in the selection moved with an edit. */
    mapBounds(changes: readonly DocumentChange[]): void {
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
        const next = found.findIndex((mark) => mark.from >= anchor);
        this.index = found.length === 0 ? null : Math.max(0, next);
    }

    step(direction: 1 | -1): void {
        if (this.search !== undefined && this.query?.regex && !this.freshRegex) {
            this.startRegex(true);
            return;
        }
        const count = this.marks.length;
        if (count === 0) {
            return;
        }
        this.index = this.index === null ? (direction === 1 ? 0 : count - 1) : (this.index + direction + count) % count;
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
        this.snapshotMemo = undefined;
        this.retained = null;
        this.searching = false;
        this.failed = undefined;
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
                void this.search!.request((client) => {
                    if (epoch !== this.epoch || this.disposed) {
                        throw new EditorSearchError('superseded', 'The find query changed.');
                    }
                    return client.search(snapshot, query, { ...this.scope, maxResults: FIND_LIMIT });
                })
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
                        this.index =
                            marks.length === 0
                                ? null
                                : Math.max(
                                      0,
                                      marks.findIndex((mark) => mark.from >= anchor)
                                  );
                        this.searching = false;
                        this.options?.changed();
                        this.preparePreview();
                    })
                    .catch((error) => {
                        if (epoch !== this.epoch || this.disposed || (error instanceof EditorSearchError && error.kind === 'superseded')) {
                            return;
                        }
                        this.searching = false;
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
        if (this.preview && this.search !== undefined && this.query?.regex && this.freshRegex && this.currentMatch === null) {
            this.cancelMatch = (this.options?.schedule ?? scheduleFind)(() => {
                this.cancelMatch = undefined;
                void this.ensureMatch().catch(() => {});
            }, 50);
        }
    }

    async ensureMatch(): Promise<FindMatch | null> {
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
        const current = (): boolean =>
            !this.disposed &&
            epoch === this.epoch &&
            this.model.getRevision() === snapshot.revision &&
            this.currentMark?.from === mark.from &&
            this.currentMark?.to === mark.to;
        try {
            const found = await this.search.request((client) => {
                if (!current()) {
                    throw new EditorSearchError('superseded', 'The current find match changed.');
                }
                return client.match(snapshot, query, mark);
            });
            if (!current()) {
                return null;
            }
            this.retained = found;
            this.options?.changed();
            return found;
        } catch (error) {
            if (current() && !(error instanceof EditorSearchError && error.kind === 'superseded')) {
                this.failed = error instanceof EditorSearchError && (error.kind === 'timeout' || error.kind === 'unavailable') ? error.kind : 'error';
                this.options?.changed();
            }
            return null;
        }
    }

    dispose(): void {
        this.disposed = true;
        this.resetRegex(false);
        this.search?.dispose();
    }
}
