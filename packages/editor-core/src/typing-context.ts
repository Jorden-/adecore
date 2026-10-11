import {
    hasBlockComments,
    hasDashComments,
    hasHashComments,
    hashNeedsWordStart,
    hasMarkupComments,
    hasSlashComments,
    isPhp,
    isScript,
    isWordCharacter,
    openers,
    startsExpression,
    startsExpressionAfter,
    startsWord
} from './lexical.ts';
import { scanPhpMarkup } from './php-markup.ts';
import type { DocumentLine } from './rope.ts';

export interface TypingBracket {
    at: number;
    close: string;
    previous?: TypingBracket;
    /* An `${` whose closer resumes the template text. */
    template?: boolean;
    /* The parenthesis of `if`, `for` and the like. */
    control?: boolean;
    /* A `{` that opens a block, as opposed to an object literal. */
    block?: boolean;
}

/* `html` is the markup of a PHP file around its tags, and `heredoc` the body of a heredoc or nowdoc, which `quote` holds the label of. */
type Mode = 'code' | 'line-comment' | 'block-comment' | 'html-comment' | 'quote' | 'template' | 'regex' | 'html' | 'heredoc';

/* What the lexer knows at one offset. Bracket stacks are immutable, so states share them. */
export interface TypingContext {
    mode: Mode;
    quote?: string;
    escaped: boolean;
    inClass: boolean;
    bracket?: TypingBracket;
    /* Whether an expression may start here, which makes a `/` a regex. */
    expression: boolean;
    /* The last word, or `control-close` after the parenthesis of a control statement. */
    word: string;
    /* Where the comment the lexer is in began, in the document. */
    commentStart?: number;
    /* PHP preserves these fields while code inside an attribute or raw block runs. */
    markup?: 'tag' | 'equals' | 'value' | 'comment' | 'raw';
    markupQuote?: '"' | "'";
    element?: 'script' | 'style' | 'textarea' | 'title';
    embed?: TypingContext;
    embedded?: 'javascript';
    /* Only a scan result keeps this; PHP consumes the newline immediately after a closing tag. */
    phpClose?: number;
}

interface Rules {
    script: boolean;
    php: boolean;
    hash: boolean;
    hashAtWordStart: boolean;
    dash: boolean;
    slash: boolean;
    block: boolean;
    markup: boolean;
}

const PHP_HEREDOC = /^<<<[ \t]*(["']?)([A-Za-z_]\w*)\1[ \t]*$/;
const PHP_OPEN = /<\?(?:php\b|=)/;
const PHP_INITIAL_LINES = 64;
const PHP_INITIAL_CHARACTERS = 64 * 1024;
// Quoted PHP tags within a bare code fragment must not turn its prelude into output.
const PHP_FRAGMENT_START =
    /^(?:[$'"#]|\/[/*]|(?:abstract|class|const|declare|echo|enum|final|for|foreach|function|if|include(?:_once)?|interface|namespace|print|readonly|require(?:_once)?|return|switch|throw|trait|try|use|while)\b|[A-Za-z_]\w*\s*(?:\(|::))/;

const controlWords = /^(for|for-await|if|while|switch|catch|with)$/;
const blockWords = /^(else|try|finally|do)$/;

function initial(): TypingContext {
    return { mode: 'code', escaped: false, inClass: false, expression: true, word: '' };
}

function rulesOf(language: string): Rules {
    return {
        script: isScript(language),
        php: isPhp(language),
        hash: hasHashComments(language),
        hashAtWordStart: hashNeedsWordStart(language),
        dash: hasDashComments(language),
        slash: hasSlashComments(language),
        block: hasBlockComments(language),
        markup: hasMarkupComments(language)
    };
}

function scanComment(state: TypingContext, text: string, at: number, end: number): number {
    const close = state.mode === 'block-comment' ? '*/' : '-->';
    if (at + close.length <= end && text.startsWith(close, at)) {
        state.mode = 'code';
        state.commentStart = undefined;
        return at + close.length - 1;
    }
    return at;
}

function scanLiteral(state: TypingContext, text: string, at: number, end: number, offset: number): number {
    const char = text[at];
    if (state.escaped) {
        state.escaped = false;
    } else if (char === '\\') {
        state.escaped = true;
    } else if (state.mode === 'regex') {
        if (char === '[') {
            state.inClass = true;
        } else if (char === ']') {
            state.inClass = false;
        } else if (char === '/' && !state.inClass) {
            state.mode = 'code';
            state.expression = false;
        }
    } else if (state.mode === 'template' && char === '$' && text[at + 1] === '{' && at + 1 < end) {
        state.bracket = { at: offset + at + 1, close: '}', previous: state.bracket, template: true };
        state.mode = 'code';
        state.expression = true;
        state.word = '';
        return at + 1;
    } else if (char === state.quote) {
        state.mode = 'code';
        state.expression = false;
        state.quote = undefined;
    }
    return at;
}

function openComment(state: TypingContext, mode: 'line-comment' | 'block-comment' | 'html-comment', start: number, resume: number): number {
    state.mode = mode;
    state.commentStart = start;
    return resume;
}

function scanCode(state: TypingContext, rules: Rules, text: string, at: number, end: number, offset: number): number {
    const char = text[at];
    const next = text[at + 1];

    if (/\s/u.test(char)) {
        return at;
    }
    if (rules.markup && text.startsWith('<!--', at)) {
        return openComment(state, 'html-comment', offset + at, at + 3);
    }
    if (rules.hash && char === '#' && !(rules.php && next === '[') && (!rules.hashAtWordStart || startsWord(text, at))) {
        return openComment(state, 'line-comment', offset + at, at);
    }
    if ((rules.dash && char === '-' && next === '-') || (rules.slash && char === '/' && next === '/')) {
        return openComment(state, 'line-comment', offset + at, at + 1);
    }
    if (rules.block && char === '/' && next === '*') {
        return openComment(state, 'block-comment', offset + at, at + 1);
    }
    if (rules.php && char === '<' && text.startsWith('<<<', at)) {
        const opener = PHP_HEREDOC.exec(text.slice(at));
        if (opener !== null) {
            state.mode = 'heredoc';
            state.quote = opener[2];
            return text.length;
        }
    }
    if (rules.php && char === '?' && next === '>') {
        state.phpClose = offset + at + 2;
        state.mode = 'html';
        return at + 1;
    }
    if (char === '"' || char === "'" || char === '`') {
        state.mode = rules.script && char === '`' ? 'template' : 'quote';
        state.quote = char;
        state.escaped = false;
        state.word = '';
        return at;
    }
    if (rules.script && char === '/' && state.expression) {
        state.mode = 'regex';
        state.inClass = false;
        state.escaped = false;
        return at;
    }
    if ((char === '+' || char === '-') && next === char) {
        state.word = '';
        return at + 1;
    }
    if (openers[char]) {
        state.bracket = {
            at: offset + at,
            close: openers[char],
            previous: state.bracket,
            control: char === '(' && controlWords.test(state.word),
            block: char === '{' && (!state.expression || state.word === 'control-close' || blockWords.test(state.word))
        };
        state.expression = true;
        state.word = '';
    } else if (/[)\]}]/.test(char)) {
        closeBracket(state, char);
    } else if (isWordCharacter(char)) {
        const from = at;
        while (at + 1 < end && isWordCharacter(text[at + 1])) {
            at++;
        }
        const word = text.slice(from, at + 1);
        state.word = word === 'await' && state.word === 'for' ? 'for-await' : word;
        state.expression = startsExpression(word);
    } else {
        state.expression = startsExpressionAfter(char);
        state.word = '';
    }
    return at;
}

function closeBracket(state: TypingContext, char: string): void {
    const bracket = state.bracket;
    if (bracket?.close !== char) {
        state.bracket = undefined;
        state.expression = false;
        return;
    }
    state.bracket = bracket.previous;
    if (bracket.template) {
        state.mode = 'template';
        state.quote = '`';
    }
    state.expression = Boolean(bracket.control || bracket.block);
    state.word = bracket.control ? 'control-close' : '';
}

let scriptRules: Rules | undefined;

function stepScript(state: TypingContext, text: string, at: number, end: number, offset: number): number {
    if (state.mode === 'line-comment') {
        return at;
    }
    if (state.mode === 'block-comment') {
        return scanComment(state, text, at, end);
    }
    return state.mode === 'code' ? scanCode(state, (scriptRules ??= rulesOf('javascript')), text, at, end, offset) : scanLiteral(state, text, at, end, offset);
}

const scriptLexer = { initial, step: stepScript };

function normalizeLine(state: TypingContext, multilineQuotes: boolean): void {
    if (state.mode === 'line-comment' || state.mode === 'regex' || (state.mode === 'quote' && !multilineQuotes && !state.escaped)) {
        state.mode = 'code';
        state.quote = undefined;
        state.commentStart = undefined;
        state.expression = true;
    }
    state.escaped = false;
}

/* Lexes `text` up to `end`, from the state the line started in. `offset` is where the line starts in the document. */
function scan(text: string, end: number, start: TypingContext, rules: Rules, offset: number): TypingContext {
    // An embedded lexer must not mutate the script state cached at the line start.
    const state = { ...start, embed: start.embed === undefined ? undefined : { ...start.embed } };
    for (let at = 0; at < end; at++) {
        if (state.mode === 'line-comment') {
            // A PHP line comment ends at its line break and at a closing tag.
            const tag = rules.php ? text.indexOf('?>', at) : -1;
            if (tag < 0 || tag >= end) {
                break;
            }
            state.phpClose = offset + tag + 2;
            state.mode = 'html';
            state.commentStart = undefined;
            at = tag + 1;
        } else if (state.mode === 'html') {
            at = scanPhpMarkup(state, text, at, end, offset, scriptLexer);
        } else if (state.mode === 'heredoc') {
            const closing = new RegExp(`^[\\t ]*${state.quote}(?![\\w])`).exec(text);
            if (closing === null) {
                break;
            }
            state.mode = 'code';
            state.quote = undefined;
            state.expression = false;
            at = closing[0].length - 1;
        } else if (state.mode === 'block-comment' || state.mode === 'html-comment') {
            at = scanComment(state, text, at, end);
        } else if (state.mode === 'code') {
            at = scanCode(state, rules, text, at, end, offset);
        } else {
            at = scanLiteral(state, text, at, end, offset);
        }
    }
    return state;
}

function sameState(left: TypingContext, right: TypingContext): boolean {
    return (
        left.mode === right.mode &&
        left.quote === right.quote &&
        left.escaped === right.escaped &&
        left.inClass === right.inClass &&
        left.bracket === right.bracket &&
        left.expression === right.expression &&
        left.word === right.word &&
        left.commentStart === right.commentStart &&
        left.markup === right.markup &&
        left.markupQuote === right.markupQuote &&
        left.element === right.element &&
        left.phpClose === right.phpClose &&
        (left.embed === right.embed || (left.embed !== undefined && right.embed !== undefined && sameState(left.embed, right.embed)))
    );
}

/* The state of the lexer at the start of each line, computed on demand. An edit drops the lines from its own on. */
export class TypingContexts {
    private readonly line: (index: number) => DocumentLine;
    private states: TypingContext[] = [initial()];
    private language = '';
    private decidingLine = 0;

    constructor(line: (index: number) => DocumentLine) {
        this.line = line;
    }

    invalidate(line = 0): void {
        this.states.length = Math.min(this.states.length, Math.max(1, line + 1));
        if (line <= this.decidingLine) {
            this.language = '';
        }
    }

    private initialState(language: string): TypingContext {
        const state = initial();
        this.decidingLine = 0;
        if (language !== 'php') {
            return state;
        }
        let remaining = PHP_INITIAL_CHARACTERS;
        for (let line = 0; line < PHP_INITIAL_LINES && remaining > 0; line++) {
            this.decidingLine = line;
            const source = this.line(line);
            const sample = source.text.slice(0, remaining);
            remaining -= sample.length;
            const text = sample.trimStart();
            if (text !== '') {
                const open = PHP_OPEN.exec(text);
                if (/^<(?![?<])/.test(text) || (open !== null && open.index > 0 && !PHP_FRAGMENT_START.test(text))) {
                    state.mode = 'html';
                }
                return state;
            }
            if (source.end === source.next) {
                break;
            }
        }
        return state;
    }

    at(line: number, column: number, language: string): TypingContext {
        const id = language.toLowerCase();
        if (this.language !== id) {
            this.language = id;
            this.states = [this.initialState(id)];
        }
        const rules = rulesOf(id);
        while (this.states.length <= line) {
            const previous = this.states.at(-1)!;
            const source = this.line(this.states.length - 1);
            const next = scan(source.text, source.text.length, previous, rules, source.start);
            // A PHP island's source newlines are not newlines in the emitted script.
            if (next.mode === 'html' && next.embed !== undefined && next.phpClose !== source.end) {
                normalizeLine(next.embed, false);
            }
            next.phpClose = undefined;
            normalizeLine(next, /^(php|rust|rs)$/i.test(id));
            if (next.mode === 'html' && next.markup === 'value' && next.markupQuote === undefined) {
                next.markup = 'tag';
            }
            this.states.push(sameState(next, previous) ? previous : next);
        }
        const source = this.line(line);
        const state = scan(source.text, column, this.states[line], rules, source.start);
        return state.mode === 'html' && state.embed !== undefined ? { ...state.embed, markup: 'raw', element: 'script', embedded: 'javascript' } : state;
    }
}
