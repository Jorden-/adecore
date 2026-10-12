export interface SnippetRange {
    readonly start: number;
    readonly end: number;
}

/* UTF-16 offsets into the inserted text; equal for an empty stop. */
export interface SnippetStop extends SnippetRange {
    readonly index: number;
}

export interface SnippetField {
    readonly index: number;
    readonly ranges: readonly SnippetRange[];
    /* Index into ranges of the occurrence that defines the default. */
    readonly primary: number;
    /* Child positions projected into copies of a parent, not additional syntactic tab stops. */
    readonly linked?: readonly SnippetRange[];
    readonly parents?: readonly number[];
    readonly choices?: readonly string[];
}

export interface ParsedSnippet {
    readonly text: string;
    readonly stops: readonly SnippetStop[];
    /* Optional so callers that construct the older text/stops shape remain valid. */
    readonly fields?: readonly SnippetField[];
}

type Node = { kind: 'text'; text: string } | { kind: 'field'; index: number; body?: Node[]; choices?: string[] } | { kind: 'variable'; body?: Node[] };
type FieldNode = Extract<Node, { kind: 'field' }>;

class SnippetParser {
    private at = 0;
    private readonly source: string;

    constructor(source: string) {
        this.source = source;
    }

    parse(): Node[] {
        return this.sequence(false);
    }

    private sequence(nested: boolean): Node[] {
        const nodes: Node[] = [];
        let text = '';
        const flush = (): void => {
            if (text !== '') {
                nodes.push({ kind: 'text', text });
                text = '';
            }
        };
        while (this.at < this.source.length && !(nested && this.source[this.at] === '}')) {
            const character = this.source[this.at]!;
            if (character === '\\' && /[\\$}]/.test(this.source[this.at + 1] ?? '')) {
                text += this.source[this.at + 1];
                this.at += 2;
            } else if (character === '$') {
                const node = this.dollar();
                if (node === null) {
                    text += '$';
                } else {
                    flush();
                    nodes.push(node);
                }
            } else {
                text += character;
                this.at++;
            }
        }
        flush();
        return nodes;
    }

    private dollar(): Node | null {
        const start = this.at++;
        const brace = this.source[this.at] === '{';
        if (brace) {
            this.at++;
        }
        const name = /^(?:\d+|[A-Za-z_]\w*)/.exec(this.source.slice(this.at))?.[0];
        if (name === undefined) {
            this.at = start + 1;
            return null;
        }
        const index = /^\d+$/.test(name) ? Number(name) : null;
        if (index !== null && !Number.isSafeInteger(index)) {
            this.at = start + 1;
            return null;
        }
        this.at += name.length;
        const field = (): FieldNode => ({ kind: 'field', index: index! });
        if (!brace) {
            return index === null ? { kind: 'variable' } : field();
        }
        const next = this.source[this.at];
        if (next === '}') {
            this.at++;
            return index === null ? { kind: 'variable' } : field();
        }
        if (next === ':') {
            this.at++;
            const body = this.sequence(true);
            if (this.source[this.at] === '}') {
                this.at++;
            }
            return index === null ? { kind: 'variable', body } : { ...field(), body };
        }
        if (next === '|' && index !== null) {
            this.at++;
            return { ...field(), choices: this.choices() };
        }
        if (next === '/' && index === null) {
            this.at = start;
            this.skipBraces();
            return { kind: 'variable' };
        }
        this.at = start + 1;
        return null;
    }

    private choices(): string[] {
        const values = [''];
        while (this.at < this.source.length && !(this.source[this.at] === '|' && this.source[this.at + 1] === '}')) {
            const character = this.source[this.at++]!;
            if (character === '\\' && /[\\,|]/.test(this.source[this.at] ?? '')) {
                values[values.length - 1] += this.source[this.at++]!;
            } else if (character === ',') {
                values.push('');
            } else {
                values[values.length - 1] += character;
            }
        }
        this.at = Math.min(this.source.length, this.at + 2);
        return values;
    }

    private skipBraces(): void {
        let depth = 0;
        while (this.at < this.source.length) {
            const character = this.source[this.at]!;
            this.at += character === '\\' ? 2 : 1;
            if (character === '{') {
                depth++;
            } else if (character === '}' && --depth === 0) {
                return;
            }
        }
    }
}

function renderSnippet(nodes: readonly Node[]): ParsedSnippet {
    const definitions = new Map<number, FieldNode>();
    const collect = (nodes: readonly Node[]): void => {
        for (const node of nodes) {
            if (node.kind === 'field') {
                const known = definitions.get(node.index);
                if (
                    known === undefined ||
                    (known.body === undefined && known.choices === undefined && (node.body !== undefined || node.choices !== undefined))
                ) {
                    definitions.set(node.index, node);
                }
            }
            if (node.kind !== 'text' && node.body !== undefined) {
                collect(node.body);
            }
        }
    };
    collect(nodes);
    const fields = new Map<
        number,
        { index: number; ranges: SnippetRange[]; linked: SnippetRange[]; primary: number; parents: Set<number>; choices?: string[] }
    >();
    const stops: SnippetStop[] = [];
    let text = '';
    const render = (nodes: readonly Node[], linked: boolean, parents: readonly number[], visiting: ReadonlySet<number>): void => {
        for (const node of nodes) {
            if (node.kind === 'text') {
                text += node.text;
                continue;
            }
            if (node.kind === 'variable') {
                render(node.body ?? [], linked, parents, visiting);
                continue;
            }
            const definition = definitions.get(node.index)!;
            const from = text.length;
            if (!visiting.has(node.index)) {
                if (definition.choices !== undefined) {
                    text += definition.choices[0] ?? '';
                } else {
                    render(definition.body ?? [], linked || node !== definition, [...parents, node.index], new Set([...visiting, node.index]));
                }
            }
            const range = { start: from, end: text.length };
            const field = fields.get(node.index) ?? {
                index: node.index,
                ranges: [],
                linked: [],
                primary: 0,
                parents: new Set<number>(),
                choices: definition.choices
            };
            parents.filter((parent) => parent !== node.index).forEach((parent) => field.parents.add(parent));
            if (linked) {
                field.linked.push(range);
            } else {
                if (node === definition) {
                    field.primary = field.ranges.length;
                }
                field.ranges.push(range);
                stops.push({ index: node.index, ...range });
            }
            fields.set(node.index, field);
        }
    };
    render(nodes, false, [], new Set());
    stops.sort((left, right) => left.start - right.start || right.end - left.end);
    return {
        text,
        stops,
        fields: [...fields.values()]
            .filter((field) => field.ranges.length > 0)
            .map((field) => ({
                index: field.index,
                ranges: field.ranges,
                primary: field.primary,
                ...(field.linked.length === 0 ? {} : { linked: field.linked }),
                ...(field.parents.size === 0 ? {} : { parents: [...field.parents] }),
                ...(field.choices === undefined ? {} : { choices: field.choices })
            }))
    };
}

export function parseSnippet(snippet: string): ParsedSnippet {
    return renderSnippet(new SnippetParser(snippet).parse());
}

/* One defining occurrence per index, then $0 or the end of the inserted text. */
export function tabOrder(parsed: ParsedSnippet): SnippetStop[] {
    const first = new Map<number, SnippetStop>();
    for (const stop of parsed.stops) {
        if (!first.has(stop.index)) {
            first.set(stop.index, stop);
        }
    }
    for (const field of parsed.fields ?? []) {
        const range = field.ranges[field.primary];
        if (range !== undefined) {
            first.set(field.index, { index: field.index, ...range });
        }
    }
    const visited = [...first.values()].filter((stop) => stop.index > 0).sort((left, right) => left.index - right.index);
    return [...visited, first.get(0) ?? { index: 0, start: parsed.text.length, end: parsed.text.length }];
}
