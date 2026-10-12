import { scanSnippetTransform } from './snippet-transform-format.ts';
import type { SnippetTransformJob } from './snippet-transform-protocol.ts';
import { SNIPPET_VARIABLES } from './snippet-variable-names.ts';

export type SnippetTransform = Omit<SnippetTransformJob, 'value'>;

/* UTF-16 offsets into the inserted text; equal for an empty stop. */
export interface SnippetRange {
    readonly start: number;
    readonly end: number;
    readonly parents?: readonly number[];
    readonly transform?: SnippetTransform;
}

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
    readonly limited?: true;
    readonly text: string;
    readonly stops: readonly SnippetStop[];
    /* Optional so callers that construct the older text/stops shape remain valid. */
    readonly fields?: readonly SnippetField[];
    readonly transforms?: readonly (SnippetRange & { readonly transform: SnippetTransform })[];
}

type Node =
    | { kind: 'text'; text: string; transform?: SnippetTransform }
    | { kind: 'field'; index: number; body?: Node[]; choices?: string[]; transform?: SnippetTransform }
    | { kind: 'variable'; name: string; body?: Node[]; transform?: SnippetTransform };

export type SnippetVariableResolver = (name: string) => string | undefined;
export interface SnippetTemplate {
    readonly source: string;
    render(resolve?: SnippetVariableResolver, variableTransforms?: readonly string[]): ParsedSnippet;
}
type FieldNode = Extract<Node, { kind: 'field' }>;

export const MAX_SNIPPET_TEXT = 100_000;
const MAX_SNIPPET_NODES = 10_000;
const MAX_SNIPPET_WORK = 50_000;
const MAX_SNIPPET_RANGES = 1_000;
const MAX_SNIPPET_DEPTH = 64;

class SnippetLimitError extends Error {}
class MalformedSnippetError extends Error {}

class SnippetParser {
    private at = 0;
    private nodes = 0;
    private depth = 0;
    private readonly name = /(?:\d+|[A-Za-z_]\w*)/y;
    private readonly source: string;

    constructor(source: string) {
        this.source = source;
    }

    parse(): Node[] {
        return this.sequence(false);
    }

    private sequence(nested: boolean): Node[] {
        if (++this.depth > MAX_SNIPPET_DEPTH) {
            throw new SnippetLimitError();
        }
        const nodes: Node[] = [];
        let text = '';
        const flush = (): void => {
            if (text !== '') {
                this.push(nodes, { kind: 'text', text });
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
                    this.push(nodes, node);
                }
            } else {
                text += character;
                this.at++;
            }
        }
        flush();
        this.depth--;
        return nodes;
    }

    private push(nodes: Node[], node: Node): void {
        if (++this.nodes > MAX_SNIPPET_NODES) {
            throw new SnippetLimitError();
        }
        nodes.push(node);
    }

    private dollar(): Node | null {
        const start = this.at++;
        const brace = this.source[this.at] === '{';
        if (brace) {
            this.at++;
        }
        this.name.lastIndex = this.at;
        const name = this.name.exec(this.source)?.[0];
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
            return index === null ? { kind: 'variable', name } : field();
        }
        const next = this.source[this.at];
        if (next === '}') {
            this.at++;
            return index === null ? { kind: 'variable', name } : field();
        }
        if (next === ':') {
            this.at++;
            const body = this.sequence(true);
            if (this.source[this.at] === '}') {
                this.at++;
            }
            return index === null ? { kind: 'variable', name, body } : { ...field(), body };
        }
        if (next === '|' && index !== null) {
            this.at++;
            return { ...field(), choices: this.choices() };
        }
        if (next === '/') {
            try {
                const { end, ...transform } = scanSnippetTransform(this.source, this.at);
                this.at = end;
                return index === null ? { kind: 'variable', name, transform } : { ...field(), transform };
            } catch (error) {
                if (error instanceof RangeError) {
                    throw new SnippetLimitError();
                }
                if (error instanceof SyntaxError) {
                    throw new MalformedSnippetError();
                }
                throw error;
            }
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
                if (values.length >= MAX_SNIPPET_NODES) {
                    throw new SnippetLimitError();
                }
                values.push('');
            } else {
                values[values.length - 1] += character;
            }
        }
        this.at = Math.min(this.source.length, this.at + 2);
        return values;
    }
}

function renderSnippet(nodes: readonly Node[], variableTransforms?: readonly string[]): ParsedSnippet {
    const definitions = new Map<number, FieldNode>();
    const collect = (nodes: readonly Node[]): void => {
        for (const node of nodes) {
            if (node.kind === 'field') {
                const known = definitions.get(node.index);
                if (
                    known === undefined ||
                    (known.body === undefined &&
                        known.choices === undefined &&
                        (node.body !== undefined || node.choices !== undefined || (known.transform !== undefined && node.transform === undefined)))
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
    const transforms: (SnippetRange & { transform: SnippetTransform })[] = [];
    let text = '';
    let work = 0;
    let ranges = 0;
    const append = (value: string): void => {
        if (text.length + value.length > MAX_SNIPPET_TEXT) {
            throw new SnippetLimitError();
        }
        text += value;
    };
    const render = (nodes: readonly Node[], linked: boolean, parents: readonly number[], visiting: ReadonlySet<number>): void => {
        if (parents.length > MAX_SNIPPET_DEPTH) {
            throw new SnippetLimitError();
        }
        for (const node of nodes) {
            if (++work > MAX_SNIPPET_WORK) {
                throw new SnippetLimitError();
            }
            if (node.kind === 'text') {
                const start = text.length;
                const value = node.transform === undefined || variableTransforms === undefined ? node.text : variableTransforms[transforms.length];
                if (typeof value !== 'string') {
                    throw new RangeError('The variable transform count does not match the snippet.');
                }
                append(value);
                if (node.transform !== undefined) {
                    if (++ranges > MAX_SNIPPET_RANGES) {
                        throw new SnippetLimitError();
                    }
                    transforms.push({ start, end: text.length, transform: node.transform, ...(parents.length === 0 ? {} : { parents: [...parents] }) });
                }
                continue;
            }
            if (node.kind === 'variable') {
                render(node.body ?? [], linked, parents, visiting);
                continue;
            }
            if (++ranges > MAX_SNIPPET_RANGES) {
                throw new SnippetLimitError();
            }
            const definition = definitions.get(node.index)!;
            const from = text.length;
            if (!visiting.has(node.index)) {
                if (definition.choices !== undefined) {
                    append(definition.choices[0] ?? '');
                } else {
                    render(definition.body ?? [], linked || node !== definition, [...parents, node.index], new Set([...visiting, node.index]));
                }
            }
            const range: SnippetRange = {
                start: from,
                end: text.length,
                ...(parents.length === 0 ? {} : { parents: [...parents] }),
                ...(node.transform === undefined ? {} : { transform: node.transform })
            };
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
                stops.push({ index: node.index, start: range.start, end: range.end, ...(node.transform === undefined ? {} : { transform: node.transform }) });
            }
            fields.set(node.index, field);
        }
    };
    render(nodes, false, [], new Set());
    if (variableTransforms !== undefined && variableTransforms.length !== transforms.length) {
        throw new RangeError('The variable transform count does not match the snippet.');
    }
    stops.sort((left, right) => left.start - right.start || right.end - left.end);
    return {
        text,
        stops,
        ...(transforms.length === 0 ? {} : { transforms }),
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

function variableIndices(nodes: readonly Node[]): ReadonlyMap<string, number> {
    let highest = 0;
    const names = new Set<string>();
    const scan = (nodes: readonly Node[]): void => {
        for (const node of nodes) {
            if (node.kind === 'field') {
                highest = Math.max(highest, node.index);
            } else if (node.kind === 'variable' && !SNIPPET_VARIABLES.has(node.name)) {
                names.add(node.name);
            }
            if (node.kind !== 'text' && node.body !== undefined) {
                scan(node.body);
            }
        }
    };
    scan(nodes);
    return new Map(
        [...names].map((name) => {
            if (!Number.isSafeInteger(++highest)) {
                throw new SnippetLimitError();
            }
            return [name, highest];
        })
    );
}

function resolveVariables(nodes: readonly Node[], indices: ReadonlyMap<string, number>, resolve?: SnippetVariableResolver): Node[] {
    const unknown = new Map<string, { index: number; body: Node[]; defaulted: boolean; definition: Node }>();
    const values = new Map<string, string | undefined>();
    const valueOf = (name: string): string | undefined => {
        if (!values.has(name)) {
            values.set(name, resolve?.(name));
        }
        return values.get(name);
    };
    const collect = (nodes: readonly Node[]): void => {
        for (const node of nodes) {
            if (node.kind === 'variable' && valueOf(node.name) === undefined && !SNIPPET_VARIABLES.has(node.name)) {
                const previous = unknown.get(node.name);
                if (previous === undefined) {
                    unknown.set(node.name, {
                        index: indices.get(node.name)!,
                        body: node.body ?? [{ kind: 'text', text: node.name }],
                        defaulted: node.body !== undefined,
                        definition: node
                    });
                } else if (node.body !== undefined && !previous.defaulted) {
                    previous.body = node.body;
                    previous.defaulted = true;
                    previous.definition = node;
                } else if (!previous.defaulted && node.transform === undefined && previous.definition.transform !== undefined) {
                    previous.definition = node;
                }
            }
            if (node.kind !== 'text' && node.body !== undefined) {
                collect(node.body);
            }
        }
    };
    collect(nodes);
    // Resolved empty variables retain their defaults without adding a navigable field.
    let work = 0;
    const normalize = (nodes: readonly Node[], visiting: ReadonlySet<string>, depth = 0): Node[] => {
        if (depth > MAX_SNIPPET_DEPTH) {
            throw new SnippetLimitError();
        }
        return nodes.flatMap((node): Node[] => {
            if (++work > MAX_SNIPPET_WORK) {
                throw new SnippetLimitError();
            }
            if (node.kind === 'variable' && !unknown.has(node.name)) {
                const value = valueOf(node.name);
                if (node.transform !== undefined) {
                    return [{ kind: 'text', text: value ?? '', transform: node.transform }];
                }
                return value !== undefined && value !== '' ? [{ kind: 'text', text: value }] : normalize(node.body ?? [], visiting, depth + 1);
            }
            if (node.kind === 'field') {
                return [{ ...node, ...(node.body === undefined ? {} : { body: normalize(node.body, visiting, depth + 1) }) }];
            }
            if (node.kind === 'variable') {
                const field = unknown.get(node.name)!;
                return [
                    {
                        kind: 'field',
                        index: field.index,
                        ...(node.transform === undefined ? {} : { transform: node.transform }),
                        ...(node !== field.definition
                            ? {}
                            : { body: visiting.has(node.name) ? [] : normalize(field.body, new Set([...visiting, node.name]), depth + 1) })
                    }
                ];
            }
            return [node];
        });
    };
    return normalize(nodes, new Set());
}

export function compileSnippet(source: string): SnippetTemplate {
    let nodes: Node[] | null = null;
    let indices: ReadonlyMap<string, number> = new Map();
    if (source.length <= MAX_SNIPPET_TEXT) {
        try {
            nodes = new SnippetParser(source).parse();
            indices = variableIndices(nodes);
        } catch (error) {
            if (error instanceof MalformedSnippetError) {
                return { source, render: () => ({ text: source, stops: [] }) };
            }
            if (!(error instanceof SnippetLimitError)) {
                throw error;
            }
            nodes = null;
        }
    }
    return {
        source,
        render: (resolve, variableTransforms) => {
            if (nodes === null) {
                return { text: source, stops: [], limited: true };
            }
            try {
                return renderSnippet(resolveVariables(nodes, indices, resolve), variableTransforms);
            } catch (error) {
                if (!(error instanceof SnippetLimitError)) {
                    throw error;
                }
                // Language-server snippets may expand exponentially; retain the original text without a session.
                return { text: source, stops: [], limited: true };
            }
        }
    };
}

export function parseSnippet(snippet: string, resolve?: SnippetVariableResolver): ParsedSnippet {
    return compileSnippet(snippet).render(resolve);
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
            first.set(field.index, {
                index: field.index,
                start: range.start,
                end: range.end,
                ...(range.transform === undefined ? {} : { transform: range.transform })
            });
        }
    }
    const visited = [...first.values()].filter((stop) => stop.index > 0).sort((left, right) => left.index - right.index);
    return [...visited, first.get(0) ?? { index: 0, start: parsed.text.length, end: parsed.text.length }];
}
