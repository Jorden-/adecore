import { expect, test } from 'bun:test';
import { diffSourceBudget, legacyDiffBudget, patchSourceBudget } from './diff-source-budget';

test('source budgets reject huge writes and hidden sources before line arrays are allocated', () => {
    expect(diffSourceBudget('', 'x'.repeat(2000001))).toBe(false);
    expect(diffSourceBudget('line\n'.repeat(20001), 'changed')).toBe(false);
    expect(diffSourceBudget('line\n'.repeat(20000), 'changed')).toBe(true);
    expect(diffSourceBudget('x'.repeat(1000000), 'changed')).toBe(true);
    expect(diffSourceBudget('x'.repeat(1000001), 'changed')).toBe(false);
    expect(diffSourceBudget('', '')).toBe(true);
});

test('a patch has its own bounded preparation budget, including markers and headers', () => {
    expect(patchSourceBudget('@@ -1 +1 @@\n-old\n+new\n')).toBe(true);
    expect(patchSourceBudget(' '.repeat(4000001))).toBe(false);
    expect(patchSourceBudget(' context\n'.repeat(50001))).toBe(false);
    expect(patchSourceBudget('+' + 'x'.repeat(1000000))).toBe(true);
    expect(patchSourceBudget('+' + 'x'.repeat(1000001))).toBe(false);
});

test('large editor inputs and failures cannot escape through the small legacy fallback', () => {
    expect(legacyDiffBudget('old', 'new')).toBe(true);
    expect(legacyDiffBudget('line\n'.repeat(5000), 'changed')).toBe(false);
    expect(legacyDiffBudget('old', 'new', '+line\n'.repeat(401))).toBe(false);
    expect(legacyDiffBudget('x'.repeat(10001), 'new')).toBe(false);
    expect(legacyDiffBudget('x'.repeat(10000), 'new')).toBe(true);
    expect(legacyDiffBudget('a\n'.repeat(199), 'b\n'.repeat(199))).toBe(true);
    expect(legacyDiffBudget('a\n'.repeat(200), 'b\n'.repeat(199))).toBe(false);
});
