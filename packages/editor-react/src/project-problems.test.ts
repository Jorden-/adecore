import './test-setup.ts';
import { expect, test } from 'bun:test';
import type { Diagnostic } from '@adecore/lsp';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { ProjectProblems, type ProblemReport, type ProblemSource } from './project-problems.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const at = (line: number, message = 'Problem', severity: Diagnostic['severity'] = 1): Diagnostic => ({
    range: { start: { line, character: 0 }, end: { line, character: 3 } },
    message,
    severity
});

test('a report touches only its own file, and a clean file reported clean again tells nobody', () => {
    const problems = new ProjectProblems(new FakeLanguageService());
    let told = 0;
    problems.subscribe(() => told++);
    problems.report('b.ts', 'ts', [at(4), at(1, 'Worse', 1), at(0, 'Mild', 2)]);
    problems.report('a.ts', 'ts', [at(2)]);
    const first = problems.getSnapshot();
    expect(first.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(first[1]!.rows.map((row) => row.diagnostic.message)).toEqual(['Worse', 'Problem', 'Mild']);
    expect(problems.getSnapshot()).toBe(first);
    problems.report('a.ts', 'ts', [at(3)]);
    const second = problems.getSnapshot();
    expect(second[1]).toBe(first[1]);
    expect(second[0]!.rows[0]!.diagnostic.range.start.line).toBe(3);
    const before = told;
    problems.report('c.ts', 'ts', []);
    expect(told).toBe(before);
    expect(problems.getSnapshot()).toBe(second);
    problems.report('a.ts', 'ts', []);
    expect(problems.getSnapshot().map((file) => file.path)).toEqual(['b.ts']);
    problems.dispose();
});

test('an edit moves the problems of a file without telling the listeners or copying the ones before it', async () => {
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree', theme: 'light' });
    const uri = 'file:///work/src/lines.ts';
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    await language.document.ready;
    service.report({ uri, source: 'ts', diagnostics: [at(0, 'First'), at(2, 'Last')] });
    let told = 0;
    language.diagnostics.onChange(() => told++);
    const [first] = language.diagnostics.problems;
    editor.type('one\ntwo\n\nthree');
    expect(told).toBe(0);
    expect(language.diagnostics.problems[0]!.diagnostic).toBe(first!.diagnostic);
    expect(language.diagnostics.problems[1]!.diagnostic.range.start.line).toBe(3);
    expect(language.diagnostics.counts()).toEqual({ error: 2, warning: 0, info: 0 });
    language.dispose();
    project.dispose();
});

test('a project lists the reports of the source its host hands it, and lets go of it when disposed', () => {
    const service = new FakeLanguageService();
    const listeners = new Set<(report: ProblemReport) => void>();
    const source: ProblemSource = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const project = new ProjectLanguage(service, { problemSource: source });
    for (const listener of listeners) {
        listener({ path: 'src/held-elsewhere.ts', server: 'ts', diagnostics: [at(1)] });
    }
    service.report({ uri: 'file:///work/src/a.ts', source: 'ts', diagnostics: [at(0)] });
    expect(project.problems.getSnapshot().map((file) => [file.path, file.rows[0]!.server])).toEqual([['src/held-elsewhere.ts', 'ts']]);
    project.dispose();
    expect(listeners.size).toBe(0);
});

test('without a source of its own a project lists what the service reports, by the path in its folder', () => {
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service, { folder: '/work' });
    service.report({ uri: 'file:///work/src/a.ts', source: 'ts', diagnostics: [at(0)] });
    expect(project.problems.getSnapshot().map((file) => file.path)).toEqual(['src/a.ts']);
    project.dispose();
});
