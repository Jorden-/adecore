const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/*
 * The longest start of `text` that fits in `max` UTF-16 units, the measure a schema's `max` counts in,
 * cut only between characters as a person sees them. A cut between the halves of a surrogate pair
 * leaves a lone half, which JSON writes as an escape a native client refuses along with its whole frame.
 */
export function clipText(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    let end = 0;
    for (const { segment } of graphemes.segment(text)) {
        if (end + segment.length > max) {
            break;
        }
        end += segment.length;
    }
    return text.slice(0, end);
}

// What a running tool call keeps of the output it streams; the host and every client cut it alike, so a delta grows both the same way.
export const TOOL_OUTPUT_TAIL = 64 * 1024;

/* `output` with `text` after it, cut to its last `TOOL_OUTPUT_TAIL` UTF-16 units, never between the halves of a surrogate pair. */
export function appendToolOutput(output: string | null, text: string): string {
    const whole = (output ?? '') + text;
    let start = whole.length - TOOL_OUTPUT_TAIL;
    if (start <= 0) {
        return whole;
    }
    const unit = whole.charCodeAt(start);
    if (unit >= 0xdc00 && unit <= 0xdfff) {
        start += 1;
    }
    return whole.slice(start);
}
