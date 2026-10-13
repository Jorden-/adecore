import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost } from '../../host';
import { CodeBlock } from './CodeBlock';
import type { Highlighter } from './highlighter';

const HOST_COLOR = '#123456';

/* A highlighter of the host with the grammar and the theme already in, which colors every line its own way. */
function hostHighlighter(asked: string[]): Highlighter {
    return {
        getLoadedLanguages: () => ['typescript'],
        getLoadedThemes: () => ['github-light'],
        loadLanguage: async (lang: string) => {
            asked.push(`language ${lang}`);
        },
        loadTheme: async () => {
            asked.push('theme');
        },
        getTheme: () => ({ fg: '#000000' }),
        codeToTokens: (code: string) => ({
            tokens: code.split('\n').map((line) => [{ content: line, offset: 0, color: HOST_COLOR }]),
            grammarState: undefined
        })
    } as unknown as Highlighter;
}

test('a code block draws with the highlighter the host lends, without loading what it already has', async () => {
    const asked: string[] = [];
    const lent = hostHighlighter(asked);
    let borrowed = 0;
    const code: ChatHost['code'] = {
        useMode: () => 'light',
        useThemes: () => ({ light: 'github-light', dark: 'github-dark' }),
        custom: [],
        highlighter: async () => {
            borrowed += 1;
            return lent;
        }
    };
    const page = createPage();
    const fromPage = ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const;
    const names = [...fromPage, 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of fromPage) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? page.window : page.window[name], configurable: true });
    }
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    try {
        await act(async () =>
            root.render(
                <ChatHostProvider host={{ code }}>
                    <CodeBlock code={'const answer = 42;\nexport { answer };'} lang="typescript" />
                </ChatHostProvider>
            )
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const colored = [...page.host.querySelectorAll('pre span')].filter((span) => span.getAttribute('style')?.includes(HOST_COLOR));
        expect(colored.map((span) => span.textContent)).toEqual(['const answer = 42;', 'export { answer };']);
        expect(borrowed).toBe(1);
        expect(asked).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
});
