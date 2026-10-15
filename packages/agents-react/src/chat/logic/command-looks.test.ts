import { describe, expect, test } from 'bun:test';
import type { CommandLook } from '../../host';
import { EMBEDDED_CODE_LIMIT } from './embedded-code';
import { matchCommandLook } from './command-looks';

const Mark = () => null;

/* An invented CLI: `orbit <area> <action> …`, with `orbit help` of its own and nothing for `orbit` alone. */
const ORBIT: CommandLook = {
    program: 'orbit',
    brand: 'Orbit',
    Mark,
    describe: (args) => {
        const [area] = args;
        if (area === undefined) {
            return null;
        }
        if (area === 'help') {
            return { label: 'Help', detailFrom: 1 };
        }
        return {
            label: area === 'probe' ? 'Probe' : '',
            detailFrom: 1,
            group: { key: area, sentence: (count) => `Used Orbit ${area} ${count} times` },
            fold: ['--prompt'],
            languages: { '--query': 'sql' }
        };
    }
};

const LOOKS = [ORBIT];

function detailOf(command: string): string | null {
    return matchCommandLook(command, LOOKS)?.detail ?? null;
}

describe('matchCommandLook', () => {
    test('reads a run of the program as its look, the detail from the word the match names', () => {
        const run = matchCommandLook('orbit probe launch "Main Deck" --wait 5', LOOKS)!;
        expect(run.look).toBe(ORBIT);
        expect(run.match.label).toBe('Probe');
        expect(run.detail).toBe('launch "Main Deck" --wait 5');
        expect(run.others).toEqual([]);
        expect(run.more).toBe(0);
        expect(run.heredoc).toBe(false);
    });

    test('leaves out the shell around it and names the other programs once each', () => {
        const run = matchCommandLook(`sleep 3; orbit probe state "Main Deck" 2>&1 | grep -E '^(shot|tree)' | grep x`, LOOKS)!;
        expect(run.detail).toBe('state "Main Deck"');
        expect(run.others).toEqual(['sleep', 'grep']);
    });

    test('a redirect inside the words reads as one space', () => {
        expect(detailOf('orbit probe state > out.txt --wait 5')).toBe('state --wait 5');
    });

    test('the first of two runs in a line is the one drawn, and the second is counted', () => {
        const run = matchCommandLook('orbit probe new --title "Open" && orbit link new a-1 b-2', LOOKS)!;
        expect(run.detail).toBe('new --title "Open"');
        expect(run.more).toBe(1);
        expect(run.others).toEqual([]);
    });

    test('a heredoc is said, not shown', () => {
        const run = matchCommandLook("orbit probe write --name chart.html <<'HTML'\n<!doctype html>\nHTML", LOOKS)!;
        expect(run.detail).toBe('write --name chart.html');
        expect(run.heredoc).toBe(true);
    });

    test('a path and assignments before the program do not hide it', () => {
        expect(detailOf('NO_COLOR=1 ~/.orbit/bin/orbit probe read api --tail 80')).toBe('read api --tail 80');
        expect(detailOf('env FOO=1 orbit probe ping')).toBe('ping');
    });

    test('the program counts only where the shell runs it', () => {
        expect(detailOf('grep -rn "orbit" src')).toBeNull();
        expect(detailOf('which orbit')).toBeNull();
        expect(detailOf('echo orbit probe')).toBeNull();
        expect(detailOf('orbital probe')).toBeNull();
    });

    test('a run the look does not describe stays a shell call', () => {
        expect(detailOf('orbit')).toBeNull();
    });

    test('a line past the limit is not read', () => {
        expect(detailOf(`orbit probe ${'x'.repeat(EMBEDDED_CODE_LIMIT)}`)).toBeNull();
    });

    test('no looks, no runs', () => {
        expect(matchCommandLook('orbit probe ping', [])).toBeNull();
        expect(matchCommandLook('orbit probe ping', undefined)).toBeNull();
    });

    test('a folded value stops past 40 characters and the words after it stay', () => {
        const prompt = 'The tokenizer drops a trailing heredoc marker when the line ends in a comment';
        expect(detailOf(`orbit agent codex --task "Fix" --prompt "${prompt}" --view Work`)).toBe(
            `codex --task "Fix" --prompt "${prompt.slice(0, 40)}…" --view Work`
        );
        expect(detailOf(`orbit agent codex --task "${prompt}"`)).toBe(`codex --task "${prompt}"`);
    });

    test('a value in a language is found for the highlighter, inside its quotes', () => {
        const run = matchCommandLook(`orbit db query --connection local --query "SELECT id FROM users"`, LOOKS)!;
        expect(run.code.map(({ start, end, language }) => [language, run.detail.slice(start, end)])).toEqual([['sql', 'SELECT id FROM users']]);
    });

    test('the words a host may name are the ones that are no option', () => {
        const run = matchCommandLook('orbit probe go probe-3f2a --url https://example.com --view main', LOOKS)!;
        expect(run.words.map(({ start, end, text }) => [text, run.detail.slice(start, end)])).toEqual([
            ['go', 'go'],
            ['probe-3f2a', 'probe-3f2a'],
            ['https://example.com', 'https://example.com'],
            ['main', 'main']
        ]);
    });

    test('a quoted word is named by what the program gets', () => {
        const run = matchCommandLook(`orbit probe tap 'probe-1' --view "main"`, LOOKS)!;
        expect(run.words.map(({ text }) => text)).toEqual(['tap', 'probe-1', 'main']);
        expect(run.words.map(({ start, end }) => run.detail.slice(start, end))).toEqual(['tap', "'probe-1'", '"main"']);
    });

    test('an empty detail is a look with nothing after the word it starts at', () => {
        expect(detailOf('orbit help')).toBe('');
    });
});
