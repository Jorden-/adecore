import { expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatHostProvider, useChatHost, type ChatHost } from './host';

function Probe({ onHost }: { onHost(host: ChatHost): void }) {
    onHost(useChatHost());
    return null;
}

function read(...hosts: Array<Partial<ChatHost>>): ChatHost {
    let seen: ChatHost | null = null;
    const probe = createElement(Probe, { onHost: (host) => (seen = host) });
    renderToStaticMarkup(hosts.reduceRight<ReactNode>((children, host) => createElement(ChatHostProvider, { host }, children), probe));
    return seen!;
}

test('outside a provider the host is the chat without the parts of an app', () => {
    const host = read();
    expect(host.actions).toBeNull();
    expect(host.fileLinks).toBeNull();
    expect(host.useStreaming()).toBe('words');
});

test('a provider inside another keeps what the outer one handed and replaces what it hands itself', () => {
    const notify = () => {};
    const outer = () => 'blocks' as const;
    const inner = () => 'whole' as const;
    const host = read({ notify, useStreaming: outer }, { useStreaming: inner });
    expect(host.notify).toBe(notify);
    expect(host.useStreaming).toBe(inner);
    expect(host.useSendDelivery()).toBe('queue');
});
