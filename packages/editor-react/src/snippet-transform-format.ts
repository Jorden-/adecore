import {
    MAX_TRANSFORM_FORMAT,
    MAX_TRANSFORM_NODES,
    MAX_TRANSFORM_PATTERN,
    MAX_TRANSFORM_JOBS,
    MAX_TRANSFORM_VALUE,
    MAX_TRANSFORM_CHARACTERS,
    MAX_TRANSFORM_MATCHES,
    type SnippetTransformCase,
    type SnippetTransformFormatNode,
    type SnippetTransformJob
} from './snippet-transform-protocol.ts';
const CASES: ReadonlySet<string> = new Set(['upcase', 'downcase', 'capitalize', 'camelcase', 'pascalcase']);
export function compileSnippetTransformFormat(source: string): readonly SnippetTransformFormatNode[] {
    if (source.length > MAX_TRANSFORM_FORMAT) {
        throw new RangeError('The transform format is too long.');
    }
    const nodes: SnippetTransformFormatNode[] = [];
    let at = 0,
        text = '';
    const push = (node: SnippetTransformFormatNode): void => {
        if (nodes.length >= MAX_TRANSFORM_NODES) {
            throw new RangeError('The transform format has too many nodes.');
        }
        nodes.push(node);
    };
    const flush = (): void => {
        if (text !== '') {
            push({ kind: 'text', text });
            text = '';
        }
    };
    const string = (colon = false): string => {
        let value = '';
        while (at < source.length && source[at] !== '}' && !(colon && source[at] === ':')) {
            if (source[at] === '\\' && at + 1 < source.length) {
                at++;
            }
            value += source[at++]!;
        }
        return value;
    };
    while (at < source.length) {
        if (source[at] === '\\' && at + 1 < source.length) {
            at++;
            text += source[at++]!;
            continue;
        }
        if (source[at] !== '$') {
            text += source[at++]!;
            continue;
        }
        at++;
        const brace = source[at] === '{';
        if (brace) {
            at++;
        }
        const start = at;
        while (at < source.length && source.charCodeAt(at) >= 48 && source.charCodeAt(at) <= 57) {
            at++;
        }
        if (at === start) {
            if (brace) {
                throw new SyntaxError('A transform format needs a capture index.');
            }
            text += '$';
            continue;
        }
        const index = Number(source.slice(start, at));
        if (index > 99) {
            throw new RangeError('Transform captures are limited to 99.');
        }
        flush();
        let node: SnippetTransformFormatNode = { kind: 'capture', index };
        if (brace) {
            if (source[at] === ':') {
                at++;
                const operator = source[at];
                if (operator === '/') {
                    at++;
                    const operation = string();
                    if (!CASES.has(operation)) {
                        throw new SyntaxError('Unknown transform case operation.');
                    }
                    node = { kind: 'capture', index, case: operation as SnippetTransformCase };
                } else if (operator === '+') {
                    at++;
                    node = { kind: 'conditional', index, if: string() };
                } else if (operator === '?') {
                    at++;
                    const when = string(true);
                    if (source[at++] !== ':') {
                        throw new SyntaxError('A conditional transform needs both branches.');
                    }
                    node = { kind: 'conditional', index, if: when, else: string() };
                } else {
                    if (operator === '-') {
                        at++;
                    }
                    node = { kind: 'conditional', index, else: string() };
                }
            }
            if (source[at++] !== '}') {
                throw new SyntaxError('An unclosed transform capture cannot be applied.');
            }
        }
        push(node);
    }
    flush();
    return nodes;
}
function capitalize(value: string): string {
    const first = value.slice(0, (value.codePointAt(0) ?? 0) > 0xffff ? 2 : 1);
    return first.toUpperCase() + value.slice(first.length);
}
function changeCase(value: string, operation?: SnippetTransformCase): string {
    if (operation === 'upcase') {
        return value.toUpperCase();
    }
    if (operation === 'downcase') {
        return value.toLowerCase();
    }
    if (operation === 'capitalize') {
        return capitalize(value);
    }
    if (operation === 'camelcase' || operation === 'pascalcase') {
        const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
        return words.map((word, index) => (operation === 'camelcase' && index === 0 ? word.toLowerCase() : capitalize(word.toLowerCase()))).join('');
    }
    return value;
}
export function validateSnippetTransformJobs(jobs: readonly SnippetTransformJob[]): void {
    if (!Array.isArray(jobs) || jobs.length > MAX_TRANSFORM_JOBS) {
        throw new RangeError('Too many snippet transform jobs.');
    }
    let characters = 0;
    const patterns = new Set<string>();
    for (const job of jobs) {
        if (
            typeof job.value !== 'string' ||
            job.value.length > MAX_TRANSFORM_VALUE ||
            typeof job.pattern !== 'string' ||
            job.pattern.length > MAX_TRANSFORM_PATTERN
        ) {
            throw new RangeError('A snippet transform value or pattern is too large.');
        }
        characters += job.value.length + job.pattern.length;
        if (characters > MAX_TRANSFORM_CHARACTERS || !Array.isArray(job.format) || job.format.length > MAX_TRANSFORM_NODES) {
            throw new RangeError('The snippet transform batch is too large.');
        }
        if (
            typeof job.flags !== 'string' ||
            Array.from(job.flags as string).some((flag) => !'gimsu'.includes(flag)) ||
            new Set(job.flags).size !== job.flags.length
        ) {
            throw new SyntaxError('Snippet transforms support the flags g, i, m, s and u once each.');
        }
        let formatLength = 0;
        for (const node of job.format) {
            if (node.kind === 'text') {
                if (typeof node.text !== 'string') {
                    throw new SyntaxError('Invalid transform text.');
                }
                formatLength += node.text.length;
            } else if (node.kind === 'capture' || node.kind === 'conditional') {
                if (!Number.isInteger(node.index) || node.index < 0 || node.index > 99) {
                    throw new RangeError('Invalid transform capture index.');
                }
                if (node.kind === 'capture' && node.case !== undefined && !CASES.has(node.case)) {
                    throw new SyntaxError('Invalid transform case operation.');
                }
                if (node.kind === 'conditional') {
                    if ((node.if !== undefined && typeof node.if !== 'string') || (node.else !== undefined && typeof node.else !== 'string')) {
                        throw new SyntaxError('Invalid transform branches.');
                    }
                    formatLength += (node.if?.length ?? 0) + (node.else?.length ?? 0);
                }
            } else {
                throw new SyntaxError('Invalid transform format node.');
            }
        }
        if (formatLength > MAX_TRANSFORM_FORMAT) {
            throw new RangeError('The transform format is too long.');
        }
        characters += formatLength;
        if (characters > MAX_TRANSFORM_CHARACTERS) {
            throw new RangeError('The snippet transform batch is too large.');
        }
        const key = job.flags + '\0' + job.pattern;
        if (!patterns.has(key)) {
            // Compilation validates syntax; only the worker executes patterns supplied by a server.
            new RegExp(job.pattern, job.flags);
            patterns.add(key);
        }
    }
}
export function applySnippetTransform(job: SnippetTransformJob, maximum = MAX_TRANSFORM_CHARACTERS, expression = new RegExp(job.pattern, job.flags)): string {
    expression.lastIndex = 0;
    const pieces: string[] = [];
    let at = 0,
        length = 0,
        matches = 0;
    const append = (text: string): void => {
        length += text.length;
        if (length > maximum) {
            throw new RangeError('The snippet transform output is too large.');
        }
        pieces.push(text);
    };
    for (let match = expression.exec(job.value); match !== null; match = expression.exec(job.value)) {
        if (++matches > MAX_TRANSFORM_MATCHES) {
            throw new RangeError('The snippet transform has too many matches.');
        }
        append(job.value.slice(at, match.index));
        for (const node of job.format) {
            if (node.kind === 'text') {
                append(node.text);
            } else {
                const capture = match[node.index] ?? '';
                append(node.kind === 'capture' ? changeCase(capture, node.case) : capture !== '' ? (node.if ?? capture) : (node.else ?? ''));
            }
        }
        at = match.index + match[0].length;
        if (!expression.global) {
            break;
        }
        if (match[0].length === 0) {
            expression.lastIndex += (job.value.codePointAt(expression.lastIndex) ?? 0) > 0xffff ? 2 : 1;
        }
    }
    append(job.value.slice(at));
    return pieces.join('');
}
