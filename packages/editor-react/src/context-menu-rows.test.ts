import { describe, expect, test } from 'bun:test';
import en from './locales/en.json';
import nl from './locales/nl.json';
import { menuGroupsOf } from './context-menu-rows.ts';

const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

describe('the rows of the editor context menu', () => {
    test('put every way to jump in the Go to group, declaration among them', () => {
        const groups = menuGroupsOf(() => true);
        expect(ids(groups.goTo)).toEqual(['definition', 'declaration', 'typeDefinition', 'implementation']);
        expect(ids(groups.references)).toEqual(['peekReferences', 'callHierarchy']);
        expect(ids(groups.changes)).toEqual(['renameSymbol', 'codeActions']);
    });

    test('hold only what a server answers, so a group can end up empty', () => {
        const groups = menuGroupsOf((method) => method === 'textDocument/declaration' || method === 'textDocument/rename');
        expect(ids(groups.goTo)).toEqual(['declaration']);
        expect(ids(groups.references)).toEqual([]);
        expect(ids(groups.changes)).toEqual(['renameSymbol']);
    });

    test('keep the keys of the table on the rows that have one', () => {
        const groups = menuGroupsOf(() => true);
        expect(groups.goTo.map((row) => row.shortcut)).toEqual(['goToDefinition', null, 'goToTypeDefinition', 'goToImplementation']);
    });

    test('name the submenu and its rows, and end Rename symbol in an ellipsis since a field follows, in English and Dutch', () => {
        expect(en.language.context.goTo).toEqual({
            menu: 'Go to',
            definition: 'Definition',
            declaration: 'Declaration',
            typeDefinition: 'Type definition',
            implementation: 'Implementation'
        });
        expect(Object.keys(nl.language.context.goTo).sort()).toEqual(Object.keys(en.language.context.goTo).sort());
        expect(en.language.context.renameSymbol).toBe('Rename symbol…');
        expect(nl.language.context.renameSymbol).toBe('Symbool hernoemen…');
    });
});
