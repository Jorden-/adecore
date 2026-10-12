import { expect, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { EditorLayout, type TextRow } from './layout.ts';
import { RowPainter, type RowPaint } from './paint.ts';
import { createPage } from './testing.ts';

test('keeps a folded tail at the end of a long wrapped header, outside earlier paint bands', () => {
    const { host } = createPage();
    const text = 'word '.repeat(2000);
    const model = new DocumentModel(text + '\n}');
    const layout = new EditorLayout(model, {
        lineHeight: 20,
        charWidth: 10,
        tabSize: 4,
        measureText: (value) => value.length * 10,
        measureInlay: (value) => value.length * 10
    });
    layout.configure({ wrapWidth: 100, folds: [{ startLine: 0, endLine: 1, collapsed: true, closer: text.length + 1 }] });
    layout.syncRows(layout.rows);
    const painter = new RowPainter(host, layout, undefined);
    const paint: RowPaint = {
        layoutVersion: 0,
        whitespace: false,
        tokensOf: () => null,
        viewportWidth: 100,
        hostLeft: 0,
        hostWidth: 100,
        onUnfold: () => {},
        window: { top: 0, bottom: 200 }
    };
    painter.paint(layout.rows, paint);
    expect(host.querySelector('.se-fold-chip')).toBeNull();
    expect(host.textContent).not.toContain('}');
    const row = layout.rows[0] as TextRow;
    paint.window = { top: row.height - 200, bottom: row.height };
    painter.paint(layout.rows, paint);
    expect(host.querySelector('.se-fold-chip')).not.toBeNull();
    expect(host.textContent).toEndWith('}');
    painter.clear();
});
