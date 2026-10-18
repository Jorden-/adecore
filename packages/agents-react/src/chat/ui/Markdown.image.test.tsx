import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatHostProvider, type ChatHost } from '../../host';
import { FileLinkContext } from './file-links';
import { ReplyMarkdown } from './Markdown';

function HostImage({ path, alt }: { path: string; alt: string }) {
    return createElement('figure', { 'data-path': path }, alt);
}

function render(text: string, cwd: string | null, host: Partial<ChatHost> = { MarkdownImage: HostImage }): string {
    return renderToStaticMarkup(
        createElement(
            ChatHostProvider,
            { host },
            createElement(FileLinkContext.Provider, { value: cwd }, createElement(ReplyMarkdown, { text, streaming: false }))
        )
    );
}

describe('an image in a reply', () => {
    test('an absolute path goes to the host', () => {
        expect(render('![Lamp](/home/me/lamp.png)', null)).toContain('<figure data-path="/home/me/lamp.png">Lamp</figure>');
    });

    test('an encoded path goes to the host decoded', () => {
        expect(render('![Lamp](/home/me/lamp%20one.png)', null)).toContain('data-path="/home/me/lamp one.png"');
    });

    test('a relative path counts from the cwd', () => {
        expect(render('![Lamp](./images/lamp.png)', '/repo/')).toContain('data-path="/repo/images/lamp.png"');
    });

    test('a URL and a relative path without a cwd stay as written', () => {
        expect(render('![Lamp](https://example.com/lamp.png)', '/repo')).toContain('<img src="https://example.com/lamp.png" alt="Lamp"/>');
        expect(render('![Lamp](images/lamp.png)', null)).toContain('<img src="images/lamp.png" alt="Lamp"/>');
    });

    test('a host without one keeps the image as written', () => {
        expect(render('![Lamp](/home/me/lamp.png)', null, {})).toContain('<img src="/home/me/lamp.png" alt="Lamp"/>');
    });
});
