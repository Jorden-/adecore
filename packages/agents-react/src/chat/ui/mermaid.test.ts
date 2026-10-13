import { describe, expect, test } from 'bun:test';
import { mermaidConfig, sizedSvg, svgDataUrl, type MermaidColors } from './mermaid';

const COLORS: MermaidColors = {
    ground: '#ececef',
    node: '#ffffff',
    nodeBorder: '#bdbdbf',
    text: '#18181b',
    line: '#6f6f78',
    cluster: '#ffffff',
    clusterBorder: '#d2d2d5',
    note: '#d9e4fd'
};

describe('mermaidConfig', () => {
    const config = mermaidConfig(COLORS, false, { family: 'system-ui', size: '14px' });

    test('draws strictly, without HTML in a label', () => {
        expect(config.securityLevel).toBe('strict');
        expect(config.htmlLabels).toBe(false);
        expect(config.startOnLoad).toBe(false);
    });

    test('a directive in the diagram cannot loosen it or leave the theme', () => {
        expect(config.secure).toEqual(expect.arrayContaining(['securityLevel', 'htmlLabels', 'theme', 'themeVariables', 'themeCSS']));
    });

    test('follows the theme it is handed', () => {
        expect(config.theme).toBe('base');
        expect(config.themeVariables).toMatchObject({ primaryColor: '#ffffff', textColor: '#18181b', lineColor: '#6f6f78', darkMode: false });
        expect(mermaidConfig(COLORS, true, { family: 'system-ui', size: '14px' }).darkMode).toBe(true);
    });
});

describe('sizedSvg', () => {
    test('the root takes the size of its view box', () => {
        const svg =
            '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 210.5px;" viewBox="-8 -8 210.5 120"><g stroke-width="2"></g></svg>';
        const sized = sizedSvg(svg)!;
        expect(sized.width).toBe(211);
        expect(sized.height).toBe(120);
        expect(sized.svg).toBe(
            '<svg width="211" height="120" id="m1" xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 210.5 120"><g stroke-width="2"></g></svg>'
        );
    });

    test('a drawing without a view box has no size to take', () => {
        expect(sizedSvg('<svg width="10"></svg>')).toBeNull();
        expect(sizedSvg('<svg viewBox="0 0 0 10"></svg>')).toBeNull();
        expect(sizedSvg('no svg')).toBeNull();
    });
});

test('svgDataUrl encodes the drawing whole', () => {
    expect(svgDataUrl('<svg>#</svg>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%3E%23%3C%2Fsvg%3E');
});
