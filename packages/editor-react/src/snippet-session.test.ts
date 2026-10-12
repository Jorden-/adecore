import './test-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import { parseSnippet, tabOrder } from './snippet.ts';
import { SnippetFeature } from './snippet-session.ts';

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

async function completion(text: string, source: string, imports = false) {
    const mounted = mountEditor({ text, language: 'typescript' });
    const service = new FakeLanguageService();
    service.respond('textDocument/completion', () => [
        {
            label: 'for',
            insertText: source,
            insertTextFormat: 2,
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
    return { ...mounted, language, timers };
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
