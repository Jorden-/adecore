import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { ChatHostProvider, type ChatHost, type FileRef } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { FileLinkContext, useOpenFileLink } from '../ui/file-links';
import { Markdown, MessageMarkdown } from '../ui/Markdown';
import { readTimelineTarget, revealUiReplyBlock, uiReplyJump, withCurrentText } from './timeline-target';
import { compileUi } from '@adecore/intelligent-ui';
import type { TimelineRow } from './timeline';

const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
const scope = { id: 'original-machine' } as ChatScope;

beforeEach(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: { getSelection: () => null } }));
afterEach(() => {
    if (windowBefore) {
        Object.defineProperty(globalThis, 'window', windowBefore);
    } else {
        Reflect.deleteProperty(globalThis, 'window');
    }
});

test('the real Markdown link captures its full ref, cwd and scope without aliasing the host ref', () => {
    const ref: FileRef = { path: 'a folder/日本語.ts', line: 12, column: 4, endLine: 16, directory: false };
    let owner: string | null | undefined;
    const host: Partial<ChatHost> = {
        fileLinks: {
            target: (_text, _cwd, scopeId) => {
                owner = scopeId;
                return ref;
            },
            open: () => {}
        }
    };
    const markup = renderToStaticMarkup(
        createElement(
            ChatHostProvider,
            { host },
            createElement(
                ChatScopeContext.Provider,
                { value: scope },
                createElement(FileLinkContext.Provider, { value: '/original-cwd' }, createElement(Markdown, { text: '[Source](<a folder/日本語.ts:12:4-16>)' }))
            )
        )
    );
    const { document } = parseHTML(markup);
    const target = readTimelineTarget(document.querySelector('button')!, document.body, []);
    expect(owner).toBe('original-machine');
    expect(target.path).toBe(ref.path);
    expect(target.line).toBe(12);
    expect(target.file).toEqual({ ref, cwd: '/original-cwd', scopeId: 'original-machine' });
    ref.line = 99;
    document.querySelector('button')!.dataset.fileScopeId = 'other-machine';
    expect(target.file?.ref.line).toBe(12);
    expect(target.file?.scopeId).toBe('original-machine');
});

test('standalone Markdown uses an explicit null owner and preserves directory refs', () => {
    const host: Partial<ChatHost> = { fileLinks: { target: () => ({ path: '/folder/', directory: true }), open: () => {} } };
    const { document } = parseHTML(renderToStaticMarkup(createElement(ChatHostProvider, { host }, createElement(Markdown, { text: '[Folder](/folder/)' }))));
    expect(readTimelineTarget(document.querySelector('button')!, document.body, []).file).toEqual({
        ref: { path: '/folder/', directory: true },
        cwd: null,
        scopeId: null
    });
});

test('mention chips inherit the nearest timeline origin', () => {
    const chips = renderToStaticMarkup(createElement(MessageMarkdown, { text: '@source.ts', mentions: ['source.ts'] }));
    const { document } = parseHTML(
        `<div data-file-cwd="/parent" data-file-scope-id="parent-machine"><div data-file-cwd="/child" data-file-scope-id="child-machine">${chips}</div></div>`
    );
    const element = document.querySelector<HTMLElement>('[data-file-path]')!;
    expect(readTimelineTarget(element.querySelector('span')!, document.body, []).file).toEqual({
        ref: { path: 'source.ts', directory: false },
        cwd: '/child',
        scopeId: 'child-machine'
    });
});

test('directory mention chips keep their directory flag when opened from the menu', () => {
    const chips = renderToStaticMarkup(createElement(MessageMarkdown, { text: '@source/', mentions: ['source/'] }));
    const { document } = parseHTML(`<div data-file-cwd="/repo" data-file-scope-id="machine">${chips}</div>`);
    const element = document.querySelector<HTMLElement>('[data-file-path]')!;
    expect(readTimelineTarget(element, document.body, []).file).toEqual({
        ref: { path: 'source/', directory: true },
        cwd: '/repo',
        scopeId: 'machine'
    });
});

test('legacy path and line attributes still work, and malformed coordinates do not become locations', () => {
    const { document } = parseHTML('<div data-file-path="old.ts" data-file-line="3"><span>Legacy</span></div>');
    const element = document.querySelector('div')!;
    expect(readTimelineTarget(element.firstElementChild as HTMLElement, document.body, []).file?.ref).toEqual({ path: 'old.ts', line: 3, directory: false });
    element.dataset.fileLine = '1.5';
    element.dataset.fileColumn = '-2';
    element.dataset.fileEndLine = '9';
    expect(readTimelineTarget(element, document.body, []).file?.ref).toEqual({ path: 'old.ts', directory: false });
    element.dataset.fileLine = '12';
    element.dataset.fileEndLine = '3';
    expect(readTimelineTarget(element, document.body, []).file?.ref).toEqual({ path: 'old.ts', line: 12, directory: false });
});

test('two-argument file adapters and helper calls remain supported', () => {
    const calls: unknown[] = [];
    const fileLinks: NonNullable<ChatHost['fileLinks']> = {
        target: (_text, _cwd) => ({ path: '/legacy', directory: false }),
        open: (cwd, ref) => {
            calls.push({ cwd, ref });
        }
    };
    const ref = fileLinks.target('/legacy', null)!;
    function Opener() {
        useOpenFileLink()(null, ref);
        return null;
    }
    renderToStaticMarkup(createElement(ChatHostProvider, { host: { fileLinks } }, createElement(Opener)));
    expect(calls).toEqual([{ cwd: null, ref }]);
});

test('ordinary timeline targets retain row lookup and current-text copy behavior', () => {
    const item = { id: 'answer', kind: 'assistant' as const, turnId: null, createdAt: 0, text: 'Before', streaming: true };
    const row: TimelineRow = { id: item.id, kind: 'assistant', item };
    const { document } = parseHTML('<div data-item-id="answer"><pre><code>printf copy</code></pre></div>');
    const target = readTimelineTarget(document.querySelector('code')!, document.body, [row]);
    expect(target.row).toEqual(row);
    expect(target.code).toBe('printf copy');
    expect(target.file).toBeNull();
    expect(withCurrentText([row], { answer: { ...item, text: 'After' } })).toEqual([{ ...row, item: { ...item, text: 'After' } }]);
});

test('a choice jump loads history, opens its turn and accepts only its original block revision', () => {
    const text = '```ui\n<Summary>Original</Summary>\n```';
    const item = {
        id: 'answer',
        kind: 'assistant' as const,
        turnId: 'turn',
        createdAt: 0,
        text,
        streaming: false,
        ui: compileUi(text, { id: 'answer', final: true })
    };
    const block = item.ui[0]!;
    const target = { itemId: item.id, blockId: block.id, revision: block.revision! };
    const row: TimelineRow = { id: item.id, kind: 'assistant', item };
    expect(uiReplyJump(target, [], {}, new Set(), true)).toEqual({ kind: 'earlier' });
    expect(uiReplyJump(target, [], {}, new Set(), false)).toEqual({ kind: 'missing' });
    expect(uiReplyJump(target, [], { answer: item }, new Set(), true)).toEqual({ kind: 'turn', turnId: 'turn' });
    expect(uiReplyJump(target, [row], { answer: item }, new Set(['turn']), true)).toEqual({ kind: 'row', index: 0 });
    expect(uiReplyJump({ ...target, revision: 'stale' }, [row], { answer: item }, new Set(), true)).toEqual({ kind: 'missing' });
    expect(uiReplyJump({ ...target, blockId: 'different' }, [row], { answer: item }, new Set(), true)).toEqual({ kind: 'missing' });
    expect(uiReplyJump(target, [], { answer: item }, new Set(['turn']), true)).toEqual({ kind: 'missing' });
    expect(uiReplyJump(target, [row], { answer: { id: 'answer', kind: 'user', turnId: null, createdAt: 0, text } }, new Set(), true)).toEqual({
        kind: 'missing'
    });
});

test('a block landing scrolls and focuses only its exact row, block and revision', () => {
    const { document } = parseHTML(
        '<main><div data-item-id="other"><div data-ui-block="block" data-ui-revision="r1"></div></div><div data-item-id="answer"><div data-ui-block="other" data-ui-revision="r1"></div><div data-ui-block="block" data-ui-revision="r1"></div></div></main>'
    );
    const scroller = document.querySelector('main')!;
    const block = scroller.lastElementChild!.lastElementChild as HTMLElement;
    // IDs can contain selector punctuation from a provider.
    scroller.lastElementChild!.setAttribute('data-item-id', 'answer"]');
    block.setAttribute('data-ui-block', 'block"]');
    const target = { itemId: 'answer"]', blockId: 'block"]', revision: 'r1' };
    let focus: unknown = null;
    block.focus = (options) => {
        focus = options;
    };
    scroller.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
    block.getBoundingClientRect = () => ({ top: 180 }) as DOMRect;
    scroller.scrollTop = 300;
    expect(revealUiReplyBlock(scroller, { ...target, revision: 'stale' })).toBe(false);
    expect(scroller.scrollTop).toBe(300);
    expect(focus).toBeNull();
    expect(revealUiReplyBlock(scroller, target)).toBe(true);
    expect(scroller.scrollTop).toBe(430);
    expect(focus).toEqual({ preventScroll: true });
});
