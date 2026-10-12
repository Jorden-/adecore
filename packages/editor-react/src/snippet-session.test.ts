import './test-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import { parseSnippet, tabOrder } from './snippet.ts';
import { SnippetFeature } from './snippet-session.ts';
import { signatureViewOf } from './signature-model.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) {
        dispose();
    }
});

function snippet(source: string) {
    const mounted = mountEditor({ text: '' });
    const feature = new SnippetFeature({ editor: mounted.editor, onDispose: (dispose) => cleanup.push(dispose) });
    cleanup.push(() => mounted.editor.dispose());
    const parsed = parseSnippet(source);
    mounted.editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: parsed.text }]);
    feature.begin({ line: 0, character: 0 }, parsed.text, tabOrder(parsed), parsed.fields);
    return { ...mounted, feature };
}

test('typing mirrors is one undo step, separate from inserting the snippet', () => {
    const { editor, type, feature } = snippet('${1:foo} = $1;$0');
    expect(editor.getSelections()).toHaveLength(2);
    type('a');
    type('b');
    expect(editor.getText()).toBe('ab = ab;');
    expect(feature.isActive).toBe(true);
    editor.runCommand('undo');
    expect(editor.getText()).toBe('foo = foo;');
    expect(feature.isActive).toBe(false);
    editor.runCommand('undo');
    expect(editor.getText()).toBe('');
});

test('an empty field grows, and Shift+Tab selects its new text', () => {
    const { editor, type, press } = snippet('$1 + $1 ${2:z}$0');
    type('abc');
    expect(editor.getText()).toBe('abc + abc z');
    press('Tab');
    expect(editor.textInRange(editor.getSelection())).toBe('z');
    press('Tab', { shiftKey: true });
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['abc', 'abc']);
});

test('the defining occurrence stays primary when its bare mirror comes first', () => {
    const { editor, type, press } = snippet('$1 x ${1:foo} $2$0');
    expect(editor.getSelection().start.character).toBe(6);
    type('bar');
    press('Tab');
    press('Tab', { shiftKey: true });
    expect(editor.getSelection().start.character).toBe(6);
    expect(editor.getText()).toBe('bar x bar ');
});

test('child fields also update their projections into parent mirrors', () => {
    const { editor, type, press } = snippet('${1:a ${2:b}} $1 $0');
    press('Tab');
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['b', 'b']);
    type('long');
    expect(editor.getText()).toBe('a long a long ');
    press('Tab', { shiftKey: true });
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['a long', 'a long']);
});

test('replacing a parent discards nested fields, including a nested final stop', () => {
    const { editor, type, press, feature } = snippet('${1:a ${2:b}$0} $1');
    type('new');
    expect(editor.getText()).toBe('new new');
    press('Tab');
    expect(feature.isActive).toBe(false);
    expect(editor.getCaret()).toEqual({ line: 0, character: 7 });
});

for (const source of ['$1$1', '${1:a}${1:a}']) {
    test(`touching mirrors stay static in ${source}`, () => {
        const { editor, type } = snippet(source);
        expect(editor.getSelections()).toHaveLength(1);
        type('x');
        expect(editor.getText()).toBe(source === '$1$1' ? 'x' : 'xa');
    });
}

test('Escape leaves only the primary caret', () => {
    const { editor, press, feature } = snippet('${1:foo} $1');
    const caret = editor.getCaret();
    expect(press('Escape')).toBe(true);
    expect(feature.isActive).toBe(false);
    expect(editor.getSelections()).toEqual([{ start: caret, end: caret }]);
});

test('losing a mirror selection or moving outside the insertion ends the session', async () => {
    const mounted = snippet('${1:foo} $1');
    mounted.editor.setCaret({ line: 0, character: 1 });
    expect(mounted.feature.isActive).toBe(false);
    const single = snippet('x ${1:foo} tail');
    single.editor.setCaret({ line: 0, character: 0 });
    // This caret is still inside the insertion hull.
    await Promise.resolve();
    expect(single.feature.isActive).toBe(true);
    single.editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'outside ' }]);
    expect(single.feature.isActive).toBe(false);
});

test('IME previews once and commits all mirrors atomically', () => {
    const { editor, page, input, feature } = snippet('${1:foo} $1');
    input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + '日本' + input.value.slice(end);
    input.setSelectionRange(start + 2, start + 2);
    input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    expect(editor.getText()).toBe('foo foo');
    expect(page.host.querySelectorAll('.se-composition')).toHaveLength(1);
    const event = new page.window.Event('compositionend', { bubbles: true });
    Object.assign(event, { data: '日本' });
    input.dispatchEvent(event);
    expect(editor.getText()).toBe('日本 日本');
    expect(feature.isActive).toBe(true);
    editor.runCommand('undo');
    expect(editor.getText()).toBe('foo foo');
});

async function completion(text: string, source: string, imports = false, insertTextMode: 1 | 2 = 1) {
    const mounted = mountEditor({ text, language: 'typescript' });
    const service = new FakeLanguageService();
    service.respond('textDocument/completion', () => [
        {
            label: 'for',
            insertText: source,
            insertTextFormat: 2,
            insertTextMode,
            ...(imports
                ? { additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'import x;\n' }] }
                : {})
        }
    ]);
    const project = new ProjectLanguage(service);
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, mounted.editor, 'file:///snippet.ts', 'typescript', timers);
    cleanup.push(() => {
        language.dispose();
        project.dispose();
        mounted.editor.dispose();
    });
    await language.document.ready;
    return { ...mounted, language, timers, service };
}

test('completion puts mirrors at every caret, after imports and earlier insertions', async () => {
    const { editor, language, timers, type, press } = await completion('fo; fo\nfo', 'for (${1:i} of $1)$0', true);
    editor.setSelections(
        [2, 6]
            .map((character) => ({ start: { line: 0, character }, end: { line: 0, character } }))
            .concat([{ start: { line: 1, character: 2 }, end: { line: 1, character: 2 } }])
    );
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await language.completion.accept(false);
    expect(editor.getText()).toBe('import x;\nfor (i of i); for (i of i)\nfor (i of i)');
    expect(editor.getSelections()).toHaveLength(6);
    type('item');
    expect(editor.getText()).toBe('import x;\nfor (item of item); for (item of item)\nfor (item of item)');
    press('Tab');
    expect(editor.getSelections()).toHaveLength(3);
    expect(language.snippets.isActive).toBe(false);
});

test('native textarea replacement also commits all mirrors', () => {
    const { editor, page, input, feature } = snippet('${1:foo} $1');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + 'native' + input.value.slice(end);
    input.setSelectionRange(start + 6, start + 6);
    input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    expect(editor.getText()).toBe('native native');
    expect(feature.isActive).toBe(true);
});

test('a caret outside the insertion ends the session after text ranges have settled', async () => {
    const mounted = mountEditor({ text: 'prefix foo suffix' });
    const feature = new SnippetFeature({ editor: mounted.editor, onDispose: (dispose) => cleanup.push(dispose) });
    cleanup.push(() => mounted.editor.dispose());
    const parsed = parseSnippet('${1:foo}');
    feature.begin({ line: 0, character: 7 }, parsed.text, tabOrder(parsed), parsed.fields);
    mounted.editor.setCaret({ line: 0, character: 0 });
    await Promise.resolve();
    expect(feature.isActive).toBe(false);
});

test('multiline mirror replacements keep later fields and final carets in place', () => {
    const { editor, type, press } = snippet('${1:foo} = $1; ${2:end}$0');
    type('first\nsecond');
    expect(editor.getText()).toBe('first\nsecond = first\nsecond; end');
    press('Tab');
    expect(editor.textInRange(editor.getSelection())).toBe('end');
    press('Tab', { shiftKey: true });
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['first\nsecond', 'first\nsecond']);
});

test('distributed paste ends the snippet instead of keeping mismatched mirrors linked', () => {
    const { editor, clip, feature } = snippet('${1:foo} = $1; ${2:end}$0');
    clip('paste', 'first\nsecond');
    expect(editor.getText()).toBe('first = second; end');
    expect(feature.isActive).toBe(false);
    expect(editor.getSelections()).toHaveLength(1);
});

test('replacing a parent keeps independent occurrences of a nested field', () => {
    const { editor, type, press } = snippet('${1:a ${2:b}} and $2$0');
    type('new');
    expect(editor.getText()).toBe('new and b');
    press('Tab');
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['b']);
    type('other');
    expect(editor.getText()).toBe('new and other');
});

test('Tab after replacing a parent in touching instances follows the primary instance', () => {
    const mounted = mountEditor({ text: '' });
    const feature = new SnippetFeature({ editor: mounted.editor, onDispose: (dispose) => cleanup.push(dispose) });
    cleanup.push(() => mounted.editor.dispose());
    const parsed = parseSnippet('${1:new ${2:Foo}()}');
    mounted.editor.setText(parsed.text + parsed.text);
    feature.begin(
        [
            { line: 0, character: 0 },
            { line: 0, character: parsed.text.length }
        ],
        parsed.text,
        tabOrder(parsed),
        parsed.fields
    );
    expect(mounted.editor.getSelections()).toHaveLength(1);
    mounted.type('x');
    expect(() => mounted.press('Tab')).not.toThrow();
    expect(feature.isActive).toBe(false);
    expect(mounted.editor.getCaret().character).toBe(mounted.editor.getText().length);
});

test('Escape closes the signature card before ending a snippet', async () => {
    const { editor, language, timers, press } = await completion('fo', 'for (${1:item})$0');
    editor.setCaret({ line: 0, character: 2 });
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await language.completion.accept(false);
    language.popups.setState({
        signature: { anchor: { line: 0, character: 4 }, model: signatureViewOf({ signatures: [{ label: 'f(x)' }] })! }
    });
    press('Escape');
    expect(language.popups.getState().signature).toBeNull();
    expect(language.snippets.isActive).toBe(true);
    press('Escape');
    expect(language.snippets.isActive).toBe(false);
});

test('a refused completion edit does not start a snippet on unchanged text', async () => {
    const { editor, language, timers } = await completion('fo', 'for (${1:item})$0');
    editor.setCaret({ line: 0, character: 2 });
    editor.setReadOnly(true);
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await language.completion.accept(false);
    expect(editor.getText()).toBe('fo');
    expect(language.snippets.isActive).toBe(false);
});

test('completion renders line variables and indentation independently at each caret', async () => {
    const { editor, language, timers, type, press } = await completion('  fo\n\tfo', '${1:$TM_LINE_NUMBER} $1\n${2:$CURSOR_NUMBER}$0', true, 2);
    editor.setSelections([
        { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
        { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }
    ]);
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await language.completion.accept(false);
    expect(editor.getText()).toBe('import x;\n  1 1\n  1\n\t2 2\n\t2');
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['1', '1', '2', '2']);
    editor.setSelections(editor.getSelections().map((range) => ({ start: range.end, end: range.end })));
    type('x');
    expect(language.snippets.isActive).toBe(true);
    expect(editor.getText()).toBe('import x;\n  1x 1x\n  1\n\t2x 2x\n\t2');
    press('Tab');
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['1', '2']);
    press('Tab');
    expect(language.snippets.isActive).toBe(false);
    expect(editor.getSelections()).toHaveLength(2);
});

test('typing behind a parent does not remove child stops', () => {
    const { editor, type, press } = snippet('${1:a ${2:b}}');
    press('End');
    type('x');
    press('Tab');
    expect(editor.textInRange(editor.getSelection())).toBe('b');
});

test('an independent empty occurrence on a parent boundary survives replacement', () => {
    const { editor, type, press } = snippet('${1:x${2}}$2');
    type('new');
    press('Tab');
    expect(editor.getCaret().character).toBe(3);
    type('child');
    expect(editor.getText()).toBe('newchild');
});

test('only edits in a parents own child grow that parents left edge', () => {
    const { editor, type, press } = snippet('${2:x}${1:a${2}}');
    press('Tab');
    editor.setSelections(editor.getSelections().map((range) => ({ start: range.end, end: range.end })));
    type('q');
    press('Tab', { shiftKey: true });
    expect(editor.textInRange(editor.getSelection())).toBe('axq');
    expect(editor.getText()).toBe('xqaxq');
});

for (const defaults of [false, true]) {
    test(`mirrored completion preserves newText from ${defaults ? 'list defaults' : 'textEdit'}`, async () => {
        const { editor, language, timers, service, type } = await completion('fo\nfo', 'unused');
        const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } };
        const source = 'for (${1:item} of $1)$0';
        service.respond('textDocument/completion', () =>
            defaults
                ? { isIncomplete: false, itemDefaults: { editRange: range, insertTextFormat: 2 }, items: [{ label: 'for(…)', textEditText: source }] }
                : [{ label: 'for(…)', insertTextFormat: 2, textEdit: { range, newText: source } }]
        );
        editor.setSelections([0, 1].map((line) => ({ start: { line, character: 2 }, end: { line, character: 2 } })));
        language.completion.invoke();
        timers.advance(1);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await language.completion.accept(false);
        expect(editor.getText()).toBe('for (item of item)\nfor (item of item)');
        type('entry');
        expect(editor.getText()).toBe('for (entry of entry)\nfor (entry of entry)');
    });
}

test('Tab aligns unknown names even when a host resolves one at only one caret', async () => {
    const { editor, language, timers, type } = await completion('fo\nfo', '$FOO $BAR $0');
    language.project.host.resolveSnippetVariable = (name, context) => (name === 'FOO' && context.cursorIndex === 1 ? 'supplied' : undefined);
    editor.setSelections([0, 1].map((line) => ({ start: { line, character: 2 }, end: { line, character: 2 } })));
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await language.completion.accept(false);
    expect(editor.getText()).toBe('FOO BAR \nsupplied BAR ');
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['BAR', 'BAR']);
    type('name');
    expect(editor.getText()).toBe('FOO name \nsupplied name ');
});

async function languageSnippet(source: string, count = 1) {
    const mounted = await completion('', 'unused');
    const parsed = parseSnippet(source);
    mounted.editor.setText(Array.from({ length: count }, () => parsed.text).join('\n'));
    mounted.language.snippets.beginInstances(
        Array.from({ length: count }, (_, index) => ({
            start: mounted.editor.positionAt(index * (parsed.text.length + 1)),
            text: parsed.text,
            stops: tabOrder(parsed),
            fields: parsed.fields
        }))
    );
    return mounted;
}

async function completeWithin(mounted: Awaited<ReturnType<typeof languageSnippet>>, text: string, imports = false, snippet = false): Promise<void> {
    mounted.service.respond('textDocument/completion', () => [
        {
            label: 'foo',
            filterText: 'fo',
            insertText: text,
            insertTextFormat: snippet ? 2 : 1,
            ...(imports
                ? { additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'import x;\n' }] }
                : {})
        }
    ]);
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
}

test('choosing a value edits all mirrors and retains the active field', async () => {
    const { editor, language, press } = await languageSnippet('${1|a,b,c|} $1 ${2:end}$0');
    expect(language.popups.getState().pick?.groups[0]?.rows.map((row) => row.label)).toEqual(['a', 'b', 'c']);
    press('ArrowDown');
    press('Enter');
    expect(editor.getText()).toBe('b b end');
    expect(language.popups.getState().pick).toBeNull();
    expect(language.snippets.isActive).toBe(true);
    expect(editor.getSelections().map((range) => editor.textInRange(range))).toEqual(['b', 'b']);
    press('Tab');
    expect(editor.textInRange(editor.getSelection())).toBe('end');
    editor.runCommand('undo');
    expect(editor.getText()).toBe('a a end');
    expect(language.snippets.isActive).toBe(false);
});

test('choice Tab advances, Escape dismisses before ending, and typing closes the picker', async () => {
    const first = await languageSnippet('${1|a,b|} $1 ${2:end}$0');
    first.press('Tab');
    expect(first.language.popups.getState().pick).toBeNull();
    expect(first.editor.textInRange(first.editor.getSelection())).toBe('end');
    const second = await languageSnippet('${1|a,b|} $1');
    second.press('Escape');
    expect(second.language.snippets.isActive).toBe(true);
    expect(second.language.popups.getState().pick).toBeNull();
    second.press('Escape');
    expect(second.language.snippets.isActive).toBe(false);
    expect(second.editor.getSelections()).toHaveLength(1);
    const third = await languageSnippet('${1|a,b|} $1');
    third.type('typed');
    expect(third.language.popups.getState().pick).toBeNull();
    expect(third.editor.getText()).toBe('typed typed');
    expect(third.language.snippets.isActive).toBe(true);
});

test('a choice applies to every original caret instance', async () => {
    const { editor, language } = await languageSnippet('${1|a,b|} $1 $0', 2);
    const id = language.popups.getState().pick!.groups[0]!.rows[1]!.id;
    language.pick.choose(id);
    expect(editor.getText()).toBe('b b \nb b ');
    expect(editor.getSelections()).toHaveLength(4);
    expect(language.snippets.isActive).toBe(true);
});

for (const imports of [false, true]) {
    test(`plain completion keeps outer stops ${imports ? 'with a boundary import' : 'without an import'}`, async () => {
        const mounted = await languageSnippet('${1:x} ${2:y}$0');
        mounted.type('fo');
        await completeWithin(mounted, 'foo', imports);
        expect(mounted.editor.getText()).toBe((imports ? 'import x;\n' : '') + 'foo y');
        expect(mounted.language.snippets.isActive).toBe(true);
        mounted.press('Tab');
        expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('y');
    });
}

test('completion replaces selected field mirrors as well as collapsed carets', async () => {
    const mounted = await languageSnippet('${1:fo} $1 ${2:end}$0');
    await completeWithin(mounted, 'foo');
    expect(mounted.editor.getText()).toBe('foo foo end');
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('end');
});

test('nested fields return to outer stops after the childs final caret', async () => {
    const mounted = await languageSnippet('for (${1:fo} of ${2:items}) {$0}');
    await completeWithin(mounted, '${1:a}.${2:b}', false, true);
    expect(mounted.editor.getText()).toBe('for (a.b of items) {}');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('a');
    mounted.type('long');
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('b');
    mounted.press('Tab');
    expect(mounted.language.snippets.isActive).toBe(true);
    expect(mounted.editor.getCaret().character).toBe(11);
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('items');
    mounted.press('Tab');
    expect(mounted.language.snippets.isActive).toBe(false);
    expect(mounted.editor.getCaret().character).toBe(mounted.editor.getText().length - 1);
});

test('Shift+Tab out of the first child field selects its parent field', async () => {
    const mounted = await languageSnippet('${1:fo} ${2:tail}$0');
    await completeWithin(mounted, '${1:a}.${2:b}', false, true);
    mounted.press('Tab', { shiftKey: true });
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('a.b');
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('tail');
});

test('nested mirror instances stay linked and return without phantom carets', async () => {
    const mounted = await languageSnippet('${1:fo} $1 ${2:tail}$0', 2);
    await completeWithin(mounted, '${1:a}.${2:b}', false, true);
    expect(mounted.editor.getSelections()).toHaveLength(4);
    mounted.type('long');
    mounted.press('Tab');
    mounted.type('end');
    expect(mounted.editor.getText()).toBe('long.end long.end tail\nlong.end long.end tail');
    mounted.press('Tab');
    expect(mounted.editor.getSelections()).toHaveLength(4);
    mounted.press('Tab');
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['tail', 'tail']);
});

test('Escape and undo end every nested frame', async () => {
    const first = await languageSnippet('${1:fo} ${2:tail}$0');
    await completeWithin(first, '${1:a}.${2:b}', false, true);
    first.press('Escape');
    expect(first.language.snippets.isActive).toBe(false);
    expect(first.editor.getSelections()).toHaveLength(1);
    const second = await languageSnippet('${1:fo} ${2:tail}$0');
    await completeWithin(second, '${1:a}.${2:b}', false, true);
    second.editor.runCommand('undo');
    expect(second.language.snippets.isActive).toBe(false);
    expect(second.editor.getText()).toBe('fo tail');
});

test('an edit crossing the active field ends the old session', async () => {
    const { editor, language } = await languageSnippet('prefix ${1:fo} ${2:tail}$0');
    const token = language.snippets.token;
    language.snippets.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, text: 'foo' }], token);
    expect(editor.getText()).toBe('foo tail');
    expect(language.snippets.isActive).toBe(false);
});

test('an accept resolving after Tab does not insert into the new field', async () => {
    const mounted = await languageSnippet('${1:fo} ${2:fo}$0');
    let resolve = (_item: unknown): void => undefined;
    let resolves = 0;
    mounted.service.respond(
        'completionItem/resolve',
        () =>
            new Promise((done) => {
                resolves++;
                resolve = done;
            })
    );
    mounted.service.respond('textDocument/completion', () => [{ label: 'foo', insertText: '${1:a}.${2:b}', insertTextFormat: 2 }, { label: 'food' }]);
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.language.completion.isOpen).toBe(true);
    const pending = mounted.language.completion.accept(false);
    expect(resolves).toBe(1);
    mounted.press('Tab');
    expect(mounted.editor.getSelection().start.character).toBe(3);
    resolve({ label: 'foo', insertText: '${1:a}.${2:b}', insertTextFormat: 2 });
    await pending;
    expect(mounted.editor.getText()).toBe('fo fo');
    expect(mounted.editor.getSelection().start.character).toBe(3);
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    expect(mounted.language.snippets.isActive).toBe(false);
});

test('moving outside a child hull resumes its parent without selecting the field again', async () => {
    const mounted = await languageSnippet('${1:fo} ${2:tail}$0');
    await completeWithin(mounted, '${1:a}.${2:b}', false, true);
    mounted.editor.setCaret({ line: 0, character: mounted.editor.getText().length });
    await Promise.resolve();
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('tail');
});

test('the ninth nested frame starts fresh instead of retaining an unbounded stack', async () => {
    const { editor, language, press } = await languageSnippet('${1:fo} ${2:tail}$0');
    const parsed = parseSnippet('${1:a} ${2:b}$0');
    for (let index = 0; index < 8; index++) {
        const range = editor.getSelection();
        language.snippets.applyEdits([{ range, text: parsed.text }], language.snippets.token);
        language.snippets.beginInstances([{ start: range.start, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], { nested: true });
    }
    press('Tab');
    expect(editor.textInRange(editor.getSelection())).toBe('b');
    press('Tab');
    expect(language.snippets.isActive).toBe(false);
});

test('range limits apply across instances before creating session positions', async () => {
    const { editor, language } = await languageSnippet('${1:x} ${2:tail}$0');
    const parsed = parseSnippet('${1:a} '.repeat(600));
    editor.setText(parsed.text + '\n' + parsed.text);
    language.snippets.beginInstances(
        [0, parsed.text.length + 1].map((offset) => ({ start: editor.positionAt(offset), text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }))
    );
    expect(language.snippets.isActive).toBe(false);
    expect(editor.getText()).toBe(parsed.text + '\n' + parsed.text);
});

test('a group exceeding the render budget leaves every caret unchanged and reports refusal', async () => {
    const { editor, language, timers } = await completion('fo\nfo', '${1:a} '.repeat(600));
    const notices: string[] = [];
    language.project.host.notify = (notice) => notices.push(notice.title);
    editor.setSelections([0, 1].map((line) => ({ start: { line, character: 2 }, end: { line, character: 2 } })));
    language.completion.invoke();
    timers.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(editor.getText()).toBe('fo\nfo');
    expect(notices).toEqual(['Completion is too large to insert']);
    expect(language.snippets.isActive).toBe(false);
});

test('commit characters retain outer stops and land at every mirrored completion', async () => {
    const mounted = await languageSnippet('${1:fo} $1 ${2:tail}$0', 2);
    mounted.service.respond('textDocument/completion', () => [
        { label: 'foo', commitCharacters: [';'] },
        { label: 'food', commitCharacters: [';'] }
    ]);
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.language.completion.isOpen).toBe(true);
    mounted.press(';');
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.editor.getText()).toBe('foo; foo; tail\nfoo; foo; tail');
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['tail', 'tail']);
});

test('caret-specific nested completion retains a mirrored parent and its remaining stops', async () => {
    const mounted = await languageSnippet('${1:fo} $1 ${2:tail}$0');
    await completeWithin(mounted, '${1:$CURSOR_NUMBER}.${2:b}', false, true);
    expect(mounted.editor.getText()).toBe('2.b 1.b tail');
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    mounted.type('end');
    expect(mounted.editor.getText()).toBe('2.end 1.end tail');
    expect(mounted.language.snippets.isActive).toBe(true);
    mounted.press('Tab');
    mounted.press('Tab');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('tail');
    mounted.press('Tab', { shiftKey: true });
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['1.end', '2.end']);
    mounted.type('same');
    expect(mounted.editor.getText()).toBe('same same tail');
    expect(mounted.language.snippets.isActive).toBe(true);
});

test('a resolved item retains inherited snippet fields when the server omits them', async () => {
    const mounted = await completion('fo', 'unused');
    mounted.editor.setCaret({ line: 0, character: 2 });
    mounted.service.respond('textDocument/completion', () => ({
        isIncomplete: false,
        itemDefaults: { insertTextFormat: 2, insertTextMode: 2, editRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } } },
        items: [{ label: 'foo', textEditText: 'foo(${1:x})$0' }]
    }));
    mounted.service.respond('completionItem/resolve', () => ({ label: 'foo', detail: 'resolved' }));
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.editor.getText()).toBe('foo(x)');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('x');
    expect(mounted.language.snippets.isActive).toBe(true);
});

test('a single server with invalid range defaults still supplies a usable snippet', async () => {
    const mounted = await completion('fo', 'unused');
    mounted.editor.setCaret({ line: 0, character: 2 });
    mounted.service.respond('textDocument/completion', () => ({
        isIncomplete: false,
        itemDefaults: { editRange: {}, insertTextFormat: 2 },
        items: [{ label: 'foo', insertText: 'foo(${1:x})$0' }, { label: 'food' }]
    }));
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.language.completion.isOpen).toBe(true);
    await mounted.language.completion.accept(false);
    expect(mounted.editor.getText()).toBe('foo(x)');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('x');
    expect(mounted.language.snippets.isActive).toBe(true);
});

test('an aborted incomplete refresh cannot close its newer refresh', async () => {
    const mounted = await completion('f', 'unused');
    const replies: (() => void)[] = [];
    let first = true;
    const result = { isIncomplete: true, items: [{ label: 'for' }, { label: 'format' }] };
    mounted.service.respond('textDocument/completion', () => {
        if (first) {
            first = false;
            return result;
        }
        return new Promise((resolve) => replies.push(() => resolve(result)));
    });
    mounted.editor.setCaret({ line: 0, character: 1 });
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    mounted.type('o');
    mounted.timers.advance(151);
    mounted.type('r');
    mounted.timers.advance(151);
    expect(replies).toHaveLength(4);
    replies[2]!();
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.language.completion.isOpen).toBe(true);
    replies[3]!();
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.language.completion.isOpen).toBe(true);
    replies[0]!();
    replies[1]!();
});

test('replacing an indented parent removes its trailing empty child', async () => {
    const mounted = await completion('  fo', '${1:foo\n$2}', false, 2);
    mounted.editor.setCaret({ line: 0, character: 4 });
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('foo\n  ');
    mounted.type('new');
    mounted.press('Tab');
    expect(mounted.editor.getText()).toBe('  new');
    expect(mounted.language.snippets.isActive).toBe(false);
    expect(mounted.editor.getCaret()).toEqual({ line: 0, character: 5 });
});

test('explicit multiline completion edits keep fields and the edit-start indentation', async () => {
    const mounted = await completion('  old\n  fo', 'unused');
    mounted.editor.setCaret({ line: 1, character: 4 });
    mounted.service.respond('textDocument/completion', () => [
        {
            label: 'foo',
            insertTextFormat: 2,
            insertTextMode: 2,
            textEdit: { range: { start: { line: 0, character: 2 }, end: { line: 1, character: 4 } }, newText: 'first\n${1:second}$0' }
        },
        { label: 'food' }
    ]);
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    await mounted.language.completion.accept(false);
    expect(mounted.editor.getText()).toBe('  first\n  second');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('second');
});

test('a touching parent does not consume the next occurrences indentation', async () => {
    const mounted = await completion('  fo', '${1:${2}a\n}$1', false, 2);
    mounted.editor.setCaret({ line: 0, character: 4 });
    mounted.language.completion.invoke();
    mounted.timers.advance(1);
    await new Promise<void>((done) => setImmediate(done));
    await mounted.language.completion.accept(false);
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('a\n');
    mounted.type('x');
    expect(mounted.editor.getSelections()).toHaveLength(2);
    expect(mounted.editor.getText()).toBe('  x  x  ');
});
