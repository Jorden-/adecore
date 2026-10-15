import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileUi } from '@adecore/intelligent-ui';
import { parseHTML } from 'linkedom';
import { ChatHostProvider } from '../../../host';
import { UiReply } from './UiReply';

const THEME = readFileSync(new URL('../../../../../ui/src/theme.css', import.meta.url), 'utf8');
const context = { scopeId: 'scope', chatId: 'chat', itemId: 'item', phase: 'final' as const };

function tokens(selector: string): Record<string, string> {
    const start = THEME.indexOf(`${selector} {`);
    const block = THEME.slice(start, THEME.indexOf('\n}', start));
    return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1], match[2]]));
}

function luminance(hex: string): number {
    const [red, green, blue] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

function drawn(source: string): Document {
    const text = '```ui\n' + source + '\n```';
    const blocks = compileUi(text, { id: 'item', final: true });
    const markup = renderToStaticMarkup(createElement(ChatHostProvider, { host: {} }, createElement(UiReply, { text, blocks, context })));
    return parseHTML(`<body>${markup}</body>`).document;
}

test('the muted text token reads at 4.5 to 1 on the block in both themes, which the faint one does not', () => {
    for (const theme of [tokens(':root, [data-theme="light"]'), tokens('[data-theme="dark"]')]) {
        expect(contrast(theme['text-muted'], theme['surface-raised'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme['text-faint'], theme['surface-raised'])).toBeLessThan(4.5);
    }
});

test('the time and description of an event are muted text, never the faint token', () => {
    const document = drawn('<Timeline><Event at="14:02" detail="Took the node out">Alert fired</Event><Event at="soon">Rolled back</Event></Timeline>');
    const small = [...document.querySelectorAll('li time, li span.text-xs, li div.text-xs')];
    expect(small.map((element) => element.textContent)).toEqual(['02:02 PM', 'Took the node out', 'soon']);
    for (const element of small) {
        expect(element.className).toContain('text-text-muted');
        expect(element.className).not.toContain('text-text-faint');
    }
});

test('a text field sits sunken in its block and its count is muted text', () => {
    const document = drawn('$q = "abcdefgh"\n<TextField value={$q} maxLength={10}>Name</TextField>');
    const input = document.querySelector('input')!;
    expect(input.className).toContain('field');
    expect(input.className).toContain('bg-surface-sunken');
    expect(document.querySelector('[id$="-count"]')?.className).toContain('text-text-muted');
});
