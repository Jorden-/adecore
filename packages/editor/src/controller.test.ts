import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';

describe('the focus', () => {
    test('leaving the editor is a blur, and moving inside it is not', () => {
        const { editor, page, input } = mountEditor();
        let blurs = 0;
        editor.onBlur(() => blurs++);
        const focusOut = (relatedTarget: EventTarget | null): void => {
            const event = new page.window.Event('focusout', { bubbles: true });
            Object.assign(event, { relatedTarget });
            input.dispatchEvent(event);
        };
        focusOut(page.host.querySelector('.se-viewport'));
        expect(blurs).toBe(0);
        focusOut(page.document.body);
        focusOut(null);
        expect(blurs).toBe(2);
    });
});
