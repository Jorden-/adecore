import { StaleResultError, type Location } from '@adecore/lsp';
import { KEY_PRIORITY } from './key-priority.ts';
import { basenameOf } from './paths.ts';
import type { EditorLanguage } from './editor-language.ts';
import { entriesOf, workspaceEntriesOf, type SymbolEntry, type WorkspaceEntry } from './symbol-picker-model.ts';
import { isShortcut } from './shortcut-keys.ts';
import { messageOf } from './error-message.ts';

const TOAST_ID = 'language-symbols';

/*
 * Go to symbol: a picker over the symbols the language servers know in the file, filtered as it is typed.
 * A `#` in front searches the whole project and a `:` in front goes to a line. The picker answers to
 * its own input, so the editor only has to open it.
 */
export class SymbolPickerFeature {
    private readonly language: EditorLanguage;

    constructor(language: EditorLanguage) {
        this.language = language;
        const off = language.onKey((event) => {
            if (!isShortcut(this.language.shortcuts.goToSymbol, event)) {
                return false;
            }
            void this.open();
            return true;
        }, KEY_PRIORITY.symbolPicker);
        language.onDispose(() => {
            off();
            this.close();
        });
    }

    async open(): Promise<void> {
        const { project, uri, popups } = this.language;
        if (!project.service.supports('textDocument/documentSymbol', uri)) {
            this.language.project.host.notify?.({ id: TOAST_ID, kind: 'error', title: this.language.project.i18n.t('editor:language.symbols.unavailable') });
            return;
        }
        try {
            const entries = entriesOf(await project.service.documentSymbols(uri));
            popups.setState({ symbols: { file: basenameOf(this.language.uri), entries } });
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                this.language.project.host.notify?.({
                    id: TOAST_ID,
                    kind: 'error',
                    title: this.language.project.i18n.t('editor:language.symbols.failed', { message: messageOf(error) })
                });
            }
        }
    }

    close(): void {
        if (this.language.popups.getState().symbols !== null) {
            this.language.popups.setState({ symbols: null });
            this.language.editor.focus();
        }
    }

    /* Puts the caret on a symbol of the file. */
    goTo(entry: SymbolEntry): void {
        this.close();
        this.language.jump({ line: entry.line, character: entry.character });
    }

    /* Puts the caret on a one-based line. */
    goToLine(line: number): void {
        this.close();
        this.language.jump({ line: line - 1, character: 0 });
    }

    /* The symbols of the project that answer to a name, which is a request to the server and so waits for a pause in the typing. */
    async search(text: string, signal: AbortSignal): Promise<WorkspaceEntry[]> {
        const { project, uri } = this.language;
        if (text === '' || !project.service.supports('workspace/symbol', uri)) {
            return [];
        }
        return workspaceEntriesOf(await project.service.workspaceSymbols(uri, text, { signal }));
    }

    goToWorkspace(entry: WorkspaceEntry): void {
        this.close();
        const location: Location = { uri: entry.uri, range: { start: { line: entry.line, character: 0 }, end: { line: entry.line, character: 0 } } };
        this.language.goTo(location);
    }
}
