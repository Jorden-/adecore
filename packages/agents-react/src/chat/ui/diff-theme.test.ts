import { expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveTheme } from '@pierre/diffs';
import { ChatHostProvider, type ChatHost } from '../../host';
import { useDiffTheme } from './diff-theme';

type CodeTheme = ChatHost['code']['custom'][number];

// The library's registry outlives a test, so every theme here has a name of its own.
function themeOf(name: string, foreground: string): CodeTheme {
    return { name, type: 'dark', fg: foreground, bg: '#000000', tokenColors: [] };
}

function Probe() {
    useDiffTheme();
    return null;
}

function codeOf(custom: () => ChatHost['code']['custom'], themes: () => { light: string; dark: string }): ChatHost['code'] {
    return {
        useMode: () => 'dark',
        useThemes: themes,
        get custom() {
            return custom();
        }
    };
}

test('a static array of themes resolves in diffs', async () => {
    const own = themeOf('diff-theme-static', '#111111');
    const code: ChatHost['code'] = { useMode: () => 'dark', useThemes: () => ({ light: own.name, dark: own.name }), custom: [own] };
    renderToStaticMarkup(createElement(ChatHostProvider, { host: { code } }, createElement(Probe)));
    expect((await resolveTheme(own.name)).fg).toBe('#111111');
});

test('a theme the host adds after the first diff resolves once it is picked, and a name is registered once', async () => {
    const first = themeOf('diff-theme-first', '#222222');
    const late = themeOf('diff-theme-late', '#333333');
    let custom: CodeTheme[] = [first];
    let picked = first.name;
    const host = {
        code: codeOf(
            () => custom,
            () => ({ light: picked, dark: picked })
        )
    };
    const errors = spyOn(console, 'error');
    try {
        const render = () => renderToStaticMarkup(createElement(ChatHostProvider, { host }, createElement(Probe)));
        render();
        custom = [first, late];
        picked = late.name;
        render();
        // A host that answers a new array with the same names registers nothing again.
        custom = [{ ...first }, { ...late }];
        render();
        expect(errors).not.toHaveBeenCalled();
    } finally {
        errors.mockRestore();
    }
    expect((await resolveTheme(late.name)).fg).toBe('#333333');
});
