import { describe, expect, test } from 'bun:test';
import { registerComposerSender, sendFromComposer, type ComposerSend } from './composer-send';

describe('sending from outside a composer', () => {
    test('reaches the composer of that chat and says when there is none', () => {
        const sent: ComposerSend[] = [];
        const unregister = registerComposerSender('local:chat-1', (how) => sent.push(how));
        expect(sendFromComposer('local:chat-1', 'and-new')).toBe(true);
        expect(sendFromComposer('local:chat-2')).toBe(false);
        unregister();
        expect(sendFromComposer('local:chat-1')).toBe(false);
        expect(sent).toEqual(['and-new']);
    });

    test('a composer that left does not take away the one that replaced it', () => {
        const first = registerComposerSender('local:chat-1', () => undefined);
        const sent: ComposerSend[] = [];
        registerComposerSender('local:chat-1', (how) => sent.push(how));
        first();
        expect(sendFromComposer('local:chat-1')).toBe(true);
        expect(sent).toEqual(['default']);
    });
});
