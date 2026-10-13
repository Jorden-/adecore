import { SnippetTransformQueueError } from './snippet-transform-queue.ts';
import { SnippetTransformError } from './snippet-transform-client.ts';
import { MAX_TRANSFORM_JOBS, MAX_TRANSFORM_WORK, type SnippetTransformJob } from './snippet-transform-protocol.ts';
import { fileUriToPath, StaleResultError, type CompletionContext, type CompletionItem } from '@adecore/lsp';
import type { EditorContentChange, EditorPosition, EditorRange, EditorTextChange } from '@adecore/editor';
import { comparePositions, shiftPosition } from './diagnostics-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import {
    completionDocsOf,
    editRangeOf,
    identifierPrefix,
    insertionOf,
    isIdentifierCharacter,
    itemsOf,
    matchedCharacters,
    mirroredInsertions,
    opensCompletion,
    prefixFor,
    qualifiersOf,
    rankCompletions,
    type Insertion,
    type Ranked
} from './completion-model.ts';
import { PARAMETER_HINTS_COMMAND, isCallItem, planCall, withParentheses, type CallPlan } from './completion-call.ts';
import { compileSnippet } from './snippet.ts';
import { createSnippetResolver } from './snippet-variables.ts';
import { wordRangeAt } from './rename-model.ts';
import { RecentChoices, recentChoicesOf } from './recent-choices.ts';
import { shikiLanguageOf } from './language-ids.ts';
import { textBeforeOf } from './line-text.ts';
import { isEmptyRange } from './proposal-model.ts';
import { isShortcut } from './shortcut-keys.ts';
import type { CompletionRow, CompletionView } from './popups.ts';
import { realTimers, type Timers } from './timers.ts';
import { messageOf } from './error-message.ts';

const METHOD = 'textDocument/completion';
const START_DELAY_MS = 80;
/* After typing stops, the list is asked for again at the new text: a server only resolves an item for the text it was made for. */
const REFRESH_DELAY_MS = 150;
const RESOLVE_DELAY_MS = 120;
const PAGE = 8;
const LINES_BACK = 60;
const TOAST_ID = 'language-completion';
const MAX_COMPLETION_CHARACTERS = 2_000_000;
const MAX_COMPLETION_RANGES = 1_000;

class CompletionLimitError extends Error {}

function mapCompletionEdits(
    item: CompletionItem,
    changes: readonly EditorContentChange[],
    mapRange: (range: EditorRange) => EditorRange
): CompletionItem | null {
    // Changes apply one after another, so each is checked against the range as the earlier ones left it.
    const overlapsChange = (range: EditorRange): boolean => {
        let { start, end } = range;
        for (const change of changes) {
            if (comparePositions(start, change.range.end) < 0 && comparePositions(change.range.start, end) < 0) {
                return true;
            }
            start = shiftPosition(start, change);
            end = shiftPosition(end, change);
        }
        return false;
    };
    let valid = true;
    const map = (range: EditorRange): EditorRange => {
        valid &&= !overlapsChange(range);
        return mapRange(range);
    };
    const edit = item.textEdit;
    const mapped = {
        ...item,
        ...(edit === undefined
            ? {}
            : { textEdit: 'range' in edit ? { ...edit, range: map(edit.range) } : { ...edit, insert: map(edit.insert), replace: map(edit.replace) } }),
        ...(item.additionalTextEdits === undefined
            ? {}
            : { additionalTextEdits: item.additionalTextEdits.map((edit) => ({ ...edit, range: map(edit.range) })) })
    };
    return valid ? mapped : null;
}

/*
 * The suggestions that open while a word is typed. A single typed identifier character or a trigger
 * character of the server asks for the list; every character after that only filters the list that
 * is already there, unless the server called it incomplete. Enter inserts, Tab replaces, Escape closes.
 */
export class CompletionFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private pool: readonly CompletionItem[] = [];
    private incomplete = false;
    private ranked: readonly Ranked[] = [];
    private active = 0;
    /* Whether the person moved in the list; until then the active row is the best match, whatever the typing does to the list. */
    private touched = false;
    private activeKey: string | null = null;
    /* Asked for with the keyboard, which is as good as moving in the list when a commit character is typed. */
    private explicit = false;
    private detailsOpen = true;
    private start: EditorPosition | null = null;
    private server = '';
    private request = 0;
    private controller: AbortController | null = null;
    private requestTimer: unknown;
    private refreshTimer: unknown;
    private resolveTimer: unknown;
    private textRevision = 0;
    private acceptSequence = 0;
    private disposed = false;
    private readonly resolved = new Map<CompletionItem, CompletionItem>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => this.key(event)),
            editor.onTextChange((change) => this.edited(change)),
            editor.onCaret((position) => this.caretMoved(position)),
            editor.onBlur(() => {
                this.acceptSequence++;
                this.close();
            })
        ];
        language.onDispose(() => {
            this.disposed = true;
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.language.popups.getState().completion !== null;
    }

    /* Asks for suggestions at the caret now, as Ctrl+Space does. */
    invoke(): void {
        this.language.pick.close();
        this.explicit = true;
        this.beginRequest({ triggerKind: 1 }, 0);
    }

    move(delta: number): void {
        if (this.ranked.length === 0) {
            return;
        }
        const last = this.ranked.length - 1;
        // One step past either end goes round, a page does not.
        this.active = Math.abs(delta) === 1 ? (this.active + delta + last + 1) % (last + 1) : Math.max(0, Math.min(last, this.active + delta));
        this.touched = true;
        this.publish();
        this.scheduleResolve();
    }

    /* Picks a row by a click or a key. It never rejects: a failure is told to the person, so a caller can leave the promise alone. */
    async accept(replace: boolean, index = this.active, commit?: string): Promise<void> {
        try {
            await this.insert(replace, index, commit);
        } catch (error) {
            const { project } = this.language;
            project.host.notify?.({ id: TOAST_ID, kind: 'error', title: project.i18n.t('editor:language.completion.failed', { message: messageOf(error) }) });
        }
    }

    private async insert(replace: boolean, index: number, commit: string | undefined): Promise<void> {
        const entry = this.ranked[index];
        if (entry === undefined) {
            return;
        }
        const { editor, project, uri, snippets } = this.language;
        const acceptSequence = ++this.acceptSequence;
        const snippetToken = snippets.token;
        const inSnippet = snippets.isActive;
        const exitChanges: { changes: readonly EditorContentChange[]; map: (range: EditorRange) => EditorRange }[] = [];
        if (snippets.hasPendingTransforms) {
            this.close();
            if (
                !(await snippets.settleTransforms(
                    () => !this.disposed && acceptSequence === this.acceptSequence && snippets.token === snippetToken,
                    (changes, map) => exitChanges.push({ changes, map })
                ))
            ) {
                return;
            }
        }
        const acceptedSelections = editor.getSelections();
        const revision = this.textRevision;
        const current = (): boolean => {
            if (this.disposed || acceptSequence !== this.acceptSequence || revision !== this.textRevision || (inSnippet && snippets.token !== snippetToken)) {
                return false;
            }
            const selections = editor.getSelections();
            return (
                selections.length === acceptedSelections.length &&
                selections.every(
                    (range, index) =>
                        comparePositions(range.start, acceptedSelections[index]!.start) === 0 &&
                        comparePositions(range.end, acceptedSelections[index]!.end) === 0
                )
            );
        };
        recentChoicesOf(this.language.languageId).record(entry.item);
        let item = this.resolved.get(entry.item) ?? entry.item;
        const needsResolve = !this.resolved.has(entry.item) && project.service.providerOptions('completionItem/resolve', uri) !== undefined;
        this.close();
        if (needsResolve) {
            // Resolving can add the import an item needs; an item that cannot be resolved is still inserted as it is.
            item = await this.resolveNow(entry.item);
        }
        if (!current()) {
            return;
        }
        for (const { changes, map } of exitChanges) {
            const mapped = mapCompletionEdits(item, changes, map);
            if (mapped === null) {
                return;
            }
            item = mapped;
        }
        const caret = editor.getCaret();
        const lineBefore = textBeforeOf(editor, caret);
        const lineAfter = editor.textInRange({ start: caret, end: { line: caret.line, character: Number.MAX_SAFE_INTEGER } });
        const carets = editor.getSelections();
        const source = item.textEdit?.newText ?? item.insertText ?? item.label;
        if (source.length * carets.length > MAX_COMPLETION_CHARACTERS) {
            this.refuseLargeCompletion();
            return;
        }
        let characters = 0;
        let ranges = 0;
        const now = new Date();
        const template = item.insertTextFormat === 2 ? compileSnippet(item.textEdit?.newText ?? item.insertText ?? item.label) : undefined;
        const finishes = new Map<Insertion, (values: readonly string[]) => Insertion>();
        const renderAt = (position: EditorPosition, selection: EditorRange): Insertion => {
            const line = editor.textInRange({ start: { line: position.line, character: 0 }, end: { line: position.line, character: Number.MAX_SAFE_INTEGER } });
            const word = wordRangeAt(line, position);
            const resolver = createSnippetResolver(
                {
                    uri,
                    languageId: this.language.languageId,
                    position,
                    selection,
                    selectedText: editor.textInRange(selection),
                    currentLine: line,
                    currentWord: word === null ? '' : editor.textInRange(word),
                    cursorIndex: Math.max(
                        0,
                        carets.findIndex((range) => comparePositions(range.start, selection.start) === 0 && comparePositions(range.end, selection.end) === 0)
                    ),
                    cursorCount: carets.length,
                    folder: project.host.folder,
                    path: fileUriToPath(uri) ?? project.host.pathOfUri?.(uri) ?? undefined
                },
                project.host.resolveSnippetVariable?.bind(project.host),
                { now }
            );
            const atItem =
                position === caret || item.textEdit === undefined
                    ? item
                    : { ...item, textEdit: undefined, insertText: item.textEdit?.newText ?? item.insertText };
            const editStart = editRangeOf(atItem, replace)?.start;
            // A commit character follows the name, so accepting must not also add a call.
            const finish = (variableTransforms?: readonly string[]): Insertion => {
                const insertion = insertionOf(
                    atItem,
                    position,
                    line.slice(0, position.character),
                    replace,
                    commit === undefined ? line.slice(position.character) : '(',
                    {
                        template,
                        variableTransforms,
                        resolve: resolver,
                        indentationBefore:
                            editStart === undefined ? undefined : editor.textInRange({ start: { line: editStart.line, character: 0 }, end: editStart })
                    }
                );
                return commit === undefined ? insertion : { ...insertion, text: insertion.text + commit };
            };
            const rendered = finish();
            finishes.set(rendered, finish);
            characters += rendered.text.length;
            ranges +=
                (rendered.variableTransforms?.length ?? 0) +
                (rendered.fields?.reduce((count, field) => count + field.ranges.length + (field.linked?.length ?? 0), 1) ?? rendered.stops.length);
            if (rendered.limited || characters > MAX_COMPLETION_CHARACTERS || ranges > MAX_COMPLETION_RANGES) {
                throw new CompletionLimitError();
            }
            return rendered;
        };
        try {
            const planned = renderAt(caret, editor.getSelection());
            const { before, rest } = this.surroundings(planned, caret, lineAfter);
            const plan: CallPlan =
                commit === undefined ? planCall({ item, languageId: this.language.languageId, insertion: planned, before, rest, replace }) : { action: 'none' };
            let main = plan.action === 'add' ? withParentheses(planned, plan.inside) : planned;
            const extras = (item.additionalTextEdits ?? []).map((edit): EditorContentChange => ({ range: edit.range, text: edit.newText }));
            const instances = new Map<EditorContentChange, Insertion>();
            const continuing = inSnippet && snippets.isActive && snippetToken === snippets.token;
            const mirrored = mirroredInsertions(carets, editor.getSelection(), caret, (range) => editor.textInRange(range), main, continuing).map(
                (insertion) => {
                    const selection = carets.find(
                        (range) =>
                            range.start.line === insertion.range.start.line &&
                            range.start.character >= insertion.range.start.character &&
                            range.start.character <= insertion.range.end.character
                    )!;
                    const position = selection[continuing ? 'end' : 'start'];
                    const own = renderAt(position, selection);
                    const rendered = plan.action === 'add' ? withParentheses(own, plan.inside) : own;
                    const edit = { ...insertion, text: rendered.text };
                    const instance = { ...rendered, range: insertion.range };
                    instances.set(edit, instance);
                    const finish = finishes.get(own);
                    if (finish !== undefined) {
                        finishes.set(instance, (values) => ({ ...finish(values), range: insertion.range }));
                    }
                    return edit;
                }
            );
            const drafts = [...mirrored.map((edit) => instances.get(edit)!), main];
            const jobs: SnippetTransformJob[] = [];
            const keys = new Map<string, number>();
            const slots = drafts.map((draft) =>
                (draft.variableTransforms ?? []).map((job) => {
                    const key = JSON.stringify(job);
                    let slot = keys.get(key);
                    if (slot === undefined) {
                        slot = jobs.length;
                        keys.set(key, slot);
                        jobs.push(job);
                    }
                    return slot;
                })
            );
            if (jobs.length > MAX_TRANSFORM_JOBS || jobs.reduce((sum, job) => sum + job.value.length, 0) > MAX_TRANSFORM_WORK) {
                throw new CompletionLimitError();
            }
            if (jobs.length > 0 && project.host.snippetTransformWorker !== undefined) {
                const values = await snippets.transformVariables(jobs, current);
                if (!current()) {
                    return;
                }
                if (values !== null) {
                    const transformed = drafts.map((draft, index) =>
                        slots[index]!.length === 0 ? draft : finishes.get(draft)!(slots[index]!.map((slot) => values[slot]!))
                    );
                    if (
                        transformed.some((draft) => draft.limited) ||
                        transformed.reduce((sum, draft) => sum + draft.text.length, 0) > MAX_COMPLETION_CHARACTERS
                    ) {
                        throw new CompletionLimitError();
                    }
                    main = transformed.at(-1)!;
                    mirrored.forEach((edit, index) => {
                        edit.text = transformed[index]!.text;
                        instances.set(edit, transformed[index]!);
                    });
                }
            }
            const primary = { range: main.range, text: main.text };
            const changes = [primary, ...mirrored, ...extras];
            if (changes.reduce((total, edit) => total + edit.text.length, 0) > MAX_COMPLETION_CHARACTERS) {
                throw new CompletionLimitError();
            }
            // Imports and earlier carets move each insertion independently; the primary instance stays last.
            const starts = [...mirrored, primary].map((insertion) =>
                changes
                    .filter((change) => change !== insertion && comparePositions(change.range.end, insertion.range.start) <= 0)
                    .sort((left, right) => comparePositions(right.range.start, left.range.start))
                    .reduce((place, change) => shiftPosition(place, change), insertion.range.start)
            );
            const applied = inSnippet ? snippets.applyEdits(changes, snippetToken, extras) : editor.applyEdits(changes);
            if (!applied) {
                return;
            }
            const landed = editor.getSelections();
            if (commit === undefined) {
                this.language.snippets.beginInstances(
                    [...mirrored, primary].map((insertion, index) => {
                        const rendered = insertion === primary ? main : instances.get(insertion)!;
                        return { start: starts[index]!, text: rendered.text, stops: rendered.stops, fields: rendered.fields };
                    }),
                    { nested: continuing && snippets.isActive }
                );
                if (plan.action === 'add' && plan.inside && mirrored.length > 0 && main.fields === undefined) {
                    this.placeMirroredCarets(carets, mirrored, landed);
                }
                if (plan.action === 'enter') {
                    const end = editor.getCaret();
                    editor.setCaret({ line: end.line, character: end.character + plan.shift });
                }
            } else {
                if (this.triggerCharacters().includes(commit)) {
                    this.beginRequest({ triggerKind: 2, triggerCharacter: commit }, 0);
                }
            }
            this.afterInsert(item, commit, lineBefore);
            editor.focus();
        } catch (error) {
            if (!current()) {
                return;
            }
            if (error instanceof SnippetTransformQueueError) {
                project.host.notify?.({ id: TOAST_ID, kind: 'error', title: project.i18n.t('editor:language.completion.transformBusy') });
            } else if (error instanceof CompletionLimitError || (error instanceof SnippetTransformError && error.kind === 'range')) {
                this.refuseLargeCompletion();
            } else if (error instanceof SnippetTransformError) {
                project.host.notify?.({ id: TOAST_ID, kind: 'error', title: project.i18n.t('editor:language.completion.transformFailed') });
            } else {
                throw error;
            }
        }
    }

    private refuseLargeCompletion(): void {
        this.language.project.host.notify?.({ id: TOAST_ID, kind: 'error', title: this.language.project.i18n.t('editor:language.completion.tooLarge') });
    }

    /* The carets that got the same `()` go inside it like the primary one, which the snippet already placed. */
    private placeMirroredCarets(before: readonly EditorRange[], mirrored: readonly EditorContentChange[], landed: readonly EditorRange[]): void {
        const { editor } = this.language;
        const primary = before.length - 1;
        const selections = landed.map((range, index): EditorRange => {
            const caret = before[index]!.start;
            const got = mirrored.some(
                (edit) => edit.range.start.line === caret.line && edit.range.start.character <= caret.character && caret.character <= edit.range.end.character
            );
            if (index === primary || !got) {
                return range;
            }
            const stop = { line: range.end.line, character: range.end.character - 1 };
            return { start: stop, end: stop };
        });
        selections[primary] = editor.getSelection();
        editor.setSelections(selections);
    }

    /* The lines above the insertion down to where it starts, and the rest of the line past what it replaces. */
    private surroundings(insertion: Insertion, caret: EditorPosition, lineAfter: string): { before: string; rest: string } {
        const { editor } = this.language;
        const { start, end } = insertion.range;
        const before = editor.textInRange({ start: { line: Math.max(0, start.line - LINES_BACK), character: 0 }, end: start });
        const rest = end.line === caret.line ? lineAfter.slice(Math.max(0, end.character - caret.character)) : '';
        return { before, rest };
    }

    /* Parameter info for a call that was opened (or that the server asks for), then the item's own command. */
    private afterInsert(item: CompletionItem, commit: string | undefined, lineBefore: string): void {
        const { editor, project, uri, signature } = this.language;
        const { start } = editor.getSelection();
        const insideCall = start.character > 0 && editor.textInRange({ start: { line: start.line, character: start.character - 1 }, end: start }) === '(';
        if (commit === '(' || (insideCall && isCallItem(item, lineBefore))) {
            signature.trigger();
        }
        const { command } = item;
        if (command === undefined) {
            return;
        }
        if (command.command === PARAMETER_HINTS_COMMAND) {
            signature.trigger();
        } else {
            project.service.executeCommand(uri, command).catch(() => undefined);
        }
    }

    /*
     * Resolving gives the item its documentation and the import it needs, but only for the text it was
     * made for. When the person typed on since, the list is asked for again at the new text and the same
     * suggestion is resolved in that one; an item that cannot be resolved is still inserted as it is.
     */
    private async resolveNow(item: CompletionItem): Promise<CompletionItem> {
        const { editor, project, uri } = this.language;
        try {
            return { ...item, ...(await project.service.resolveCompletion(uri, item)) };
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                return item;
            }
        }
        try {
            const fresh = itemsOf(await project.service.completion(uri, editor.getCaret(), { triggerKind: 1 })).items.find(
                (candidate) => candidate.label === item.label && candidate.kind === item.kind
            );
            return fresh === undefined ? item : { ...fresh, ...(await project.service.resolveCompletion(uri, fresh).catch(() => fresh)) };
        } catch {
            return item;
        }
    }

    close(): void {
        this.request++;
        this.controller?.abort();
        this.timers.clear(this.requestTimer);
        this.timers.clear(this.refreshTimer);
        this.timers.clear(this.resolveTimer);
        this.pool = [];
        this.ranked = [];
        this.touched = false;
        this.explicit = false;
        this.activeKey = null;
        this.start = null;
        this.resolved.clear();
        if (this.language.popups.getState().completion !== null) {
            this.language.popups.setState({ completion: null });
        }
    }

    private key(event: KeyboardEvent): boolean {
        if (isShortcut(this.language.shortcuts.triggerCompletion, event)) {
            if (this.isOpen) {
                this.detailsOpen = !this.detailsOpen;
                this.publish();
            } else {
                this.invoke();
            }
            return true;
        }
        if (!this.isOpen || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        if (this.commits(event)) {
            void this.accept(false, this.active, event.key);
            return true;
        }
        switch (event.key) {
            case 'ArrowDown':
                this.move(1);
                return true;
            case 'ArrowUp':
                this.move(-1);
                return true;
            case 'PageDown':
                this.move(PAGE);
                return true;
            case 'PageUp':
                this.move(-PAGE);
                return true;
            case 'Enter':
            case 'Tab':
                if (event.shiftKey) {
                    return false;
                }
                void this.accept(event.key === 'Tab');
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    /* A character the active item commits on, typed once the person has moved in the list or asked for it, which is when Enter would not be the way they chose. */
    private commits(event: KeyboardEvent): boolean {
        if ((!this.touched && !this.explicit) || event.key.length !== 1 || event.isComposing) {
            return false;
        }
        return this.ranked[this.active]?.item.commitCharacters?.includes(event.key) === true;
    }

    private edited(change: EditorTextChange): void {
        this.textRevision++;
        if (change.source !== 'input' || change.changes.length !== 1) {
            this.close();
            return;
        }
        const { range, text } = change.changes[0]!;
        const triggers = this.triggerCharacters();
        const last = Array.from(text).at(-1) ?? '';
        const typedIdentifier = text !== '' && Array.from(text).every(isIdentifierCharacter);
        if (text.length === 1 && triggers.includes(last)) {
            this.close();
            this.beginRequest({ triggerKind: 2, triggerCharacter: last }, 0);
        } else if (isEmptyRange(range) && opensCompletion(textBeforeOf(this.language.editor, range.start), text)) {
            this.close();
            this.beginRequest({ triggerKind: 1 }, START_DELAY_MS);
        } else if (this.isOpen) {
            if (text === '' || typedIdentifier) {
                this.refilter();
                this.scheduleRefresh();
            } else {
                this.close();
            }
        } else if (text.length === 1 && typedIdentifier && isEmptyRange(range)) {
            this.beginRequest({ triggerKind: 1 }, START_DELAY_MS);
        }
    }

    private caretMoved(position: EditorPosition): void {
        if (this.start === null) {
            return;
        }
        if (position.line !== this.start.line || position.character < this.start.character) {
            this.close();
        } else {
            this.refilter();
        }
    }

    private triggerCharacters(): readonly string[] {
        const { project, uri } = this.language;
        return project.service.providerOptions(METHOD, uri)?.triggerCharacters ?? [];
    }

    private scheduleRefresh(): void {
        const { project, uri } = this.language;
        this.timers.clear(this.refreshTimer);
        if (this.start === null || !project.service.supports(METHOD, uri)) {
            return;
        }
        const request = this.request;
        this.refreshTimer = this.timers.set(() => {
            if (request === this.request && this.start !== null) {
                void this.ask({ triggerKind: 1 }, request, true);
            }
        }, REFRESH_DELAY_MS);
    }

    private beginRequest(context: CompletionContext, delay: number): void {
        const { project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            return;
        }
        this.timers.clear(this.requestTimer);
        const request = ++this.request;
        this.requestTimer = this.timers.set(() => void this.ask(context, request), delay);
    }

    private async ask(context: CompletionContext, request: number, refresh = false): Promise<void> {
        const { editor, project, uri } = this.language;
        const position = editor.getCaret();
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        let normalized: ReturnType<typeof itemsOf>;
        try {
            const result = await project.service.completion(uri, position, context, { signal: controller.signal });
            if (request !== this.request || this.controller !== controller || controller.signal.aborted) {
                return;
            }
            normalized = itemsOf(result);
        } catch {
            if (request === this.request && this.controller === controller && !controller.signal.aborted) {
                this.close();
            }
            return;
        }
        const { items, incomplete } = normalized;
        this.pool = items;
        this.incomplete = incomplete;
        this.resolved.clear();
        this.server = project.host.serverNames?.(uri)[0] ?? '';
        if (!refresh) {
            const caret = editor.getCaret();
            const lineBefore = textBeforeOf(editor, caret);
            const prefix = context.triggerKind === 2 ? '' : identifierPrefix(lineBefore);
            this.start = { line: caret.line, character: caret.character - prefix.length };
            this.active = 0;
            this.touched = false;
        } else if (this.touched && this.ranked[this.active] !== undefined) {
            // The list is made again, so the row that was chosen is found again by what it says.
            this.activeKey = RecentChoices.keyOf(this.ranked[this.active]!.item);
        }
        const asked = this.explicit && !refresh;
        this.refilter();
        if (asked && !this.isOpen && !this.incomplete) {
            this.language.project.host.notify?.({ id: TOAST_ID, kind: 'error', title: this.language.project.i18n.t('editor:language.completion.none') });
        } else if (asked && this.ranked.length === 1 && !this.incomplete) {
            // One answer to a list that was asked for is the one wanted.
            void this.accept(false, 0);
        }
    }

    private refilter(): void {
        const { editor } = this.language;
        const caret = editor.getCaret();
        if (this.start === null || caret.line !== this.start.line || caret.character < this.start.character) {
            this.close();
            return;
        }
        const lineBefore = textBeforeOf(editor, caret);
        // Most items of a list replace the same range, so the text under it is read once and not once per item.
        const typed = new Map<string, string>();
        const textBetween = (range: EditorRange): string => {
            const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            let text = typed.get(key);
            if (text === undefined) {
                text = editor.textInRange(range);
                typed.set(key, text);
            }
            return text;
        };
        const before = this.ranked[this.active]?.item;
        const recent = recentChoicesOf(this.language.languageId);
        this.ranked = rankCompletions(
            this.pool,
            (item) => prefixFor(item, caret, lineBefore, textBetween),
            (item) => recent.recency(item)
        );
        if (this.ranked.length === 0) {
            if (this.incomplete && this.pool.length > 0) {
                this.beginRequest({ triggerKind: 3 }, START_DELAY_MS);
            }
            this.close();
            return;
        }
        const key = this.activeKey ?? (this.touched && before !== undefined ? RecentChoices.keyOf(before) : null);
        this.activeKey = null;
        const kept = key === null ? -1 : this.ranked.findIndex((entry) => RecentChoices.keyOf(entry.item) === key);
        this.active = kept >= 0 ? kept : 0;
        this.touched = this.touched && kept >= 0;
        this.publish();
        this.scheduleResolve();
        if (this.incomplete) {
            this.beginRequest({ triggerKind: 3 }, START_DELAY_MS);
        }
    }

    private scheduleResolve(): void {
        const { project, uri } = this.language;
        this.timers.clear(this.resolveTimer);
        const entry = this.ranked[this.active];
        if (entry === undefined || this.resolved.has(entry.item) || project.service.providerOptions('completionItem/resolve', uri) === undefined) {
            return;
        }
        this.resolveTimer = this.timers.set(() => {
            void project.service
                .resolveCompletion(uri, entry.item)
                .then((item) => {
                    this.resolved.set(entry.item, { ...entry.item, ...item });
                    if (this.ranked[this.active]?.item === entry.item) {
                        this.publish();
                    }
                })
                .catch(() => undefined);
        }, RESOLVE_DELAY_MS);
    }

    private publish(): void {
        const entry = this.ranked[this.active];
        if (entry === undefined || this.start === null) {
            return;
        }
        const item = this.resolved.get(entry.item) ?? entry.item;
        const descriptions = qualifiersOf(this.ranked.map((ranked) => ranked.item));
        const rows: CompletionRow[] = this.ranked.map(({ item: row, prefix }, index) => ({
            label: row.label,
            kind: row.kind,
            detail: row.labelDetails?.detail ?? '',
            description: descriptions[index]!,
            matches: matchedCharacters(row.label, prefix),
            deprecated: row.deprecated === true || row.tags?.includes(1) === true
        }));
        const highlightLanguage = shikiLanguageOf(this.language.languageId);
        const view: CompletionView = {
            anchor: this.start,
            rows,
            active: this.active,
            detailsOpen: this.detailsOpen,
            docs: completionDocsOf(item, highlightLanguage),
            server: this.server,
            highlightLanguage
        };
        this.language.popups.setState({ completion: view });
    }
}
