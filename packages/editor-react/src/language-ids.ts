/* Highlighter ids mapped to the LSP id of the same language. */
const LSP_IDS: Record<string, string> = {
    typescript: 'typescript',
    tsx: 'typescriptreact',
    javascript: 'javascript',
    jsx: 'javascriptreact',
    vue: 'vue',
    php: 'php',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    json: 'json',
    jsonc: 'jsonc',
    yaml: 'yaml',
    python: 'python',
    shellscript: 'shellscript',
    docker: 'dockerfile',
    twig: 'twig',
    sql: 'sql'
};

/* The LSP language id of a file, or null when no language server here knows its language. */
export function lspLanguageIdOf(language: string | undefined): string | null {
    return language === undefined ? null : (LSP_IDS[language] ?? null);
}

const SHIKI_IDS: Record<string, string> = { typescriptreact: 'tsx', javascriptreact: 'jsx' };

/* The highlighter id of an LSP language id, for code a server sends back to be drawn. */
export function shikiLanguageOf(lspLanguageId: string): string {
    return SHIKI_IDS[lspLanguageId] ?? lspLanguageId;
}

const PATH_IDS: Record<string, string> = {
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    vue: 'vue',
    php: 'php',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    twig: 'twig',
    sql: 'sql'
};

/* The highlighter id for the code of a file we only know by its path, such as a place another file refers to. */
export function shikiLanguageOfPath(path: string): string {
    return PATH_IDS[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'text';
}
