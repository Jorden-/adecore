import { expect, test } from 'bun:test';
import { z } from 'zod';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatAssistantItemSchema, ChatEventSchema, ChatUiPlaceReadingSchema, ChatUiQueryStateSchema } from './chat.ts';

test('future UI components stay open on the chat wire and legacy decoders retain the reply', () => {
    const text = '```ui\n<Summary>Readable</Summary>\n```';
    const block = compileUi(text, { id: 'reply', final: true })[0];
    const future = {
        ...block,
        catalogVersion: 999,
        nodes: [{ ...block.nodes[0], type: 'FutureWidget', props: { future: true }, expressions: { future: { kind: 'future' } } }]
    };
    const reply = { id: 'reply', kind: 'assistant', createdAt: 1, turnId: null, text, streaming: false, ui: [future] };
    const parsed = ChatAssistantItemSchema.parse(reply);
    expect(parsed.ui?.[0].nodes[0].type).toBe('FutureWidget');
    expect(parsed.ui?.[0].nodes[0].expressions.future as unknown).toEqual({ kind: 'future' });
    const oldReply = ChatAssistantItemSchema.omit({ ui: true }).parse(reply);
    expect(oldReply.text).toBe(text);
    expect(oldReply).not.toHaveProperty('ui');
    const event = { type: 'delta', itemId: 'reply', text: '', textLength: text.length, ui: [future] };
    expect(ChatEventSchema.parse(event) as unknown).toEqual(event);
    const oldDelta = z.object({ type: z.literal('delta'), itemId: z.string(), text: z.string() }).parse(event);
    expect(oldDelta).toEqual({ type: 'delta', itemId: 'reply', text: '' });
});

test('a frozen block reads with or without the places looked up beside it', () => {
    const older = { authorChatId: 'chat', blocks: { block: { revision: 'r1', readings: {}, fallback: 'Text' } } };
    expect(ChatUiQueryStateSchema.parse(older) as unknown).toEqual(older);
    const places = {
        found: { state: 'found', lat: 52.0907, lon: 5.1214, label: 'Domplein, Utrecht' },
        missing: { state: 'missing', code: 'place-not-found', reason: 'No match for this address.' }
    };
    const newer = { authorChatId: 'chat', blocks: { block: { revision: 'r1', readings: {}, fallback: 'Text', places } } };
    expect(ChatUiQueryStateSchema.parse(newer) as unknown).toEqual(newer);
    expect(ChatUiPlaceReadingSchema.safeParse({ state: 'found', lat: 91, lon: 5 }).success).toBe(false);
    expect(ChatUiPlaceReadingSchema.safeParse({ state: 'later' }).success).toBe(false);
});
