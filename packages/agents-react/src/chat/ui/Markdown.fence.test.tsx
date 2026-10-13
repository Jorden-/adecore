import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reactMarkdown from 'react-markdown';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost, type ShellCodeBlockContext } from '../../host';
import type { Highlighter } from './highlighter';
import { splitMarkdownBlocks } from './markdown-blocks';

/* Every block that is parsed goes through react-markdown once, so its calls count the parses a render does. */
let parses = 0;
const RealMarkdown = reactMarkdown.default;
mock.module('react-markdown', () => ({
    ...reactMarkdown,
    default: function Markdown(options: Parameters<typeof RealMarkdown>[0]) {
        parses++;
        return RealMarkdown(options);
    }
}));
const { ReplyMarkdown } = await import('./Markdown');

// A reference definition keeps a reply in one block, so the same reply goes through remark as a whole.
const THROUGH_REMARK = '[unused]: https://example.com\n\n';

const REPLY = { scopeId: 'scope', chatId: 'chat', itemId: 'item' };

interface Rendered {
    html: string;
    shell: ShellCodeBlockContext[];
    parses: number;
}

/* A reply drawn to static markup, with the shell code blocks the host was asked to add actions to. */
function renderReply(text: string, streaming: boolean): Rendered {
    const shell: ShellCodeBlockContext[] = [];
    const host: Partial<ChatHost> = {
        renderShellCodeBlock: (context) => {
            shell.push(context);
            return createElement('button', { 'data-language': context.language, 'data-code': context.code, 'data-complete': context.complete }, 'Run');
        }
    };
    const before = parses;
    const html = renderToStaticMarkup(
        createElement(ChatHostProvider, { host }, createElement(ReplyMarkdown, { text, streaming, reply: { ...REPLY, streaming } }))
    );
    return { html: normalized(html), shell, parses: parses - before };
}

/*
 * Without what is irrelevant to the comparison: the line feeds react-markdown writes between the
 * top-level elements it parses as a whole, which a reply drawn a block at a time does not have between
 * its blocks, and the ids `useId` derives from where an element sits in the tree. Code keeps its own.
 */
function normalized(html: string): string {
    return html
        .split(/(<code[^>]*>[\s\S]*?<\/code>)/)
        .map((part, index) => (index % 2 === 1 ? part : part.replace(/>\n+</g, '><').replace(/ id="base-ui-[^"]*"/g, ' id="base-ui"')))
        .join('');
}

const FENCES: [string, string][] = [
    ['a language', '```ts\nconst a = 1;\n```'],
    ['prose before and after', 'Intro paragraph.\n\n```python\nprint("hi")\n```\n\nAfter it.'],
    ['a tilde fence', '~~~js\nlet x;\n~~~'],
    ['a longer marker around a shorter one', '````md\n```\nnested\n```\n````'],
    ['a longer closing fence with spaces after it', '```ts\nx\n`````   \nafter'],
    ['a closing fence that is too deep', '```ts\nx\n    ```\n```'],
    ['an indented opening', '   ```ts\n   indented\n     deeper\n  less\nnone\n   ```'],
    ['a tab under an indented opening', '  ```\n\tTabbed\n  \tmixed\n  ```'],
    ['extra words in the info string', '```ts title="a.ts" {1,2}\ncode\n```'],
    ['a language markdown cuts short', '```c++\nint x;\n```'],
    ['a backtick in the info string of a tilde fence', '~~~ js `x`\ncode\n~~~'],
    ['a backtick in the info string of a backtick fence', '``` js `x`\ntext'],
    ['an empty body', '```\n```'],
    ['a body of blank lines', '```ts\n\n\n```'],
    ['an unclosed fence', 'Intro.\n\n```ts\nconst a = 1;\nconst b'],
    ['an unclosed fence ending in a line feed', '```ts\nconst a = 1;\n'],
    ['an unclosed fence ending in blank lines', '```ts\nconst a = 1;\n\n\n'],
    ['an opening line alone', '```ts'],
    ['CRLF', '```bash\r\nprintf "one"  \r\nprintf "two"\r\n```\r\nAfter\r\n'],
    ['CRLF, unclosed', 'Intro\r\n```ts\r\nconst a = 1;\r\n\r\n'],
    ['a mermaid diagram', '```mermaid\ngraph TD\n  A-->B\n```'],
    ['an unclosed mermaid diagram', '```mermaid\ngraph TD\n  A-->'],
    ['sh', '```sh\nls -la\n```'],
    ['bash', '```bash\n  printf "héllo"  \n\n```'],
    ['zsh with tildes', '~~~zsh\nprintf `pwd`\n~~~~'],
    ['an unclosed shell fence', '```sh\nprintf unfinished\n'],
    ['a shell fence closed by another marker', '~~~zsh\nprintf unfinished\n```'],
    ['an indented shell fence', '  ```sh\n  ls\n  ```'],
    ['a shell fence with an info string', '```sh title\nls\n```'],
    ['a fence right under a paragraph line', 'Run this:\n```sh\nls -la\n```\nThen this.'],
    ['a fence right under a list', '- item\n```ts\nx\n```'],
    ['a fence right under a quote', '> quoted\n```ts\nx\n```'],
    ['a fence right under a table', '| a |\n|---|\n| b |\n```ts\nx\n```'],
    ['fences one under the other', '```sh\na\n```\n```zsh\nb\n```'],
    ['prose of every kind around it', '# Title\n\n- one\n- two\n\n```ts\nx\n```\n\n1. step\n\n**Done.**']
];

describe('a top-level code fence drawn without parsing', () => {
    test.each(FENCES)('draws %s as remark does', (_, text) => {
        for (const streaming of [false, true]) {
            const direct = renderReply(text, streaming);
            const reference = renderReply(THROUGH_REMARK + text, streaming);
            expect(reference.parses).toBe(1);
            expect(direct.html).toBe(reference.html);
            expect(direct.shell).toEqual(reference.shell);
        }
    });

    test('every case but the ones markdown reads differently is drawn directly', () => {
        const remarked = new Set(['a backtick in the info string of a backtick fence']);
        for (const [name, text] of FENCES) {
            expect([name, splitMarkdownBlocks(text).some((block) => block.fence !== undefined)]).toEqual([name, !remarked.has(name)]);
        }
    });

    test('a language markdown decodes is left to markdown', () => {
        const text = '```c\\+\\+\nint x;\n```';
        expect(splitMarkdownBlocks(text).some((block) => block.fence !== undefined)).toBe(false);
        expect(renderReply(text, false).html).toBe(renderReply(THROUGH_REMARK + text, false).html);
    });

    test.each([
        ['a list item', '1. Step\n\n   ```bash\n   ls\n   ```\n2. Next\n   ```sh\n   pwd\n   ```'],
        ['a nested list item', '- one\n  - two\n    ```ts\n    x\n    ```'],
        ['a block quote', '> ```sh\n> printf quoted\n> ```']
    ])('a fence inside %s still goes through remark', (_, text) => {
        expect(splitMarkdownBlocks(text).every((block) => block.fence === undefined)).toBe(true);
        const direct = renderReply(text, false);
        expect(direct.parses).toBeGreaterThan(0);
        expect(direct.html).toContain('chat-code');
        expect(direct.shell).toEqual([]);
        expect(direct.html).toBe(renderReply(THROUGH_REMARK + text, false).html);
    });
});

/* A highlighter of the host with the grammar and the theme already in, so a code block draws its lines at once. */
const highlighter = {
    getLoadedLanguages: () => ['typescript'],
    getLoadedThemes: () => ['github-light'],
    loadLanguage: async () => {},
    loadTheme: async () => {},
    getTheme: () => ({ fg: '#000000' }),
    codeToTokens: (code: string) => ({ tokens: code.split('\n').map((line) => [{ content: line, offset: 0, color: '#123456' }]), grammarState: undefined })
} as unknown as Highlighter;

const host: Partial<ChatHost> = {
    code: { useMode: () => 'light', useThemes: () => ({ light: 'github-light', dark: 'github-dark' }), custom: [], highlighter: async () => highlighter }
};

describe('a streaming reply in a page', () => {
    const page = createPage();
    const fromPage = ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const;
    const names = [...fromPage, 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    let root: Root;

    beforeAll(() => {
        for (const name of fromPage) {
            Object.defineProperty(globalThis, name, { value: name === 'window' ? page.window : page.window[name], configurable: true });
        }
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    });

    afterAll(() => {
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    });

    async function show(text: string, streaming: boolean): Promise<void> {
        await act(async () =>
            root.render(
                <ChatHostProvider host={host}>
                    <ReplyMarkdown text={text} streaming={streaming} />
                </ChatHostProvider>
            )
        );
    }

    async function mount(text: string): Promise<void> {
        root = createRoot(page.host);
        await show(text, true);
        // The lent highlighter arrives after the first frame.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    test('closing a fence keeps its code block and the lines it drew', async () => {
        await mount('Intro\n```ts\nconst a = 1;\nconst b');
        const block = page.host.querySelector('.chat-code');
        const line = page.host.querySelector('.chat-code .line');
        expect(line?.textContent).toBe('const a = 1;');
        await show('Intro\n```ts\nconst a = 1;\nconst b = 2;\n```', true);
        await show('Intro\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter it.', true);
        await show('Intro\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter it.', false);
        expect(page.host.querySelector('.chat-code')).toBe(block);
        expect(page.host.querySelector('.chat-code .line')).toBe(line);
        expect([...page.host.querySelectorAll('.chat-code .line')].map((element) => element.textContent)).toEqual(['const a = 1;', 'const b = 2;']);
        await act(async () => root.unmount());
    });

    test.each([10, 2000])('a word added to a fence of %i lines parses nothing', async (count) => {
        let text = `Intro.\n\n\`\`\`ts\n${Array.from({ length: count }, (_, index) => `const value${index} = ${index};`).join('\n')}\n`;
        await mount(text);
        const before = parses;
        for (let index = 0; index < 30; index++) {
            text += index % 5 === 4 ? '\n' : `word${index} `;
            await show(text, true);
        }
        expect(parses - before).toBe(0);
        expect(page.host.querySelectorAll('.chat-code .line')).toHaveLength(count + 6);
        await act(async () => root.unmount());
    });
});
