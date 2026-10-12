import type { EditorBlock } from '@adecore/editor';
import type { DocumentSymbol, DocumentSymbolResult, Range, SymbolInformation } from '@adecore/lsp';
import type { EditorLanguage } from './editor-language.ts';
import { Refresher } from './refresher.ts';
import { realTimers, type Timers } from './timers.ts';

const METHOD = 'textDocument/documentSymbol';
const PAUSE_MS = 500;

/* The names a breadcrumb and a sticky header know a symbol kind by; a kind left out is not a block worth pinning. */
const KINDS: Record<number, string> = {
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    9: 'constructor',
    10: 'enum',
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'constant',
    23: 'struct'
};

export interface SymbolSpan {
    readonly name: string;
    readonly kind: number;
    readonly range: Range;
    /* The line of the name, when the server says where the name is. */
    readonly nameLine?: number;
}

function walk(symbols: readonly DocumentSymbol[], spans: SymbolSpan[]): void {
    for (const symbol of symbols) {
        spans.push({ name: symbol.name, kind: symbol.kind, range: symbol.range, nameLine: symbol.selectionRange?.start.line });
        walk(symbol.children ?? [], spans);
    }
}

/* Every symbol of an answer, a parent before its children, whether the server sent a tree or a flat list. */
export function symbolSpansOf(result: DocumentSymbolResult): SymbolSpan[] {
    const spans: SymbolSpan[] = [];
    if (result === null || result.length === 0) {
        return spans;
    }
    if ('range' in result[0]!) {
        walk(result as DocumentSymbol[], spans);
        return spans;
    }
    return (result as SymbolInformation[]).map((symbol) => ({ name: symbol.name, kind: symbol.kind, range: symbol.location.range }));
}

/* A line a declaration can have above it: blank, a comment, or an attribute. A bare `#` is no comment, since it heads a Markdown section. */
const PRELUDE = /^\s*(?:$|\/\/|\/\*|\*|#\[)/;

/*
 * The line a block is pinned by. A range may begin at the doc comment or the attributes of a declaration, so the
 * line of the name wins, and without it the first line below the comment that holds the name.
 */
function headerLineOf({ name, range, nameLine }: SymbolSpan, lines: readonly string[] | undefined): number {
    const { start, end } = range;
    if (nameLine !== undefined && nameLine >= start.line && nameLine <= end.line) {
        return nameLine;
    }
    if (lines === undefined) {
        return start.line;
    }
    const last = Math.min(end.line, lines.length - 1);
    let first = start.line;
    while (first < last && PRELUDE.test(lines[first] ?? '')) {
        first++;
    }
    const short = name.slice(name.lastIndexOf('\\') + 1);
    for (let line = first; line <= last; line++) {
        if (!PRELUDE.test(lines[line] ?? '') && (lines[line] ?? '').includes(short)) {
            return line;
        }
    }
    return first;
}

function blockOf(span: SymbolSpan, lines: readonly string[] | undefined): EditorBlock | null {
    const { name, kind, range } = span;
    const label = KINDS[kind];
    // A one-line symbol has no body to pin, and a property or an enum member is part of the block around it.
    return label === undefined || range.end.line <= range.start.line
        ? null
        : { startLine: headerLineOf(span, lines) + 1, endLine: range.end.line + 1, name, kind: label };
}

/*
 * The multi-line symbols of a file as blocks, outermost first, in one-based lines. The text of the document
 * lets a block start at its declaration rather than at the comment a server counts into the symbol.
 */
export function blocksOf(result: DocumentSymbolResult, text?: string): EditorBlock[] {
    const lines = text?.split('\n');
    const blocks = symbolSpansOf(result).flatMap((span) => blockOf(span, lines) ?? []);
    return blocks.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
}

/*
 * The symbols of the file as the blocks sticky scroll and the breadcrumb go by, with their real names. Until
 * the first answer, and wherever no server has symbols, the editor reads blocks off the text itself.
 */
export class SymbolsFeature {
    private readonly refresher: Refresher;
    private readonly listeners = new Set<(result: DocumentSymbolResult) => void>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                if (!project.service.supports(METHOD, uri)) {
                    return;
                }
                const result = await project.service.documentSymbols(uri, { signal });
                if (!signal.aborted) {
                    editor.setBlocks(result === null ? null : blocksOf(result, editor.getText()));
                    for (const listener of [...this.listeners]) {
                        listener(result);
                    }
                }
            },
            PAUSE_MS,
            timers
        );
        const edits = editor.onTextChange(() => this.refresher.later());
        const providers = language.onProvidersChanged(() => {
            this.refresher.now();
        });
        language.onDispose(() => {
            edits();
            providers();
            this.refresher.dispose();
            editor.setBlocks(null);
        });
    }

    /* Called with every answer that was not replaced before it came. */
    onResult(listener: (result: DocumentSymbolResult) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
