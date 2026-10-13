import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { UIProvider } from '../UIProvider.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });

describe.skipIf(typeof document === 'undefined')('a confirm dialog', () => {
    let root: Root;
    let container: HTMLDivElement;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    test('puts its className and ref on the popup', async () => {
        const ref = createRef<HTMLDivElement>();
        await act(async () => {
            root.render(
                <UIProvider i18n={i18n}>
                    <ConfirmDialog
                        open
                        onOpenChange={() => {}}
                        title="Remove the machine"
                        description="Its sessions stop."
                        confirmLabel="Remove"
                        onConfirm={async () => {}}
                        className="confirm-under-test"
                        ref={ref}
                    />
                </UIProvider>
            );
        });
        expect(ref.current).not.toBeNull();
        expect(ref.current!.classList.contains('confirm-under-test')).toBe(true);
        expect(ref.current!.textContent).toContain('Remove the machine');
    });
});
