import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatHostProvider } from '../../../host';
import { UiReply } from './UiReply';

test.skipIf(typeof document === 'undefined')('an event with a time nobody can read draws with the time as written and shows the person no note', async () => {
    const text =
        '```ui\n<Timeline><Event at="15:41:55" tone="success">Deployed</Event><Event at="soon" tone="info" detail="later">Rolled back</Event></Timeline>\n```';
    const blocks = compileUi(text, { id: 'timeline', final: true });
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host: {} },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'timeline', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        expect(element.textContent).not.toContain('Could not draw this part');
        const rows = [...element.querySelectorAll('li[aria-label]')];
        expect(rows).toHaveLength(2);
        expect(rows[1].getAttribute('aria-label')).toBe('soon, Rolled back, Info, later');
        expect(rows[1].querySelector('time')).toBeNull();
        expect(rows[1].textContent).toContain('soon');
        expect(rows[1].textContent).toContain('Rolled back');
        expect(rows[1].textContent).toContain('later');
        expect(rows[0].querySelector('time')?.textContent).toContain(':55');
        expect(element.querySelector('[aria-expanded]')).toBeNull();
        expect(element.textContent).not.toContain('unreadable_time');
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});

test.skipIf(typeof document === 'undefined')('a block with an error still shows the person its note', async () => {
    const text = '```ui\n<Timeline><Event at="15:41:55">Deployed</Event><Widget>Odd</Widget></Timeline>\n```';
    const blocks = compileUi(text, { id: 'error', final: true });
    expect(blocks[0].diagnostics.some((diagnostic) => diagnostic.severity !== 'warning')).toBe(true);
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host: {} },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'error', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        expect(element.querySelector('[aria-expanded]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});

test.skipIf(typeof document === 'undefined')('an event written with time instead of at draws as a timeline row and shows the person no note', async () => {
    const text = '```ui\n<Timeline><Event time="14:30" tone="info">Rolled back</Event><Event time="14:45">Recovered</Event></Timeline>\n```';
    const blocks = compileUi(text, { id: 'alias', final: true });
    expect(blocks[0].diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([
        ['renamed_prop', 'warning'],
        ['renamed_prop', 'warning']
    ]);
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host: {} },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'alias', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        expect(element.textContent).not.toContain('Could not draw this part');
        const rows = [...element.querySelectorAll('li[aria-label]')];
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('time')).not.toBeNull();
        expect(rows[0].textContent).toContain('Rolled back');
        expect(rows[1].textContent).toContain('Recovered');
        expect(element.querySelector('[aria-expanded]')).toBeNull();
        expect(element.textContent).not.toContain('renamed_prop');
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});
