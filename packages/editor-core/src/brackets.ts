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
    startsExpressionAfter,
    startsExpressionAt,
    startsWord
} from './lexical.ts';

export interface BracketIndex {
    /* Both directions: an opener maps to its closer and the closer back to the opener. */
    pairs: ReadonlyMap<number, number>;
    unmatched: ReadonlySet<number>;
}

/* A bracket of the code and its mate, which an unmatched one has none of. */
export interface BracketMatch {
    mate: number | undefined;
}

/* An open bracket without its offset, so the state at a line stays the same however far an edit above moves it. */
export interface OpenBracket {
    close: string;
    /* An `${` whose closer resumes the template text. */
    template: boolean;
    depth: number;
    previous: OpenBracket | undefined;
}

export interface BracketState {
    mode: 'code' | 'line-comment' | 'block-comment' | 'markup-comment' | 'string' | 'template' | 'regex';
    quote: string;
    /* Inside the character class of a regex, where a `/` does not end it. */
    inClass: boolean;
    /* Whether an expression may start here, which makes a `/` a regex. */
    expression: boolean;
    stack: OpenBracket | undefined;
}

export interface BracketRules {
    script: boolean;
    hash: boolean;
    hashAtWordStart: boolean;
    dash: boolean;
    phpAttributes: boolean;
    slash: boolean;
    block: boolean;
    markup: boolean;
}

export interface BracketVisitor {
    open(at: number, depth: number): void;
    /* `depth` counts the opener it closes. */
    close(at: number, depth: number): void;
    /* A closer that fits no opener, which gives up every open bracket. */
    mismatch(at: number): void;
}

export function initialBracketState(): BracketState {
    return { mode: 'code', quote: '', inClass: false, expression: true, stack: undefined };
}

export function bracketRules(language: string): BracketRules {
    return {
        script: isScript(language),
        hash: hasHashComments(language),
        hashAtWordStart: hashNeedsWordStart(language),
        dash: hasDashComments(language),
        phpAttributes: isPhp(language),
        slash: hasSlashComments(language),
        block: hasBlockComments(language),
        markup: hasMarkupComments(language)
    };
}

export function sameBracketState(left: BracketState, right: BracketState): boolean {
    if (left.mode !== right.mode || left.quote !== right.quote || left.inClass !== right.inClass || left.expression !== right.expression) {
        return false;
    }
    let one = left.stack;
    let other = right.stack;
    while (one !== other) {
        if (one === undefined || other === undefined || one.close !== other.close || one.template !== other.template || one.depth !== other.depth) {
            return false;
        }
        one = one.previous;
        other = other.previous;
    }
    return true;
}

function isSpace(character: string): boolean {
    const code = character.charCodeAt(0);
    return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(character));
}

function isCloser(character: string): boolean {
    return character === ')' || character === ']' || character === '}';
}

/* Where a comment that runs to `terminator` ends in `text`, or `to` when it goes on past it. */
function commentEnd(state: BracketState, text: string, at: number, to: number, terminator: string): number {
    const end = text.indexOf(terminator, at);
    if (end < 0 || end + terminator.length > to) {
        return to;
    }
    state.mode = 'code';
    return end + terminator.length - 1;
}

/*
 * Lexes `text` from `from` to `to`, continuing `state`, and reports every bracket of the code at its offset plus
 * `offset`. A piece has to end at a line break or the end of the text, as nothing here looks past one.
 */
export function lexBrackets(state: BracketState, rules: BracketRules, text: string, from: number, to: number, offset: number, visitor: BracketVisitor): void {
    for (let at = from; at < to; at++) {
        const char = text[at]!;
        if (state.mode !== 'code') {
            switch (state.mode) {
                case 'line-comment': {
                    const end = text.indexOf('\n', at);
                    if (end < 0 || end >= to) {
                        return;
                    }
                    state.mode = 'code';
                    at = end;
                    continue;
                }
                case 'block-comment':
                    at = commentEnd(state, text, at, to, '*/');
                    continue;
                case 'markup-comment':
                    at = commentEnd(state, text, at, to, '-->');
                    continue;
                case 'string':
                    if (char === '\\') {
                        at++;
                    } else if (char === state.quote || (rules.script && (char === '\n' || char === '\r'))) {
                        state.mode = 'code';
                    }
                    continue;
                case 'template':
                    if (char === '\\') {
                        at++;
                    } else if (char === '`') {
                        state.mode = 'code';
                        state.expression = false;
                    } else if (char === '$' && text[at + 1] === '{') {
                        at++;
                        const depth = (state.stack?.depth ?? 0) + 1;
                        state.stack = { close: '}', template: true, depth, previous: state.stack };
                        state.mode = 'code';
                        state.expression = true;
                        visitor.open(offset + at, depth);
                    }
                    continue;
                case 'regex':
                    if (char === '\\') {
                        at++;
                    } else if (char === '[') {
                        state.inClass = true;
                    } else if (char === ']') {
                        state.inClass = false;
                    } else if ((char === '/' && !state.inClass) || char === '\n' || char === '\r') {
                        state.mode = 'code';
                    }
                    continue;
            }
            continue;
        }

        if (isSpace(char)) {
            continue;
        }
        const next = text[at + 1];
        if (rules.markup && char === '<' && text.startsWith('<!--', at)) {
            state.mode = 'markup-comment';
            at += 3;
        } else if (
            (rules.slash && char === '/' && next === '/') ||
            (rules.dash && char === '-' && next === '-') ||
            (rules.hash && char === '#' && !(rules.phpAttributes && next === '[') && (!rules.hashAtWordStart || startsWord(text, at)))
        ) {
            state.mode = 'line-comment';
        } else if (rules.block && char === '/' && next === '*') {
            state.mode = 'block-comment';
            at++;
        } else if (char === '"' || char === "'") {
            state.mode = 'string';
            state.quote = char;
            state.expression = false;
        } else if (rules.script && char === '`') {
            state.mode = 'template';
        } else if (rules.script && char === '/' && state.expression) {
            state.mode = 'regex';
            state.inClass = false;
            state.expression = false;
        } else if (openers[char]) {
            const depth = (state.stack?.depth ?? 0) + 1;
            state.stack = { close: openers[char], template: false, depth, previous: state.stack };
            state.expression = true;
            visitor.open(offset + at, depth);
        } else if (isCloser(char)) {
            const open = state.stack;
            if (open?.close === char) {
                state.stack = open.previous;
                if (open.template) {
                    state.mode = 'template';
                }
                visitor.close(offset + at, open.depth);
            } else {
                state.stack = undefined;
                visitor.mismatch(offset + at);
            }
            state.expression = false;
        } else if (isWordCharacter(char)) {
            const start = at;
            while (at + 1 < to && isWordCharacter(text[at + 1]!)) {
                at++;
            }
            state.expression = startsExpressionAt(text, start, at + 1);
        } else {
            state.expression = startsExpressionAfter(char);
        }
    }
}

/* Lexical pairing for incomplete code; malformed nesting never produces crossing pairs. */
export function scanBrackets(text: string, language = 'typescript'): BracketIndex {
    const pairs = new Map<number, number>();
    const unmatched = new Set<number>();
    let open: number[] = [];
    lexBrackets(initialBracketState(), bracketRules(language), text, 0, text.length, 0, {
        open(at) {
            open.push(at);
        },
        close(at) {
            const opener = open.pop()!;
            pairs.set(opener, at);
            pairs.set(at, opener);
        },
        mismatch(at) {
            unmatched.add(at);
            // A mismatched closer keeps a distant opener from claiming it later.
            for (const abandoned of open) {
                unmatched.add(abandoned);
            }
            open = [];
        }
    });
    for (const at of open) {
        unmatched.add(at);
    }
    return { pairs, unmatched };
}
