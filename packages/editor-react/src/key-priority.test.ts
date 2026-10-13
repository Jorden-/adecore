import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine, type FakeEditor } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { KEY_PRIORITY, KeyDispatcher } from './key-priority.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import type { Timers } from './timers.ts';

const uri = 'file:///work/src/a.ts';

describe('the key dispatcher', () => {
    test('hands a key to the highest priority first, and of two equal ones to the one added first', () => {
        const keys = new KeyDispatcher();
        const seen: string[] = [];
        const add = (name: string, priority: number, takes = false) =>
            keys.add(() => {
                seen.push(name);
                return takes;
            }, priority);
        add('low', 0);
        add('high', 200);
        add('middle', 100);
        add('middle again', 100);
        expect(keys.dispatch({ key: 'a' } as KeyboardEvent)).toBe(false);
        expect(seen).toEqual(['high', 'middle', 'middle again', 'low']);
    });

    test('stops at the first handler that takes the key, and forgets a handler that is removed', () => {
        const keys = new KeyDispatcher();
        const seen: string[] = [];
        const off = keys.add(() => {
            seen.push('taker');
            return true;
        }, 10);
        keys.add(() => {
            seen.push('after');
            return false;
        }, 0);
        expect(keys.dispatch({ key: 'a' } as KeyboardEvent)).toBe(true);
        expect(seen).toEqual(['taker']);
        off();
        off();
        expect(keys.dispatch({ key: 'a' } as KeyboardEvent)).toBe(false);
        expect(seen).toEqual(['taker', 'after']);
    });
});

describe('the keys of an editor language', () => {
    /* Takes Quick Info's shortcut for itself at `priority`, after the features are made. */
    class QuickLanguage extends EditorLanguage {
        readonly taken: string[] = [];

        constructor(project: ProjectLanguage, editor: FakeEditor, timers: Timers, priority?: number) {
            super(project, editor, uri, 'typescript', timers);
            const quickInfo = keyOf(this.shortcuts.quickInfo);
            this.onKey((event) => {
                if (event.key !== quickInfo.key || event.ctrlKey !== quickInfo.ctrlKey) {
                    return false;
                }
                this.taken.push(event.key);
                return true;
            }, priority);
        }
    }

    async function setup(priority?: number) {
        const service = new FakeLanguageService();
        service.respond('textDocument/hover', () => ({ contents: 'const total: number' }));
        const project = new ProjectLanguage(service);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const total = 1;', theme: 'light' });
        editor.moveCaret({ line: 0, character: 8 });
        const language = new QuickLanguage(project, editor, new ManualTimers(), priority);
        await language.document.ready;
        const hovers = () => service.calls.filter((call) => call.method === 'textDocument/hover').length;
        return { editor, language, project, hovers };
    }

    test('a subclass sees a key before a feature when it asks for a higher priority, without subscribing before super()', async () => {
        const { editor, language, project, hovers } = await setup(KEY_PRIORITY.hover + 1);
        expect(editor.press(keyOf(language.shortcuts.quickInfo))).toBe(true);
        expect(language.taken).toEqual(['q']);
        expect(hovers()).toBe(0);
        language.dispose();
        project.dispose();
    });

    test('without a priority a handler comes after every feature, as one on the editor after super() did', async () => {
        const { editor, language, project, hovers } = await setup();
        expect(editor.press(keyOf(language.shortcuts.quickInfo))).toBe(true);
        expect(language.taken).toEqual([]);
        expect(hovers()).toBe(1);
        language.dispose();
        project.dispose();
    });

    test('a handler on the editor before super() still sees a key before every feature', async () => {
        const service = new FakeLanguageService();
        service.respond('textDocument/hover', () => ({ contents: 'const total: number' }));
        const project = new ProjectLanguage(service);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const total = 1;', theme: 'light' });
        const seen: string[] = [];
        editor.onKeyDown((event) => {
            seen.push(event.key);
            return true;
        });
        const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
        await language.document.ready;
        editor.press(keyOf(language.shortcuts.quickInfo));
        expect(seen).toEqual(['q']);
        expect(service.calls.filter((call) => call.method === 'textDocument/hover')).toHaveLength(0);
        language.dispose();
        project.dispose();
    });

    test('lets go of the keys of the editor when disposed', async () => {
        const { editor, language, project } = await setup(KEY_PRIORITY.pick + 1);
        language.dispose();
        expect(editor.press(keyOf(language.shortcuts.quickInfo))).toBe(false);
        expect(language.taken).toEqual([]);
        project.dispose();
    });

    test('ranks the features in the order their construction used to give them', () => {
        expect(
            Object.entries(KEY_PRIORITY)
                .sort((left, right) => right[1] - left[1])
                .map(([name]) => name)
        ).toEqual([
            'pick',
            'diagnostics',
            'hover',
            'completion',
            'snippets',
            'signature',
            'highlights',
            'codeActions',
            'rename',
            'navigation',
            'peek',
            'callHierarchy',
            'symbolPicker',
            'history',
            'renderedDocs'
        ]);
    });
});
