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
    const shift = (offset: number, after = true): number => {
        let low = 0;
        let high = insertions.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (insertions[middle]! < offset || (after && insertions[middle] === offset)) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return offset + low * prefix.length;
    };
    const childStarts = new Map<number, Set<number>>();
    const children = [...(parsed.fields ?? []).flatMap((field) => [...field.ranges, ...(field.linked ?? [])]), ...(parsed.transforms ?? [])];
    for (const child of children) {
        for (const parent of child.parents ?? []) {
            const starts = childStarts.get(parent) ?? new Set<number>();
            starts.add(child.start);
            childStarts.set(parent, starts);
        }
    }
    const range = <Range extends SnippetRange>(range: Range, index?: number): Range => ({
        ...range,
        start: shift(range.start),
        // A child at the newline must remain contained even though other ranges exclude the next prefix.
        end: shift(range.end, range.start === range.end || (index !== undefined && childStarts.get(index)?.has(range.end) === true))
    });
    return {
        text: parsed.text.replace(/\n/g, '\n' + prefix),
        stops: parsed.stops.map((stop) => range(stop, stop.index)),
        ...(parsed.transforms === undefined ? {} : { transforms: parsed.transforms.map((transform) => range(transform)) }),
        ...(parsed.fields === undefined
            ? {}
            : {
                  fields: parsed.fields.map((field) => ({
                      ...field,
                      ranges: field.ranges.map((child) => range(child, field.index)),
                      ...(field.linked === undefined ? {} : { linked: field.linked.map((child) => range(child, field.index)) })
                  }))
              })
    };
}
