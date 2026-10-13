import { describe, expect, test } from 'bun:test';
import { EMBEDDED_CODE_LIMIT, embeddedCode } from './embedded-code';

/* The code found in a command as its text and language, which reads better than offsets. */
function found(command: string): [string, string][] {
    return embeddedCode(command).map(({ start, end, language }) => [language, command.slice(start, end)]);
}

describe('embeddedCode', () => {
    test('a plain command has none', () => {
        expect(found('git log --oneline -5 -- "apps/server/src/chat"')).toEqual([]);
        expect(found('')).toEqual([]);
    });

    test('an inline interpreter script is in its own language', () => {
        expect(found(`python3 -c 'import json; print(json.load(open("a.json"))["rev"])'`)).toEqual([
            ['python', 'import json; print(json.load(open("a.json"))["rev"])']
        ]);
        expect(found('node -e "console.log(1)"')).toEqual([['javascript', 'console.log(1)']]);
        expect(found(`bun --eval 'const x: number = 1'`)).toEqual([['typescript', 'const x: number = 1']]);
        expect(found(`psql -d app -c 'select 1'`)).toEqual([['sql', 'select 1']]);
        expect(found(`sqlite3 app.db "select * from users"`)).toEqual([['sql', 'select * from users']]);
        expect(found('/usr/bin/python3.12 -c pass')).toEqual([['python', 'pass']]);
    });

    test('a shell script inside a command is shell again, and the code inside that is found too', () => {
        const command = `bash -lc 'cd app && python3 -c "print(1)"'`;
        expect(found(command)).toEqual([
            ['shellscript', 'cd app && python3 -c "print(1)"'],
            ['python', 'print(1)']
        ]);
        expect(found(`sh -c "echo hi"`)).toEqual([['shellscript', 'echo hi']]);
    });

    test('assignments, wrappers and runners do not hide the program', () => {
        expect(found(`FOO=1 sudo -E python -c 'x = 1'`)).toEqual([['python', 'x = 1']]);
        expect(found(`uv run python -c 'x = 1'`)).toEqual([['python', 'x = 1']]);
        expect(found(`env node -e 'x'`)).toEqual([['javascript', 'x']]);
    });

    test('every command of a pipeline or a list is looked at', () => {
        expect(found(`echo start && node -e 'a()' | python3 -c 'b()'; ls`)).toEqual([
            ['javascript', 'a()'],
            ['python', 'b()']
        ]);
    });

    test('a script file means the flags after it are its own', () => {
        expect(found(`python3 script.py -c 'not python'`)).toEqual([]);
        expect(found(`python3 -m http.server -c 'x'`)).toEqual([]);
    });

    test('a heredoc fed to an interpreter is in its language', () => {
        const command = "python3 - <<'EOF'\nimport sys\nprint(sys.argv)\nEOF\necho done";
        expect(found(command)).toEqual([['python', 'import sys\nprint(sys.argv)\n']]);
        expect(found('node <<EOF 2>&1\nconsole.log(1)\nEOF')).toEqual([['javascript', 'console.log(1)\n']]);
        expect(found('psql app <<SQL\nselect 1;\nSQL')).toEqual([['sql', 'select 1;\n']]);
    });

    test('a heredoc written to a file takes the language of its extension', () => {
        expect(found("cat > src/app.ts <<'EOF'\nconst x = 1;\nEOF")).toEqual([['typescript', 'const x = 1;\n']]);
        expect(found('cat <<EOF | tee config.json\n{"a": 1}\nEOF')).toEqual([]);
        expect(found('tee config.json <<EOF\n{"a": 1}\nEOF')).toEqual([['json', '{"a": 1}\n']]);
        expect(found('cat <<EOF > notes\nhello\nEOF')).toEqual([]);
    });

    test('a heredoc with a tab-stripped delimiter ends at it', () => {
        expect(found('bash <<-EOF\n\techo hi\n\tEOF\nls')).toEqual([['shellscript', '\techo hi\n']]);
    });

    test('quotes and comments do not end a word or a command early', () => {
        expect(found(`node -e 'a; b | c' # python -c 'x'`)).toEqual([['javascript', 'a; b | c']]);
        expect(found(`echo "$(python3 -c 'x')"`)).toEqual([]);
    });

    test('a word that mixes quotes is left alone', () => {
        expect(found(`python3 -c 'a'"b"`)).toEqual([]);
    });

    test('an unterminated quote or heredoc runs to the end', () => {
        expect(found(`python3 -c 'print(1)`)).toEqual([['python', 'print(1)']]);
        expect(found('python3 <<EOF\nprint(1)')).toEqual([['python', 'print(1)']]);
    });

    test('a command past the limit is not scanned', () => {
        expect(embeddedCode(`python3 -c '${'x'.repeat(EMBEDDED_CODE_LIMIT)}'`)).toEqual([]);
    });
});
