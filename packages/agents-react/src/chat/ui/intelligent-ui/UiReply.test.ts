import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileUi } from '@adecore/intelligent-ui';
import { parseHTML } from 'linkedom';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { UiReplyNavigationContext } from '../reply-context';
import { UiReply } from './UiReply';
import { uiReplyParts } from './reply-parts';

const context = { scopeId: 'scope', chatId: 'chat', itemId: 'item', phase: 'final' as const };

test('interleaves prose and several blocks while rejecting overlapping or invalid ranges', () => {
    const text = 'Before\n```ui\n<Summary>One</Summary>\n```\nMiddle\n```ui\n<Summary>Two</Summary>\n```\nAfter';
    const blocks = compileUi(text, { id: 'item', final: true });
    const parts = uiReplyParts(text, [blocks[1], blocks[0], { ...blocks[0], start: -1 }, { ...blocks[1], end: text.length + 1 }]);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'ui', 'text', 'ui', 'text']);
    expect(parts.filter((part) => part.kind === 'text').map((part) => part.text)).toEqual(['Before\n', 'Middle\n', 'After']);
});

test('a growing unfinished block does not echo its uncompiled raw tail as prose', () => {
    const text = 'Before\n```ui\n<Summary>Open';
    const blocks = compileUi(text, { id: 'item' });
    const parts = uiReplyParts(text + ' grows', blocks, true);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'ui']);
});

test('renders compiled nodes in the actual reply composition and falls back for a future catalog', () => {
    const text = '```ui\n<Summary>Result</Summary><Stats><Stat label="Passed" value={3} /></Stats>\n```';
    const blocks = compileUi(text, { id: 'item', final: true });
    const markup = renderToStaticMarkup(createElement(UiReply, { text, blocks, context }));
    expect(markup).toContain('Result');
    expect(markup).toContain('Passed');
    expect(markup).not.toContain('```');
    const future = [{ ...blocks[0], catalogVersion: 999, fallback: 'Future fallback' }];
    expect(renderToStaticMarkup(createElement(UiReply, { text, blocks: future, context }))).toContain('Future fallback');
});

function drawn(source: string, extra: Partial<Omit<typeof context, 'phase'>> & { phase?: 'streaming' | 'final' } = {}, host: Partial<ChatHost> = {}): string {
    const text = '```ui\n' + source + '\n```';
    const blocks = compileUi(text, { id: 'item', final: true });
    return renderToStaticMarkup(createElement(ChatHostProvider, { host }, createElement(UiReply, { text, blocks, context: { ...context, ...extra } })));
}

test('draws written prose as inline Markdown and keeps the space beside a tag', () => {
    const markup = drawn('<Callout tone="info">Use **bold**, *this* and `code` <Tag>new</Tag> now</Callout>');
    expect(markup).toContain('Use <strong>bold</strong>, <em>this</em> and <code');
    expect(markup).toMatch(/>code<\/code> <span/);
    expect(markup).toMatch(/<\/span> now/);
});

test('fades each written word in while the block streams and keeps its Markdown, whitespace and literal text', () => {
    const source = '$name = "**data**"\n<Callout tone="info">Use **bold** and `a b` <Tag>new tag</Tag> {$name} now</Callout>';
    const streaming = drawn(source, { phase: 'streaming' });
    expect(streaming).toContain('<span class="chat-fade">Use</span> <strong><span class="chat-fade">bold</span></strong>');
    expect(streaming).toMatch(/<code[^>]*>a b<\/code>/);
    expect(streaming).toMatch(/<\/code> <span/);
    expect(streaming).toContain('>new tag<');
    expect(streaming).toContain('**data**');
    expect(streaming).toContain('<span class="chat-fade">now</span>');
    const final = drawn(source);
    expect(final).not.toContain('chat-fade');
    expect(final).toContain('Use <strong>bold</strong> and <code');
});

test('leaves code, control labels and the value of an expression as written', () => {
    const markup = drawn(
        '$name = "**data**"\n<Summary>{$name} **prose**</Summary><CodeBlock>a **b**</CodeBlock><Choices><Choice>Fix **all**</Choice></Choices>'
    );
    expect(markup).toContain('**data** <strong>prose</strong>');
    expect(markup).toContain('Fix **all**');
    expect(markup).not.toContain('<strong>b</strong>');
    expect(markup).not.toContain('<strong>all</strong>');
});

test('keeps headings, lists, images and raw addresses out of prose', () => {
    const markup = drawn('<Summary># Not a heading ![x](https://example.com/x.png) - no list [site](https://example.com) [bad](javascript:alert(1))</Summary>');
    expect(markup).toContain('# Not a heading');
    expect(markup).not.toContain('<h1');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<ul');
    expect(markup).not.toContain('<a');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('site');
    const linked = drawn(
        '<Summary>See [site](https://example.com) and [bad](javascript:alert(1))</Summary>',
        {},
        {
            intelligentUi: { openUrl: () => undefined, sendChoice: async () => 'sent' }
        }
    );
    expect(linked.match(/<button[^>]*>site<\/button>/g)).toHaveLength(1);
    expect(linked).toContain('and bad');
});

test('joins a run of text and inline nodes into one padded paragraph between the cards of the block', () => {
    const markup = drawn('Before <Tag>t</Tag> after\n<Steps><Step state="done">One</Step></Steps>\n  ');
    expect(markup).toMatch(/<div class="px-2 text-xs text-text">Before <span[^>]*>.*<\/span> after\s*<\/div><ol class="chat-ui-nodes/);
});

test('sets prose and cards a block gap apart and draws no part for the newline between two fences', () => {
    const text = 'Intro\n```ui\n<Summary>One</Summary>\n```\n```ui\n<Summary>Two</Summary>\n```\n';
    const blocks = compileUi(text, { id: 'item', final: true });
    const markup = renderToStaticMarkup(createElement(UiReply, { text, blocks, context }));
    expect(markup.startsWith('<div class="flex flex-col gap-(--chat-block-gap)">')).toBe(true);
    expect(markup.match(/chat-markdown/g)).toHaveLength(1);
});

test('finds written prose inside a repetition and keeps a repeated value as data', () => {
    const markup = drawn(
        '$rows = [{name: "**a**"}]\n<EntityList><Each items={$rows} as="row"><Entry label="Name">{row.name} is **ready**</Entry></Each></EntityList>'
    );
    expect(markup).toContain('**a** is <strong>ready</strong>');
});

test('an answered block restores its selected input and closes every choice and input', () => {
    const text =
        '```ui\n$count = 2\n<Slider value={$count} min={1} max={5}>Count</Slider><Choices><Choice context={"Build " + $count}>Build</Choice></Choices>\n```';
    const blocks = compileUi(text, { id: 'answered-item', final: true }).map((block) => ({ ...block, revision: 'revision' }));
    const choice = blocks[0].nodes.find((node) => node.type === 'Choices')!.children[0];
    const answer = {
        itemId: 'answered-item',
        blockId: blocks[0].id,
        revision: 'revision',
        choiceId: choice.id,
        label: 'Build',
        at: 1000,
        sourceAt: 500,
        older: false,
        values: { $count: 4 },
        queued: true,
        turnId: 'turn'
    };
    const markup = renderToStaticMarkup(
        createElement(UiReply, { text, blocks, context: { ...context, itemId: 'answered-item' }, answers: { [blocks[0].id]: answer } })
    );
    expect(markup).toContain('Build 4');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('disabled');
    expect(markup).toMatch(/Answered|blocks\.answered/);
});

test('a jump highlights only its original block revision and leaves both blocks focusable', () => {
    const text = '```ui\n<Summary>One</Summary>\n```\n```ui\n<Summary>Two</Summary>\n```';
    const blocks = compileUi(text, { id: 'item', final: true });
    const render = (revision: string) =>
        parseHTML(
            renderToStaticMarkup(
                createElement(
                    UiReplyNavigationContext.Provider,
                    { value: { chatId: 'chat', reveal: () => {}, flash: { itemId: 'item', blockId: blocks[1]!.id, revision, nonce: 1 } } },
                    createElement(UiReply, { text, blocks, context })
                )
            )
        ).document;
    const document = render(blocks[1]!.revision!);
    expect(document.querySelectorAll('[data-ui-block][tabindex="-1"]').length).toBe(2);
    expect(document.querySelectorAll('.chat-flash').length).toBe(1);
    expect(document.querySelector('.chat-flash')!.parentElement!.dataset.uiBlock).toBe(blocks[1]!.id);
    expect(render('stale').querySelector('.chat-flash')).toBeNull();
});

test('numbers in written prose resolve to Sources without changing code, expressions or control labels', () => {
    const html = drawn(
        '$text = "[1]"\n<Callout tone="info">See **[1]** and `[1]` and [9]. {$text}</Callout><Choices><Choice>Pick [1]</Choice></Choices><Sources><Source title="Docs" url="https://adecore.dev"/></Sources>'
    );
    expect(html).toContain('inline-flex h-4 min-w-4.5');
    expect(html).toMatch(/<code[^>]*>\[1\]<\/code>/);
    expect(html).toContain('[9]');
    expect(html).toContain('Pick [1]');
    expect(html).not.toContain('href="https://adecore.dev"');
});

test('a primary choice comes first in the document, not only on screen', () => {
    const markup = drawn('<Choices><Choice>Leave it</Choice><Choice primary={true}>Fix it</Choice></Choices>');
    expect(markup.indexOf('Fix it')).toBeLessThan(markup.indexOf('Leave it'));
    expect(markup).not.toContain('order-first');
});
