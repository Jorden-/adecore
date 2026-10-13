import { useEffect, useState, type ReactNode } from 'react';
import type { BundledLanguage } from 'shiki';
import { EMBEDDED_CODE_LIMIT, SHELL_LANGUAGE, embeddedCode } from '../logic/embedded-code';
import type { CodeToken } from './code-lines';
import { useChatHost } from '../../host';
import { useCodeTheme } from './code-theme';
import { tokenStyle, useCodeHighlighter, type CodeHighlighter, type Highlighter } from './highlighter';

/* One colored run of a command, as offsets into it. */
interface Run extends CodeToken {
    start: number;
    end: number;
}

// Rows redraw often and a thread holds many commands, so each is tokenized once per theme.
const CACHE_LIMIT = 300;
const cache = new Map<string, Run[]>();

/* The runs of `code` in one language, placed at `offset`; a run in the theme's own foreground takes the color around it. */
function runsOf(highlighter: Highlighter, code: string, language: string, theme: string, offset: number): Run[] {
    const fg = highlighter.getTheme(theme).fg.toLowerCase();
    const { tokens } = highlighter.codeToTokens(code, { lang: language as BundledLanguage, theme });
    return tokens.flat().map((token) => ({
        start: offset + token.offset,
        end: offset + token.offset + token.content.length,
        content: token.content,
        color: token.color?.toLowerCase() === fg ? undefined : token.color,
        fontStyle: token.fontStyle
    }));
}

/* `base` with `[start, end)` cut out of it and `inner` in its place. */
function overlay(base: readonly Run[], start: number, end: number, inner: readonly Run[]): Run[] {
    const kept: Run[] = [];
    for (const run of base) {
        if (run.end <= start || run.start >= end) {
            kept.push(run);
            continue;
        }
        if (run.start < start) {
            kept.push({ ...run, end: start, content: run.content.slice(0, start - run.start) });
        }
        if (run.end > end) {
            kept.push({ ...run, start: end, content: run.content.slice(end - run.start) });
        }
    }
    return [...kept, ...inner].sort((left, right) => left.start - right.start);
}

function languagesOf(command: string): Set<string> {
    return new Set([SHELL_LANGUAGE, ...embeddedCode(command).map(({ language }) => language)]);
}

/* The colored runs of a command, or null while a grammar or the theme is still on its way. */
function highlight(command: string, theme: string, code: CodeHighlighter): Run[] | null {
    const key = `${theme}\n${command}`;
    const known = cache.get(key);
    if (known !== undefined) {
        // Touched entries move to the end, so the oldest falls out first.
        cache.delete(key);
        cache.set(key, known);
        return known;
    }
    const embedded = embeddedCode(command);
    const highlighter = code.ready([SHELL_LANGUAGE, ...embedded.map(({ language }) => language)], theme);
    if (highlighter === null) {
        return null;
    }
    let runs = runsOf(highlighter, command, code.language(SHELL_LANGUAGE), theme, 0);
    for (const part of embedded) {
        runs = overlay(runs, part.start, part.end, runsOf(highlighter, command.slice(part.start, part.end), code.language(part.language), theme, part.start));
    }
    cache.set(key, runs);
    if (cache.size > CACHE_LIMIT) {
        cache.delete(cache.keys().next().value!);
    }
    return runs;
}

function draw(command: string, runs: readonly Run[]): ReactNode[] {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const run of runs) {
        // Shiki leaves the line breaks out of its tokens; they come from the command itself.
        if (run.start > at) {
            parts.push(command.slice(at, run.start));
        }
        const style = tokenStyle(run);
        parts.push(
            style === undefined ? (
                run.content
            ) : (
                <span key={run.start} style={style}>
                    {run.content}
                </span>
            )
        );
        at = run.end;
    }
    if (at < command.length) {
        parts.push(command.slice(at));
    }
    return parts;
}

/*
 * A shell command in the colors of the code theme, with the code inside it (a `bash -lc` script, a
 * `python3 -c` argument, a heredoc) in its own language. Plain text until the grammars are in, which
 * changes no size; a command past the limit stays plain.
 */
export function ShellCommand({ command }: { command: string }) {
    const theme = useCodeTheme();
    const { custom } = useChatHost().code;
    const highlighter = useCodeHighlighter();
    // Bumped when a load settles, so the cache is asked again.
    const [, setLoads] = useState(0);
    const tooLong = command.length > EMBEDDED_CODE_LIMIT;
    const runs = tooLong ? null : highlight(command, theme, highlighter);

    useEffect(() => {
        if (runs !== null || tooLong) {
            return;
        }
        let cancelled = false;
        Promise.all([highlighter.loadTheme(theme, custom), ...[...languagesOf(command)].map((lang) => highlighter.loadLanguage(lang))])
            .then(() => !cancelled && setLoads((count) => count + 1))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [highlighter, command, theme, custom, runs, tooLong]);

    return <>{runs === null ? command : draw(command, runs)}</>;
}
