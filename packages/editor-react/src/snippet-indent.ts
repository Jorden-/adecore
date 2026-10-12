import { MAX_SNIPPET_TEXT, type ParsedSnippet, type SnippetRange } from './snippet.ts';

/* Indentation edits map the offsets once, including child projections in copied parents. */
export function indentSnippet(parsed: ParsedSnippet, before: string): ParsedSnippet {
    const prefix = /^[\t ]*/.exec(before)?.[0] ?? '';
    if (prefix === '' || !parsed.text.includes('\n')) {
        return parsed;
    }
    const insertions: number[] = [];
    for (let offset = parsed.text.indexOf('\n'); offset !== -1; offset = parsed.text.indexOf('\n', offset + 1)) {
        insertions.push(offset + 1);
    }
    if (parsed.text.length + insertions.length * prefix.length > MAX_SNIPPET_TEXT) {
        return { text: parsed.text, stops: [], limited: true };
    }
    const shift = (offset: number): number => {
        let low = 0;
        let high = insertions.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (insertions[middle]! <= offset) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return offset + low * prefix.length;
    };
    const range = <Range extends SnippetRange>(range: Range): Range => ({ ...range, start: shift(range.start), end: shift(range.end) });
    return {
        text: parsed.text.replace(/\n/g, '\n' + prefix),
        stops: parsed.stops.map(range),
        ...(parsed.fields === undefined
            ? {}
            : {
                  fields: parsed.fields.map((field) => ({
                      ...field,
                      ranges: field.ranges.map(range),
                      ...(field.linked === undefined ? {} : { linked: field.linked.map(range) })
                  }))
              })
    };
}
