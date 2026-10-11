import { expect, test } from 'bun:test';
import { createHighlighter, type Highlighter } from 'shiki';
import { diffDocument, patchOf, type DiffDocument } from '@adecore/merge';
import type { DiffSyntaxDocument, DiffSyntaxTokens } from '@adecore/editor/shiki-worker';
import { diffSyntaxDocument } from '@adecore/editor-react';
import { createDiffSyntaxRuntime, diffSourceTokens, type DiffSyntaxMapping, type DiffSyntaxRuntime } from './diff-syntax';

function mapping(document: DiffDocument): DiffSyntaxMapping {
    const build = (side: 'old' | 'new'): DiffSyntaxDocument => ({
        language: 'typescript',
        theme: 'github-dark',
        blocks: document.sides[side].length === 0 ? [] : [document.sides[side].join('\n')],
        resets: []
    });
    return {
        documents: { old: build('old'), new: build('new') },
        locate: (side, index) => (index >= 0 && index < document.sides[side].length ? { block: 0, line: index } : undefined)
    };
}

function fixture(highlighter: Highlighter): () => Promise<Highlighter> {
    // Syntax equality is independent of the production time limit under parallel test load.
    return async () => ({ ...highlighter, codeToTokensBase: (code, options) => highlighter.codeToTokensBase(code, { ...options, tokenizeTimeLimit: 0 }) });
}

test('source tokens keep old and new grammar states and immutable arrays, and request each visible block once', async () => {
    using highlighter = await createHighlighter({ langs: [], themes: [] });
    const old = '/* opening\nold */\nconst value = 1;\n';
    const fresh = '/* opening\nfresh */\nconst value = 2;\n';
    const document = diffDocument(patchOf(old, fresh), { old, new: fresh });
    const base = createDiffSyntaxRuntime({ themes: [], highlighter: fixture(highlighter) });
    let requests = 0;
    const runtime: DiffSyntaxRuntime = {
        open(definition) {
            const session = base.open(definition);
            return {
                ...session,
                request(index) {
                    requests++;
                    return session.request(index);
                }
            };
        },
        dispose: () => base.dispose()
    };
    const source = diffSourceTokens(document, mapping(document), runtime);
    let notices = 0;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const stop = source.subscribe(() => {
        if (++notices === 2) {
            finish();
        }
    });
    expect(source.get('old', 1)).toBeUndefined();
    expect(source.get('old', 0)).toBeUndefined();
    expect(source.get('new', 1)).toBeUndefined();
    expect(requests).toBe(2);
    await ready;
    expect(source.get('old', 1)).toEqual([{ length: 6, color: '#6A737D', fontStyle: 0 }]);
    expect(source.get('new', 1)).toEqual([{ length: 8, color: '#6A737D', fontStyle: 0 }]);
    const tokens = source.get('old', 1);
    expect(source.get('old', 1)).toBe(tokens);
    expect(source.get('old', 2)).toBeDefined();
    expect(requests).toBe(2);
    expect(source.get('old', 999)).toBeNull();
    stop();
    source.dispose();
    expect(source.get('old', 1)).toBeNull();
    runtime.dispose();
});

test('disposed sources suppress late replies and failed blocks remain plain without retry loops', async () => {
    const document = diffDocument(patchOf('old', 'new'), { old: 'old', new: 'new' });
    const replies: Array<(packet: DiffSyntaxTokens | null) => void> = [];
    let disposed = 0;
    let requests = 0;
    const runtime: DiffSyntaxRuntime = {
        open() {
            return {
                request: () => {
                    requests++;
                    return new Promise((resolve) => replies.push(resolve));
                },
                cancel: () => {},
                dispose: () => {
                    disposed++;
                }
            };
        },
        dispose: () => {}
    };
    const source = diffSourceTokens(document, mapping(document), runtime);
    let notices = 0;
    source.subscribe(() => {
        notices++;
    });
    expect(source.get('old', 0)).toBeUndefined();
    replies[0]!(null);
    await Promise.resolve();
    expect(source.get('old', 0)).toBeNull();
    expect(source.get('old', 0)).toBeNull();
    expect(requests).toBe(1);
    expect(notices).toBe(1);
    expect(source.get('new', 0)).toBeUndefined();
    source.dispose();
    replies[1]!(null);
    await Promise.resolve();
    expect(disposed).toBe(2);
    expect(notices).toBe(1);
    expect(source.get('new', 0)).toBeNull();
});

test('an empty side never starts a syntax request', () => {
    const document = diffDocument(patchOf('', '\n'), { old: '', new: '\n' });
    let requests = 0;
    const runtime: DiffSyntaxRuntime = {
        open() {
            return {
                request: async () => {
                    requests++;
                    return null;
                },
                cancel: () => {},
                dispose: () => {}
            };
        },
        dispose: () => {}
    };
    const source = diffSourceTokens(document, mapping(document), runtime);
    expect(source.get('old', 0)).toBeNull();
    expect(requests).toBe(0);
    expect(source.get('new', 0)).toBeUndefined();
    expect(requests).toBe(1);
    source.dispose();
});

test('syntax at the source limits preserves comment state from the first through the last block', async () => {
    using highlighter = await createHighlighter({ langs: [], themes: [] });
    const lines = ['/*' + 'x'.repeat(9998), ...Array.from({ length: 19998 }, () => 'still comment'), 'closing */ const value = 1;'];
    const document: DiffDocument = { sides: { old: lines, new: [] }, hunks: [], offsets: [], snapshots: true, ignoreWhitespace: false, partial: false };
    const runtime = createDiffSyntaxRuntime({ themes: [], highlighter: fixture(highlighter) });
    const source = diffSourceTokens(document, diffSyntaxDocument(document, 'typescript', 'github-dark'), runtime);
    const ready = new Promise<void>((resolve) => source.subscribe(resolve));
    expect(source.get('old', 19999)).toBeUndefined();
    await ready;
    const tokens = source.get('old', 19999)!;
    expect(tokens[0]!.color).toBe('#6A737D');
    expect(tokens.some((token) => token.color !== '#6A737D')).toBe(true);
    source.dispose();
    runtime.dispose();
});
