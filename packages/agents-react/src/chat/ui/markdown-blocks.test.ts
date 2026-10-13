import { describe, expect, test } from 'bun:test';
import { settledBlocksText, splitMarkdownBlocks } from './markdown-blocks';

function texts(text: string): string[] {
    return splitMarkdownBlocks(text).map((block) => block.text);
}

describe('splitMarkdownBlocks', () => {
    test('splits at blank lines and joins back into the text', () => {
        const text = '# Title\n\nA paragraph.\n\nAnother one.';
        expect(texts(text)).toEqual(['# Title\n\n', 'A paragraph.\n\n', 'Another one.']);
        expect(texts(text).join('')).toBe(text);
    });

    test('keeps a blank line inside a fence in the same block', () => {
        const text = 'Before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter';
        expect(texts(text)).toEqual(['Before\n\n', '```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n', 'After']);
    });

    test('marks the last block while its fence is still open', () => {
        const blocks = splitMarkdownBlocks('Intro\n\n```ts\nconst a = 1;\n\nconst b');
        expect(blocks.map((block) => block.openFence)).toEqual([false, true]);
        expect(blocks[1]!.text).toBe('```ts\nconst a = 1;\n\nconst b');
    });

    test('a shorter or different run does not close a fence', () => {
        const blocks = splitMarkdownBlocks('````\n```\n\n~~~\ntext');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.openFence).toBe(true);
    });

    test('does not split before a list item or an indented continuation', () => {
        const text = '- one\n\n- two\n\n  still two\n\nDone.';
        expect(texts(text)).toEqual(['- one\n\n- two\n\n  still two\n\n', 'Done.']);
    });

    test('leaves text with a reference definition in one piece', () => {
        const text = 'See [the docs][docs].\n\nMore.\n\n[docs]: https://ruimte.app';
        expect(texts(text)).toEqual([text]);
    });

    test('an empty text is one empty block', () => {
        expect(splitMarkdownBlocks('')).toEqual([{ text: '', openFence: false }]);
    });

    test('a fence line with an info string does not close a fence', () => {
        const blocks = splitMarkdownBlocks('```\ncode\n```ts\n\nstill code');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.openFence).toBe(true);
    });

    test('a closing fence more than three spaces deeper than its opening is a line of code', () => {
        expect(splitMarkdownBlocks('```\ncode\n    ```\n\nstill code')[0]!.openFence).toBe(true);
        expect(splitMarkdownBlocks('- item\n  ```\n  code\n     ```\n\nAfter').map((block) => block.openFence)).toEqual([false, false]);
    });

    test('a line with only a no-break space is not a blank line', () => {
        const text = 'One\n\u00a0\nTwo';
        expect(texts(text)).toEqual([text]);
    });
});

describe('a code fence at the top level', () => {
    test('is a block of its own, also right under a line of text, with the blank lines under it', () => {
        const text = 'Run this:\n```sh\nls\n```\n\nThen this.';
        expect(texts(text)).toEqual(['Run this:\n', '```sh\nls\n```\n\n', 'Then this.']);
        expect(splitMarkdownBlocks(text)[1]!.fence).toEqual({ marker: '```', info: 'sh', body: 'ls', closed: true, source: '```sh\nls\n```' });
    });

    test('ends at the line after its closing fence, whatever that line is', () => {
        expect(texts('```ts\na\n```\n  indented\n- item')).toEqual(['```ts\na\n```\n', '  indented\n- item']);
        expect(texts('```ts\na\n```\n```sh\nb\n```')).toEqual(['```ts\na\n```\n', '```sh\nb\n```']);
    });

    test('reads its marker, info string and body the way markdown does', () => {
        const fence = (text: string) => splitMarkdownBlocks(text).at(-1)!.fence;
        expect(fence('~~~~ js  title="a b"  \nx\n~~~\n~~~~~ \n')).toEqual({
            marker: '~~~~',
            info: 'js  title="a b"',
            body: 'x\n~~~',
            closed: true,
            source: '~~~~ js  title="a b"  \nx\n~~~\n~~~~~ '
        });
        expect(fence('  ```\n  two\n   three\n one\n\tfour\n  ```')!.body).toBe('two\n three\none\n  four');
        expect(fence('```bash\r\nprintf one\r\n\r\nprintf two\r\n```\r\n')).toMatchObject({ body: 'printf one\r\n\r\nprintf two', closed: true });
        expect(fence('```ts\nopen\n')).toEqual({ marker: '```', info: 'ts', body: 'open', closed: false, source: '```ts\nopen\n' });
        expect(fence('```ts\nopen\n\n')).toMatchObject({ body: 'open\n', closed: false });
        expect(fence('```')).toEqual({ marker: '```', info: '', body: '', closed: false, source: '```' });
    });

    test('is no fence where markdown reads the line otherwise', () => {
        const fences = (text: string) => splitMarkdownBlocks(text).filter((block) => block.fence !== undefined).length;
        // A backtick in the info string of a backtick fence, indented code, and a language markdown decodes.
        expect(fences('``` a`b\ntext')).toBe(0);
        expect(fences('Text\n    ```\nmore')).toBe(0);
        expect(fences('\t```\ncode')).toBe(0);
        expect(fences('```c\\+\\+\nint x;\n```')).toBe(0);
        expect(texts('```c\\+\\+\nint x;\n```\nAfter')).toEqual(['```c\\+\\+\nint x;\n```\n', 'After']);
    });

    test('belongs to a list item it is indented into, and ends one it is not', () => {
        const fences = (text: string) => splitMarkdownBlocks(text).map((block) => block.fence !== undefined);
        expect(fences('1. Step\n   ```sh\n   ls\n   ```\n2. Next\n   ```sh\n   pwd\n   ```')).toEqual([false]);
        expect(fences('- one\n  - two\n    ```ts\n    x\n    ```')).toEqual([false]);
        expect(fences('- item\n```ts\nx\n```')).toEqual([false, true]);
        expect(fences('- item\n ```ts\nx\n```')).toEqual([false, true]);
        expect(fences('- item\n  ```ts\n  x\n  ```\n\nText\n\n  ```ts\nx\n  ```')).toEqual([false, false, true]);
    });

    test('is left to markdown past a line markdown may read either way', () => {
        // Under a line of text, `2.` may start a list or continue the paragraph.
        expect(splitMarkdownBlocks('Text\n2. two\n   ```ts\n   x\n   ```').every((block) => block.fence === undefined)).toBe(true);
        // A fence inside raw HTML is part of the HTML.
        expect(splitMarkdownBlocks('<pre>\n```\n</pre>\n\n```ts\na\n\nb\n```').every((block) => block.fence === undefined)).toBe(true);
    });

    test('a blank line inside raw HTML that runs to a marker is no place to cut', () => {
        expect(texts('<!--\n\n-->\n\nAfter')).toEqual(['<!--\n\n-->\n\n', 'After']);
    });

    test('a lone carriage return keeps the text in one piece', () => {
        expect(texts('One\r\n\r```ts\nx\n```')).toEqual(['One\r\n\r```ts\nx\n```']);
    });
});

describe('settledBlocksText', () => {
    test('holds back the block still being written', () => {
        expect(settledBlocksText('First paragraph.\n\nSecond, still')).toBe('First paragraph.\n\n');
        expect(settledBlocksText('Only one so far')).toBe('');
    });

    test('a blank line alone does not settle a block, since the next line may continue it', () => {
        expect(settledBlocksText('- one\n\n')).toBe('');
        expect(settledBlocksText('- one\n\n- two')).toBe('');
        expect(settledBlocksText('- one\n\nDone')).toBe('- one\n\n');
    });

    test('an open fence is never settled, blank lines inside it included', () => {
        expect(settledBlocksText('Intro\n\n```ts\nconst a = 1;\n\nconst b')).toBe('Intro\n\n');
    });

    test('holds a heading until the block under it settles', () => {
        expect(settledBlocksText('Intro\n\n## Setup\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('Intro\n\n# Plan\n\n## Setup\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('Intro\n\n# Plan\n\n## Setup\n\nInstall it.\n\nNext')).toBe('Intro\n\n# Plan\n\n## Setup\n\nInstall it.\n\n');
    });

    test('settles the paragraph above a heading with no blank line between them', () => {
        expect(settledBlocksText('Intro\n## Setup\n\nInstall')).toBe('Intro\n');
    });

    test('holds a line of only bold text like a heading', () => {
        expect(settledBlocksText('**Risk by area:**\n\n| a |\n|---|\n')).toBe('');
        expect(settledBlocksText('Intro\n\n**Use *bun* now**\n\nInstall it')).toBe('Intro\n\n');
        expect(settledBlocksText('**Note:** read this.\n\nNext')).toBe('**Note:** read this.\n\n');
        // Right under a line of text, a bold line continues that paragraph.
        expect(settledBlocksText('Intro\n**Setup**\n\nInstall')).toBe('Intro\n**Setup**\n\n');
    });

    test('settles the text above a fence once the fence opens, and the fence once a line follows it', () => {
        expect(settledBlocksText('Intro\n```ts\na')).toBe('Intro\n');
        expect(settledBlocksText('Intro\n```ts\na\n```\n')).toBe('Intro\n');
        expect(settledBlocksText('Intro\n```ts\na\n```\nNext')).toBe('Intro\n```ts\na\n```\n');
    });

    test('holds a heading above a code block until the fence closes', () => {
        expect(settledBlocksText('## Code\n\n```ts\na\n\nb\n')).toBe('');
        expect(settledBlocksText('## Code\n\n```ts\na\n```\n\nAfter')).toBe('## Code\n\n```ts\na\n```\n\n');
    });
});
