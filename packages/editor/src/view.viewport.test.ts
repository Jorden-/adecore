import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mount, rendered } from './view.fixture.test.ts';

describe('scrolling', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');

    test('draws the rows and the pinned headers in the scroll event itself', () => {
        const { host, view } = mount(`function outer() {\n${text}\n}`);
        view.refreshFolds();
        view.viewport.scrollTop = 20 * 100;
        view.scrolled();
        expect(rendered(host)).toContain('105');
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(1);
    });

    test('keeps a viewport of rows drawn on each side', () => {
        const { host, view } = mount(text);
        view.viewport.scrollTop = 20 * 200;
        view.scrolled();
        const lines = rendered(host).map(Number);
        expect(lines[0]!).toBeLessThanOrEqual(200 - 20);
        expect(lines.at(-1)!).toBeGreaterThanOrEqual(200 + 30);
    });

    test('keeps the pinned headers in the scroll container, where the browser holds them still', () => {
        const { view } = mount(text);
        expect(view.viewport.contains(view.stickyElement)).toBe(true);
    });
});

describe('the primary caret', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');

    test('is the one the view scrolls to', () => {
        const { model, view } = mount(text);
        const far = model.getLine(300).start;
        model.setSelections([
            { anchor: 0, head: 0 },
            { anchor: far, head: far }
        ]);
        view.revealCaret();
        expect(view.viewport.scrollTop).toBeGreaterThan(20 * 300 - 400);
    });
});

describe('sticky scroll', () => {
    const body = Array.from({ length: 40 }, (_, i) => `    call(${i});`).join('\n');
    const text = `export function outer() {\n  function inner() {\n${body}\n  }\n}\nconst after = 1;`;

    test('pins the headers of the blocks scrolled out of sight', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        expect(host.querySelector('.se-sticky')!.hasAttribute('hidden')).toBe(true);
        viewport.scrollTop = 20 * 20;
        view.render();
        const rows = [...host.querySelectorAll('.se-sticky-row')];
        expect(rows.map((row) => (row as HTMLElement).dataset.line)).toEqual(['0', '1']);
        expect(rows[0]!.querySelector('.se-sticky-number')!.textContent).toBe('1');
        expect(rows[1]!.querySelector('.se-run')!.textContent).toBe('  function inner() {');
    });

    test('draws no headers and covers no rows while sticky scroll is off', () => {
        const { host, view, settings } = mount(text, { stickyScroll: false });
        view.refreshFolds();
        view.viewport.scrollTop = 20 * 20;
        view.render();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
        expect(host.querySelector('.se-sticky')!.hasAttribute('hidden')).toBe(true);
        settings.stickyScroll = true;
        view.applySettings();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(2);
        settings.stickyScroll = false;
        view.applySettings();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
    });

    test('uses source labels and refreshes them while a header is pinned', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        view.viewport.scrollTop = 20 * 20;
        view.setLineNumbers((line) => (line === 0 ? '1000' : null));
        expect([...host.querySelectorAll('.se-sticky-number')].map((number) => number.textContent)).toEqual(['1000', '']);
        view.setLineNumbers(() => '2000');
        expect([...host.querySelectorAll('.se-sticky-number')].map((number) => number.textContent)).toEqual(['2000', '2000']);
        view.setLineNumbers(null);
        expect([...host.querySelectorAll('.se-sticky-number')].map((number) => number.textContent)).toEqual(['1', '2']);
        view.dispose();
    });

    test('goes away again at the top and past the end of the block', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        viewport.scrollTop = 0;
        view.render();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
        viewport.scrollTop = 20 * 45;
        view.render();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
    });

    test('pushes the last header up as its block ends', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        const lineHeight = view.layout.metrics.lineHeight;
        // `inner` ends on line 42; with one header above it, it is pinned at the second row.
        view.viewport.scrollTop = lineHeight * 41 + 10;
        view.render();
        const inner = host.querySelectorAll('.se-sticky-row')[1] as HTMLElement;
        expect(inner.style.transform).toBe('translateY(-10px)');
        expect((host.querySelector('.se-sticky') as HTMLElement).style.height).toBe(`${lineHeight * 2 - 10}px`);
    });

    test('takes the blocks the host hands it over its own reading', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        view.setBlocks([{ startLine: 2, endLine: 30, name: 'host' }]);
        viewport.scrollTop = 20 * 20;
        view.render();
        expect([...host.querySelectorAll('.se-sticky-row')].map((row) => (row as HTMLElement).dataset.line)).toEqual(['1']);
    });

    test('jumps to a header and puts the caret on it', () => {
        const { model, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        view.jumpToHeader(1, 1);
        expect(model.positionAt(model.getSelections()[0]!.head)).toMatchObject({ line: 1, column: 2 });
        expect(viewport.scrollTop).toBe(0);
    });

    test('keeps a caret moved up from under the pinned headers', () => {
        const { view, model } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        const target = model.getLine(21).start;
        view.revealOffset(target);
        expect(viewport.scrollTop).toBeLessThanOrEqual(20 * (21 - 2));
    });
});

describe('the gutter', () => {
    test('scrolls with the text, in the one container, instead of following it from a script', () => {
        const { host, view } = mount('a\nb');
        expect(host.querySelector('.se-viewport .se-scroller > .se-gutter')).not.toBeNull();
        expect(view.gutterElement.parentElement).toBe(host.querySelector('.se-scroller'));
        expect((view.gutterElement.firstElementChild as HTMLElement).style.transform).toBe('');
    });

    test('moves the text right by its own width', () => {
        const { view } = mount('abc');
        view.render();
        expect(view.offsetAtPoint(64, 5)).toBe(0);
        expect(view.offsetAtPoint(64 + 8 * 3, 5)).toBe(3);
    });
});

describe('the scroll width', () => {
    const CHAR = 7.8;
    const ROOM = 3 * CHAR;
    const widest = 'x'.repeat(200);
    const contentWidth = (host: HTMLElement): number => Number.parseFloat((host.querySelector('.se-content') as HTMLElement).style.width);
    const rule = (selector: string): string => {
        const css = readFileSync(new URL('./editor.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        return css.split('}').find((block) => block.split('{')[0]!.trim() === selector) ?? '';
    };

    test('is the widest line and three columns of room, and nothing more', () => {
        const { host, view } = mount(`short\n${widest}\nmiddling line`);
        view.render();
        expect(contentWidth(host)).toBeCloseTo(200 * CHAR + ROOM, 3);
    });

    test('shrinks when the widest line gets shorter, and again when it is deleted', () => {
        const { host, model, view } = mount(`short\n${widest}\n${'y'.repeat(150)}`);
        view.render();
        model.applyEdits([{ from: 6 + 100, to: 6 + 200, text: '' }]);
        expect(contentWidth(host)).toBeCloseTo(150 * CHAR + ROOM, 3);
        model.applyEdits([{ from: 6 + 100, to: 6 + 100 + 1 + 150, text: '' }]);
        expect(contentWidth(host)).toBeCloseTo(100 * CHAR + ROOM, 3);
    });

    test('is the width of the editor when every line is narrower', () => {
        const { host, model, view } = mount(widest);
        view.render();
        model.applyEdits([{ from: 0, to: 200, text: 'short' }]);
        expect(contentWidth(host)).toBe(800 - 64);
    });

    test('counts an inlay for what it draws', () => {
        const { host, view } = mount(widest);
        view.setInlays([{ id: 'hint', at: 200, text: ': void' }]);
        const geometry = view.layout.geometry(view.layout.rows[0] as never);
        expect(geometry.inlays[0]!.width).toBeGreaterThan(0);
        expect(contentWidth(host)).toBe(geometry.width + ROOM);
    });

    test('is not widened by a widget, a code vision row or a ghost row', () => {
        const { host, view } = mount(`${widest}\nfunction a() {}`);
        view.render();
        const before = contentWidth(host);
        view.setBlockWidgets('test', [{ id: 'w', at: 0, placement: 'below', height: 80, render: (container) => (container.textContent = 'x'.repeat(500)) }]);
        view.setLenses([{ id: 'lens', at: 201, placement: 'above', lens: true, render: (container) => (container.textContent = '3 usages') }]);
        expect(contentWidth(host)).toBe(before);
    });

    test('keeps a row of the host inside the content however far the view is scrolled', () => {
        const { host, view } = mount(`${widest}\nb`);
        view.setBlockWidgets('test', [{ id: 'w', at: 0, placement: 'below', height: 30, render: (container) => (container.textContent = 'peek') }]);
        const block = host.querySelector('.se-block') as HTMLElement;
        const width = contentWidth(host);
        for (const left of [0, 300, width - 736]) {
            view.viewport.scrollLeft = left;
            view.scrolled();
            expect(Number.parseFloat(block.style.left) + Number.parseFloat(block.style.width)).toBeLessThanOrEqual(left + 736 + 1e-6);
            expect(Number.parseFloat(block.style.left) + Number.parseFloat(block.style.width)).toBeLessThanOrEqual(width);
        }
    });

    test('clips what a host row draws past its own width, so it cannot push the scroll extent along with the view', () => {
        expect(rule('.se-block.se-widget')).toMatch(/overflow-x:\s*clip/);
    });

    test('is not stretched by a right margin the text and the view never reach', () => {
        const { host, view } = mount(`${'x'.repeat(100)}\nshort`, { rightMargin: 999 });
        view.render();
        expect(host.querySelector('.se-margin')).toBeNull();
        expect(contentWidth(host)).toBeCloseTo(100 * CHAR + ROOM, 3);
    });

    test('shows the right margin once a line or the view reaches it', () => {
        const wide = mount(`${'x'.repeat(150)}\nshort`, { rightMargin: 120 });
        wide.view.render();
        expect((wide.host.querySelector('.se-margin') as HTMLElement).style.left).toBe(`${120 * CHAR}px`);
        const short = mount('short', { rightMargin: 80 });
        short.view.render();
        expect(short.host.querySelector('.se-margin')).not.toBeNull();
    });

    test('keeps the gutter stuck to the left edge of the scroller', () => {
        const css = rule('.se-gutter');
        expect(css).toMatch(/position:\s*sticky/);
        expect(css).toMatch(/left:\s*0/);
        expect(rule('.se-scroller')).not.toMatch(/overflow/);
    });
});
