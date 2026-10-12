/*
 * A documentation comment read the way a person reads it: a description and its tags. The text is
 * Markdown by the time it leaves here. HTML is never passed on; a small, fixed subset is turned into
 * Markdown and every other tag is dropped or left as text.
 */

export interface DocTagEntry {
    /* Canonical: `returns` is `return`, `exception` is `throws`, `arg` and `argument` are `param`. */
    readonly name: string;
    /* The type in the tag, as written, without braces. */
    readonly type: string | null;
    /* The parameter, variable or class the tag is about. */
    readonly subject: string | null;
    /* Markdown. For `example` the code itself. */
    readonly text: string;
}

export interface ParsedDocComment {
    readonly description: string;
    readonly tags: readonly DocTagEntry[];
}

/* The prefix of an address that stands for a name a `{@link}` points at, which the view resolves instead of following. */
export const DOC_LINK_PREFIX = '#doc-link:';

const ALIASES: Readonly<Record<string, string>> = {
    returns: 'return',
    exception: 'throws',
    arg: 'param',
    argument: 'param',
    prop: 'property',
    yields: 'yield',
    link: 'see'
};

/* Tags that carry a type before their subject. */
const TYPED = new Set(['param', 'property', 'return', 'throws', 'var', 'type', 'yield', 'template', 'this']);
/* Tags whose first word is the thing they are about. */
const SUBJECT_FIRST = new Set(['param', 'property', 'var', 'template']);

const TAG_START = /^@([A-Za-z][\w-]*)(?::[\w-]+)?[ \t]*(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const DASH = /^[—–-][ \t]+/;
const DANGEROUS =
    /<(script|style|iframe|object|embed|svg|math|form)\b[\s\S]*?<\/\1\s*>|<\/?(script|style|iframe|object|embed|link|meta|base|svg|math|form|img|video|audio|source|input|button|textarea|select|canvas|frame|frameset)\b[^>]*>/gi;
const SAFE_SCHEME = /^(https?:|mailto:)/i;

/* Reads a type that starts the text: in braces as JSDoc writes it, or as one word with its brackets as PHPDoc does. */
function takeType(text: string, braces: boolean): { type: string | null; rest: string } {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{')) {
        let depth = 0;
        for (let i = 0; i < trimmed.length; i++) {
            depth += trimmed[i] === '{' ? 1 : trimmed[i] === '}' ? -1 : 0;
            if (depth === 0) {
                return { type: trimmed.slice(1, i).trim(), rest: trimmed.slice(i + 1).trimStart() };
            }
        }
        return { type: null, rest: trimmed };
    }
    if (braces || /^[$&.]/.test(trimmed)) {
        return { type: null, rest: trimmed };
    }
    let depth = 0;
    let end = 0;
    for (; end < trimmed.length; end++) {
        const character = trimmed[end]!;
        if ('<([{'.includes(character)) {
            depth++;
        } else if ('>)]}'.includes(character)) {
            depth--;
        } else if (/\s/.test(character) && depth <= 0) {
            break;
        }
    }
    return { type: end === 0 ? null : trimmed.slice(0, end), rest: trimmed.slice(end).trimStart() };
}

/* The first word of a tag's text: a name with its sigils and the `[name=default]` form of JSDoc. */
function takeSubject(text: string): { subject: string | null; rest: string } {
    const optional = /^\[([^\]]+)\]\s*/.exec(text);
    if (optional !== null) {
        return { subject: optional[1]!, rest: text.slice(optional[0].length) };
    }
    const word = /^(?:\.\.\.|&)?[$\w.\\:-]+/.exec(text);
    if (word === null) {
        return { subject: null, rest: text };
    }
    return { subject: word[0], rest: text.slice(word[0].length).trimStart() };
}

/* A comment's lines cut where a tag starts at the beginning of a line, outside a fenced block. */
function splitTags(body: string): { description: string; raw: { name: string; text: string }[] } {
    const description: string[] = [];
    const raw: { name: string; text: string }[] = [];
    let fenced = false;
    for (const line of body.split('\n')) {
        if (FENCE.test(line)) {
            fenced = !fenced;
        }
        const start = fenced ? null : TAG_START.exec(line.trimStart());
        if (start !== null) {
            raw.push({ name: start[1]!.toLowerCase(), text: start[2]! });
        } else if (raw.length > 0) {
            raw[raw.length - 1]!.text += `\n${line}`;
        } else {
            description.push(line);
        }
    }
    return { description: description.join('\n').trim(), raw };
}

function entryOf(name: string, text: string, php: boolean): DocTagEntry {
    let rest = text.trim();
    let type: string | null = null;
    let subject: string | null = null;
    if (TYPED.has(name)) {
        const taken = name === 'return' && rest.startsWith('$this') ? { type: '$this', rest: rest.slice(5).trimStart() } : takeType(rest, !php);
        type = taken.type;
        rest = taken.rest;
        // A type that stands alone is the whole text of a tag that has no subject.
        if (SUBJECT_FIRST.has(name) || (name === 'throws' && type === null)) {
            const word = takeSubject(rest);
            subject = word.subject;
            rest = word.rest;
        }
    } else if (name === 'see' && !rest.startsWith('{')) {
        const target = /^\S+/.exec(rest);
        subject = target === null ? null : target[0];
        rest = target === null ? rest : rest.slice(target[0].length).trimStart();
    }
    if (name === 'throws' && type === null && subject !== null) {
        type = subject;
        subject = null;
    }
    return { name, type, subject, text: rest.replace(DASH, '').trim() };
}

/* Text outside backtick code, which is the only text HTML and inline tags are read in. */
function outsideCode(markdown: string, convert: (text: string) => string): string {
    return markdown
        .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/)
        .map((part, index) => (index % 2 === 1 ? part : convert(part)))
        .join('');
}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...' };

/* Named entities of the small set docblocks use, and numeric ones; anything else stays as written. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
        if (code[0] === '#') {
            const point = code[1]!.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
            return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
        }
        return ENTITIES[code.toLowerCase()] ?? match;
    });
}

function dedent(text: string): string {
    const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
    const indents = lines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
    const common = indents.length === 0 ? 0 : Math.min(...indents);
    return lines.map((line) => line.slice(common)).join('\n');
}

function fenced(body: string): string {
    return `\n\n\`\`\`\n${dedent(decodeEntities(stripTags(body)))}\n\`\`\`\n\n`;
}

function stripTags(html: string): string {
    return html.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

/* The address of a link when it is one a reader may follow; null for everything else, such as a script address. */
export function safeAddress(address: string): string | null {
    const trimmed = decodeEntities(address.trim());
    return SAFE_SCHEME.test(trimmed) || trimmed.startsWith(DOC_LINK_PREFIX) ? trimmed.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29') : null;
}

/*
 * The HTML subset docblocks use, as Markdown: paragraphs and breaks, bold, italic, code, preformatted
 * blocks, links to http, https and mailto, lists, headings and entities. Dangerous elements go with their
 * content, attributes are never copied except a safe `href`, and a tag that is not in the subset is left
 * as the text it was, which the view draws escaped.
 */
export function htmlToMarkdown(source: string): string {
    if (!source.includes('<') && !source.includes('&')) {
        return source;
    }
    const lists: ('ul' | 'ol')[] = [];
    const counters: number[] = [];
    let anchor: string | null = null;
    const blocks = source
        .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_match, body: string) => fenced(body))
        .replace(/<code>([^<]*\n[^<]*)<\/code>/gi, (_match, body: string) => fenced(body));
    const converted = outsideCode(blocks, (text) =>
        text
            .replace(DANGEROUS, '')
            .replace(
                /<(\/?)(p|br|b|strong|i|em|u|code|tt|kbd|samp|var|a|ul|ol|li|h[1-6]|blockquote|hr|div|span|dl|dt|dd|sup|sub|small|center)\b([^>]*?)(\/?)>/gi,
                (_match, close: string, tag: string, attributes: string) => {
                    const closing = close === '/';
                    switch (tag.toLowerCase()) {
                        case 'p':
                        case 'div':
                        case 'dl':
                            return '\n\n';
                        case 'br':
                            return '\n';
                        case 'hr':
                            return '\n\n---\n\n';
                        case 'b':
                        case 'strong':
                            return '**';
                        case 'i':
                        case 'em':
                        case 'var':
                            return '*';
                        case 'code':
                        case 'tt':
                        case 'kbd':
                        case 'samp':
                            return '`';
                        case 'a': {
                            if (closing) {
                                const target = anchor;
                                anchor = null;
                                return target === null ? '' : `](${target})`;
                            }
                            const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
                            anchor = href === null ? null : safeAddress(href[1] ?? href[2] ?? href[3] ?? '');
                            return anchor === null ? '' : '[';
                        }
                        case 'ul':
                        case 'ol':
                            if (closing) {
                                lists.pop();
                                counters.pop();
                            } else {
                                lists.push(tag.toLowerCase() as 'ul' | 'ol');
                                counters.push(0);
                            }
                            return '\n';
                        case 'li': {
                            if (closing) {
                                return '';
                            }
                            const depth = Math.max(0, lists.length - 1);
                            const marker = lists.at(-1) === 'ol' ? `${(counters[depth] = (counters[depth] ?? 0) + 1)}.` : '-';
                            return `\n${'  '.repeat(depth)}${marker} `;
                        }
                        case 'blockquote':
                            return closing ? '\n\n' : '\n\n> ';
                        case 'dt':
                            return closing ? '**\n\n' : '\n\n**';
                        case 'dd':
                            return '\n\n';
                        default:
                            if (/^h[1-6]$/i.test(tag)) {
                                return closing ? '\n\n' : `\n\n${'#'.repeat(Number(tag[1]))} `;
                            }
                            return '';
                    }
                }
            )
    );
    // Entities last, so `&lt;b&gt;` stays the text it spells and is not read as a tag above.
    return outsideCode(converted, decodeEntities).replace(/\n{3,}/g, '\n\n');
}

/*
 * Inline `{@link Name}`, `{@link Name label}`, `{@link Name|label}`, the `linkcode` and `linkplain` forms, `{@see Name}`
 * and `{@code text}`. A name becomes a link the view resolves; an address becomes a link to it.
 */
export function inlineTagsToMarkdown(markdown: string): string {
    return outsideCode(markdown, (text) =>
        text
            .replace(/\{@(?:link|linkcode|linkplain|see)\s+([^}\s|]+)(?:\s*[|\s]\s*([^}]+?))?\s*\}/g, (_match, target: string, label: string | undefined) => {
                const address = /^https?:\/\//i.test(target) ? safeAddress(target) : `${DOC_LINK_PREFIX}${encodeURIComponent(target)}`;
                const shown = label ?? target;
                return address === null ? `\`${shown}\`` : `[${label === undefined ? `\`${shown}\`` : shown}](${address})`;
            })
            .replace(/\{@code\s+([^}]*)\}/g, (_match, code: string) => `\`${code.trim()}\``)
            .replace(/\{@inheritDoc\}/g, '')
    );
}

/* An example's lines without the caption, and without the indentation they share; the text after the tag on its own line is not indented like the rest. */
function exampleOf(text: string): string {
    const code = text.replace(/^\s*<caption>[\s\S]*?<\/caption>[ \t]*\n?/i, '');
    const [head = '', ...tail] = code.split('\n');
    return head.trim() === '' ? dedent(code) : [head.trim(), dedent(tail.join('\n'))].join('\n').trim();
}

function proseOf(text: string): string {
    return inlineTagsToMarkdown(htmlToMarkdown(text)).trim();
}

/* Reads the body of a documentation comment, as `findDocComments` returns it. `php` lets a type stand without braces. */
export function parseDocComment(body: string, options: { php?: boolean } = {}): ParsedDocComment {
    const php = options.php === true;
    const { description, raw } = splitTags(body);
    const tags = raw.map(({ name, text }) => {
        const bare = name.replace(/^(?:psalm|phpstan)-/, '');
        const canonical = ALIASES[bare] ?? bare;
        const entry = entryOf(canonical, text, php);
        // An example is code: it keeps its lines and gets no prose treatment, only its caption removed.
        if (canonical === 'example') {
            return { ...entry, text: exampleOf(text) };
        }
        return { ...entry, text: proseOf(entry.text) };
    });
    return { description: proseOf(description), tags };
}

/* Tags in the order a reader looks for them; every other tag follows in the order it was written. */
const ORDER = ['deprecated', 'template', 'param', 'property', 'type', 'var', 'return', 'yield', 'throws', 'see', 'example', 'since', 'version', 'author'];

export interface DocTagSection {
    readonly name: string;
    readonly tags: readonly DocTagEntry[];
}

/* The tags gathered by name, so a list of parameters is one section, in reading order. */
export function sectionsOf(tags: readonly DocTagEntry[]): DocTagSection[] {
    const byName = new Map<string, DocTagEntry[]>();
    for (const tag of tags) {
        byName.set(tag.name, [...(byName.get(tag.name) ?? []), tag]);
    }
    const rank = (name: string): number => {
        const index = ORDER.indexOf(name);
        return index === -1 ? ORDER.length : index;
    };
    return [...byName].map(([name, entries]) => ({ name, tags: entries })).sort((left, right) => rank(left.name) - rank(right.name));
}
