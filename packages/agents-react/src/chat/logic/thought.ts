import { stripMarkdown } from './timeline-copy';

// A line that is nothing but bold, the way a model titles a stretch of its reasoning.
const HEADING_LINE = /^[ \t]*\*\*([^*\n]+?)\*\*[ \t]*$/;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm;
// A sentence ends on a stop with white space after it, so `a.ts` and `1.5` stay whole.
const SENTENCE_END = /[.!?]["'”’)\]]*(?=\s)/;

/* The thought as one line of plain text: the marks gone and every run of white space one space. */
export function flattenThought(text: string): string {
    return stripMarkdown(text.replace(LIST_MARKER, '')).replace(/\s+/g, ' ').trim();
}

function headingOf(line: string): string | null {
    return HEADING_LINE.exec(line)?.[1] ?? null;
}

/* What a folded thought shows on its one line: the heading it opens with, or the whole thought flattened for the row to cut off. */
export function thoughtPreview(text: string): string {
    const heading = headingOf(text.trimStart().split('\n', 1)[0] ?? '');
    return flattenThought(heading ?? text);
}

/*
 * What the model is thinking about now, in a line: the heading of the last stretch it titled, which
 * is the one it is on, or the first sentence of a thought that titles nothing.
 */
export function thoughtLine(text: string): string {
    const headings = text
        .split('\n')
        .map(headingOf)
        .filter((heading): heading is string => heading !== null);
    const last = headings.at(-1);
    if (last !== undefined) {
        return flattenThought(last);
    }
    const flat = flattenThought(text);
    const end = SENTENCE_END.exec(flat);
    return end === null ? flat : flat.slice(0, end.index + end[0].length);
}
