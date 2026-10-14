import { describe, expect, test } from 'bun:test';
import type { KeyLike } from '@adecore/ui';
import { runScopeOf } from './shortcuts.ts';

const enter = (modifiers: Partial<KeyLike>): KeyLike => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'Enter',
    code: 'Enter',
    ...modifiers
});

describe('runScopeOf', () => {
    test('runs the selection or the statement on Mod+Enter', () => {
        expect(runScopeOf(enter({ metaKey: true }), true)).toBe('selection-or-statement');
        expect(runScopeOf(enter({ ctrlKey: true }), false)).toBe('selection-or-statement');
    });

    test('runs everything with Shift held as well', () => {
        expect(runScopeOf(enter({ metaKey: true, shiftKey: true }), true)).toBe('all');
        expect(runScopeOf(enter({ ctrlKey: true, shiftKey: true }), false)).toBe('all');
    });

    test('is null for any other key', () => {
        expect(runScopeOf(enter({}), true)).toBeNull();
        expect(runScopeOf(enter({ ctrlKey: true }), true)).toBeNull();
        expect(runScopeOf(enter({ metaKey: true, key: 'a', code: 'KeyA' }), true)).toBeNull();
    });
});
