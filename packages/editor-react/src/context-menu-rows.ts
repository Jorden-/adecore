import type { KeymapId } from '@adecore/editor/keymap';
import type { NavigationKind } from './navigation.ts';

export type MenuRowId = NavigationKind | 'peekReferences' | 'callHierarchy' | 'renameSymbol' | 'codeActions';

export interface MenuRowSpec {
    readonly id: MenuRowId;
    readonly method: string;
    readonly shortcut: KeymapId | null;
}

/* The rows of the Go to submenu. Declaration has no key of its own in the table. */
const GO_TO: readonly MenuRowSpec[] = [
    { id: 'definition', method: 'textDocument/definition', shortcut: 'goToDefinition' },
    { id: 'declaration', method: 'textDocument/declaration', shortcut: null },
    { id: 'typeDefinition', method: 'textDocument/typeDefinition', shortcut: 'goToTypeDefinition' },
    { id: 'implementation', method: 'textDocument/implementation', shortcut: 'goToImplementation' }
];

const REFERENCES: readonly MenuRowSpec[] = [
    { id: 'peekReferences', method: 'textDocument/references', shortcut: 'peekReferences' },
    { id: 'callHierarchy', method: 'textDocument/prepareCallHierarchy', shortcut: 'callHierarchy' }
];

const CHANGES: readonly MenuRowSpec[] = [
    { id: 'renameSymbol', method: 'textDocument/rename', shortcut: 'renameSymbol' },
    { id: 'codeActions', method: 'textDocument/codeAction', shortcut: 'codeActions' }
];

export interface MenuGroups {
    readonly goTo: readonly MenuRowSpec[];
    readonly references: readonly MenuRowSpec[];
    readonly changes: readonly MenuRowSpec[];
}

/* The language rows of the context menu in their groups, each holding only the rows a server answers. */
export function menuGroupsOf(supports: (method: string) => boolean): MenuGroups {
    const supported = (rows: readonly MenuRowSpec[]): MenuRowSpec[] => rows.filter((row) => supports(row.method));
    return { goTo: supported(GO_TO), references: supported(REFERENCES), changes: supported(CHANGES) };
}
