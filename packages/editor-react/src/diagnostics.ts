import type { Diagnostic } from '@adecore/lsp';
import type { EditorContentChange, EditorPosition, EditorReveal } from '@adecore/editor';
import type { EditorLanguage } from './editor-language.ts';
import { sameRange } from './hover-content.ts';
import { isShortcut } from './shortcut-keys.ts';
import { comparePositions, markerOf, neighborProblem, problemCountsOf, problemsAt, severityOf, shiftRange, type Problem } from './diagnostics-model.ts';

export interface ProblemCounts {
    readonly error: number;
    readonly warning: number;
    readonly info: number;
}

/*
 * The problems the servers report for one file. A report from a server replaces the one before it
 * from the same server, the editor draws them, and each one follows its text through edits made
 * before the server reports again, so what is under a squiggle is still what it was about.
 */
export class DiagnosticsFeature {
    private readonly language: EditorLanguage;
    private readonly reports = new Map<string, readonly Diagnostic[]>();
    private readonly listeners = new Set<() => void>();
    private list: readonly Problem[] = [];

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor, project, uri } = language;
        const reports = project.service.onDiagnostics((report) => {
            if (report.uri === uri) {
                this.reports.set(report.source, report.diagnostics);
                this.rebuild();
            }
        });
        const edits = editor.onTextChange((change) => this.shift(change.changes));
        // These keys are the editor's while it has the keyboard; elsewhere the menu's commands answer.
        const keys = editor.onKeyDown((event) => {
            const next = isShortcut(this.language.shortcuts.nextProblem, event);
            if (!next && !isShortcut(this.language.shortcuts.previousProblem, event)) {
                return false;
            }
            this.step(next ? 1 : -1);
            return true;
        });
        language.onDispose(() => {
            keys();
            reports.dispose();
            edits();
            this.listeners.clear();
            editor.setMarkers([]);
        });
    }

    get problems(): readonly Problem[] {
        return this.list;
    }

    counts(): ProblemCounts {
        return problemCountsOf(this.list.map((problem) => problem.diagnostic));
    }

    at(position: EditorPosition): Problem[] {
        return problemsAt(this.list, position);
    }

    /* Puts the caret on the next problem, or the one before; false when there is none. */
    step(direction: 1 | -1): boolean {
        const caret = this.language.editor.getCaret();
        const target = neighborProblem(this.list, caret, direction);
        if (target === null) {
            return false;
        }
        const { start } = target.diagnostic.range;
        this.reveal(target, comparePositions(start, caret) > 0 ? 'centerDown' : 'centerUp');
        return true;
    }

    /* Puts the caret on the first problem of the file. */
    goToFirst(): boolean {
        const target = neighborProblem(this.list, { line: -1, character: 0 }, 1);
        if (target === null) {
            return false;
        }
        this.reveal(target, 'center');
        return true;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private reveal(problem: Problem, reveal: EditorReveal): void {
        const { editor, project } = this.language;
        editor.setCaret(problem.diagnostic.range.start, reveal);
        editor.focus();
        this.language.hover.showProblemsAt(editor.getCaret());
        const severity = project.i18n.t(`editor:language.announce.severity.${severityOf(problem.diagnostic)}`);
        editor.announce(project.i18n.t('editor:language.announce.problem', { severity, message: problem.diagnostic.message }));
    }

    /* The problems follow the edit as the markers do. Their number does not change, so nobody is told. */
    private shift(changes: readonly EditorContentChange[]): void {
        let moved = false;
        for (const [server, diagnostics] of this.reports) {
            let shifted: Diagnostic[] | null = null;
            for (const [index, diagnostic] of diagnostics.entries()) {
                const range = shiftRange(diagnostic.range, changes);
                if (!sameRange(range, diagnostic.range)) {
                    shifted ??= [...diagnostics];
                    shifted[index] = { ...diagnostic, range };
                }
            }
            if (shifted !== null) {
                this.reports.set(server, shifted);
                moved = true;
            }
        }
        if (moved) {
            this.collect();
        }
    }

    private rebuild(): void {
        this.collect();
        this.language.editor.setMarkers(this.list.map((problem) => markerOf(problem.diagnostic)));
        for (const listener of [...this.listeners]) {
            listener();
        }
    }

    private collect(): void {
        this.list = [...this.reports].flatMap(([server, diagnostics]) => diagnostics.map((diagnostic): Problem => ({ diagnostic, server })));
    }
}
