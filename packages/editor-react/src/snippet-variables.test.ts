import './test-setup.ts';
import { expect, test } from 'bun:test';
import { createSnippetResolver } from './snippet-variables.ts';
import { indentSnippet } from './snippet-indent.ts';
import { parseSnippet, tabOrder } from './snippet.ts';
import type { SnippetVariableContext } from './host-types.ts';

const context: SnippetVariableContext = {
    uri: 'file:///work/a.ts',
    languageId: 'typescript',
    position: { line: 4, character: 2 },
    selection: { start: { line: 4, character: 0 }, end: { line: 4, character: 2 } },
    selectedText: 'ab',
    currentLine: 'ab word',
    currentWord: 'ab',
    cursorIndex: 2,
    cursorCount: 3,
    folder: '/work',
    path: '/work/a.ts'
};

test('built-in values use the insertion context and cache random values', () => {
    let randomCalls = 0;
    const resolve = createSnippetResolver(context, undefined, {
        now: new Date(2026, 9, 12, 8, 9, 7),
        random: () => {
            randomCalls++;
            return 0.5;
        },
        uuid: () => 'uuid'
    });
    expect(['TM_LINE_INDEX', 'TM_LINE_NUMBER', 'CURSOR_INDEX', 'CURSOR_NUMBER', 'TM_SELECTED_TEXT', 'TM_CURRENT_LINE', 'TM_CURRENT_WORD'].map(resolve)).toEqual(
        ['4', '5', '2', '3', 'ab', 'ab word', 'ab']
    );
    expect(['TM_FILENAME', 'TM_FILENAME_BASE', 'TM_DIRECTORY', 'TM_FILEPATH', 'RELATIVE_FILEPATH', 'WORKSPACE_NAME', 'WORKSPACE_FOLDER'].map(resolve)).toEqual([
        'a.ts',
        'a',
        '/work',
        '/work/a.ts',
        'a.ts',
        'work',
        '/work'
    ]);
    expect(['CURRENT_YEAR', 'CURRENT_MONTH', 'CURRENT_DATE', 'CURRENT_DAY_NAME', 'CURRENT_HOUR', 'CURRENT_MINUTE', 'CURRENT_SECOND'].map(resolve)).toEqual([
        '2026',
        '10',
        '12',
        'Monday',
        '08',
        '09',
        '07'
    ]);
    expect(resolve('RANDOM')).toBe('500000');
    expect(resolve('RANDOM')).toBe('500000');
    expect(resolve('RANDOM_HEX')).toBe('800000');
    expect(resolve('UUID')).toBe('uuid');
    expect(randomCalls).toBe(2);
});

test('host overrides are synchronous and undefined preserves built-ins', () => {
    const resolve = createSnippetResolver(context, (name, at) => (name === 'LINE_COMMENT' ? '//' : name === 'CUSTOM' ? String(at.cursorCount) : undefined));
    expect(resolve('LINE_COMMENT')).toBe('//');
    expect(resolve('CUSTOM')).toBe('3');
    expect(resolve('TM_FILENAME')).toBe('a.ts');
    expect(resolve('CLIPBOARD')).toBeUndefined();
    expect(parseSnippet('${CLIPBOARD:missing} $CUSTOM', resolve).text).toBe('missing 3');
});

test('dotfiles and Windows workspace paths have sensible names', () => {
    const resolve = createSnippetResolver({ ...context, path: 'C:\\work\\.env', folder: 'C:\\work' });
    expect(resolve('TM_FILENAME_BASE')).toBe('.env');
    expect(resolve('RELATIVE_FILEPATH')).toBe('.env');
});

test('indentation maps explicit fields, copied children and CRLF offsets', () => {
    const parsed = indentSnippet(parseSnippet('${1:a\r\n${2:b}} $1$0'), '\t\t');
    expect(parsed.text).toBe('a\r\n\t\tb a\r\n\t\tb');
    const child = parsed.fields!.find((field) => field.index === 2)!;
    expect(child.ranges.map((range) => parsed.text.slice(range.start, range.end))).toEqual(['b']);
    expect(child.linked?.map((range) => parsed.text.slice(range.start, range.end))).toEqual(['b']);
    expect(tabOrder(parsed).at(-1)?.start).toBe(parsed.text.length);
});

test('indentation cannot expand a small snippet into unbounded text', () => {
    const parsed = parseSnippet('${1:x}\n'.repeat(100));
    const adjusted = indentSnippet(parsed, ' '.repeat(100_000));
    expect(adjusted.text).toBe(parsed.text);
    expect(adjusted.stops).toEqual([]);
});

test('prototype property names are unknown variables rather than builtin values', () => {
    const resolve = createSnippetResolver(context);
    expect(resolve('toString')).toBeUndefined();
    expect(resolve('__proto__')).toBeUndefined();
    expect(parseSnippet('$toString $__proto__', resolve).text).toBe('toString __proto__');
});

test('a throwing override delegates to built-ins and a basename has no directory', () => {
    const resolve = createSnippetResolver({ ...context, path: 'a.ts' }, () => {
        throw new Error('offline');
    });
    expect(resolve('TM_FILENAME')).toBe('a.ts');
    expect(resolve('TM_DIRECTORY')).toBe('');
    expect(resolve('UNKNOWN')).toBeUndefined();
});
