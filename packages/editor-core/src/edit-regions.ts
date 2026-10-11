import type { EditSource } from './edit-source.ts';
import { type EditRegion, vueRegionAt } from './languages.ts';
import { hasJsx, jsxChildren } from './markup-regions.ts';

export type EditRegions = (line: number, offset?: number) => EditRegion | null;

const SCAN_LIMIT = 2_000_000;
export function phpLiteralAt(source: EditSource, offset: number): boolean {
    const context = source.context(offset);
    return context.mode === 'heredoc' || context.mode === 'quote' || (context.embedded !== undefined && context.mode === 'template');
}

export function phpTagAt(source: EditSource, offset: number): boolean {
    const context = source.context(offset);
    return context.mode === 'html' && (context.markup === 'tag' || context.markup === 'equals' || context.markup === 'value');
}

function firstContent(source: EditSource, line: number): number {
    const bounds = source.line(line);
    return bounds.start + bounds.text.length - bounds.text.trimStart().length;
}

function mixedPhpLine(source: EditSource, line: number): boolean {
    const bounds = source.line(line);
    let work = SCAN_LIMIT;
    for (const match of bounds.text.matchAll(/<\?(?:php\b|=)|\?>/g)) {
        work -= bounds.text.length + 1;
        if (work < 0) {
            return true;
        }
        const at = bounds.start + match.index;
        const context = source.context(at);
        const { mode, embedded } = context;
        if (match[0] === '?>') {
            if (mode !== 'html' && embedded === undefined) {
                return true;
            }
        } else if (mode === 'html' || embedded !== undefined || (mode === 'code' && at === firstContent(source, line))) {
            return true;
        }
    }
    return false;
}

export function editRegions(source: EditSource, language: string): EditRegions {
    const id = language.toLowerCase();
    const end = source.line(source.lineCount - 1).end;
    if (id === 'vue') {
        return (line) => (/^<\/?(?:template|script|style)\b/.test(source.line(line).text) ? 'mixed' : vueRegionAt((index) => source.line(index).text, line));
    }
    if (hasJsx(id)) {
        let children: ((offset: number) => boolean) | undefined;
        return (line, offset) => {
            if (end > SCAN_LIMIT) {
                return null;
            }
            children ??= jsxChildren(source.slice(0, end));
            return children(offset ?? firstContent(source, line)) ? 'jsx' : null;
        };
    }
    if (id === 'php') {
        return (line, offset) => {
            const bounds = source.line(line);
            if (
                offset === undefined &&
                (phpLiteralAt(source, bounds.start) ||
                    phpLiteralAt(source, bounds.end) ||
                    phpTagAt(source, bounds.start) ||
                    phpTagAt(source, bounds.end) ||
                    mixedPhpLine(source, line))
            ) {
                return 'mixed';
            }
            const at = offset ?? firstContent(source, line);
            const context = source.context(at);
            if (phpTagAt(source, at)) {
                return 'mixed';
            }
            if (context.mode !== 'html' && context.embedded === undefined) {
                return null;
            }
            if (context.markup === 'comment' || (offset === undefined && source.context(bounds.end).markup === 'comment')) {
                return 'mixed';
            }
            if (context.markup === 'raw') {
                const closing = /^<\/(script|style|textarea|title)(?=[\s/>]|$)/i.exec(source.slice(at, at + 11));
                // The closing tag belongs to markup, while the preceding raw text keeps its syntax.
                if (closing?.[1]?.toLowerCase() !== context.element) {
                    return context.element === 'script' || context.element === 'style' ? context.element : 'mixed';
                }
            }
            return 'template';
        };
    }
    return () => null;
}
