import { describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { surfacePartOf } from './surface';

const { document } = parseHTML(`<html><body>
    <div id="surface">
        <p id="notice">Too long</p>
        <div class="cm-editor"><div contenteditable="true"><div id="line">Hello</div></div></div>
        <button><span id="in-button">Send</span></button>
        <div role="menuitem" id="item">Model</div>
        <span id="focusable" tabindex="0">Chip</span>
        <span id="skipped" tabindex="-1">Row</span>
        <span id="read-only" contenteditable="false">Text</span>
        <div data-composer-action><span id="marked">Playhead</span></div>
    </div>
    <div id="popup"><span id="portaled">Option</span></div>
</body></html>`);

const surface = document.getElementById('surface')!;
const partOf = (id: string) => surfacePartOf(document.getElementById(id), surface);

describe('surfacePartOf', () => {
    test('text and space that do nothing of their own stand in for the field', () => {
        expect(partOf('notice')).toBe('surface');
        expect(surfacePartOf(surface, surface)).toBe('surface');
        expect(partOf('skipped')).toBe('surface');
        expect(partOf('read-only')).toBe('surface');
    });

    test('the editor is the field itself', () => {
        expect(partOf('line')).toBe('input');
    });

    test('anything with an action of its own is an action, also inside it', () => {
        expect(partOf('in-button')).toBe('action');
        expect(partOf('item')).toBe('action');
        expect(partOf('focusable')).toBe('action');
        expect(partOf('marked')).toBe('action');
    });

    test('a target outside the surface, such as a portaled popup, is left alone', () => {
        expect(partOf('portaled')).toBe('action');
        expect(surfacePartOf(null, surface)).toBe('action');
    });
});
