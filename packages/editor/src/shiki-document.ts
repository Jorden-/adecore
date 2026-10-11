import type { GrammarState, Highlighter, ShikiTransformer } from 'shiki';
import { documentLanguageOf, loadGrammar } from './shiki.ts';

export function shikiDocumentHighlighter(
    highlighter: () => Promise<Highlighter>,
    blocks: readonly string[],
    language: string,
    theme: string,
    transformers: readonly ShikiTransformer[] = []
): (index: number) => Promise<string> {
    // A CR before the removed LF belongs to the block separator, not the last source line.
    const code = blocks.map((block, index) => (index < blocks.length - 1 ? block.replace(/\r$/, '') : block));
    let prepared: Promise<{ highlighter: Highlighter; language: string }> | undefined;
    let pending = Promise.resolve();
    let grammar: unknown;
    let themeRegistration: unknown;
    let state: GrammarState | undefined;
    let html: string[] = [];

    const prepare = async (): Promise<{ highlighter: Highlighter; language: string }> => {
        const loaded = await highlighter();
        if (!loaded.getLoadedThemes().includes(theme)) {
            await loaded.loadTheme(theme as Parameters<Highlighter['loadTheme']>[0]);
        }
        const documentLanguage = documentLanguageOf(language);
        const known =
            loaded.getLoadedLanguages().includes(documentLanguage) || documentLanguage in loaded.getBundledLanguages() || documentLanguage !== language;
        const grammar = known && (await loadGrammar(loaded, documentLanguage, code.join('\n'))) ? documentLanguage : 'text';
        return { highlighter: loaded, language: grammar };
    };

    return (index) => {
        if (!Number.isInteger(index) || index < 0 || index >= code.length) {
            return Promise.reject(new RangeError('The highlighted block index is outside the document.'));
        }
        const result = pending.then(async () => {
            prepared ??= prepare().catch((error: unknown) => {
                prepared = undefined;
                throw error;
            });
            const { highlighter: loaded, language: grammarId } = await prepared;
            const refresh = (): void => {
                const currentGrammar = grammarId === 'text' ? undefined : loaded.getLanguage(grammarId);
                const currentTheme = loaded.getTheme(theme);
                // Loading an embedded language rebuilds Shiki's grammar and invalidates its old states.
                if (grammar !== currentGrammar || themeRegistration !== currentTheme) {
                    grammar = currentGrammar;
                    themeRegistration = currentTheme;
                    state = undefined;
                    html = [];
                }
            };
            refresh();
            while (html.length <= index) {
                const block = html.length;
                let root: Parameters<NonNullable<ShikiTransformer['root']>>[0] | undefined;
                const rendered = loaded.codeToHtml(code[block]!, {
                    lang: grammarId,
                    theme,
                    grammarState: state,
                    transformers: [
                        ...transformers,
                        {
                            root(node) {
                                root = node;
                            }
                        }
                    ]
                });
                state = root === undefined ? undefined : loaded.getLastGrammarState(root);
                html.push(rendered);
                if (block < index) {
                    // A jump deep into a file must leave room for input and painting between blocks.
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    refresh();
                }
            }
            return html[index]!;
        });
        // A failed theme or grammar load can be retried without rejecting every later request.
        pending = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    };
}
