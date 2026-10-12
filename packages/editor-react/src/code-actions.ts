import { ErrorCodes, LspError, StaleResultError, type CodeAction, type Command, type Diagnostic, type Position } from '@adecore/lsp';
import type { EditorPosition, EditorRange } from '@adecore/editor';
import {
    ACTION_GROUPS,
    REFACTOR_GROUPS,
    actionsOf,
    diagnosticsAt,
    fixableOnLine,
    isHint,
    mergeEntries,
    previewOf,
    type ActionEntry,
    type ActionGroup
} from './code-actions-model.ts';
import type { Problem } from './diagnostics-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import type { PickGroup, PickPreview } from './popups.ts';
import { Refresher } from './refresher.ts';
import { isShortcut } from './shortcut-keys.ts';
import { realTimers, type Timers } from './timers.ts';
import { messageOf } from './error-message.ts';

const METHOD = 'textDocument/codeAction';
const PAUSE_MS = 250;
const INVOKED = 1;
const AUTOMATIC = 2;
const TOAST_ID = 'language-action';
/* How many problems of the line are asked for their fixes besides the caret's own request. */
const LINE_PROBLEMS = 3;
/* The command of the PHP server that asks the client to rename the name a refactor just wrote; the server answers it with nothing. */
const INLINE_RENAME_COMMAND = 'php.rename';

/* A server that would not make the action, with its reason. */
class ActionRefused extends Error {}

function isRefusal(error: unknown): boolean {
    return error instanceof LspError && error.code === ErrorCodes.InternalError;
}

interface RequestOptions {
    readonly only?: readonly string[];
    readonly signal?: AbortSignal;
    /* The problems the actions are about; the ones touching the range when absent. */
    readonly about?: readonly Diagnostic[];
    readonly order?: readonly ActionGroup[];
}

interface AskOptions {
    readonly range: EditorRange;
    readonly only?: readonly string[];
    readonly anchor: EditorPosition;
    /* The problems the actions are about; the ones touching the range when absent. */
    readonly diagnostics?: readonly Diagnostic[];
    /* Also the fixes of a problem on the line when none touches the range. */
    readonly withLine?: boolean;
    /* The groups the list shows, in order; the quick fix list's own by default. */
    readonly groups?: readonly ActionGroup[];
}

/*
 * What the servers offer at the caret or the selection: the gutter's lightbulb, the list under the caret
 * with a preview of each change, a problem's Quick fix, organize imports and format. An action is resolved
 * before it is applied, since a server fills in its edit only when asked for it.
 */
export class CodeActionsFeature {
    private readonly language: EditorLanguage;
    private readonly refresher: Refresher;
    /* While a list is being asked for, the lightbulb waits: both are the same request and the newer one would cancel the older. */
    private asking = false;
    private readonly resolved = new Map<ActionEntry, CodeAction>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        const { editor } = language;
        this.refresher = new Refresher((signal) => this.hint(signal), PAUSE_MS, timers);
        const providers = language.onProvidersChanged(() => {
            this.refresher.later();
        });
        const offs = [
            editor.onCaret(() => {
                editor.setGutterAction(null);
                this.refresher.later();
            }),
            editor.onTextChange(() => editor.setGutterAction(null)),
            editor.onGutterAction(() => void this.open()),
            editor.onKeyDown((event) => {
                if (isShortcut(this.language.shortcuts.codeActions, event)) {
                    void this.open();
                    return true;
                }
                if (isShortcut(this.language.shortcuts.refactorThis, event)) {
                    void this.refactorThis();
                    return true;
                }
                return false;
            }),
            language.diagnostics.onChange(() => this.refresher.later()),
            providers
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.refresher.dispose();
            editor.setGutterAction(null);
        });
    }

    get supported(): boolean {
        return this.language.project.service.supports(METHOD, this.language.uri);
    }

    /* The list under the caret, or under the selection's start. */
    open(): Promise<void> {
        const range = this.language.editor.getSelection();
        return this.ask({ range, anchor: range.start, withLine: true });
    }

    /* Refactor This: only the refactorings, grouped by what they do, under the caret or the selection. */
    refactorThis(): Promise<void> {
        const range = this.language.editor.getSelection();
        return this.ask({ range, only: ['refactor'], anchor: range.start, groups: REFACTOR_GROUPS });
    }

    /* The quick fixes of one problem, under it, as the Quick fix button of its card asks. */
    quickFixFor(problem: Problem): Promise<void> {
        const { range } = problem.diagnostic;
        return this.ask({ range, only: ['quickfix'], anchor: range.start, diagnostics: [problem.diagnostic] });
    }

    async organizeImports(): Promise<void> {
        const { editor } = this.language;
        const everything = { start: { line: 0, character: 0 }, end: editor.positionAt(Number.MAX_SAFE_INTEGER) };
        const entries = await this.request(everything, INVOKED, { only: ['source.organizeImports'] });
        const entry = entries?.find((candidate) => candidate.action.kind?.startsWith('source.organizeImports') === true);
        if (entry === undefined) {
            this.tell('success', this.say(entries === null ? 'unavailable' : 'organized'));
            return;
        }
        await this.apply(entry);
    }

    async formatDocument(): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports('textDocument/formatting', uri)) {
            this.tell('error', this.say('noFormatter'));
            return;
        }
        try {
            const edits = await project.service.formatting(uri, { ...editor.getIndentation() });
            if (edits !== null && edits.length > 0 && !editor.applyEdits(edits.map((edit) => ({ range: edit.range, text: edit.newText })))) {
                this.tell('error', this.say('readOnly'));
            }
        } catch (error) {
            this.fail(error);
        }
    }

    /* The actions of one kind for the selection, as entries a menu can list and `apply` runs. */
    list(only: readonly string[]): Promise<ActionEntry[] | null> {
        if (!this.supported) {
            return Promise.resolve(null);
        }
        return this.request(this.language.editor.getSelection(), AUTOMATIC, { only, order: only.includes('refactor') ? REFACTOR_GROUPS : ACTION_GROUPS });
    }

    private async ask(options: AskOptions): Promise<void> {
        if (!this.supported) {
            this.tell('error', this.say('unavailable'));
            return;
        }
        // The press on a card or the gutter may have taken the focus, and the list answers to the editor's keys.
        this.language.editor.focus();
        this.asking = true;
        let entries: ActionEntry[] | null;
        try {
            entries = options.withLine
                ? await this.requestWithLine(options.range, INVOKED)
                : await this.request(options.range, INVOKED, { only: options.only, about: options.diagnostics, order: options.groups });
        } finally {
            this.asking = false;
        }
        if (entries === null) {
            return;
        }
        if (entries.length === 0) {
            this.tell('success', this.say('none'));
            return;
        }
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        const groups: PickGroup[] = (options.groups ?? ACTION_GROUPS).flatMap((group): PickGroup[] => {
            const rows = entries.filter((entry) => entry.group === group).map((entry) => ({ id: entry.id, label: entry.action.title, detail: '' }));
            return rows.length === 0 ? [] : [{ title: this.say(`groups.${group}`), rows }];
        });
        this.language.completion.close();
        this.language.pick.open({
            anchor: options.anchor,
            groups,
            accept: (id) => {
                const entry = byId.get(id);
                if (entry !== undefined) {
                    void this.apply(entry);
                }
            },
            attempt: (id) => this.refusalOf(byId.get(id)),
            preview: (id, signal) => this.preview(byId.get(id), signal)
        });
    }

    /* Asks the servers; null when they could not answer, with the reason said aloud for a request a person made. */
    private async request(range: EditorRange, triggerKind: number, options: RequestOptions = {}): Promise<ActionEntry[] | null> {
        const { project, uri, diagnostics } = this.language;
        const { only, signal, order } = options;
        try {
            const about =
                options.about ??
                diagnosticsAt(
                    diagnostics.problems.map((problem) => problem.diagnostic),
                    range
                );
            const context = {
                diagnostics: [...about],
                ...(only ? { only: [...only] } : {}),
                triggerKind: triggerKind as 1 | 2
            };
            const entries = actionsOf(await project.service.codeActions(uri, range, context, { signal }), order);
            // A server may answer with more than the kinds asked for.
            return only ? entries.filter((entry) => only.some((kind) => entry.action.kind === kind || entry.action.kind?.startsWith(`${kind}.`))) : entries;
        } catch (error) {
            if (triggerKind === INVOKED) {
                this.fail(error);
            }
            return null;
        }
    }

    /*
     * What the servers offer at the range, and when no problem touches it, the quick fixes of the problems
     * elsewhere on its line too, since the fix of an error is wanted from anywhere on the line it is on.
     */
    private async requestWithLine(range: EditorRange, triggerKind: number, signal?: AbortSignal): Promise<ActionEntry[] | null> {
        const entries = await this.request(range, triggerKind, { signal });
        if (entries === null || range.start.line !== range.end.line) {
            return entries;
        }
        const all = this.language.diagnostics.problems.map((problem) => problem.diagnostic);
        if (diagnosticsAt(all, range).length > 0) {
            return entries;
        }
        const onLine = fixableOnLine(all, range.start.line).slice(0, LINE_PROBLEMS);
        const fixes = await Promise.all(
            onLine.map((diagnostic) => this.request(diagnostic.range, triggerKind, { only: ['quickfix'], signal, about: [diagnostic] }))
        );
        return mergeEntries([entries, ...fixes.map((list) => list ?? [])]);
    }

    private async hint(signal: AbortSignal): Promise<void> {
        const { editor } = this.language;
        if (this.asking || !this.supported) {
            editor.setGutterAction(null);
            return;
        }
        const range = editor.getSelection();
        const entries = await this.requestWithLine(range, AUTOMATIC, signal);
        if (signal.aborted || this.asking) {
            return;
        }
        editor.setGutterAction(entries?.some(isHint) === true ? { line: editor.getCaret().line, label: this.say('show') } : null);
    }

    private async resolve(entry: ActionEntry, signal?: AbortSignal): Promise<CodeAction> {
        const known = this.resolved.get(entry);
        if (known !== undefined) {
            return known;
        }
        const { project, uri } = this.language;
        const { action } = entry;
        let result = action;
        if (action.edit === undefined && project.service.providerOptions(METHOD, uri)?.resolveProvider === true) {
            try {
                result = await project.service.resolveCodeAction(uri, action, { signal });
            } catch (error) {
                if (isRefusal(error)) {
                    throw new ActionRefused((error as Error).message);
                }
                // An action the server cannot resolve is still tried as it is, unless the text moved under it.
                if (error instanceof StaleResultError) {
                    throw error;
                }
            }
        }
        this.resolved.set(entry, result);
        return result;
    }

    private async preview(entry: ActionEntry | undefined, signal: AbortSignal): Promise<PickPreview | null> {
        if (entry === undefined) {
            return null;
        }
        let action: CodeAction;
        try {
            action = await this.resolve(entry, signal);
        } catch (error) {
            if (error instanceof ActionRefused) {
                return { removed: [], added: [], note: null, refusal: error.message };
            }
            throw error;
        }
        const { editor, uri } = this.language;
        const found = action.edit === undefined ? null : previewOf(editor.getText(), action.edit, uri);
        if (found === null) {
            return null;
        }
        const notes = [
            ...(found.hiddenLines > 0 ? [this.say('moreLines', { count: found.hiddenLines })] : []),
            ...(found.otherFiles > 0 ? [this.say('otherFiles', { count: found.otherFiles })] : []),
            ...(found.moves > 0 ? [this.say('moves', { count: found.moves })] : []),
            ...((found.creates ?? 0) > 0 ? [this.say('creates', { count: found.creates })] : []),
            ...((found.deletes ?? 0) > 0 ? [this.say('deletes', { count: found.deletes })] : [])
        ];
        return { removed: found.removed, added: found.added, note: notes.length === 0 ? null : notes.join(' · ') };
    }

    /* Why a server would not make the action, or null when it will, which resolves it for `apply` to use. */
    private async refusalOf(entry: ActionEntry | undefined): Promise<string | null> {
        if (entry === undefined) {
            return null;
        }
        try {
            await this.resolve(entry);
            return null;
        } catch (error) {
            return error instanceof ActionRefused ? error.message : null;
        }
    }

    /* Resolves the action, makes its edit as one undo step, and then runs its command. */
    async apply(entry: ActionEntry): Promise<void> {
        const { editor, project, uri } = this.language;
        try {
            const action = await this.resolve(entry);
            if (action.edit !== undefined) {
                const result = await project.applyWorkspaceEdit(action.edit);
                if (!result.applied) {
                    this.tell('error', this.say('failed', { message: result.failureReason ?? this.say('refused') }));
                    return;
                }
            }
            if (action.command?.command === INLINE_RENAME_COMMAND) {
                await this.startRename(action.command);
            } else if (action.command !== undefined) {
                await project.service.executeCommand(uri, action.command);
            }
        } catch (error) {
            this.fail(error);
        } finally {
            this.resolved.delete(entry);
            editor.focus();
        }
    }

    /* The name a refactor wrote is offered for a rename right where it stands, the way the platform does after an extraction. */
    private async startRename(command: Command): Promise<void> {
        const target = (command.arguments?.[0] ?? null) as { textDocument?: { uri?: string }; position?: Position } | null;
        if (target?.position !== undefined && target.textDocument?.uri === this.language.uri) {
            this.language.editor.setCaret(target.position);
            await this.language.rename.start();
        }
    }

    private tell(kind: 'success' | 'error', title: string): void {
        this.language.project.host.notify?.({ id: TOAST_ID, kind, title });
    }

    private fail(error: unknown): void {
        if (!(error instanceof StaleResultError)) {
            this.tell('error', this.say('failed', { message: messageOf(error) }));
        }
    }

    private say(key: string, options?: Record<string, unknown>): string {
        return this.language.project.i18n.t(`editor:language.actions.${key}`, options);
    }
}
