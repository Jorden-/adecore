import { StaleResultError, type Location, type PrepareRenameResult, type WorkspaceEdit } from '@adecore/lsp';
import { KEY_PRIORITY } from './key-priority.ts';
import type { EditorRange } from '@adecore/editor';
import type { EditorLanguage } from './editor-language.ts';
import { lineTextOf } from './line-text.ts';
import type { RenameView } from './popups.ts';
import { occurrencesOf, renameKindOf, renamePreviewOf, renameTargetOf, wordRangeAt, type RenameTarget } from './rename-model.ts';
import { isShortcut } from './shortcut-keys.ts';
import { resourceOperationsOf } from './workspace-edit.ts';
import { messageOf } from './error-message.ts';

const METHOD = 'textDocument/rename';
const TOAST_ID = 'language-rename';
/* How much is read to tell a name suggester how the symbol is used: its first places, other files and lines around it. */
const SAMPLE_LOCATIONS = 8;
const SAMPLE_OTHER_FILES = 3;
const CONTEXT_LINES = 3;

interface Session {
    readonly target: RenameTarget;
    readonly original: string;
    /* Set once the preview asked for the edit, so Enter applies exactly what was shown. */
    edit: WorkspaceEdit | null;
    /* The request for names, which ends with the rename. */
    readonly names: AbortController;
}

/*
 * Renaming a symbol. The input sits on the symbol itself, every place the name has lights up while the
 * new one is typed, Enter applies the server's edit at once and Shift+Enter lists what it would change first.
 * Edits to other files land as unsaved drafts (`applyWorkspaceEdit`), so nothing is written to disk here.
 */
export class RenameFeature {
    private readonly language: EditorLanguage;
    private session: Session | null = null;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            language.onKey((event) => {
                if (!isShortcut(this.language.shortcuts.rename, event)) {
                    return false;
                }
                void this.start();
                return true;
            }, KEY_PRIORITY.rename),
            editor.onTextChange(() => this.cancel())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.cancel();
        });
    }

    get isOpen(): boolean {
        return this.session !== null;
    }

    async start(): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            this.tell('error', this.say('unavailable'));
            return;
        }
        this.cancel();
        const caret = editor.getCaret();
        const prepare = project.service.providerOptions(METHOD, uri)?.prepareProvider === true;
        let answer: PrepareRenameResult;
        try {
            answer = prepare ? await project.service.prepareRename(uri, caret) : { defaultBehavior: true };
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                this.tell('error', this.say('nothing'));
            }
            return;
        }
        const target = renameTargetOf(
            answer,
            (range) => editor.textInRange(range),
            () => wordRangeAt(lineTextOf(editor, caret.line), caret)
        );
        if (target === null) {
            this.tell('error', this.say('nothing'));
            return;
        }
        const session: Session = { target, original: editor.textInRange(target.range), edit: null, names: new AbortController() };
        this.session = session;
        this.publish({ phase: 'input', busy: false, name: target.placeholder, files: [], operations: [], occurrences: null, suggestions: [] });
        void this.light(session).then((locations) => this.suggest(session, locations));
    }

    /* The name was typed: Enter applies it, Shift+Enter lists what it would change first. */
    async submit(name: string, preview: boolean): Promise<void> {
        const session = this.session;
        const next = name.trim();
        if (session === null) {
            return;
        }
        if (next === '' || next === session.original) {
            this.finish();
            return;
        }
        this.publish({ phase: 'input', busy: true, name: next, error: null });
        const { project, uri } = this.language;
        try {
            const edit = await project.service.rename(uri, session.target.range.start, next);
            if (this.session !== session) {
                return;
            }
            if (edit === null) {
                this.fail(this.say('refused'));
                return;
            }
            session.edit = edit;
            if (!preview) {
                await this.apply(session);
                return;
            }
            const files = await renamePreviewOf(edit, (target) => project.readText(target));
            if (this.session !== session) {
                return;
            }
            this.publish({ phase: 'preview', busy: false, name: next, files, operations: resourceOperationsOf(edit) });
        } catch (error) {
            if (this.session === session) {
                this.fail(error instanceof StaleResultError ? this.say('stale') : messageOf(error));
            }
        }
    }

    /* Applies the edit the preview showed. */
    async confirm(): Promise<void> {
        const session = this.session;
        if (session?.edit) {
            await this.apply(session);
        }
    }

    cancel(): void {
        if (this.session === null) {
            return;
        }
        this.finish();
    }

    /* The name was changed, which answers the failure under it. */
    edited(): void {
        if (this.language.popups.getState().rename?.error != null) {
            this.publish({ error: null });
        }
    }

    private async apply(session: Session): Promise<void> {
        const result = await this.language.project.applyWorkspaceEdit(session.edit!);
        if (this.session !== session) {
            return;
        }
        if (result.applied) {
            this.finish();
        } else {
            this.fail(result.failureReason ?? this.say('refused'));
        }
    }

    /* The input stays, with the reason under it, so the name can be changed and tried again. */
    private fail(message: string): void {
        if (this.session !== null) {
            this.session.edit = null;
            this.publish({ phase: 'input', busy: false, files: [], operations: [], error: this.say('failed', { message }) });
        }
    }

    private finish(): void {
        this.session?.names.abort();
        this.session = null;
        const { editor, popups } = this.language;
        popups.setState({ rename: null });
        editor.setHighlights([]);
        editor.focus();
    }

    /* Lights up the places the name has in this file, and counts them all; what the servers listed, or null when they did not. */
    private async light(session: Session): Promise<readonly Location[] | null> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports('textDocument/references', uri)) {
            return null;
        }
        try {
            const locations = await project.service.references(uri, session.target.range.start, true);
            if (this.session !== session || locations === null) {
                return null;
            }
            const found = occurrencesOf(locations, uri);
            editor.setHighlights(found.inFile.map((range: EditorRange) => ({ range, kind: 'write' as const })));
            this.publish({ occurrences: { count: found.count, files: found.files } });
            return locations;
        } catch {
            // The count is a courtesy; renaming does not wait for it.
            return null;
        }
    }

    /*
     * Names from the host suggestion provider, using the lines around the symbol and a sample of the lines that
     * use it. They only appear under the input: the name that is typed stays the one that is applied.
     */
    private async suggest(session: Session, locations: readonly Location[] | null): Promise<void> {
        const suggestNames = this.language.project.host.suggestNames;
        if (suggestNames === undefined || this.session !== session) {
            return;
        }
        const { editor, languageId, uri } = this.language;
        try {
            const line = session.target.range.start.line;
            const context = editor.textInRange({
                start: { line: Math.max(0, line - CONTEXT_LINES), character: 0 },
                end: { line: line + CONTEXT_LINES, character: Number.MAX_SAFE_INTEGER }
            });
            const [uses, kind] = await Promise.all([this.linesOf(locations ?? []), this.kindOf(session, locations ?? [])]);
            const request = { uri, languageId, name: session.original, ...(kind === undefined ? {} : { kind }), context, uses };
            const names = await suggestNames(request, session.names.signal);
            if (this.session === session && names.length > 0) {
                this.publish({ suggestions: names });
            }
        } catch {
            // Suggestions do not prevent a manual rename.
        }
    }

    /* So a suggester knows a function from a variable; a rename on a use finds the kind through the declaration's place in this file. */
    private async kindOf(session: Session, locations: readonly Location[]): Promise<string | undefined> {
        const { project, uri } = this.language;
        if (!project.service.supports('textDocument/documentSymbol', uri)) {
            return undefined;
        }
        try {
            const symbols = await project.service.documentSymbols(uri, { signal: session.names.signal, parallel: true });
            return renameKindOf(symbols, session.original, [session.target.range, ...occurrencesOf(locations, uri).inFile]);
        } catch {
            return undefined;
        }
    }

    /* The text of the first lines that name the symbol, in the order the servers listed them, reading at most a few other files. */
    private async linesOf(locations: readonly Location[]): Promise<string[]> {
        const { project } = this.language;
        const texts = new Map<string, string[] | null>();
        const lines: string[] = [];
        let others = 0;
        for (const location of locations.slice(0, SAMPLE_LOCATIONS)) {
            if (!texts.has(location.uri)) {
                if (location.uri !== this.language.uri && others++ >= SAMPLE_OTHER_FILES) {
                    continue;
                }
                texts.set(location.uri, (await project.readText(location.uri))?.split('\n') ?? null);
            }
            const text = texts.get(location.uri)?.[location.range.start.line];
            if (text !== undefined && text.trim() !== '' && !lines.includes(text)) {
                lines.push(text);
            }
        }
        return lines;
    }

    private publish(patch: Partial<RenameView>): void {
        const session = this.session;
        if (session === null) {
            return;
        }
        const { popups } = this.language;
        const current = popups.getState().rename;
        popups.setState({
            rename: {
                phase: 'input',
                range: session.target.range,
                original: session.original,
                placeholder: session.target.placeholder,
                occurrences: null,
                busy: false,
                error: null,
                name: session.target.placeholder,
                files: [],
                operations: [],
                suggestions: [],
                ...current,
                ...patch
            }
        });
    }

    private tell(kind: 'success' | 'error', title: string): void {
        this.language.project.host.notify?.({ id: TOAST_ID, kind, title });
    }

    private say(key: string, options?: Record<string, unknown>): string {
        return this.language.project.i18n.t(`editor:language.rename.${key}`, options);
    }
}
