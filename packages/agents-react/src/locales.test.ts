import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { AGENTS_LOCALES, AGENTS_NAMESPACES } from './locales';

const HERE = new URL('.', import.meta.url).pathname;

function namespacesOn(language: string): string[] {
    return readdirSync(join(HERE, 'locales', language))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => name.slice(0, -'.ts'.length))
        .sort();
}

async function read(language: string, namespace: string): Promise<unknown> {
    return ((await import(`./locales/${language}/${namespace}`)) as { default: unknown }).default;
}

function strings(value: unknown, prefix = ''): Array<[string, string]> {
    if (typeof value === 'string') {
        return [[prefix, value]];
    }
    if (typeof value !== 'object' || value === null) {
        return [[prefix, '']];
    }
    return Object.entries(value).flatMap(([key, child]) => strings(child, prefix === '' ? key : `${prefix}.${key}`));
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((match) => match[1]!).sort();
}

describe('the words of @adecore/agents-react', () => {
    test('every namespace has a file in every language, and every file a namespace', () => {
        expect(Object.keys(AGENTS_LOCALES).sort()).toEqual(['en', 'nl']);
        for (const language of Object.keys(AGENTS_LOCALES)) {
            expect(namespacesOn(language)).toEqual([...AGENTS_NAMESPACES].sort());
        }
    });

    test.each([...AGENTS_NAMESPACES])('Dutch has every key of %s English has, with the same placeholders, and no other', async (namespace) => {
        const english = new Map(strings(await read('en', namespace)));
        const dutch = new Map(strings(await read('nl', namespace)));
        expect([...dutch.keys()].sort()).toEqual([...english.keys()].sort());
        for (const [key, text] of english) {
            expect([key, placeholders(dutch.get(key) ?? '')]).toEqual([key, placeholders(text)]);
        }
    });

    test('a loader answers every namespace of its language', async () => {
        for (const load of Object.values(AGENTS_LOCALES)) {
            expect(Object.keys(await load()).sort()).toEqual([...AGENTS_NAMESPACES].sort());
        }
    });
});
