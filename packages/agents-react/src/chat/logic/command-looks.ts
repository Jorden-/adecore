import type { CommandLook, CommandLookMatch } from '../../host';
import { EMBEDDED_CODE_LIMIT, shellCommands, type EmbeddedCode, type ShellSimpleCommand, type ShellWord } from './embedded-code';

// A folded value keeps this many characters of what it says.
const FOLD_LENGTH = 40;
// Rows redraw often and a thread holds many commands, so each is read once per set of looks.
const CACHE_LIMIT = 300;

/* A word of a detail a host may give a name, as offsets into the detail. */
export interface CommandLookWord {
    readonly start: number;
    readonly end: number;
    /* The word as the program gets it, quotes taken out. */
    readonly text: string;
}

/* A shell call read as a tool of its own: the first command of the line a look knows. */
export interface CommandLookRun {
    readonly look: CommandLook;
    readonly match: CommandLookMatch;
    /* The source from the detail word on, as typed, without redirects and with folded values shortened. */
    readonly detail: string;
    /* The values the match names a language for, as offsets into the detail. */
    readonly code: readonly EmbeddedCode[];
    /* The words of the detail that are no option. */
    readonly words: readonly CommandLookWord[];
    /* The programs of the other commands in the line, each once, in the order they run. */
    readonly others: readonly string[];
    /* How many more commands of the line a look knows. */
    readonly more: number;
    /* Whether the command is fed a heredoc, which the detail leaves out. */
    readonly heredoc: boolean;
}

const caches = new WeakMap<readonly CommandLook[], Map<string, CommandLookRun | null>>();

/* The look of a simple command and what it says about it, or null when no look knows it. */
function lookOf(command: ShellSimpleCommand, looks: readonly CommandLook[]): { look: CommandLook; match: CommandLookMatch } | null {
    const program = command.program;
    if (program === null) {
        return null;
    }
    const args = command.words.slice(program.index + 1).map(({ text }) => text);
    for (const look of looks) {
        if (look.program !== program.name) {
            continue;
        }
        const match = look.describe(args);
        if (match !== null) {
            return { look, match };
        }
    }
    return null;
}

/* The source of `word`, with its value cut past the fold; the body comes back as offsets into what is returned. */
function foldedWord(source: string, word: ShellWord, fold: boolean): { text: string; body: { start: number; end: number } | null } {
    const text = source.slice(word.start, word.end);
    const body = word.body === null ? null : { start: word.body.start - word.start, end: word.body.end - word.start };
    if (!fold) {
        return { text, body };
    }
    if (body !== null && body.end - body.start > FOLD_LENGTH) {
        const cut = body.start + FOLD_LENGTH;
        return { text: `${text.slice(0, cut)}…${text.slice(body.end)}`, body: { start: body.start, end: cut + 1 } };
    }
    if (body === null && text.length > FOLD_LENGTH) {
        return { text: `${text.slice(0, FOLD_LENGTH)}…`, body: null };
    }
    return { text, body };
}

/* The detail of a command from the word the match names: its words with their spacing, a redirect or heredoc between them a single space. */
function detailOf(source: string, command: ShellSimpleCommand, match: CommandLookMatch): Pick<CommandLookRun, 'detail' | 'code' | 'words'> {
    const first = command.program!.index + 1 + Math.max(0, match.detailFrom);
    let detail = '';
    const code: EmbeddedCode[] = [];
    const words: CommandLookWord[] = [];
    let previous: ShellWord | null = null;
    // The option the word before was, whose value this word may be.
    let option: string | null = null;
    for (const word of command.words.slice(first)) {
        if (previous !== null) {
            const gap = source.slice(previous.end, word.start);
            detail += /^[ \t]*$/.test(gap) ? gap : ' ';
        }
        const start = detail.length;
        const { text, body } = foldedWord(source, word, option !== null && match.fold?.includes(option) === true);
        const language = option === null ? undefined : match.languages?.[option];
        if (language !== undefined && body !== null && body.end > body.start) {
            code.push({ start: start + body.start, end: start + body.end, language });
        }
        detail += text;
        const isOption = word.text.startsWith('-') && word.text !== '-';
        if (!isOption) {
            words.push({ start, end: detail.length, text: word.text });
        }
        option = isOption ? word.text : null;
        previous = word;
    }
    return { detail, code, words };
}

function read(command: string, looks: readonly CommandLook[]): CommandLookRun | null {
    let found: { command: ShellSimpleCommand; look: CommandLook; match: CommandLookMatch } | null = null;
    let more = 0;
    const others: string[] = [];
    for (const simple of shellCommands(command)) {
        const known = lookOf(simple, looks);
        if (known !== null && found === null) {
            found = { command: simple, ...known };
        } else if (known !== null) {
            more++;
        } else if (simple.program !== null && !others.includes(simple.program.name)) {
            others.push(simple.program.name);
        }
    }
    if (found === null) {
        return null;
    }
    return {
        look: found.look,
        match: found.match,
        ...detailOf(command, found.command, found.match),
        others,
        more,
        heredoc: found.command.heredocs.length > 0
    };
}

/*
 * The first command of a shell line that one of `looks` knows, read as that look's tool: a program
 * counts only where the shell runs it, past assignments and wrappers, so `grep tool` is no run of
 * `tool`. Null for a line no look knows, and for one past the length that is drawn without looking inside.
 */
export function matchCommandLook(command: string, looks: readonly CommandLook[] | undefined): CommandLookRun | null {
    if (looks === undefined || looks.length === 0 || command.length > EMBEDDED_CODE_LIMIT || !looks.some(({ program }) => command.includes(program))) {
        return null;
    }
    let cache = caches.get(looks);
    if (cache === undefined) {
        cache = new Map();
        caches.set(looks, cache);
    }
    const known = cache.get(command);
    if (known !== undefined) {
        return known;
    }
    const run = read(command, looks);
    cache.set(command, run);
    if (cache.size > CACHE_LIMIT) {
        cache.delete(cache.keys().next().value!);
    }
    return run;
}
