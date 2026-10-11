import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TerminalView } from './TerminalView.tsx';

describe('a terminal view', () => {
    test('is a named region only when it has a label', () => {
        expect(renderToStaticMarkup(<TerminalView label="Build output" />)).toContain('role="region" aria-label="Build output"');
        expect(renderToStaticMarkup(<TerminalView />)).not.toContain('role=');
    });

    test('hands the host to xterm inside the box the caller sizes', () => {
        const markup = renderToStaticMarkup(<TerminalView className="grow" />);
        expect(markup).toMatch(/^<div\b[^>]*><div\b[^>]*><\/div><\/div>$/);
        const classes = [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]!.split(/\s+/));
        expect(classes).toContainEqual(expect.arrayContaining(['terminal-view', 'grow']));
        expect(classes).toContainEqual(expect.arrayContaining(['terminal-view-host']));
    });
});
