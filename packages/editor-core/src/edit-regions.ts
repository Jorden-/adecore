import type { EditSource } from './edit-source.ts';
import { type EditRegion, vueRegionAt } from './languages.ts';
import { hasJsx, jsxChildren } from './markup-regions.ts';

export type EditRegions = (line: number, offset?: number) => EditRegion | null;

const SCAN_LIMIT = 2_000_000;
interface TagRegion {
    readonly at: number;
    readonly region: 'template' | 'script' | 'style' | 'mixed';
}

function firstContent(source: EditSource, line: number): number {
    const bounds = source.line(line);
    return bounds.start + bounds.text.length - bounds.text.trimStart().length;
}

function mixedPhpLine(source: EditSource, line: number): boolean {
    const bounds = source.line(line);
    let work = SCAN_LIMIT;
    for (const match of bounds.text.matchAll(/<\?(?:php\b|=)|\?>/g)) {
        work -= match.index + 1;
        if (work < 0) {
            return true;
        }
        const at = bounds.start + match.index;
        const mode = source.context(at).mode;
        if (match[0] === '?>') {
            if (mode === 'code' || mode === 'line-comment') {
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
    const tags = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const closing = { script: /<\/script\b[^>]*>/gi, style: /<\/style\b[^>]*>/gi };
    let active: 'script' | 'style' | null = null;
    let at = 0;
    let work = SCAN_LIMIT;
    while (at < end) {
        // Raw script and style bodies only end at their own closing tag.
        const matcher: RegExp = active === null ? tags : closing[active];
        matcher.lastIndex = at;
        const match = matcher.exec(text);
        if (match === null) {
            break;
        }
        at = match.index + match[0].length;
        const name: string | undefined = active ?? match[2]?.toLowerCase();
        const comment = active === null && match[0].startsWith('<!--');
        if (!comment && name !== 'script' && name !== 'style') {
            continue;
        }
        const line = source.line(source.lineAt(match.index));
        work -= match.index - line.start + 1;
        if (work < 0) {
            return null;
        }
        if (source.context(match.index).mode !== 'html') {
            continue;
        }
        if (comment) {
            regions.push({ at: match.index + 4, region: 'mixed' });
            if (match[0].endsWith('-->')) {
                regions.push({ at, region: 'template' });
            }
            continue;
        }
        if (name !== 'script' && name !== 'style') {
            continue;
        }
        const closes: boolean = active !== null || match[1] === '/';
        active = closes ? null : name;
        regions.push({ at: match.index + (closes ? 0 : match[0].length), region: active ?? 'template' });
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
        return (line) => vueRegionAt((index) => source.line(index).text, line);
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
            if (offset === undefined && mixedPhpLine(source, line)) {
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
            return tags === null ? 'mixed' : tagRegionAt(tags, at);
        };
    }
    return () => null;
}
