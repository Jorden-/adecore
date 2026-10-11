import { expect, test } from 'bun:test';
import { holdLiftsIn, holdsPrompt, PROMPT_HOLD_PAUSE_MS } from './prompt-hold';

test('a card is held until the pause has run out', () => {
    const input = { typedAt: 1000, composing: false };
    expect(holdsPrompt(input, 1000 + PROMPT_HOLD_PAUSE_MS - 1)).toBe(true);
    expect(holdsPrompt(input, 1000 + PROMPT_HOLD_PAUSE_MS)).toBe(false);
});

test('composing holds for as long as it lasts', () => {
    expect(holdsPrompt({ typedAt: 0, composing: true }, 1_000_000)).toBe(true);
    expect(holdsPrompt({ typedAt: null, composing: true }, 5)).toBe(true);
});

test('without typing nothing is held', () => {
    expect(holdsPrompt({ typedAt: null, composing: false }, 5)).toBe(false);
});

test('the hold says when it lifts', () => {
    expect(holdLiftsIn({ typedAt: 1000, composing: false }, 1500)).toBe(PROMPT_HOLD_PAUSE_MS - 500);
    expect(holdLiftsIn({ typedAt: 1000, composing: false }, 9000)).toBe(0);
    expect(holdLiftsIn({ typedAt: null, composing: false }, 1500)).toBeNull();
    expect(holdLiftsIn({ typedAt: 1000, composing: true }, 1500)).toBeNull();
});
