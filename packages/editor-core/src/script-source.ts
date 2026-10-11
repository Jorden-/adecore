import type { TypingContext } from './typing-context.ts';

export function scriptSource(text: string, start: number, complete: boolean, context: (offset: number) => TypingContext | null): string | undefined {
    const events = /<\?(?:php\b|=)|\?>|<\/script(?=[\s/>]|$)/gi;
    const chunks: string[] = [];
    let cursor = 0;
    let island: number | undefined;
    const finish = (end: number): string => {
        chunks.push(text.slice(cursor, island ?? end));
        if (island !== undefined) {
            chunks.push(' '.repeat(end - island));
        }
        return chunks.join('');
    };
    for (const match of text.matchAll(events)) {
        const state = context(start + match.index);
        if (state === null) {
            return undefined;
        }
        const inScript = state.embedded === 'javascript' && state.embedStart === start;
        if (/^<\?(?:php\b|=)/.test(match[0])) {
            if (inScript) {
                island = match.index;
            }
        } else if (match[0] === '?>') {
            if (island !== undefined && state.embed?.embedStart === start && (state.mode === 'code' || state.mode === 'line-comment')) {
                let end = match.index + 2;
                if (text.startsWith('\r\n', end)) {
                    end += 2;
                } else if (text[end] === '\n') {
                    end++;
                }
                // Spaces preserve document offsets without treating PHP source newlines as script text.
                chunks.push(text.slice(cursor, island), ' '.repeat(end - island));
                cursor = end;
                island = undefined;
            }
        } else if (match[0].startsWith('</') && inScript) {
            return finish(match.index);
        }
    }
    return complete ? finish(text.length) : undefined;
}
