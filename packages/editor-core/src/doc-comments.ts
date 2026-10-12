import { commentRole } from './fold-roles.ts';
import { commentSyntax, vueRegionAt } from './languages.ts';
import { scanStructure } from './structure.ts';

/* A documentation comment that stands on lines of its own, so a row can take its place. */
export interface DocComment {
    /* Offsets of its opener and of the end of its closer. */
    from: number;
    to: number;
    /* Zero-based and inclusive. */
    startLine: number;
    endLine: number;
    /* The whitespace in front of the comment on its first line. */
    indent: string;
    /* The text between the delimiters with the margin stars taken off. */
    body: string;
}

/* Past this many comments in one document the rest are left as text. */
export const MAX_DOC_COMMENTS = 500;

function bodyOf(inner: string): string {
    const lines = inner.split(/\r\n|\r|\n/).map((line, index) => (index === 0 ? line.replace(/^[ \t]+/, '') : line.replace(/^[ \t]*\*?[ \t]?/, '')));
    const last = lines.length - 1;
    lines[last] = lines[last]!.replace(/[ \t*]+$/, '');
    while (lines.length > 0 && lines[0]!.trim() === '') {
        lines.shift();
    }
    while (lines.length > 0 && lines.at(-1)!.trim() === '') {
        lines.pop();
    }
    return lines.map((line) => line.replace(/[ \t]+$/, '')).join('\n');
}

const HEREDOC_OPENER = /<<<[ \t]*(?:'(\w+)'|"(\w+)"|(\w+))\r?\n/g;

/* The bodies of PHP heredocs and nowdocs, which the structure scan reads as code. Offsets of the first character after the opener and of the closing label. */
function heredocBodies(text: string): [number, number][] {
    const result: [number, number][] = [];
    for (const opener of text.matchAll(HEREDOC_OPENER)) {
        const label = opener[1] ?? opener[2] ?? opener[3]!;
        const from = opener.index + opener[0].length;
        const closer = new RegExp(`^[ \\t]*${label}\\b`, 'm').exec(text.slice(from));
        result.push([from, closer === null ? text.length : from + closer.index]);
    }
    return result;
}

/*
 * The block comments that open with two stars and have their lines to themselves: nothing but
 * whitespace before the opener and after the closer. Only languages that write block comments as
 * a slash and a star have any, and a Vue file has them in its script. A comment that shares a line
 * with code is left out, since a row could not take its lines without hiding the code. A banner of
 * three stars or more is no documentation, and nor is the text of a PHP heredoc or nowdoc. A heredoc
 * body is still read as code by the scan, so a quote in it can hide the comments that follow.
 */
export function findDocComments(text: string, language: string, limit = MAX_DOC_COMMENTS): DocComment[] {
    const vue = language.toLowerCase() === 'vue';
    const syntax = commentSyntax(language, vue ? 'script' : null);
    if (syntax.block?.open !== '/*' || syntax.line !== '//' || !text.includes('/**')) {
        return [];
    }
    const result: DocComment[] = [];
    const bodies = language.toLowerCase() === 'php' && text.includes('<<<') ? heredocBodies(text) : [];
    const lines = vue ? text.split(/\r\n|\r|\n/) : null;
    let counted = 0;
    let line = 0;
    for (const range of scanStructure(text)) {
        if (result.length >= limit) {
            break;
        }
        if (range.kind !== 'comment' || commentRole((from, to) => text.slice(from, to), range.from, range.to) === undefined) {
            continue;
        }
        // Three stars or more is a banner, not a comment about the code under it.
        if (text[range.from + 3] === '*' || bodies.some(([from, to]) => range.from >= from && range.from < to)) {
            continue;
        }
        const lineStart = Math.max(text.lastIndexOf('\n', range.from - 1), text.lastIndexOf('\r', range.from - 1)) + 1;
        const newline = text.slice(range.to).search(/[\r\n]/);
        const lineEnd = newline === -1 ? text.length : range.to + newline;
        const before = text.slice(lineStart, range.from);
        if (!/^[ \t]*$/.test(before) || !/^[ \t]*$/.test(text.slice(range.to, lineEnd))) {
            continue;
        }
        for (; counted < range.from; counted++) {
            if (text[counted] === '\n' || (text[counted] === '\r' && text[counted + 1] !== '\n')) {
                line++;
            }
        }
        const startLine = line;
        if (lines !== null && vueRegionAt((index) => lines[index] ?? '', startLine) !== 'script') {
            continue;
        }
        let endLine = startLine;
        for (let at = range.from; at < range.to; at++) {
            if (text[at] === '\n' || (text[at] === '\r' && text[at + 1] !== '\n')) {
                endLine++;
            }
        }
        result.push({ from: range.from, to: range.to, startLine, endLine, indent: before, body: bodyOf(text.slice(range.innerFrom + 1, range.innerTo)) });
    }
    return result;
}
