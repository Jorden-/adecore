import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentHost, memoryPortPair } from '@adecore/agents/host';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import { ChatClient } from '@adecore/agents-react/chat';
import { AGENTS_LOCALES } from '@adecore/agents-react/locales';
import { portTransport, ChatScopeContext, useChatScope, configureChatStorage } from '@adecore/agents-react';
import { chatSink, useChats } from '@adecore/agents-react/state';

const dataDir = await mkdtemp(join(tmpdir(), 'adecore-agent-port-'));
const fake = inProcess(fakeClaude);
configureChatStorage({ namespace: 'agent-port-example', storage: null });
const host = await AgentHost.open({
    dataDir,
    background: false,
    env: { HOME: dataDir, PATH: '' },
    spawn: fake.spawn,
    command: ['fixture-cli'],
    detect: async () => ({ installed: true, version: 'fixture' })
});
const [clientPort, hostPort] = memoryPortPair();
const disconnect = host.connect(hostPort);
const transport = portTransport(clientPort);
const keyOf = (chatId) => `local:${chatId}`;
const chats = new ChatClient(transport, chatSink(keyOf));
const scope = { id: 'local', keyOf, owns: (key) => key.startsWith('local:'), transport, chats };

function ScopeLabel() {
    return createElement('span', null, useChatScope().id);
}

try {
    const locales = await AGENTS_LOCALES.en();
    assert.ok(locales['agent-chat']);
    assert.equal(renderToStaticMarkup(createElement(ChatScopeContext.Provider, { value: scope }, createElement(ScopeLabel))), '<span>local</span>');
    const completed = new Promise((resolve) => {
        const stop = transport.on('chat.event', ({ event }) => {
            if (event.type === 'item' && event.item.kind === 'turn' && event.item.state === 'done') {
                stop();
                resolve();
            }
        });
    });
    assert.equal(await chats.open('example', { provider: 'claude', cwd: dataDir }), true);
    await chats.send('example', 'hello');
    await completed;
    const reply = Object.values(useChats.getState().byKey[keyOf('example')].items).find((item) => item.kind === 'assistant');
    assert.equal(reply.text, 'echo: hello');
    await assert.rejects(transport.request('chat.send', { chatId: 'missing', text: 'hello' }), { code: 'chat-not-found' });
    await chats.detach('example');
    console.log('AgentHost, ChatTransport, ChatClient and ChatScope fixture passed');
} finally {
    chats.dispose();
    transport.close();
    disconnect();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
}
