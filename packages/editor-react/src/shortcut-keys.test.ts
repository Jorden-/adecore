import { describe, expect, test } from 'bun:test';
import { KEYMAP } from '@adecore/editor/keymap';
import { isShortcut, shortcutsOf } from './shortcut-keys.ts';

function press(key: string, code: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
    const altGraph = (name: string): boolean => name === 'AltGraph';
    return { key, code, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, getModifierState: altGraph, ...extra } as KeyboardEvent;
}

describe('isShortcut with AltGraph reported', () => {
    const other = shortcutsOf(KEYMAP, false);
    const apple = shortcutsOf(KEYMAP, true);

    test('lets German AltGr+Q type an at sign', () => {
        expect(isShortcut(other.toggleRenderedDocs, press('@', 'KeyQ'))).toBe(false);
    });

    test('opens the call hierarchy with Ctrl+Alt+H', () => {
        expect(isShortcut(other.callHierarchy, press('h', 'KeyH'))).toBe(true);
    });

    test('goes back in the history with Ctrl+Alt+ArrowLeft', () => {
        expect(isShortcut(other.historyBack, press('ArrowLeft', 'ArrowLeft'))).toBe(true);
    });

    test('toggles rendered documentation with Ctrl+Option+Q on macOS', () => {
        expect(isShortcut(apple.toggleRenderedDocs, press('œ', 'KeyQ'))).toBe(true);
    });
});
