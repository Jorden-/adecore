import { describe, expect, test } from 'bun:test';
import { KEY_SHORTCUTS } from '@adecore/ui';
import { CHAT_SEND_KEYS, isChatSendKey, modSends, sendKeyLabel, sendShortcut } from './send-key';

describe('send key', () => {
    test('Mod+Enter sends a message of more lines in the multiline mode and every message in its own', () => {
        expect(modSends('enter', true)).toBe(false);
        expect(modSends('mod-enter-multiline', false)).toBe(false);
        expect(modSends('mod-enter-multiline', true)).toBe(true);
        expect(modSends('mod-enter', false)).toBe(true);
    });

    test('the hint names the key that sends what is in the box', () => {
        expect(sendShortcut('enter', true)).toBe(KEY_SHORTCUTS.enter);
        expect(sendShortcut('mod-enter-multiline', true)).toBe(KEY_SHORTCUTS.modEnter);
        expect(sendShortcut('mod-enter', false)).toBe(KEY_SHORTCUTS.modEnter);
    });

    test('only the known keys are one', () => {
        expect(CHAT_SEND_KEYS.every(isChatSendKey)).toBe(true);
        expect(isChatSendKey('shift-enter')).toBe(false);
        expect(isChatSendKey(undefined)).toBe(false);
    });

    test('every key has words, with the modifier of the platform', () => {
        expect(CHAT_SEND_KEYS.map((key) => sendKeyLabel(key, false))).toEqual(['Enter', 'Enter, Ctrl+Enter for more lines', 'Ctrl+Enter']);
        expect(sendKeyLabel('mod-enter', true)).toBe('⌘+Enter');
    });
});
