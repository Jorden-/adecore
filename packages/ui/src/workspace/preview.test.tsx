import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DropPreview } from './DropPreview.tsx';
import { dropPreviewPath, rectDropPreview, sameDropPreview, tabDropPreview } from './preview.ts';

describe('the drop preview', () => {
    test('draws a rectangle as a tab with no height, inside its top left corner', () => {
        expect(rectDropPreview({ x: 10, y: 20, width: 200, height: 100 })).toEqual({
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            barHeight: 0,
            tabLeft: 14,
            tabWidth: 0,
            tabTop: 20,
            radius: 6
        });
    });

    test('stands a tab in the bar of the cell it lands in', () => {
        const shape = tabDropPreview({ gap: 1, left: 50, tabWidth: 96, width: 500, height: 400, barHeight: 36 }, { x: 240, y: 12 });
        expect(shape).toMatchObject({ x: 240, y: 12, barHeight: 36, tabLeft: 290, tabWidth: 96, tabTop: 16 });
    });

    test('keeps the commands of its path the same for any shape, so one outline can move into another', () => {
        const commands = (path: string): string => path.replace(/[\d.,-]+/g, '');
        const rect = dropPreviewPath(rectDropPreview({ x: 0, y: 0, width: 300, height: 200 }));
        const tab = dropPreviewPath(tabDropPreview({ gap: 0, left: 0, tabWidth: 96, width: 300, height: 200, barHeight: 36 }, { x: 0, y: 0 }));
        expect(commands(rect)).toBe(commands(tab));
        expect(rect).toStartWith('M');
        expect(rect).toEndWith('Z');
    });

    test('tells two equal shapes apart from two that differ', () => {
        const shape = rectDropPreview({ x: 1, y: 2, width: 3, height: 4 });
        expect(sameDropPreview(shape, { ...shape })).toBe(true);
        expect(sameDropPreview(shape, { ...shape, width: 5 })).toBe(false);
        expect(sameDropPreview(shape, null)).toBe(false);
        expect(sameDropPreview(null, null)).toBe(true);
    });

    test('draws nothing without a shape and the outline of the path with one', () => {
        expect(renderToStaticMarkup(<DropPreview shape={null} />)).toBe('');
        const shape = rectDropPreview({ x: 0, y: 0, width: 300, height: 200 });
        const markup = renderToStaticMarkup(<DropPreview shape={shape} className="opacity-50" />);
        expect(markup).toContain('class="ade-drop-preview opacity-50"');
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain(`path(&quot;${dropPreviewPath(shape)}&quot;)`);
    });
});
