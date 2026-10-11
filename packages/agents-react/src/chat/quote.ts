/*
 * The text a selection in an answer quotes: its lines without trailing spaces or the blank lines
 * around them, and at most one blank line in a row. A selection of only whitespace quotes nothing.
 */
export function quoteOf(selected: string): string | null {
    const text = selected
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/^\n+|\n+$/g, '')
        .replace(/\n{3,}/g, '\n\n');
    return text.trim() === '' ? null : text;
}

/* The message as it goes out: the quote as a markdown blockquote, a blank line, then what was typed. */
export function withQuote(quote: string, message: string): string {
    if (quote === '') {
        return message;
    }
    const block = quote
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    return message === '' ? block : `${block}\n\n${message}`;
}

/*
 * The inverse of `withQuote`: the quote a message opens with and what follows it. Null when the text
 * does not open with a blockquote that ends on a blank line or the end of the text.
 */
export function splitQuote(text: string): { quote: string; rest: string } | null {
    const lines = text.split('\n');
    let end = 0;
    while (end < lines.length && (lines[end] === '>' || lines[end]!.startsWith('> '))) {
        end += 1;
    }
    if (end === 0 || (end < lines.length && lines[end] !== '')) {
        return null;
    }
    const quote = lines
        .slice(0, end)
        .map((line) => line.slice(2))
        .join('\n');
    return { quote, rest: lines.slice(end + 1).join('\n') };
}
