export interface MarkdownBlock {
    text: string;
    /* The block ends inside a code fence that has not closed yet. */
    openFence: boolean;
    /* Set when the block is one code fence at the top level of the text, read as markdown reads it. */
    fence?: MarkdownFence;
}

export interface MarkdownFence {
    /* The run of backticks or tildes that opens it. */
    marker: string;
    /* What follows the marker on its line, trimmed. Its first word is the language. */
    info: string;
    /* The lines between the fences, less the indentation of the opening fence. */
    body: string;
    closed: boolean;
    /* The fence as written, from its opening marker to the end of its closing one or of the text. */
    source: string;
}

interface OpenFence {
    marker: string;
    length: number;
    indent: number;
}

interface TopFence {
    // Where the opening marker stands in the text.
    from: number;
    marker: string;
    info: string;
    indent: number;
    body: string;
    // The line ending of the last line in `body`, which goes in front of the next one; null before the first.
    ending: string | null;
    // Markdown decodes an escape or a character reference in the language, so such a fence is left to it.
    direct: boolean;
}

/* The outermost list item a line may still belong to. */
interface ListItem {
    // The column its content starts at; a line less indented than that is not part of it.
    column: number;
    // The bullet, or the delimiter of a number, which a next item of the same list repeats.
    kind: string;
    // False once a line may or may not have ended it, which only markdown itself can tell.
    certain: boolean;
    // Nothing stands in it yet.
    empty: boolean;
}

const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// Spaces and tabs only: a line that holds a no-break space is text to markdown, not a blank line.
const BLANK = /^[ \t]*$/;
// A line that continues what stood before the blank line: an indented paragraph of a list item, or
// the next item of a loose list. Splitting there would change what the markdown means.
const CONTINUES = /^([ \t]|[-*+][ \t]|\d+[.)][ \t])/;
const LIST_MARKER = /^[ \t]*(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/;
// A list item with nothing after its marker.
const EMPTY_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// A heading or a quote, which ends a list item instead of continuing its paragraph.
const ENDS_ITEM = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>)/;
const HTML_START = /^ {0,3}<[A-Za-z/!?]/;
// The HTML that runs on until a marker rather than a blank line, with that marker.
const HTML_UNTIL: [RegExp, RegExp][] = [
    [/^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i, /<\/(?:pre|script|style|textarea)>/i],
    [/^ {0,3}<!--/, /-->/],
    [/^ {0,3}<\?/, /\?>/],
    [/^ {0,3}<![A-Za-z]/, />/],
    [/^ {0,3}<!\[CDATA\[/, /\]\]>/]
];
// A reference or footnote definition may be used anywhere in the text, so a block cannot stand alone.
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
// Markdown ends a line at a lone carriage return too, which a split at line feeds would not see.
const LONE_RETURN = /\r(?!\n|$)/;
// How much deeper than its opening a closing fence may sit; deeper than that it is a line of code.
const CLOSING_INDENT = 3;
// From four columns in, a line is indented code rather than the start of a block.
const CODE_INDENT = 4;
const TAB_STOP = 4;
// A section title: an ATX heading, or a line of only bold text, which models write as a heading too.
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const BOLD_LINE = /^ {0,3}\*\*(?:[^*]|\*(?!\*))+\*\*:?[ \t]*$/;

/*
 * A reply cut into blocks at blank lines outside a code fence, so each block parses on its own and
 * only the one still growing is parsed again. A code fence at the top level is a block of its own,
 * through its closing line and the blank lines under it, so it can be drawn without parsing at all.
 * Joined back together the blocks are the text.
 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
    if (DEFINITION.test(text) || LONE_RETURN.test(text)) {
        return [{ text, openFence: isFenceOpenAtEnd(text) }];
    }
    const lines = text.split('\n');
    const blocks: MarkdownBlock[] = [];
    let start = 0;
    let offset = 0;
    // The fence as a reading line by line sees it, blind to lists and indented code. A blank line is
    // only cut at where this reading agrees, so every such cut is one this split made before it
    // followed fences any further.
    let lineFence: OpenFence | null = null;
    let afterBlank = false;
    // A fence inside a list item.
    let fence: OpenFence | null = null;
    let top: TopFence | null = null;
    // A top-level fence that has closed; its block takes the blank lines under it.
    let closed: { fence: TopFence; source: string } | null = null;
    let item: ListItem | null = null;
    // The marker that ends the raw HTML the line stands in.
    let html: RegExp | null = null;
    // Whether the top level is still known here. Past HTML, or a line that may or may not end a list
    // item, a fence is left inside the block it stands in, which markdown parses as a whole.
    let known = true;
    // Where the line above starts when it is blank.
    let blankAbove: number | null = null;

    const cutAt = (end: number): void => {
        if (end > start) {
            blocks.push({ text: text.slice(start, end), openFence: false });
        }
        start = end;
    };

    for (const [index, line] of lines.entries()) {
        const at = offset;
        offset += line.length + 1;
        const content = withoutReturn(line);
        const blank = BLANK.test(line);
        // Blank to markdown, which a line ending in a carriage return is too.
        const empty = BLANK.test(content);
        const blankCut = lineFence === null && afterBlank && !blank && !CONTINUES.test(line);
        lineFence = nextFence(lineFence, line);
        afterBlank = lineFence === null && blank && index > 0;
        if (top !== null) {
            if (closesFence(top.marker, content)) {
                closed = { fence: top, source: text.slice(top.from, at + content.length) };
                top = null;
            } else if (index < lines.length - 1 || line !== '') {
                // The empty line after a line ending at the end of the text is no line of the fence.
                top.body += (top.ending ?? '') + outdent(content, top.indent);
                top.ending = line.length > content.length ? '\r\n' : '\n';
            }
            continue;
        }
        if (closed !== null) {
            if (empty) {
                continue;
            }
            blocks.push(fenceBlock(text.slice(start, at), closed.fence, closed.source, true));
            start = at;
            closed = null;
        }
        if (html !== null) {
            // Raw HTML holds no fence and no blank line to cut at until its marker.
            if (html.test(content)) {
                html = null;
            }
            continue;
        }
        if (known && fence !== null && item !== null && !empty && columns(content) < item.column) {
            // Code is no paragraph a line may continue lazily, so a line left of the item's content ends
            // the item and its code. A next item of the same list keeps the list going.
            fence = null;
            if (!LIST_MARKER.test(content)) {
                item = null;
            }
        }
        if (blankCut && fence === null) {
            cutAt(at);
        }
        const above = index > 0 ? withoutReturn(lines[index - 1]!) : '';
        const opening = known && fence === null ? openingFence(content) : null;
        if (opening !== null && EMPTY_ITEM.test(above)) {
            // Markdown reads an empty item right above a fence as a list or as text depending on what
            // stands before it, so the two stay in one block.
            known = false;
        } else if (opening !== null && opening.indent < CODE_INDENT && (item === null || opening.indent < item.column)) {
            // The blank line right above goes with the fence. Code in a list item this fence ends takes
            // every blank line under it but the last, and at the end of a block it would take them all.
            cutAt(blankAbove !== null && blankAbove > start ? blankAbove : at);
            // Three columns at most, so the indentation is spaces.
            top = { ...opening, from: at + opening.indent, body: '', ending: null };
            item = null;
            blankAbove = null;
            continue;
        }
        if (known && item?.empty === true && empty) {
            // An item with nothing on its first line ends at a blank line right under it.
            item = null;
        }
        if (known && fence === null && !empty) {
            // A fence in an item is followed only while the item is known to be open, and less than four
            // columns deeper than its content: deeper it is code of the item, or of an item inside it.
            if (opening !== null && item !== null && (!item.certain || opening.indent < item.column || opening.indent >= item.column + CODE_INDENT)) {
                known = false;
            } else if (opening === null) {
                item = nextItem(item, content, index > 0 && !BLANK.test(above));
            }
        }
        if (fence === null && HTML_START.test(content)) {
            known = false;
            const until = HTML_UNTIL.find(([begins]) => begins.test(content))?.[1];
            html = until !== undefined && !until.test(content) ? until : null;
        }
        if (known && (fence !== null || item !== null)) {
            fence = nextFence(fence, fence === null ? itemContent(content) : content);
        }
        if (item?.empty === true && !empty && columns(content) >= item.column) {
            item = { ...item, empty: false };
        }
        blankAbove = empty ? at : null;
    }
    if (top !== null) {
        blocks.push(fenceBlock(text.slice(start), top, text.slice(top.from), false));
    } else if (closed !== null) {
        blocks.push(fenceBlock(text.slice(start), closed.fence, closed.source, true));
    } else {
        blocks.push({ text: text.slice(start), openFence: (known ? fence : lineFence) !== null });
    }
    return blocks;
}

/*
 * The blocks of a reply still being written that will not change any more: every block but the last.
 * A block is only known to be closed once the line after its blank line starts, since that line may
 * still turn out to continue it (a list item, an indented paragraph). A section title waits for the
 * block under it, so it never sits alone above a block that is still streaming.
 */
export function settledBlocksText(text: string): string {
    return withoutTrailingTitles(
        splitMarkdownBlocks(text)
            .slice(0, -1)
            .map((block) => block.text)
            .join('')
    );
}

function withoutTrailingTitles(text: string): string {
    const lines = text.split('\n');
    let end = lines.length;
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index]!;
        if (BLANK.test(line)) {
            continue;
        }
        // A bold line right under a line of text continues that paragraph.
        const title = HEADING.test(line) || (BOLD_LINE.test(line) && (index === 0 || BLANK.test(lines[index - 1]!)));
        if (!title) {
            break;
        }
        end = index;
    }
    if (end === lines.length) {
        return text;
    }
    return lines
        .slice(0, end)
        .map((line) => `${line}\n`)
        .join('');
}

/* The fence a line leaves open: it opens one, closes the one that is open, or changes nothing. */
function nextFence(fence: OpenFence | null, line: string): OpenFence | null {
    const match = FENCE.exec(line);
    if (!match) {
        return fence;
    }
    const indent = match[1]!.length;
    const run = match[2]!;
    const rest = match[3]!;
    if (fence === null) {
        // A backtick fence's info string may not hold a backtick, or the line is inline code.
        if (run[0] === '`' && rest.includes('`')) {
            return null;
        }
        return { marker: run[0]!, length: run.length, indent };
    }
    // A closing fence carries no info string, and a line far deeper than the opening is code.
    if (run[0] === fence.marker && run.length >= fence.length && BLANK.test(rest) && indent <= fence.indent + CLOSING_INDENT) {
        return null;
    }
    return fence;
}

function isFenceOpenAtEnd(text: string): boolean {
    let fence: OpenFence | null = null;
    for (const line of text.split('\n')) {
        fence = nextFence(fence, withoutReturn(line));
    }
    return fence !== null;
}

/* The fence a line opens wherever it stands, with its indentation in columns. */
function openingFence(content: string): Pick<TopFence, 'marker' | 'info' | 'indent' | 'direct'> | null {
    const match = FENCE.exec(content);
    if (!match) {
        return null;
    }
    const marker = match[2]!;
    const info = match[3]!.replace(/^[ \t]+|[ \t]+$/g, '');
    // A backtick fence's info string may not hold a backtick, or the line is inline code.
    if (marker[0] === '`' && info.includes('`')) {
        return null;
    }
    return { marker, info, indent: columns(content), direct: !/[\\&]/.test(info.split(/[ \t]/, 1)[0]!) };
}

/* A line without the carriage return of a CRLF line ending. */
function withoutReturn(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function closesFence(marker: string, content: string): boolean {
    const run = CLOSING_FENCE.exec(content)?.[1];
    return run !== undefined && run[0] === marker[0] && run.length >= marker.length;
}

function fenceBlock(text: string, fence: TopFence, source: string, closed: boolean): MarkdownBlock {
    if (!fence.direct) {
        return { text, openFence: !closed };
    }
    return { text, openFence: !closed, fence: { marker: fence.marker, info: fence.info, body: fence.body, closed, source } };
}

/* The list item a line that is neither blank nor a fence leaves open, as far as a fence needs to know. */
function nextItem(item: ListItem | null, content: string, underLine: boolean): ListItem | null {
    const indent = columns(content);
    if (item !== null && indent >= item.column) {
        return item;
    }
    if (THEMATIC_BREAK.test(content) || ENDS_ITEM.test(content)) {
        return null;
    }
    const marker = indent < CODE_INDENT ? itemMarker(content) : null;
    if (marker === null) {
        if (item === null || !underLine) {
            return null;
        }
        // A line right under an item may continue its paragraph, or follow an item that ends in something else.
        return { ...item, certain: false };
    }
    // Right under another line, only a bullet or a 1 with text after it surely starts a list; anything
    // else may be text of a paragraph above.
    const certain = !underLine || (item !== null && item.certain && item.kind === marker.kind) || (marker.first && marker.rest !== '');
    return { column: marker.column, kind: marker.kind, certain, empty: marker.rest === '' };
}

/* The marker a list item starts with: its kind, whether it may start a list under text, and the column its content starts at. */
function itemMarker(content: string): { kind: string; first: boolean; column: number; rest: string } | null {
    const match = LIST_MARKER.exec(content);
    if (match === null) {
        return null;
    }
    const [, bullet, number, delimiter, spacing = '', rest = ''] = match;
    const indent = columns(content);
    const width = bullet !== undefined ? 1 : number!.length + 1;
    // The content starts after the spaces behind the marker, unless there are five or more: then the
    // item starts with indented code one column after the marker.
    const gap = rest === '' ? 1 : columns(spacing, indent + width);
    const column = indent + width + (gap > CODE_INDENT ? 1 : gap);
    return { kind: bullet ?? delimiter!, first: bullet !== undefined || Number(number) === 1, column, rest };
}

/* A list item's line with its marker as spaces, so a fence on that line is seen where the item's content starts. */
function itemContent(content: string): string {
    const marker = itemMarker(content);
    return marker === null ? content : ' '.repeat(marker.column) + marker.rest;
}

/* The columns of the indentation of a line, which starts at column `from`; a tab reaches to the next stop of four. */
function columns(line: string, from = 0): number {
    let column = from;
    for (const character of line) {
        if (character === '\t') {
            column += TAB_STOP - (column % TAB_STOP);
        } else if (character === ' ') {
            column += 1;
        } else {
            break;
        }
    }
    return column - from;
}

/*
 * A line of a fence less up to `indent` columns of indentation. A tab reaches to the next stop of
 * four, and what of it lies past `indent` stays as spaces, as markdown reads it.
 */
function outdent(line: string, indent: number): string {
    let column = 0;
    let index = 0;
    while (column < indent && index < line.length) {
        const character = line[index];
        if (character === '\t') {
            const stop = column + TAB_STOP - (column % TAB_STOP);
            if (stop > indent) {
                return ' '.repeat(stop - indent) + line.slice(index + 1);
            }
            column = stop;
        } else if (character === ' ') {
            column += 1;
        } else {
            break;
        }
        index += 1;
    }
    return line.slice(index);
}
