import type { EditSource } from './edit-source.ts';
import { type EditRegion, vueRegionAt } from './languages.ts';
import { hasJsx, jsxChildren } from './markup-regions.ts';

export type EditRegions = (line: number, offset?: number) => EditRegion | null;

const SCAN_LIMIT = 2_000_000;
interface TagRegion {
    readonly at: number;
    readonly region: 'template' | 'script' | 'style' | 'mixed';
}

export function phpLiteralAt(source: EditSource, offset: number): boolean {
    const mode = source.context(offset).mode;
    return mode === 'heredoc' || mode === 'quote';
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
        const mode = source.context(at).mode;
        if (match[0] === '?>') {
            if (mode !== 'html') {
                return true;
            }
        } else if (mode === 'html' || (mode === 'code' && at === firstContent(source, line))) {
            return true;
        }
    }
    return false;
}

function phpTags(source: EditSource, end: number): TagRegion[] | null {
    const regions: TagRegion[] = [];
    const text = source.slice(0, end);
    const tags = /<!--|<(\/?)([a-z][\w:-]*)(?=[\s/>])/gi;
    const closing = { script: /<\/script(?=[\s/>])[^<>]*>/gi, style: /<\/style(?=[\s/>])[^<>]*>/gi };
    let work = SCAN_LIMIT;
    let exhausted = false;
    const modeAt = (offset: number) => {
        const line = source.line(source.lineAt(offset));
        // PHP markup lookup searches the whole line for its next opening tag.
        work -= line.text.length + 1;
        if (work < 0) {
            exhausted = true;
            return null;
        }
        return source.context(offset).mode;
    };
    const phpEnd = (from: number): number => {
        let close = text.indexOf('?>', from);
        while (close >= 0 && close < end) {
            const mode = modeAt(close);
            if (exhausted) {
                return end;
            }
            if (mode === 'code' || mode === 'line-comment') {
                return close + 2;
            }
            close = text.indexOf('?>', close + 2);
        }
        return end;
    };
    const tagEnd = (from: number): { at: number; closed: boolean } => {
        let quote: string | null = null;
        let at = from;
        while (at < end) {
            const char = text[at]!;
            if (char === '<' && text[at + 1] === '?' && /^<\?(?:php\b|=)/.test(text.slice(at, at + 8))) {
                at = phpEnd(at + 3);
                continue;
            }
            if (quote !== null) {
                if (char === quote) {
                    quote = null;
                }
            } else if (char === '"' || char === "'") {
                quote = char;
            } else if (char === '>') {
                return { at: at + 1, closed: true };
            } else if (char === '<') {
                return { at, closed: false };
            }
            at++;
        }
        return { at, closed: false };
    };
    let active: 'script' | 'style' | null = null;
    let at = 0;
    while (at < end) {
        // Raw script and style bodies only end at their own closing tag.
        const matcher: RegExp = active === null ? tags : closing[active];
        matcher.lastIndex = at;
        const match = matcher.exec(text);
        if (match === null) {
            break;
        }
        at = match.index + match[0].length;
        const mode = modeAt(match.index);
        if (exhausted) {
            return null;
        }
        if (mode !== 'html') {
            continue;
        }
        if (active === null && match[0] === '<!--') {
            regions.push({ at, region: 'mixed' });
            let close = text.indexOf('-->', at);
            while (close >= 0 && close < end && modeAt(close) !== 'html') {
                if (exhausted) {
                    return null;
                }
                close = text.indexOf('-->', close + 3);
            }
            if (exhausted) {
                return null;
            }
            if (close < 0 || close >= end) {
                break;
            }
            at = close + 3;
            regions.push({ at, region: 'template' });
            continue;
        }
        const name: string | undefined = active ?? match[2]?.toLowerCase();
        const closes: boolean = active !== null || match[1] === '/';
        if (active === null) {
            const finish = tagEnd(at);
            if (exhausted) {
                return null;
            }
            at = finish.at;
            if (!finish.closed) {
                continue;
            }
        }
        if (name !== 'script' && name !== 'style') {
            continue;
        }
        active = closes ? null : name;
        regions.push({ at: closes ? match.index : at, region: active ?? 'template' });
    }
    return regions;
}

function tagRegionAt(tags: readonly TagRegion[], offset: number): EditRegion {
    let low = 0;
    let high = tags.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (tags[middle]!.at <= offset) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return tags[low - 1]?.region ?? 'template';
}

/* Scans once for one command, without retaining offsets after its edits. */
export function editRegions(source: EditSource, language: string, through?: number): EditRegions {
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
        let tags: TagRegion[] | null | undefined;
        return (line, offset) => {
            const bounds = source.line(line);
            if (offset === undefined && (phpLiteralAt(source, bounds.start) || phpLiteralAt(source, bounds.end) || mixedPhpLine(source, line))) {
                return 'mixed';
            }
            const at = offset ?? firstContent(source, line);
            if (source.context(at).mode !== 'html') {
                return null;
            }
            if (end > SCAN_LIMIT) {
                return 'mixed';
            }
            if (tags === undefined) {
                tags = phpTags(source, Math.min(end, through ?? end));
            }
            if (tags === null || (offset === undefined && tagRegionAt(tags, source.line(line).end) === 'mixed')) {
                return 'mixed';
            }
            return tagRegionAt(tags, at);
        };
    }
    return () => null;
}
