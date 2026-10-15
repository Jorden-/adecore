import { useEffect, useState, type ReactNode } from 'react';
import type { BundledLanguage } from 'shiki';
import { Tooltip } from '@adecore/ui';
import { EMBEDDED_CODE_LIMIT, SHELL_LANGUAGE, embeddedCode, type EmbeddedCode } from '../logic/embedded-code';
import type { CodeToken } from './code-lines';
import { useChatHost, type CommandName } from '../../host';
import { useCodeTheme } from './code-theme';
import { tokenStyle, useCodeHighlighter, type CodeHighlighter, type Highlighter } from './highlighter';

/* One colored run of a command, as offsets into it. */
interface Run extends CodeToken {
    start: number;
    end: number;
}

/* A word of a command drawn as the name a host gave it, as offsets into the command. */
export interface NamedWord {
    readonly start: number;
    readonly end: number;
    readonly word: string;
    readonly name: CommandName;
}

const NO_CODE: readonly EmbeddedCode[] = [];
const NO_NAMES: readonly NamedWord[] = [];

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

/* The code inside a command, with the stretches a caller knows the language of on top. */
function codeIn(command: string, extra: readonly EmbeddedCode[]): EmbeddedCode[] {
    return extra.length === 0
        ? embeddedCode(command)
        : [...embeddedCode(command), ...extra].sort((left, right) => left.start - right.start || right.end - left.end);
}

function languagesOf(command: string, extra: readonly EmbeddedCode[]): Set<string> {
    return new Set([SHELL_LANGUAGE, ...codeIn(command, extra).map(({ language }) => language)]);
}

/* The colored runs of a command, or null while a grammar or the theme is still on its way. */
function highlight(command: string, extra: readonly EmbeddedCode[], theme: string, code: CodeHighlighter): Run[] | null {
    const key = `${theme}\n${extra.map(({ start, end, language }) => `${start}:${end}:${language}`).join(',')}\n${command}`;
    const known = cache.get(key);
    if (known !== undefined) {
        // Touched entries move to the end, so the oldest falls out first.
        cache.delete(key);
        cache.set(key, known);
        return known;
    }
    const embedded = codeIn(command, extra);
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

/* `command[from, to)` in its colors, or as it is while there are none. */
function draw(command: string, runs: readonly Run[] | null, from: number, to: number): ReactNode[] {
    if (runs === null) {
        return [command.slice(from, to)];
    }
    const parts: ReactNode[] = [];
    let at = from;
    for (const run of runs) {
        if (run.end <= from || run.start >= to) {
            continue;
        }
        const start = Math.max(run.start, from);
        const end = Math.min(run.end, to);
        // Shiki leaves the line breaks out of its tokens; they come from the command itself.
        if (start > at) {
            parts.push(command.slice(at, start));
        }
        const content = run.content.slice(start - run.start, end - run.start);
        const style = tokenStyle(run);
        parts.push(
            style === undefined ? (
                content
            ) : (
                <span key={start} style={style}>
                    {content}
                </span>
            )
        );
        at = end;
    }
    if (at < to) {
        parts.push(command.slice(at, to));
    }
    return parts;
}

/* A word as its name, in a frame so it reads as a reference; the word itself stays in the text, for a find. */
function Name({ named }: { named: NamedWord }) {
    return (
        <Tooltip label={named.word}>
            <span className="inline-flex items-center gap-1 rounded bg-surface-hover px-1 font-sans text-text ring-1 ring-border ring-inset">
                {named.name.icon}
                {named.name.name}
                <span className="sr-only">{named.word}</span>
            </span>
        </Tooltip>
    );
}

function drawNamed(command: string, runs: readonly Run[] | null, names: readonly NamedWord[]): ReactNode[] {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const named of names) {
        if (named.start < at) {
            continue;
        }
        parts.push(...draw(command, runs, at, named.start), <Name key={`name-${named.start}`} named={named} />);
        at = named.end;
    }
    parts.push(...draw(command, runs, at, command.length));
    return parts;
}

/*
 * A shell command in the colors of the code theme, with the code inside it (a `bash -lc` script, a
 * `python3 -c` argument, a heredoc) in its own language. Plain text until the grammars are in, which
 * changes no size; a command past the limit stays plain. `code` adds stretches whose language the
 * caller knows, and `names` draws words as the names a host gave them, both as offsets into `command`.
 */
export function ShellCommand({ command, code = NO_CODE, names = NO_NAMES }: { command: string; code?: readonly EmbeddedCode[]; names?: readonly NamedWord[] }) {
    const theme = useCodeTheme();
    const { custom } = useChatHost().code;
    const highlighter = useCodeHighlighter();
    // Bumped when a load settles, so the cache is asked again.
    const [, setLoads] = useState(0);
    const tooLong = command.length > EMBEDDED_CODE_LIMIT;
    const runs = tooLong ? null : highlight(command, code, theme, highlighter);

    useEffect(() => {
        if (runs !== null || tooLong) {
            return;
        }
        let cancelled = false;
        Promise.all([highlighter.loadTheme(theme, custom), ...[...languagesOf(command, code)].map((lang) => highlighter.loadLanguage(lang))])
            .then(() => !cancelled && setLoads((count) => count + 1))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [highlighter, command, code, theme, custom, runs, tooLong]);

    if (names.length > 0) {
        return <>{drawNamed(command, runs, names)}</>;
    }
    return <>{runs === null ? command : draw(command, runs, 0, command.length)}</>;
}
