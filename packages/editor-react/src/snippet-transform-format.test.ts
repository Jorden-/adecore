import { expect, test } from 'bun:test';
import { applySnippetTransform, compileSnippetTransformFormat, validateSnippetTransformJobs } from './snippet-transform-format.ts';
const job = (value: string, format: string, pattern = '(.*)', flags = '') => ({ value, pattern, flags, format: compileSnippetTransformFormat(format) });
for (const [operation, source, expected] of [
    ['upcase', 'hello', 'HELLO'],
    ['downcase', 'HeLLo', 'hello'],
    ['capitalize', 'helloWORLD', 'HelloWORLD'],
    ['camelcase', 'HELLO_world-name', 'helloWorldName'],
    ['pascalcase', 'hello_world-name', 'HelloWorldName']
]) {
    test(`transform case ${operation}`, () => expect(applySnippetTransform(job(source!, '${1:/' + operation + '}'))).toBe(expected));
}
test('captures, conditionals, empty groups and escaped format delimiters', () => {
    expect(applySnippetTransform(job('a', '$0/$1/${2}/$99', '(a)'))).toBe('a/a//');
    expect(applySnippetTransform(job('a', '${1:+yes}-${2:-no}-${1:?has:missing}-${2:default}', '(a)(b)?'))).toBe('yes-no-has-default');
    expect(applySnippetTransform(job('', '${1:?a:b}-${1:-empty}', '()'))).toBe('b-empty');
    expect(applySnippetTransform(job('a', '${1:?a\\:b:c}\\}\\$'))).toBe('a:b}$');
    expect(applySnippetTransform(job('abc', 'other', 'z'))).toBe('abc');
});
test('global empty matches advance by a whole Unicode code point', () => {
    expect(applySnippetTransform(job('😀', 'x', '(?:)', 'gu'))).toBe('x😀x');
    expect(applySnippetTransform(job('aaa', '${1:/upcase}', '(a)', 'g'))).toBe('AAA');
});
test('format, input, output and match budgets refuse the whole operation', () => {
    expect(() => compileSnippetTransformFormat('x'.repeat(10001))).toThrow(RangeError);
    expect(() => compileSnippetTransformFormat('$100')).toThrow(RangeError);
    expect(() => compileSnippetTransformFormat('${1:/unknown}')).toThrow(SyntaxError);
    expect(() => compileSnippetTransformFormat('${1:?missing}')).toThrow(SyntaxError);
    expect(() => compileSnippetTransformFormat('$1'.repeat(1001))).toThrow(RangeError);
    expect(() => validateSnippetTransformJobs([job('x'.repeat(100001), 'x')])).toThrow(RangeError);
    expect(() => validateSnippetTransformJobs(Array.from({ length: 1001 }, () => job('a', '$1')))).toThrow(RangeError);
    expect(() => validateSnippetTransformJobs([job('a', '$1', '(', '')])).toThrow(SyntaxError);
    expect(() => validateSnippetTransformJobs([job('a', '$1', '(a)', 'y')])).toThrow(SyntaxError);
    expect(() => validateSnippetTransformJobs([job('a', '$1', '(a)', 'gg')])).toThrow(SyntaxError);
    expect(() => applySnippetTransform(job('a', 'long'), 3)).toThrow(RangeError);
    expect(() => applySnippetTransform(job('x'.repeat(10000), '', '(?:)', 'g'))).toThrow(RangeError);
});
