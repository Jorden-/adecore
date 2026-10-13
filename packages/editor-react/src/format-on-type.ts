import type { TextEdit } from '@adecore/lsp';
import type { EditorTextChange } from '@adecore/editor';
import { comparePositions } from './diagnostics-model.ts';
import type { EditorLanguage } from './editor-language.ts';

const METHOD = 'textDocument/onTypeFormatting';
/* A line break with the indentation the editor put after it, which is how Enter reaches the server. */
const LINE_BREAK = /^\r?\n[ \t]*(\r?\n[ \t]*)?$/;
/* A closer with the whitespace the editor replaced in front of it when it moved the closer back to its opener's indentation. */
const DEDENTED = /^[ \t]+(\S)$/u;

/* The overlapping edits of a server answer have no single meaning, so an answer that has them is not applied. */
function overlaps(edits: readonly TextEdit[]): boolean {
    const ordered = [...edits].sort((left, right) => comparePositions(left.range.start, right.range.start));
    return ordered.some((edit, index) => index > 0 && comparePositions(ordered[index - 1]!.range.end, edit.range.start) > 0);
}

/*
 * Formatting while typing: after a person types one of the characters the server named in
 * `firstTriggerCharacter` and `moreTriggerCharacter`, the server is asked what to change around the caret, and its
 * edits are applied.
 *
 * Only typing counts: one change that is the trigger character alone, the closer the editor moved back to its
 * opener's indentation, or a line break with its indentation for `\n`, which the editor reports as typed though
 * Enter runs as a command. A character the editor types over an existing closer changes no text and asks nothing. A paste, undo, a completion or an external change does not ask, and neither does a
 * second caret, a read-only editor or a snippet session, whose tab stops an edit could move. An answer is applied
 * only while the text is exactly what it was asked about, and the caret where it was.
 *
 * The edits join the undo step of the typed character, so one undo takes both back. Off by default; a host enables it explicitly with `configure(true)`.
 */
export class FormatOnTypeFeature {
    private readonly language: EditorLanguage;
    private enabled = false;
    /* Raised by every change of the text, so an answer for an older text is told from the one for the text that is. */
    private revision = 0;
    private controller = new AbortController();

    constructor(language: EditorLanguage) {
        this.language = language;
        const off = language.editor.onTextChange((change) => this.typed(change));
        language.onDispose(() => {
            off();
            this.controller.abort();
        });
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /* Whether the server of this document formats on type and the service can ask it. */
    get supported(): boolean {
        const { project, uri } = this.language;
        return project.service.onTypeFormatting !== undefined && project.service.supports(METHOD, uri);
    }

    configure(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.controller.abort();
        }
    }

    /* The characters that ask the server, the first one and the more. */
    triggerCharacters(): readonly string[] {
        const options = this.language.project.service.providerOptions(METHOD, this.language.uri);
        return options === undefined
            ? []
            : [...(options.firstTriggerCharacter === undefined ? [] : [options.firstTriggerCharacter]), ...(options.moreTriggerCharacter ?? [])];
    }

    private typed(change: EditorTextChange): void {
        const revision = ++this.revision;
        this.controller.abort();
        if (!this.enabled || (change.source !== 'input' && change.typed !== true) || change.changes.length !== 1 || !this.supported) {
            return;
        }
        const { editor, snippets } = this.language;
        const { text } = change.changes[0]!;
        const typed = LINE_BREAK.test(text) ? '\n' : Array.from(text).length === 1 ? text : (DEDENTED.exec(text)?.[1] ?? null);
        if (typed === null || !this.triggerCharacters().includes(typed)) {
            return;
        }
        if (snippets.isActive || editor.isReadOnly?.() === true || editor.getSelections().length !== 1) {
            return;
        }
        this.controller = new AbortController();
        void this.ask(revision, typed, editor.getCaret(), this.controller.signal);
    }

    private async ask(revision: number, typed: string, caret: { line: number; character: number }, signal: AbortSignal): Promise<void> {
        const { editor, project, uri, document } = this.language;
        try {
            // The change of the typed character reaches the server before this question does.
            await document.ready;
            const edits = await project.service.onTypeFormatting!(uri, caret, typed, { ...editor.getIndentation() }, { signal });
            const here = editor.getCaret();
            const stale = revision !== this.revision || this.language.isDisposed || comparePositions(here, caret) !== 0;
            if (stale || edits === null || edits.length === 0 || overlaps(edits)) {
                return;
            }
            editor.applyEdits(
                edits.map((edit) => ({ range: edit.range, text: edit.newText })),
                { mergeUndo: true }
            );
        } catch {
            // A refusal or a failing server is not worth a notice per keystroke; the next trigger character asks again.
        }
    }
}
