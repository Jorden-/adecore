import { expect, test } from 'bun:test';
import { PANEL_BODY_HEIGHT, PANEL_BODY_MIN, clampPanelBody, panelBodyMax } from './panel-size.ts';

test('clamps a body between four rows and four fifths of the editor', () => {
    expect(clampPanelBody(10, 1000)).toBe(PANEL_BODY_MIN);
    expect(clampPanelBody(5000, 1000)).toBe(panelBodyMax(1000));
    expect(panelBodyMax(1000)).toBe(737);
    expect(clampPanelBody(300.4, 1000)).toBe(300);
});

test('a small editor still gets the minimum and a bad number the default', () => {
    expect(panelBodyMax(100)).toBe(PANEL_BODY_MIN);
    expect(clampPanelBody(Number.NaN, 1000)).toBe(PANEL_BODY_HEIGHT);
});
