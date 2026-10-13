import { afterEach, describe, expect, test } from 'bun:test';
import { copyText } from './clipboard.ts';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const useClipboard = (clipboard: Partial<Clipboard> | undefined): void => {
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
};

afterEach(() => {
    if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
    } else {
        Reflect.deleteProperty(navigator, 'clipboard');
    }
});

describe('copying text', () => {
    test('resolves true once the clipboard holds the text', async () => {
        const written: string[] = [];
        useClipboard({
            writeText: async (text: string) => {
                written.push(text);
            }
        });
        expect(await copyText('git status')).toBe(true);
        expect(written).toEqual(['git status']);
    });

    test('resolves false, without throwing, when the browser refuses', async () => {
        useClipboard({ writeText: () => Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')) });
        expect(await copyText('git status')).toBe(false);
    });

    test('resolves false where there is no clipboard', async () => {
        useClipboard(undefined);
        expect(await copyText('git status')).toBe(false);
    });
});
