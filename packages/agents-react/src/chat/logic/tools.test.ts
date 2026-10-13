import { describe, expect, test } from 'bun:test';
import type { ChatToolItem } from '@adecore/agent-contracts';
import {
    approvalChanges,
    exitCodeOf,
    hasFileChanges,
    hasToolBody,
    liveOutput,
    readImagePath,
    shellCommand,
    toolCallLines,
    toolStartedAt,
    unifiedChanges
} from './tools';

function running(progress?: ChatToolItem['progress']): ChatToolItem {
    return {
        id: 'b1',
        kind: 'tool',
        createdAt: 5000,
        turnId: 't1',
        toolUseId: 'b1',
        name: 'Bash',
        input: { command: 'bun test' },
        output: null,
        state: 'running',
        parentToolUseId: null,
        progress
    };
}

describe('readImagePath', () => {
    test('names the image a read looked at and nothing else', () => {
        expect(readImagePath('Read', { file_path: '/a/shot.PNG' })).toBe('/a/shot.PNG');
        expect(readImagePath('Read', { file_path: '/a/notes.md' })).toBeNull();
        expect(readImagePath('Read', {})).toBeNull();
        expect(readImagePath('Write', { file_path: '/a/shot.png' })).toBeNull();
    });
});

describe('live tool helpers', () => {
    test('the start is what the CLI reported, or when the call appeared', () => {
        expect(toolStartedAt(running())).toBe(5000);
        expect(toolStartedAt(running({ startedAt: null, description: 'x', output: null }))).toBe(5000);
        expect(toolStartedAt(running({ startedAt: 2000, description: null, output: null }))).toBe(2000);
    });

    test('partial output keeps its history for ANSI state, and is absent when nothing streamed', () => {
        expect(liveOutput(running())).toBeNull();
        expect(liveOutput(running({ startedAt: null, description: null, output: '' }))).toBeNull();
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
        expect(liveOutput(running({ startedAt: null, description: null, output: `${lines}\n` }))).toBe(`${lines}\n`);
    });
});

function patched(changes: ChatToolItem['changes']): ChatToolItem {
    return {
        ...running(),
        id: 'p1',
        toolUseId: 'p1',
        name: 'ApplyPatch',
        input: { summary: 'a.ts' },
        output: '-x\n+y\n',
        state: 'done',
        progress: undefined,
        changes
    };
}

describe('file change helpers', () => {
    test('a call carries the unified diffs a provider reported, and an empty diff is nothing to show', () => {
        expect(unifiedChanges(patched([{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }]))).toHaveLength(1);
        expect(unifiedChanges(patched([{ path: 'a.ts', kind: 'update', diff: '' }]))).toEqual([]);
        expect(unifiedChanges(running())).toEqual([]);
    });

    test('a turn shows a call in its changed files card when either kind of change is there', () => {
        expect(hasFileChanges(patched([{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }]))).toBe(true);
        expect(hasFileChanges(patched([]))).toBe(false);
        expect(hasFileChanges({ ...running(), name: 'Write', input: { file_path: 'a.ts', content: 'hi' } })).toBe(true);
    });

    test('an approval repeats the diffs in its input, and anything else is no diff at all', () => {
        expect(approvalChanges({ summary: 'a.ts', changes: [{ path: 'a.ts', kind: 'update', diff: '-x\n' }] })).toHaveLength(1);
        expect(approvalChanges({ changes: [{ path: 'a.ts', diff: '' }] })).toEqual([]);
        expect(approvalChanges({ command: 'date' })).toEqual([]);
        expect(approvalChanges(null)).toEqual([]);
    });
});

describe('toolCallLines', () => {
    test('a shell call is its command, without the description its row already shows', () => {
        expect(toolCallLines('Bash', { command: 'bun test', description: 'Run the tests', timeout: 60000 })).toEqual({
            command: 'bun test',
            args: [['timeout', '60000']],
            text: null
        });
    });

    test('any other input is key and value, a string as it is and the rest as compact JSON', () => {
        expect(toolCallLines('Grep', { pattern: 'settleTask', path: 'apps/server/src', head_limit: 5, multiline: false, glob: ['*.ts'] })).toEqual({
            command: null,
            args: [
                ['pattern', 'settleTask'],
                ['path', 'apps/server/src'],
                ['head_limit', '5'],
                ['multiline', 'false'],
                ['glob', '["*.ts"]']
            ],
            text: null
        });
    });

    test('an empty string and null still show, an undefined key does not', () => {
        expect(toolCallLines('mcp/set', { title: '', note: null, skipped: undefined }).args).toEqual([
            ['title', '""'],
            ['note', 'null']
        ]);
    });

    test('a shell call without a command reads like any other input', () => {
        expect(toolCallLines('Bash', { command: ' ', description: 'x' })).toEqual({
            command: null,
            args: [
                ['command', ' '],
                ['description', 'x']
            ],
            text: null
        });
    });

    test('an input that is no object is text, and nothing is nothing', () => {
        expect(toolCallLines('Odd', 'raw input')).toEqual({ command: null, args: [], text: 'raw input' });
        expect(toolCallLines('Odd', [1, 2])).toEqual({ command: null, args: [], text: '[1,2]' });
        expect(toolCallLines('Odd', null)).toEqual({ command: null, args: [], text: null });
        expect(toolCallLines('Odd', {})).toEqual({ command: null, args: [], text: null });
    });
});

describe('shellCommand', () => {
    test('only a shell tool has one', () => {
        expect(shellCommand('Bash', { command: 'ls' })).toBe('ls');
        expect(shellCommand('Bash', { command: '' })).toBeNull();
        expect(shellCommand('Grep', { command: 'ls' })).toBeNull();
    });
});

describe('exitCodeOf', () => {
    test('lifts a nonzero exit code off the first line', () => {
        expect(exitCodeOf('Exit code 1\nerror: nope')).toEqual({ code: 1, rest: 'error: nope' });
        expect(exitCodeOf('Exit code 127')).toEqual({ code: 127, rest: '' });
    });

    test('leaves any other output alone', () => {
        expect(exitCodeOf('Exit code 0\nfine')).toEqual({ code: null, rest: 'Exit code 0\nfine' });
        expect(exitCodeOf('error: Exit code 1')).toEqual({ code: null, rest: 'error: Exit code 1' });
        expect(exitCodeOf('Exit code 1a')).toEqual({ code: null, rest: 'Exit code 1a' });
    });
});

describe('hasToolBody', () => {
    const settled = (input: unknown, output: string | null): ChatToolItem => ({ ...running(), input, output, state: 'done' });

    test('a call with neither input nor output has nothing to open', () => {
        expect(hasToolBody(settled({}, null))).toBe(false);
        expect(hasToolBody(settled({}, '  \n'))).toBe(false);
        expect(hasToolBody({ ...settled({}, null), name: 'TodoWrite' })).toBe(false);
    });

    test('input, output or a diff is something to open', () => {
        expect(hasToolBody(settled({ command: 'ls' }, null))).toBe(true);
        expect(hasToolBody(settled({}, 'a.txt'))).toBe(true);
        expect(hasToolBody({ ...settled({}, null), changes: [{ path: 'a', kind: 'update', diff: '@@' }] })).toBe(true);
    });
});
