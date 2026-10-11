import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createSmartEditorEngine } from '@adecore/editor';
import { createPage, press } from '@adecore/editor/testing';
import { chatHost, setChatHost } from '../../../host';
import { PromptCard } from '../../../prompts/ui/PromptCard';
import { ApprovalReview } from './ApprovalReview';
import { reviewEntries } from './review-plan';

async function mounted(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>) {
    const page = createPage();
    const names = ['window', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const host = chatHost();
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: page.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        setChatHost(host);
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
}

const entries = reviewEntries(
    [],
    [
        { path: 'src/one.txt', before: 'old one', after: 'new one' },
        { path: 'src/one.txt', before: 'old two', after: 'new two' },
        { path: 'src/two.txt', before: 'old three', after: 'new three' }
    ]
);

test('a multiple-change approval mounts one editor and disposes it when switching files', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        setChatHost({ code: { ...chatHost().code, editor: async () => engine } });
        await act(async () => root.render(<ApprovalReview entries={entries} maxHeight={176} />));
        const buttons = [...page.host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
        expect(buttons.map((button) => button.textContent)).toEqual(['one.txt (1/2)', 'one.txt (2/2)', 'two.txt']);
        expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
        expect(engine.editors).toHaveLength(1);
        expect(engine.last.getText()).toBe('old one\nnew one');
        const first = engine.last;
        await act(async () => buttons[1]!.click());
        expect(first.disposed).toBe(true);
        expect(engine.editors).toHaveLength(2);
        expect(engine.last.getText()).toBe('old two\nnew two');
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(1);
        await act(async () => root.render(<ApprovalReview entries={[...entries]} maxHeight={480} />));
        expect(engine.editors).toHaveLength(2);
        expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    });
});

test('the approval file toolbar follows card navigation and the editor hands approval keys to the primary action once', async () => {
    await mounted(async (page, root) => {
        const engine = createSmartEditorEngine({ tokenizer: async () => null, apple: false });
        setChatHost({ isApplePlatform: () => false, code: { ...chatHost().code, editor: async () => engine } });
        let approvals = 0;
        await act(async () =>
            root.render(
                <PromptCard
                    kind="approval"
                    heading="Review"
                    busy={false}
                    notice={null}
                    error={null}
                    actions={
                        <button data-prompt-primary onClick={() => approvals++}>
                            Allow
                        </button>
                    }
                >
                    <ApprovalReview entries={entries} maxHeight={176} />
                </PromptCard>
            )
        );
        const buttons = [...page.host.querySelectorAll<HTMLButtonElement>('[aria-label="Changes to review"] button')];
        let focused = -1;
        buttons.forEach((button, index) => {
            button.focus = () => {
                focused = index;
            };
        });
        expect(press(page.window, buttons[0]!, 'ArrowRight')).toBe(true);
        expect(focused).toBe(1);
        press(page.window, buttons[1]!, 'End');
        expect(focused).toBe(2);
        press(page.window, buttons[2]!, 'Home');
        expect(focused).toBe(0);
        await act(async () => press(page.window, page.host.querySelector('textarea')!, 'Enter', { ctrlKey: true }));
        expect(approvals).toBe(1);
    });
});
