import type { TypingContext } from './typing-context.ts';

const TAG = /<(\/?)([a-z][\w:-]*)(?=[\s/>]|$)/iy;
const PHP = /<\?(?:php\b|=)/y;

interface ScriptLexer {
    initial(): TypingContext;
    step(state: TypingContext, text: string, at: number, end: number, offset: number): number;
}

function finishTag(state: TypingContext, selfClosing: boolean, script: ScriptLexer, start: number): void {
    state.markup = !selfClosing && state.element !== undefined ? 'raw' : undefined;
    state.markupQuote = undefined;
    state.embed = state.markup === 'raw' && state.element === 'script' ? script.initial() : undefined;
    if (state.embed !== undefined) {
        state.embed.embedStart = start;
    }
    if (selfClosing) {
        state.element = undefined;
    }
}

export function scanPhpMarkup(state: TypingContext, text: string, from: number, end: number, offset: number, script: ScriptLexer): number {
    for (let at = from; at < end; at++) {
        const char = text[at]!;
        if (char === '<' && text[at + 1] === '?') {
            PHP.lastIndex = at;
            const open = PHP.exec(text);
            if (open !== null) {
                if (state.markup === 'equals') {
                    state.markup = 'value';
                }
                state.mode = 'code';
                state.expression = true;
                state.word = '';
                return at + open[0].length - 1;
            }
        }
        if (state.markup === 'comment') {
            if (text.startsWith('-->', at) && at + 3 <= end) {
                state.markup = undefined;
                at += 2;
            }
            continue;
        }
        if (state.markup === 'value' && state.markupQuote !== undefined) {
            if (char === state.markupQuote) {
                state.markup = 'tag';
                state.markupQuote = undefined;
            }
            continue;
        }
        if (char === '<') {
            if (state.markup !== 'raw' && text.startsWith('<!--', at)) {
                // HTML also closes these two comments immediately, without a later -->.
                const empty = text.startsWith('<!-->', at) ? 5 : text.startsWith('<!--->', at) ? 6 : 0;
                state.markup = empty > 0 && at + empty <= end ? undefined : 'comment';
                state.element = undefined;
                at += (empty || 4) - 1;
                continue;
            }
            TAG.lastIndex = at;
            const tag = TAG.exec(text);
            const name = tag?.[2]?.toLowerCase();
            if (state.markup === 'raw' && (tag?.[1] !== '/' || name !== state.element)) {
                if (state.embed !== undefined) {
                    at = script.step(state.embed, text, at, end, offset);
                }
                continue;
            }
            state.embed = undefined;
            state.element = tag?.[1] !== '/' && (name === 'script' || name === 'style' || name === 'textarea' || name === 'title') ? name : undefined;
            state.markup = tag === null ? undefined : 'tag';
            state.markupQuote = undefined;
            if (tag !== null) {
                at += tag[0].length - 1;
            }
            continue;
        }
        if (state.embed !== undefined) {
            at = script.step(state.embed, text, at, end, offset);
            continue;
        }
        if (state.markup === undefined || state.markup === 'raw') {
            continue;
        }
        if (char === '>') {
            finishTag(state, false, script, offset + at + 1);
        } else if (char === '/' && text[at + 1] === '>' && at + 2 <= end) {
            finishTag(state, true, script, offset + at + 2);
            at++;
        } else if (/\s/u.test(char)) {
            if (state.markup === 'value') {
                state.markup = 'tag';
            }
        } else if (state.markup === 'equals') {
            state.markup = 'value';
            state.markupQuote = char === '"' || char === "'" ? char : undefined;
        } else if (state.markup === 'tag' && char === '=') {
            state.markup = 'equals';
        }
    }
    return end - 1;
}
