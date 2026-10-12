import { describe, expect, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { BIDI_CONTROLS, BIDI_COLUMNS } from './bidi.ts';
import { EditorLayout, scanLine, type LayoutMetrics } from './layout.ts';
import { mountEditor } from './testing.ts';
import { mount } from './view.fixture.test.ts';

const METRICS: LayoutMetrics = {
    lineHeight: 20,
    charWidth: 10,
    tabSize: 4,
    measureText: (text) => Array.from(text).length * 20,
    measureInlay: (text) => text.length * 6
};

const RAW = /[‪-‮⁦-⁩‎‏؜]/;
const TEXT = 'a‮b';

function lineOf(text: string) {
    return { start: 0, end: text.length, text };
}

describe('geometry', () => {
    test('gives every control character its own stop and three columns', () => {
        for (const character of Object.keys(BIDI_CONTROLS)) {
            const geometry = scanLine(lineOf(`a${character}b`), METRICS, null, []);
            expect(geometry.offsets).toEqual([0, 1, 2, 3]);
            expect(geometry.before).toEqual([0, 10, 10 + BIDI_COLUMNS * 10, 50]);
            expect(geometry.runs.map((run) => run.text)).toEqual(['a', 'b']);
        }
    });

    test('covers the control in a selection rectangle and puts the click between the characters', () => {
        const model = new DocumentModel(TEXT);
        const layout = new EditorLayout(model, METRICS);
        const rects = layout.rectangles(1, 2, layout.rows);
        expect(rects).toHaveLength(1);
        expect(rects[0]).toMatchObject({ x: 10, width: 30 });
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(layout.offsetAtX(geometry, 0, 38).offset).toBe(2);
        expect(layout.offsetAtX(geometry, 0, 12).offset).toBe(1);
    });
});

describe('rendering', () => {
    test('keeps the control out of the text nodes and draws a visual placeholder', () => {
        const { page, editor } = mountEditor({ text: TEXT });
        expect(editor.getText()).toBe(TEXT);
        const line = page.host.querySelector('.se-line')!;
        expect(RAW.test(line.textContent!)).toBe(false);
        const sign = line.querySelector('.se-bidi')!;
        expect(sign.textContent).toBe('RLO');
        expect(sign.hasAttribute('role')).toBe(false);
        expect(sign.hasAttribute('aria-label')).toBe(false);
        const box = sign as HTMLElement;
        expect(parseFloat(box.style.width)).toBeCloseTo(BIDI_COLUMNS * parseFloat(box.style.left), 5);
    });

    test('draws every control', () => {
        const everything = Object.keys(BIDI_CONTROLS).join('x');
        const { page } = mountEditor({ text: everything });
        const labels = [...page.host.querySelectorAll('.se-bidi')].map((sign) => sign.textContent);
        expect(labels).toEqual(Object.values(BIDI_CONTROLS).map((control) => control.label));
        expect(RAW.test(page.host.querySelector('.se-line')!.textContent!)).toBe(false);
        expect(Object.keys(BIDI_CONTROLS)).toHaveLength(12);
    });

    test('lays the lines out left to right over any bidirectional run', () => {
        const css = Bun.file(new URL('./editor.css', import.meta.url));
        return css.text().then((text) => {
            expect(text).toMatch(/\.se-line \{[^}]*direction: ltr;[^}]*unicode-bidi: bidi-override;/);
            expect(text).toMatch(/\.se-run \{[^}]*unicode-bidi: bidi-override;/);
        });
    });
});

describe('inlays and ghost text', () => {
    test('shows a control in an inlay or a suggestion as a bracketed label', () => {
        const { host, view } = mount('foo(bar)');
        view.setInlays([{ id: 'hint', at: 4, text: 'a‮b' }]);
        expect(host.querySelector('.se-inlay')!.textContent).toBe('a[RLO]b');
        expect(RAW.test(host.textContent!)).toBe(false);
        view.setGhost({ at: 8, text: 'x‏y\nz⁦', accessory: undefined });
        expect(host.querySelector('.se-ghost')!.textContent).toBe('x[RLM]y');
        expect(host.querySelector('.se-ghost-rows')!.textContent).toBe('z[LRI]');
        expect(RAW.test(host.textContent!)).toBe(false);
    });
});

describe('editing', () => {
    test('steps over the control as one character and copies it back', () => {
        const { editor, press, clip } = mountEditor({ text: TEXT });
        editor.setCaret({ line: 0, character: 1 });
        press('ArrowRight');
        expect(editor.getCaret()).toMatchObject({ line: 0, character: 2 });
        press('ArrowLeft');
        press('ArrowRight', { shiftKey: true });
        expect(editor.getSelection()).toMatchObject({ start: { character: 1 }, end: { character: 2 } });
        expect(clip('copy')).toBe('‮');
        expect(editor.getText()).toBe(TEXT);
    });
});
