/* A stretch of a shell command written in another language, as offsets into the command. */
export interface EmbeddedCode {
    readonly start: number;
    readonly end: number;
    /* A Shiki language id. */
    readonly language: string;
}

export const SHELL_LANGUAGE = 'shellscript';

// Past this a command is drawn without looking for code inside it; the scan is linear, the highlighting is not.
export const EMBEDDED_CODE_LIMIT = 20_000;
const MAX_DEPTH = 3;

interface Span {
    readonly start: number;
    readonly end: number;
}

interface Word extends Span {
    /* The word as the shell hands it to the program, quotes and escapes taken out. */
    readonly text: string;
    /* The source of what the program gets, for a word that is bare or one quoted string; null for a mix. */
    readonly body: Span | null;
}

interface SimpleCommand {
    readonly words: Word[];
    readonly redirects: { readonly op: string; readonly target: Word }[];
    readonly heredocs: Span[];
}

interface Interpreter {
    readonly language: string;
    /* Whether a flag says the next argument is the script. */
    script(flag: string): boolean;
    /* Options that take the next argument as their value. */
    readonly takesValue?: ReadonlySet<string>;
    /* A database client: its arguments name a database, and it reads statements from stdin whatever they are. */
    readonly client?: boolean;
    /* The positional argument that holds statements, as in `sqlite3 app.db 'select 1'`. */
    readonly positional?: number;
}

const SHELL: Interpreter = {
    language: SHELL_LANGUAGE,
    script: (flag) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag),
    takesValue: new Set(['-o', '-O', '--rcfile', '--init-file'])
};

const PYTHON: Interpreter = { language: 'python', script: (flag) => flag === '-c', takesValue: new Set(['-W', '-X']) };

const NODE: Interpreter = {
    language: 'javascript',
    script: (flag) => ['-e', '--eval', '-p', '--print'].includes(flag),
    takesValue: new Set(['-r', '--require', '--import', '--input-type', '--conditions', '-C'])
};

const BUN: Interpreter = { language: 'typescript', script: (flag) => ['-e', '--eval', '-p', '--print'].includes(flag), takesValue: NODE.takesValue };

const MYSQL: Interpreter = {
    language: 'sql',
    client: true,
    script: (flag) => flag === '-e' || flag === '--execute',
    takesValue: new Set(['-u', '-h', '-P', '-D', '-S', '--user', '--host', '--port', '--database'])
};

const INTERPRETERS: Record<string, Interpreter> = {
    bash: SHELL,
    sh: SHELL,
    zsh: SHELL,
    dash: SHELL,
    ksh: SHELL,
    python: PYTHON,
    node: NODE,
    bun: BUN,
    psql: {
        language: 'sql',
        client: true,
        script: (flag) => flag === '-c' || flag === '--command',
        takesValue: new Set(['-d', '-h', '-p', '-U', '-f', '-v', '-o', '--dbname', '--host', '--port', '--username', '--file', '--set'])
    },
    mysql: MYSQL,
    mariadb: MYSQL,
    sqlite3: { language: 'sql', client: true, script: () => false, takesValue: new Set(['-cmd', '-separator', '-newline', '-nullvalue']), positional: 1 }
};

// Programs that run the next word as the command; their own options are skipped along with them.
const WRAPPERS = new Set(['sudo', 'env', 'exec', 'nohup', 'time', 'command', 'nice']);
// Tools that run a program of a project's environment as `<tool> run <program>`.
const RUNNERS = new Set(['uv', 'poetry', 'pipenv']);
// Where a heredoc written to a file goes, by the file's extension.
const EXTENSIONS: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    mts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    sql: 'sql',
    sh: SHELL_LANGUAGE,
    bash: SHELL_LANGUAGE,
    zsh: SHELL_LANGUAGE,
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    css: 'css',
    html: 'html',
    php: 'php',
    xml: 'xml'
};

const SEPARATORS = ';&|()';
const BLANKS = ' \t\r';

/* The program a command name runs, as the table above knows it: `/usr/bin/python3.12` is `python`. */
function programOf(word: string): string {
    const name = word.slice(word.lastIndexOf('/') + 1);
    return /^python\d*(\.\d+)?$/.test(name) ? 'python' : name;
}

/* Splits `source[from, to)` into simple commands the way a shell would, enough to find the code in them. */
function parseCommands(source: string, from: number, to: number): SimpleCommand[] {
    const commands: SimpleCommand[] = [];
    let current: SimpleCommand = { words: [], redirects: [], heredocs: [] };
    const pending: { command: SimpleCommand; delimiter: string; strip: boolean }[] = [];
    const finish = (): void => {
        if (current.words.length > 0 || current.redirects.length > 0) {
            commands.push(current);
        }
        current = { words: [], redirects: [], heredocs: [] };
    };
    const skipBlanks = (index: number): number => {
        while (index < to && BLANKS.includes(source[index]!)) {
            index++;
        }
        return index;
    };

    const readWord = (start: number): Word => {
        let index = start;
        let text = '';
        let quoted: Span | null = null;
        let parts = 0;
        let bare = true;
        while (index < to) {
            const char = source[index]!;
            if (BLANKS.includes(char) || char === '\n' || SEPARATORS.includes(char) || char === '<' || char === '>') {
                break;
            }
            parts++;
            if (char === "'") {
                const close = source.indexOf("'", index + 1);
                const end = close === -1 || close >= to ? to : close;
                text += source.slice(index + 1, end);
                quoted = { start: index + 1, end };
                bare = false;
                index = Math.min(end + 1, to);
            } else if (char === '"') {
                let end = index + 1;
                while (end < to && source[end] !== '"') {
                    if (source[end] === '\\' && end + 1 < to && '$`"\\\n'.includes(source[end + 1]!)) {
                        text += source[end + 1];
                        end += 2;
                    } else {
                        text += source[end];
                        end++;
                    }
                }
                quoted = { start: index + 1, end };
                bare = false;
                index = Math.min(end + 1, to);
            } else if (char === '\\') {
                text += source[index + 1] ?? '';
                bare = false;
                index += 2;
            } else if (char === '$' && source[index + 1] === '(') {
                const end = closingParen(source, index + 1, to);
                text += source.slice(index, end);
                index = end;
            } else {
                text += char;
                index++;
            }
        }
        const end = Math.min(index, to);
        const body = bare ? { start, end } : parts === 1 && quoted !== null ? quoted : null;
        return { start, end, text, body };
    };

    const readHeredoc = (start: number, delimiter: string, strip: boolean): { body: Span; next: number } => {
        let index = start;
        while (index < to) {
            const newline = source.indexOf('\n', index);
            const lineEnd = newline === -1 || newline >= to ? to : newline;
            let line = source.slice(index, lineEnd).replace(/\r$/, '');
            if (strip) {
                line = line.replace(/^\t+/, '');
            }
            if (line === delimiter) {
                return { body: { start, end: index }, next: Math.min(lineEnd + 1, to) };
            }
            index = lineEnd + 1;
        }
        return { body: { start, end: to }, next: to };
    };

    let index = from;
    while (index < to) {
        const char = source[index]!;
        if (char === '\n') {
            index++;
            for (const heredoc of pending) {
                const { body, next } = readHeredoc(index, heredoc.delimiter, heredoc.strip);
                heredoc.command.heredocs.push(body);
                index = next;
            }
            pending.length = 0;
            finish();
        } else if (BLANKS.includes(char)) {
            index++;
        } else if (char === '\\' && source[index + 1] === '\n') {
            index += 2;
        } else if (char === '#') {
            const newline = source.indexOf('\n', index);
            index = newline === -1 || newline >= to ? to : newline;
        } else if (source.startsWith('<<<', index)) {
            index = readWord(skipBlanks(index + 3)).end;
        } else if (source.startsWith('<<', index)) {
            index += 2;
            const strip = source[index] === '-';
            const word = readWord(skipBlanks(strip ? index + 1 : index));
            if (word.text !== '') {
                pending.push({ command: current, delimiter: word.text, strip });
            }
            index = word.end;
        } else if (char === '<' || char === '>' || (char === '&' && source[index + 1] === '>')) {
            let end = index + 1;
            while (end < to && '<>&|'.includes(source[end]!)) {
                end++;
            }
            const op = source.slice(index, end);
            const target = readWord(skipBlanks(end));
            current.redirects.push({ op, target });
            index = Math.max(target.end, end);
        } else if (SEPARATORS.includes(char)) {
            index++;
            finish();
        } else {
            const word = readWord(index);
            // The `2` of `2>&1` is a file descriptor, not an argument.
            const descriptor = /^\d+$/.test(word.text) && (source[word.end] === '>' || source[word.end] === '<');
            if (!descriptor) {
                current.words.push(word);
            }
            index = Math.max(word.end, index + 1);
        }
    }
    finish();
    return commands;
}

/* Where the `)` that closes the `(` at `open` is, past it; quotes inside do not count. */
function closingParen(source: string, open: number, to: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let index = open; index < to; index++) {
        const char = source[index]!;
        if (quote !== null) {
            if (char === quote) {
                quote = null;
            } else if (char === '\\' && quote === '"') {
                index++;
            }
        } else if (char === "'" || char === '"') {
            quote = char;
        } else if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0) {
                return index + 1;
            }
        }
    }
    return to;
}

/* The index of the word a command runs, past variable assignments, wrappers and runners; -1 for none. */
function programIndex(words: readonly Word[]): number {
    let index = 0;
    while (index < words.length) {
        const text = words[index]!.text;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
            index++;
        } else if (WRAPPERS.has(programOf(text))) {
            index++;
            while (index < words.length && words[index]!.text.startsWith('-')) {
                index++;
            }
        } else if (RUNNERS.has(programOf(text)) && words[index + 1]?.text === 'run') {
            index += 2;
        } else {
            return index;
        }
    }
    return -1;
}

/* The code of one simple command: an inline script, or a heredoc fed to an interpreter or written to a file. */
function codeOf(command: SimpleCommand): EmbeddedCode[] {
    const found: EmbeddedCode[] = [];
    const at = programIndex(command.words);
    const program = at === -1 ? '' : programOf(command.words[at]!.text);
    const interpreter = INTERPRETERS[program];
    let readsFile = false;
    if (interpreter !== undefined) {
        let positional = 0;
        for (let index = at + 1; index < command.words.length; index++) {
            const word = command.words[index]!;
            if (word.text.startsWith('-') && word.text !== '-') {
                if (interpreter.script(word.text)) {
                    const script = command.words[index + 1];
                    if (script?.body) {
                        found.push({ ...script.body, language: interpreter.language });
                    }
                    readsFile = true;
                    index++;
                } else if (interpreter.takesValue?.has(word.text)) {
                    index++;
                } else if (interpreter === PYTHON && word.text === '-m') {
                    readsFile = true;
                    break;
                }
                continue;
            }
            if (interpreter.client !== true) {
                // A script file; whatever follows is its own arguments.
                readsFile = word.text !== '-';
                break;
            }
            if (positional === interpreter.positional && word.body !== null) {
                found.push({ ...word.body, language: interpreter.language });
            }
            positional++;
        }
    }
    const heredocLanguage = interpreter !== undefined && (!readsFile || interpreter.client === true) ? interpreter.language : writtenLanguage(command, program);
    if (heredocLanguage !== null) {
        for (const body of command.heredocs) {
            found.push({ ...body, language: heredocLanguage });
        }
    }
    return found;
}

/* The language of the file a `cat > file` or `tee file` writes, by its extension; null when nothing says. */
function writtenLanguage(command: SimpleCommand, program: string): string | null {
    const targets = command.redirects.filter(({ op }) => op === '>' || op === '>>' || op === '>|').map(({ target }) => target.text);
    if (program === 'tee') {
        targets.push(
            ...command.words
                .slice(programIndex(command.words) + 1)
                .map(({ text }) => text)
                .filter((text) => !text.startsWith('-'))
        );
    }
    for (const target of targets) {
        const dot = target.lastIndexOf('.');
        const language = dot === -1 ? undefined : EXTENSIONS[target.slice(dot + 1).toLowerCase()];
        if (language !== undefined) {
            return language;
        }
    }
    return null;
}

function collect(source: string, from: number, to: number, depth: number, into: EmbeddedCode[]): void {
    for (const command of parseCommands(source, from, to)) {
        for (const code of codeOf(command)) {
            if (code.end <= code.start) {
                continue;
            }
            into.push(code);
            if (code.language === SHELL_LANGUAGE && depth < MAX_DEPTH) {
                collect(source, code.start, code.end, depth + 1, into);
            }
        }
    }
}

/*
 * The code inside a shell command that is in another language, or a shell script of its own: the
 * script of `bash -lc '…'`, `python3 -c '…'`, `node -e '…'`, `psql -c '…'`, and a heredoc fed to an
 * interpreter or written to a file of a known kind. Sorted by start, a stretch before the ones inside
 * it, so drawing them in order leaves the innermost language on top. A heuristic over a small shell
 * grammar, not a parser: what it does not recognize stays plain shell.
 */
export function embeddedCode(command: string): EmbeddedCode[] {
    if (command.length > EMBEDDED_CODE_LIMIT) {
        return [];
    }
    const found: EmbeddedCode[] = [];
    collect(command, 0, command.length, 0, found);
    return found.sort((left, right) => left.start - right.start || right.end - left.end);
}
