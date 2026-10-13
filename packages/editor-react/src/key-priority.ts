import type { EditorKeyHandler } from '@adecore/editor';

/*
 * Where each feature of an editor sees a key through `EditorLanguage.onKey`, the highest first. A hundred
 * apart, so a handler of the app can stand between two features; 0, the default, comes after all of them.
 */
export const KEY_PRIORITY = {
    pick: 1500,
    diagnostics: 1400,
    hover: 1300,
    completion: 1200,
    snippets: 1100,
    signature: 1000,
    highlights: 900,
    codeActions: 800,
    rename: 700,
    navigation: 600,
    peek: 500,
    callHierarchy: 400,
    symbolPicker: 300,
    history: 200,
    renderedDocs: 100
} as const;

interface Entry {
    readonly handler: EditorKeyHandler;
    readonly priority: number;
}

/* Hands a key to its handlers by priority until one takes it; of two of the same priority the one added first. */
export class KeyDispatcher {
    private readonly entries: Entry[] = [];

    add(handler: EditorKeyHandler, priority: number): () => void {
        const entry = { handler, priority };
        const index = this.entries.findIndex((other) => other.priority < priority);
        this.entries.splice(index === -1 ? this.entries.length : index, 0, entry);
        return () => {
            const at = this.entries.indexOf(entry);
            if (at !== -1) {
                this.entries.splice(at, 1);
            }
        };
    }

    dispatch(event: KeyboardEvent): boolean {
        return [...this.entries].some((entry) => entry.handler(event));
    }
}
