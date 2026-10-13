import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { loadLanguage, loadTheme } from './highlighter';
import { ShellCommand } from './ShellCommand';

function render(command: string): HTMLElement {
    return parseHTML(`<div>${renderToStaticMarkup(createElement(ShellCommand, { command }))}</div>`).document.querySelector('div')!;
}

describe('ShellCommand', () => {
    test('is the command as it is while the grammars load, and the same text colored once they are in', async () => {
        const command = `bash -lc 'cd app && python3 -c "print(1)"'\necho done`;
        const plain = render(command);
        expect(plain.textContent).toBe(command);
        expect(plain.querySelector('span')).toBeNull();
        await Promise.all([loadTheme('github-light', []), loadLanguage('shellscript'), loadLanguage('python')]);
        const drawn = render(command);
        expect(drawn.textContent).toBe(command);
        const colored = [...drawn.querySelectorAll('span')].filter((span) => span.getAttribute('style')?.includes('color'));
        expect(colored.length).toBeGreaterThan(0);
        // Drawn as shell alone, the python would be one quoted string; drawn as python, `print` is a token of its own.
        expect([...drawn.querySelectorAll('span')].some((span) => span.textContent === 'print')).toBe(true);
    });
});
