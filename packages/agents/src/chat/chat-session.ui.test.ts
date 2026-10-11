import { describe, expect, test } from 'bun:test';
import type { ChatEvent, ChatItem } from '@adecore/agent-contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { compileUiBlock, evaluateUiBlock } from '@adecore/intelligent-ui';
import { flush, rig } from './chat-session.fixture.test.ts';

describe('streamed intelligent UI', () => {
    test('previews are transient and final text replaces the compiled tree once', async () => {
        const clock = new ManualClock();
        const events: ChatEvent[] = [];
        const run = rig({ clock, emit: (event) => events.push(event) });
        await run.session.send('Show results');
        await flush();
        const streamed = 'Before\n```ui\n<Summary>Streaming';
        run.event({ type: 'text.delta', ref: 'answer', text: streamed });
        const item = run.session.thread.list().find((row) => row.kind === 'assistant');
        expect(item?.kind).toBe('assistant');
        if (item?.kind !== 'assistant') {
            throw new Error('Missing assistant');
        }
        expect(item.ui).toBeUndefined();
        expect(run.session.uiPreviews).toHaveLength(1);
        expect(run.session.previewItems([item])[0]).toHaveProperty('ui');
        clock.advance(50);
        run.event({ type: 'text.delta', ref: 'answer', text: ' pending' });
        expect(run.session.uiPreviews).toHaveLength(0);
        clock.advance(200);
        const previews = events.filter((event) => event.type === 'delta' && event.ui !== undefined);
        expect(previews).toHaveLength(2);
        expect(run.session.thread.get(item.id)).not.toHaveProperty('ui');
        const authoritative = 'Before\n```ui\n<Summary>Corrected</Summary>\n```\nAfter';
        run.event({ type: 'text.done', ref: 'answer', text: authoritative, parentRef: null });
        const final = run.session.thread.get(item.id);
        expect(final?.kind === 'assistant' && final.ui?.[0].fallback).toContain('Corrected');
        expect(run.session.uiPreviews).toEqual([]);
        const finalEvents = events.filter((event) => event.type === 'item' && event.item.kind === 'assistant' && event.item.ui !== undefined);
        expect(finalEvents).toHaveLength(1);
        clock.advance(1000);
        expect(events.filter((event) => event.type === 'delta' && event.ui !== undefined)).toHaveLength(2);
        await run.session.dispose();
    });

    test('freeze cancels a pending compilation', async () => {
        const clock = new ManualClock();
        const events: ChatEvent[] = [];
        const run = rig({ clock, emit: (event) => events.push(event) });
        await run.session.send('Show results');
        await flush();
        run.event({ type: 'text.delta', ref: 'answer', text: '```ui\n<Summary>Start' });
        run.event({ type: 'text.delta', ref: 'answer', text: ' pending' });
        run.session.freeze();
        const count = events.length;
        clock.advance(1000);
        expect(events).toHaveLength(count);
        expect(run.session.uiPreviews).toEqual([]);
        await run.session.dispose();
    });
});

test('compiler diagnostics are retained for the next real prompt', async () => {
    const run = rig();
    await run.session.send('Show results');
    await flush();
    run.event({ type: 'text.done', ref: 'answer', text: '```ui\n<Summary tone="huge">Result</Summary>\n```', parentRef: null });
    expect(run.session.preambles.join(' ')).toContain('Your last ui block');
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    await run.session.send('Fix it');
    await flush();
    expect(run.sent.at(-1)?.preamble).toContain('Your last ui block');
    await run.session.dispose();
});

test('a fence and a host reference split across deltas are found by scanning only the tail', async () => {
    const observed: boolean[] = [];
    const events: ChatEvent[] = [];
    const run = rig({ emit: (event) => events.push(event), ui: { schemas: {}, observe: (_item, final) => observed.push(final) } });
    await run.session.send('Show results');
    await flush();
    run.event({ type: 'text.delta', ref: 'answer', text: `${'word '.repeat(40)}see <Fi` });
    run.event({ type: 'text.delta', ref: 'answer', text: 'le path="a.md"/> then\n``' });
    expect(observed).toEqual([]);
    run.event({ type: 'text.delta', ref: 'answer', text: '`ui\n<Summary>Start' });
    expect(observed).toEqual([false]);
    expect(events.some((event) => event.type === 'delta' && event.ui !== undefined)).toBe(true);
    await run.session.dispose();
});

test('an image generated while a UI reply streams is the latest one when the reply completes', async () => {
    const run = rig();
    await run.session.send('Draw it');
    await flush();
    run.event({ type: 'text.delta', ref: 'answer', text: '```ui\n<Summary>Drawing' });
    const attachment = { id: 'image', name: 'image.png', mime: 'image/png', size: 1, path: '/tmp/image.png' };
    run.event({ type: 'tool.started', ref: 'draw', name: 'ImageGeneration', input: { attachment }, parentRef: null });
    run.event({ type: 'tool.done', ref: 'draw', output: null, state: 'done' });
    run.event({ type: 'text.done', ref: 'answer', text: '```ui\n<Summary>Drawn</Summary>\n<Image generated="latest"/>\n```', parentRef: null });
    const answer = run.session.thread.list().find((item) => item.kind === 'assistant');
    expect(answer?.kind === 'assistant' ? answer.ui?.[0]?.nodes[1]?.props.attachment : undefined).toBe('image');
    await run.session.dispose();
});

test('a host fence language replaces the default one', async () => {
    const run = rig({ uiFenceLanguage: 'legacy-ui' });
    await run.session.send('Show results');
    await flush();
    run.event({ type: 'text.done', ref: 'answer', text: '```ui\n<Summary>Plain</Summary>\n```\n```legacy-ui\n<Summary>Named</Summary>\n```', parentRef: null });
    const answer = run.session.thread.list().find((item) => item.kind === 'assistant');
    expect(answer?.kind === 'assistant' ? answer.ui?.map((block) => block.fallback) : undefined).toEqual(['Named']);
    await run.session.dispose();
});

function choiceReply() {
    const text = `<Choices><Choice context="Run the selected checks">Check</Choice><Choice context="Inspect code">Inspect</Choice></Choices>`;
    const block = { ...compileUiBlock(text, { id: 'block', final: true }), revision: 'stored-revision' };
    const choices = evaluateUiBlock(block).nodes[0].children;
    const item: ChatItem = { id: 'answer', kind: 'assistant', createdAt: 5, turnId: null, streaming: false, text, ui: [block] };
    const payload = { chatId: 'child', itemId: 'answer', blockId: 'block', revision: block.revision, choiceId: choices[0].id };
    return { item, payload, other: choices[1].id };
}

describe('choices from saved UI blocks', () => {
    test('the stored context is sent once and its label remains separate metadata', async () => {
        const { item, payload, other } = choiceReply();
        const run = rig({ items: [item] });
        const result = run.session.choose(payload);
        expect(run.session.choose(payload)).toEqual(result);
        expect(() => run.session.choose({ ...payload, choiceId: other })).toThrow();
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['Run the selected checks']);
        expect(run.sent[0].preamble).toContain('The person chose "Check"');
        const user = run.session.thread.list().find((entry) => entry.kind === 'user');
        expect(user).toMatchObject({ text: 'Run the selected checks', uiChoice: { label: 'Check', itemId: 'answer', sourceAt: 5, older: false } });
        expect(run.session.thread.get('answer')).toMatchObject({ uiAnswers: { block: { choiceId: payload.choiceId, queued: false, turnId: result.turnId } } });
        await run.session.dispose();
    });

    test('a busy chat queues a choice and preserves its origin when that queue drains', async () => {
        const { item, payload } = choiceReply();
        const run = rig({ items: [item] });
        run.session.send('original');
        await flush();
        const result = run.session.choose(payload);
        expect(result.queued).toBe(true);
        expect(run.session.choose(payload)).toEqual(result);
        expect(run.session.info.queue).toHaveLength(1);
        expect(run.session.info.queue![0]).toMatchObject({ text: 'Run the selected checks', uiChoice: { label: 'Check' } });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'Run the selected checks']);
        expect(run.session.thread.list().find((entry) => entry.kind === 'user' && entry.uiChoice)).toMatchObject({
            turnId: result.turnId,
            uiChoice: { label: 'Check' }
        });
        expect(run.session.choose(payload)).toEqual({ queued: false, turnId: result.turnId });
        await run.session.dispose();
    });

    test('stale, streaming and subagent blocks cannot submit', async () => {
        const { item, payload } = choiceReply();
        for (const edited of [{ ...item, streaming: true }, { ...item, parentToolUseId: 'agent' }, item]) {
            const run = rig({ items: [edited] });
            expect(() => run.session.choose({ ...payload, revision: 'stale' })).toThrow();
            if (edited !== item) {
                expect(() => run.session.choose(payload)).toThrow();
            }
            expect(run.session.thread.list().some((entry) => entry.kind === 'user')).toBe(false);
            await run.session.dispose();
        }
    });

    test('replay deduplicates a sent choice even if its answer marker was not logged', async () => {
        const { item, payload } = choiceReply();
        const run = rig({ items: [item] });
        const result = run.session.choose(payload);
        const items = run.session.thread.list().map((entry) => (entry.kind === 'assistant' ? { ...entry, uiAnswers: undefined } : entry));
        const restored = rig({ items, info: { ...run.session.info, status: 'idle', activeTurnId: null, running: false } });
        expect(restored.session.choose(payload)).toEqual(result);
        await flush();
        expect(restored.sent).toHaveLength(0);
        expect(restored.session.thread.list().filter((entry) => entry.kind === 'user')).toHaveLength(1);
        await run.session.dispose();
        await restored.session.dispose();
    });
});

describe('the source of a quote', () => {
    const reply: ChatItem = { id: 'answer', kind: 'assistant', createdAt: 5, turnId: null, streaming: false, text: 'An earlier reply' };
    const quoted = '> An earlier\n\nWhy?';

    function userItems(run: ReturnType<typeof rig>) {
        return run.session.thread.list().filter((item) => item.kind === 'user');
    }

    test('is written on the user item', async () => {
        const run = rig({ items: [reply] });
        run.session.send(quoted, { quoteSource: { itemId: 'answer' } });
        await flush();
        expect(userItems(run)[0]).toMatchObject({ text: quoted, quoteSource: { itemId: 'answer' } });
        await run.session.dispose();
    });

    test('survives the queue', async () => {
        const run = rig({ items: [reply] });
        run.session.send('original');
        await flush();
        run.session.send(quoted, { quoteSource: { itemId: 'answer' } });
        expect(run.session.info.queue?.[0]?.quoteSource).toEqual({ itemId: 'answer' });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(userItems(run).find((item) => item.text === quoted)).toMatchObject({ quoteSource: { itemId: 'answer' } });
        await run.session.dispose();
    });

    test('is kept when the message steers a running turn', async () => {
        const run = rig({ items: [reply] });
        run.backend.steerTurn = async () => true;
        run.session.send('original');
        await flush();
        await run.session.sendInput(quoted, { delivery: 'steer', quoteSource: { itemId: 'answer' } });
        expect(userItems(run).find((item) => item.text === quoted)).toMatchObject({ quoteSource: { itemId: 'answer' } });
        await run.session.dispose();
    });

    test('is dropped for an item that is no reply, and the message still goes out', async () => {
        const run = rig({ items: [reply] });
        run.session.send(quoted, { quoteSource: { itemId: 'nowhere' } });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual([quoted]);
        expect(userItems(run)[0]).not.toHaveProperty('quoteSource');
        await run.session.dispose();
    });
});
