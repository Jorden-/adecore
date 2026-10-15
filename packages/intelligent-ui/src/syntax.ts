import { safeKey, UiBudget, UiFailure } from './budget.ts';
import { parseUiExpression, type UiExpression } from './expression.ts';

export interface UiDiagnostic {
    code: string;
    message: string;
    start: number;
    end: number;
    nodeId?: string;
    // Only a warning says so: the part it names still drew. Absent means an error, a part that could not be drawn.
    severity?: 'warning';
}

export interface UiSyntaxNode {
    id: string;
    type: string;
    props: Record<string, UiExpression>;
    children: UiSyntaxNode[];
    text?: string;
    expression?: UiExpression;
    complete: boolean;
    /* Set when a prop could not be read, so the node draws as its text even though its tag closed. */
    invalid?: boolean;
    start: number;
    end: number;
}

export interface UiSyntax {
    declarations: Record<string, UiExpression>;
    nodes: UiSyntaxNode[];
    diagnostics: UiDiagnostic[];
}

const WARNING_CODES = new Set(['refused_prop', 'renamed_prop', 'too_many_series', 'too_many_children', 'unreadable_time']);

export function uiDiagnostic(error: unknown, start: number, end: number, nodeId?: string): UiDiagnostic {
    const code = error instanceof UiFailure ? error.code : 'invalid_syntax';
    return {
        code,
        ...(WARNING_CODES.has(code) ? { severity: 'warning' as const } : {}),
        message: error instanceof Error ? error.message : 'Invalid UI syntax.',
        start,
        end,
        ...(nodeId ? { nodeId } : {})
    };
}

class UiParser {
    private position = 0;
    private readonly result: UiSyntax = { declarations: Object.create(null), nodes: [], diagnostics: [] };
    private readonly stack: UiSyntaxNode[] = [];
    private readonly source: string;
    private readonly id: string;
    private readonly final: boolean;
    private readonly budget: UiBudget;

    constructor(source: string, id: string, final: boolean, budget: UiBudget) {
        this.source = source;
        this.id = id;
        this.final = final;
        this.budget = budget;
        if (source.length > budget.limits.characters) {
            throw new UiFailure('budget_exceeded', 'The block is too long.');
        }
    }

    parse(): UiSyntax {
        this.declarations();
        while (this.position < this.source.length) {
            this.budget.step();
            this.budget.depth(this.stack.length);
            const start = this.position;
            try {
                if (this.source[this.position] === '<') {
                    this.tag();
                } else if (this.source[this.position] === '{') {
                    const body = this.balanced();
                    const node = this.node('$text', start);
                    node.complete = body.complete;
                    if (body.complete) {
                        node.expression = parseUiExpression(body.value, this.budget);
                    }
                    this.append(node);
                } else {
                    while (this.position < this.source.length && !['<', '{'].includes(this.source[this.position])) {
                        this.position += 1;
                        this.budget.step();
                    }
                    const value = this.source.slice(start, this.position);
                    if (value.trim() || !/[\r\n]/.test(value)) {
                        const node = this.node('$text', start);
                        node.text = value;
                        this.append(node);
                    }
                }
            } catch (error) {
                if (error instanceof UiFailure && error.code === 'budget_exceeded') {
                    throw error;
                }
                this.diagnose(error, start);
                if (this.position <= start) {
                    this.position = start + 1;
                }
                while (this.position < this.source.length && this.source[this.position] !== '\n' && this.source[this.position] !== '<') {
                    this.position += 1;
                    this.budget.step();
                }
            }
        }
        for (const node of this.stack) {
            node.end = this.source.length;
            if (this.final) {
                this.diagnose(new UiFailure('unclosed_tag', `The ${node.type} tag is not closed.`), node.start, node.id);
            }
        }
        return this.result;
    }

    private declarations(): void {
        while (true) {
            this.whitespace();
            if (this.source[this.position] !== '$') {
                return;
            }
            const start = this.position;
            const declaration = /^\$([A-Za-z_][A-Za-z_\d]*)\s*=/.exec(this.source.slice(start));
            if (!declaration) {
                if (this.final) {
                    this.diagnose(new UiFailure('invalid_declaration', 'Expected $name = value.'), start);
                }
                this.position = this.source.length;
                return;
            }
            const name = `$${safeKey(declaration[1])}`;
            this.position += declaration[0].length;
            const valueStart = this.position;
            let depth = 0;
            let quote = '';
            let escaped = false;
            while (this.position < this.source.length) {
                this.budget.step();
                const character = this.source[this.position];
                if (quote) {
                    if (escaped) {
                        escaped = false;
                    } else if (character === '\\') {
                        escaped = true;
                    } else if (character === quote) {
                        quote = '';
                    }
                } else if (character === '"' || character === "'") {
                    quote = character;
                } else if (['[', '{', '('].includes(character)) {
                    depth += 1;
                    this.budget.depth(depth);
                } else if ([']', '}', ')'].includes(character)) {
                    depth -= 1;
                } else if (character === '\n' && depth <= 0) {
                    break;
                }
                this.position += 1;
            }
            try {
                if (Object.hasOwn(this.result.declarations, name)) {
                    throw new UiFailure('duplicate_declaration', `Duplicate variable ${name}.`);
                }
                const value = this.source.slice(valueStart, this.position).trim();
                this.result.declarations[name] = parseUiExpression(value, this.budget);
            } catch (error) {
                if (error instanceof UiFailure && error.code === 'budget_exceeded') {
                    throw error;
                }
                if (this.final || this.position < this.source.length) {
                    this.diagnose(error, start);
                }
            }
        }
    }

    private tag(): void {
        const start = this.position++;
        const closing = this.source[this.position] === '/';
        if (closing) {
            this.position += 1;
        }
        const match = /^[A-Za-z][A-Za-z\d]*/.exec(this.source.slice(this.position));
        if (!match) {
            if (!this.final && this.position === this.source.length) {
                return;
            }
            throw new UiFailure('invalid_tag', 'Expected a component name.');
        }
        this.position += match[0].length;
        if (closing) {
            this.whitespace();
            if (!this.finish('>')) {
                return;
            }
            const index = this.stack.findLastIndex((node) => node.type === match[0]);
            if (index === -1) {
                throw new UiFailure('unmatched_tag', `Unexpected closing tag ${match[0]}.`);
            }
            for (const node of this.stack.splice(index)) {
                node.end = this.position;
                node.complete = node.type === match[0];
                if (!node.complete) {
                    this.diagnose(new UiFailure('unclosed_tag', `The ${node.type} tag is not closed.`), node.start, node.id);
                }
            }
            return;
        }
        const node = this.node(match[0], start);
        node.complete = false;
        this.append(node);
        while (this.position < this.source.length) {
            this.whitespace();
            if (this.source.startsWith('/>', this.position)) {
                this.position += 2;
                node.complete = true;
                node.end = this.position;
                return;
            }
            if (this.source[this.position] === '>') {
                this.position += 1;
                if (node.type === 'CodeBlock') {
                    const contentStart = this.position;
                    const close = this.source.indexOf('</CodeBlock>', contentStart);
                    this.position = close === -1 ? this.source.length : close;
                    const text = this.node('$text', contentStart);
                    text.text = this.source.slice(contentStart, this.position);
                    node.children.push(text);
                    if (close !== -1) {
                        this.position += '</CodeBlock>'.length;
                        node.complete = true;
                    } else if (this.final) {
                        this.diagnose(new UiFailure('unclosed_tag', 'The CodeBlock tag is not closed.'), start, node.id);
                    }
                    node.end = this.position;
                    return;
                }
                // A tag that lost a prop and has no closing tag anywhere after it was meant to close itself.
                if (node.invalid && this.final && !this.closesLater(node.type)) {
                    node.complete = true;
                    node.end = this.position;
                    return;
                }
                this.stack.push(node);
                return;
            }
            const propStart = this.position;
            try {
                if (!this.prop(node)) {
                    return;
                }
            } catch (error) {
                if (error instanceof UiFailure && error.code === 'budget_exceeded') {
                    throw error;
                }
                this.diagnose(error, propStart, node.id);
                node.invalid = true;
                this.skipToken();
            }
        }
        node.end = this.position;
        if (this.final) {
            this.diagnose(new UiFailure('unclosed_tag', `The ${node.type} tag is incomplete.`), start, node.id);
        }
    }

    /* Reads one prop into the node; false while a streaming prop waits for more text. */
    private prop(node: UiSyntaxNode): boolean {
        // At the end of the text the tag waits while it streams, and is reported incomplete once final.
        if (this.position === this.source.length) {
            return false;
        }
        const prop = /^[A-Za-z_][A-Za-z_\d]*/.exec(this.source.slice(this.position));
        if (!prop) {
            throw new UiFailure('invalid_prop', 'Expected a named prop.');
        }
        const name = safeKey(prop[0]);
        this.position += name.length;
        this.whitespace();
        if (this.position === this.source.length && !this.final) {
            return false;
        }
        if (this.source[this.position] !== '=') {
            // A bare name is true, as in JSX.
            if (Object.hasOwn(node.props, name)) {
                throw new UiFailure('duplicate_prop', `Duplicate prop ${name}.`);
            }
            node.props[name] = parseUiExpression('true', this.budget);
            return true;
        }
        this.position += 1;
        this.whitespace();
        let value: string;
        if (this.source[this.position] === '{') {
            const body = this.balanced();
            if (!body.complete) {
                return false;
            }
            value = body.value;
        } else {
            const quote = this.source[this.position];
            if (quote !== '"' && quote !== "'") {
                if (!this.final && this.position === this.source.length) {
                    return false;
                }
                throw new UiFailure('invalid_prop', 'Use a quoted string or a braced expression.');
            }
            const valueStart = this.position++;
            let escaped = false;
            let closed = false;
            while (this.position < this.source.length) {
                this.budget.step();
                const character = this.source[this.position++];
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === quote) {
                    closed = true;
                    break;
                }
            }
            if (!closed && !this.final) {
                value = this.source.slice(valueStart, this.position);
                if (escaped) {
                    value = value.slice(0, -1);
                }
                try {
                    node.props[name] = parseUiExpression(`${value}${quote}`, this.budget);
                } catch (error) {
                    if (error instanceof UiFailure && error.code === 'budget_exceeded') {
                        throw error;
                    }
                }
                node.end = this.position;
                return false;
            }
            value = this.source.slice(valueStart, this.position);
        }
        if (Object.hasOwn(node.props, name)) {
            throw new UiFailure('duplicate_prop', `Duplicate prop ${name}.`);
        }
        node.props[name] = parseUiExpression(value, this.budget);
        return true;
    }

    /* Skips a prop that could not be read, up to the next space or the end of its tag, so only that prop is lost. */
    private skipToken(): void {
        let quote = '';
        let depth = 0;
        while (this.position < this.source.length) {
            this.budget.step();
            const character = this.source[this.position];
            if (quote) {
                if (character === '\\') {
                    this.position += 1;
                } else if (character === quote) {
                    quote = '';
                }
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (character === '{') {
                depth += 1;
            } else if (character === '}') {
                depth = Math.max(0, depth - 1);
            } else if (depth === 0 && (/\s/.test(character) || character === '>' || this.source.startsWith('/>', this.position))) {
                break;
            }
            this.position += 1;
        }
    }

    private balanced(): { value: string; complete: boolean } {
        const start = ++this.position;
        let depth = 1;
        let quote = '';
        let escaped = false;
        while (this.position < this.source.length) {
            this.budget.step();
            const character = this.source[this.position++];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === quote) {
                    quote = '';
                }
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (character === '{') {
                depth += 1;
                this.budget.depth(depth);
            } else if (character === '}' && --depth === 0) {
                return { value: this.source.slice(start, this.position - 1), complete: true };
            }
        }
        if (this.final) {
            throw new UiFailure('incomplete_expression', 'The expression is not closed.');
        }
        return { value: this.source.slice(start), complete: false };
    }

    /* Whether a closing tag for this type follows, written the way `tag` accepts one: whitespace may stand before its `>`. */
    private closesLater(type: string): boolean {
        const closing = new RegExp(`</${type}\\s*>`, 'g');
        closing.lastIndex = this.position;
        return closing.test(this.source);
    }

    private whitespace(): void {
        while (this.position < this.source.length && /\s/.test(this.source[this.position])) {
            this.position += 1;
            this.budget.step();
        }
    }

    private finish(value: string): boolean {
        if (this.source[this.position] !== value) {
            if (!this.final && this.position === this.source.length) {
                return false;
            }
            throw new UiFailure('invalid_syntax', `Expected ${value}.`);
        }
        this.position += 1;
        return true;
    }

    private node(type: string, start: number): UiSyntaxNode {
        this.budget.node();
        return { id: `${this.id}:${start}`, type, props: Object.create(null), children: [], complete: true, start, end: this.position };
    }

    private append(node: UiSyntaxNode): void {
        (this.stack.at(-1)?.children ?? this.result.nodes).push(node);
    }

    private diagnose(error: unknown, start: number, nodeId?: string): void {
        if (this.result.diagnostics.length < this.budget.limits.diagnostics) {
            this.result.diagnostics.push(uiDiagnostic(error, start, this.position, nodeId));
        }
    }
}

export function parseUiSyntax(source: string, id: string, final = false, budget = new UiBudget()): UiSyntax {
    return new UiParser(source, id, final, budget).parse();
}
