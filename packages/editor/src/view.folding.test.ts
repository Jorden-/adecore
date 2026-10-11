import { describe, expect, test } from 'bun:test';
import { EditorView } from './view.ts';
import { mount, rendered } from './view.fixture.test.ts';

describe('folding', () => {
    const text = 'function a() {\n    one();\n    two();\n}\nconst b = 1;\n';

    test('offers a control on the first line of each range', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        expect([...host.querySelectorAll('.se-fold-toggle')].map((button) => (button as HTMLElement).dataset.foldLine)).toEqual(['0']);
    });

    test('hides the lines of a collapsed range and shows a chip in their place', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        expect(view.toggleFold(0)).toBe(true);
        expect(rendered(host)).toEqual(['0', '4', '5']);
        expect(host.querySelector('.se-fold-chip')).not.toBeNull();
        expect(host.querySelector('.se-fold-toggle')!.className).toContain('se-folded');
        view.toggleFold(0);
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    test('keeps a fold closed while text is typed above it, before the folds are read again', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        view.toggleFold(0);
        model.applyEdits([{ from: 0, to: 0, text: '// note\n' }]);
        expect(view.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 4 }]);
        expect(rendered(host)).toEqual(['0', '1', '5', '6']);
    });

    test('has nothing to fold on a line that starts no range', () => {
        const { view } = mount(text);
        view.refreshFolds();
        expect(view.toggleFold(4)).toBe(false);
    });

    test('moves a caret out of the lines it hides', () => {
        const { model, view } = mount(text);
        view.refreshFolds();
        model.setSelections([{ anchor: 22, head: 22 }]);
        view.toggleFold(0);
        expect(model.getSelections()[0]).toEqual({ anchor: 14, head: 14 });
    });

    test('opens a fold again for an offset inside it', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        view.toggleFold(0);
        view.revealOffset(model.getText().indexOf('two'));
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    test('keeps a fold shut when text above it changes', () => {
        const { host, model, view } = mount('x\n' + text);
        view.refreshFolds();
        view.toggleFold(1);
        model.applyEdits([{ from: 0, to: 0, text: 'yy\nzz\n' }]);
        view.refreshFolds();
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '7', '8']);
    });

    test('keeps the closing delimiter drawn after the placeholder', () => {
        const { host, view } = mount('function a() {\n    one();\n}, extra\nlast');
        view.refreshFolds();
        view.toggleFold(0);
        const row = host.querySelector('.se-line[data-line="0"]')!;
        const tail = [...row.querySelectorAll('.se-run')].map((run) => run.textContent).at(-1);
        expect(tail).toBe('}, extra');
        expect(row.querySelector('.se-fold-chip')).not.toBeNull();
    });

    test('draws a fold a server starts within its first line up to there, and its last line from where it shows again', () => {
        const source = '<?php\nuse App\\A;\nuse App\\B;\nuse App\\C;\n\nfinal class D {}';
        const { host, model, view } = mount(source, { language: 'php' });
        const at = (line: number, column: number) => model.offsetAt({ line, column });
        view.setFoldHints({ ranges: [{ from: at(1, 0), to: at(3, 0), kind: 'imports', head: at(1, 3), tail: at(3, 9) }] });
        view.refreshFolds();
        model.setSelections([{ anchor: at(1, 6), head: at(1, 6) }]);
        view.toggleFold(1);
        const runs = [...host.querySelectorAll('.se-line[data-line="1"] .se-run')].map((run) => run.textContent);
        expect(runs).toEqual(['use', ';']);
        expect(host.querySelector('.se-line[data-line="1"] .se-fold-chip')).not.toBeNull();
        expect(model.getSelections()[0]).toEqual({ anchor: at(1, 3), head: at(1, 3) });
        expect(rendered(host)).toEqual(['0', '1', '4', '5']);
        view.revealOffset(at(1, 5));
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
        expect([...host.querySelectorAll('.se-line[data-line="1"] .se-run')].map((run) => run.textContent).join('')).toBe('use App\\A;');
    });

    test('draws no tail for a fold that has no closer', () => {
        const { host, view } = mount('def a():\n    one\n    two\nb = 1', { language: 'python' });
        view.refreshFolds();
        view.toggleFold(0);
        const runs = [...host.querySelectorAll('.se-line[data-line="0"] .se-run')].map((run) => run.textContent);
        expect(runs).toEqual(['def a():']);
    });

    test('offers one control per line when several ranges start on it, and folds the outermost', () => {
        const source = 'await Promise.all([\n    one(),\n    two()\n]);\nnext();';
        const { host, view } = mount(source);
        view.refreshFolds();
        expect(host.querySelectorAll('.se-fold-toggle').length).toBe(1);
        expect(host.querySelector('.se-fold-toggle')!.textContent).toBe('');
        view.toggleFold(0);
        expect(rendered(host)).toEqual(['0', '4']);
    });

    test('keeps every closer on the last line of a collapsed range, not only the one that closes it', () => {
        const { host, view } = mount('await Promise.all([\n    one(),\n]);\nnext();');
        view.refreshFolds();
        view.toggleFold(0);
        const runs = [...host.querySelectorAll('.se-line[data-line="0"] .se-run')].map((run) => run.textContent);
        expect(runs.at(-1)).toBe(']);');
    });

    test('folds the range around the caret and every range', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        model.setSelections([{ anchor: 20, head: 20 }]);
        view.collapseRegion();
        expect(rendered(host)).toEqual(['0', '4', '5']);
        view.foldAll(false);
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
        view.foldAll(true);
        expect(rendered(host)).toEqual(['0', '4', '5']);
    });
});

describe('fold commands', () => {
    const nested = 'class A {\n    method() {\n        body();\n    }\n    other() {\n        more();\n    }\n}\nend();';
    const folded = (view: EditorView): { startLine: number; endLine: number }[] => [...view.getFolds().collapsed];

    test('collapse folds the range that starts on the caret line, or else the innermost open one around it', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(2).start + 4, head: model.getLine(2).start + 4 }]);
        view.collapseRegion();
        expect(folded(view)).toEqual([{ startLine: 1, endLine: 3 }]);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(1).start }]);
        view.collapseRegion();
        expect(folded(view)).toEqual([
            { startLine: 0, endLine: 7 },
            { startLine: 1, endLine: 3 }
        ]);
    });

    test('expand opens the range on the caret line, or else the outermost folded one around it', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        view.foldAll(true);
        model.setSelections([{ anchor: 0, head: 0 }]);
        view.expandRegion();
        expect(folded(view).map((fold) => fold.startLine)).toEqual([1, 4]);
    });

    test('collapse and expand recursively take every range inside the one at the caret', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: 0, head: 0 }]);
        view.collapseRecursively();
        expect(folded(view).map((fold) => fold.startLine)).toEqual([0, 1, 4]);
        view.expandRecursively();
        expect(folded(view)).toEqual([]);
    });

    test('fold all and unfold all keep to the selection when it holds ranges', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(3).end }]);
        view.foldAll(true);
        expect(folded(view)).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('fold selection folds the lines of the selection, takes the same fold away and follows edits', () => {
        const { host, model, view } = mount('a\nb\nc\nd\ne');
        view.refreshFolds();
        model.setSelections([{ anchor: 2, head: 6 }]);
        view.foldSelection();
        expect(rendered(host)).toEqual(['0', '1', '3', '4']);
        expect(view.getFolds().custom).toEqual([{ startLine: 1, endLine: 2 }]);
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.refreshFolds();
        expect(view.getFolds().custom).toEqual([{ startLine: 2, endLine: 3 }]);
        model.setSelections([{ anchor: model.getLine(2).start, head: model.getLine(4).start }]);
        view.foldSelection();
        expect(view.getFolds().custom).toEqual([]);
    });

    test('fold selection leaves a selection inside one line alone', () => {
        const { model, view } = mount('abc\ndef');
        view.refreshFolds();
        model.setSelections([{ anchor: 0, head: 2 }]);
        view.foldSelection();
        expect(view.getFolds().custom).toEqual([]);
    });

    test('remembers what is folded and folds it again', () => {
        const { view } = mount(nested);
        view.refreshFolds();
        view.toggleFold(1, true);
        const state = view.getFolds();
        const again = mount(nested);
        again.view.restoreFolds(state);
        expect(again.view.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('folds the roles a host asks for the first time a file opens, and nothing for a file that has folds of its own', () => {
        const source = "import a from 'a';\nimport b from 'b';\n\nconst x = 1;\nfunction f() {\n    return x;\n}\n";
        const { host, view } = mount(source);
        view.restoreFolds(null, ['imports']);
        expect(rendered(host)).toEqual(['0', '2', '3', '4', '5', '6', '7']);
        const second = mount(source);
        second.view.restoreFolds({ collapsed: [], custom: [] }, ['imports']);
        expect(second.host.querySelectorAll('.se-fold-chip')).toHaveLength(0);
        const third = mount(source);
        third.view.restoreFolds(null, []);
        expect(third.host.querySelectorAll('.se-fold-chip')).toHaveLength(0);
    });

    test('folds a region between its markers', () => {
        const { host, view } = mount('// region A\nx();\ny();\n// endregion\nz();');
        view.refreshFolds();
        view.toggleFold(0, true);
        expect(rendered(host)).toEqual(['0', '4']);
    });
});

describe('fold defaults and hints', () => {
    const source = '/**\n * Doc.\n */\nclass A {\n    run() {\n        body();\n    }\n    stop() {\n        more();\n    }\n}\n';
    const runBody = { from: source.indexOf('run()'), to: source.indexOf('    stop') - 1, body: 'method' as const };
    const stopBody = { from: source.indexOf('stop()'), to: source.lastIndexOf('}') - 1, body: 'method' as const };
    const folded = (view: EditorView): number[] => view.getFolds().collapsed.map((fold) => fold.startLine);

    test('folds a role the text gives at once, and one a server names when it answers', () => {
        const { view } = mount(source);
        view.restoreFolds(null, ['doc-comment', 'method-body']);
        expect(folded(view)).toEqual([0]);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([0, 4, 7]);
    });

    test('leaves a fold a person opened as it is when the answer comes again', () => {
        const { view } = mount(source);
        view.restoreFolds(null, ['method-body']);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        view.toggleFold(4, false);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([7]);
    });

    test('does not fold a range that holds the caret', () => {
        const { model, view } = mount(source);
        model.setSelections([{ anchor: source.indexOf('body()'), head: source.indexOf('body()') }]);
        view.restoreFolds(null, ['method-body']);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([7]);
    });

    test('stops folding by itself once the text was edited', () => {
        const { model, view } = mount(source);
        view.restoreFolds(null, ['method-body']);
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.setFoldHints({ symbols: [{ ...runBody, from: runBody.from + 2, to: runBody.to + 2 }] });
        expect(folded(view)).toEqual([]);
    });

    test('keeps the hints with their text through an edit above them', () => {
        const { model, view } = mount(source);
        view.restoreFolds(null, []);
        view.setFoldHints({ symbols: [runBody] });
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.refreshFolds();
        expect(view.getFolds().collapsed).toEqual([]);
        view.foldRole('method-body', true);
        expect(folded(view)).toEqual([5]);
    });

    test('folds and opens every documentation comment', () => {
        const { view } = mount(source + '/** Another.\n */\nfunction g() {\n}\n');
        view.refreshFolds();
        view.foldRole('doc-comment', true);
        expect(folded(view)).toEqual([0, 11]);
        view.foldRole('doc-comment', false);
        expect(folded(view)).toEqual([]);
    });

    test('opens every range above a level and folds the ones at it', () => {
        const nested = 'class A {\n    method() {\n        if (a) {\n            b();\n        }\n    }\n}\nend();';
        const { view } = mount(nested);
        view.refreshFolds();
        view.foldAll(true);
        view.expandAllToLevel(1);
        expect(folded(view)).toEqual([1, 2]);
        view.expandAllToLevel(2);
        expect(folded(view)).toEqual([2]);
        view.expandAllToLevel(3);
        expect(folded(view)).toEqual([]);
    });

    test('shows the outline the setting says', () => {
        const { host, view } = mount(source, { foldOutline: 'always' });
        expect(host.querySelector('.se-editor')!.getAttribute('data-fold-outline')).toBe('always');
        view.settings.foldOutline = 'off';
        view.applySettings();
        expect(host.querySelector('.se-editor')!.getAttribute('data-fold-outline')).toBe('off');
    });
});
