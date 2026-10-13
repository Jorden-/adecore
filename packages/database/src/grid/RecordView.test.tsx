import { describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { UIProvider } from '@adecore/ui';
import { setFormatSource } from '@adecore/ui/format';
import { fakeFormatSource } from '@adecore/ui/testing';
import { DatabaseProvider } from '../DatabaseProvider.tsx';
import type { DatabaseClient } from '../client/types.ts';
import { EnumPicker } from './EnumPicker.tsx';
import { RecordView } from './RecordView.tsx';
import type { GridColumn, GridRow } from './types.ts';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });

const render = (node: ReactNode): string =>
    renderToStaticMarkup(
        <UIProvider i18n={i18n}>
            <DatabaseProvider client={{} as DatabaseClient}>{node}</DatabaseProvider>
        </UIProvider>
    );

const columns: GridColumn[] = [
    { name: 'id', type: 'int', kind: 'integer', primaryKey: true },
    { name: 'name', type: 'varchar(255)', kind: 'text' },
    { name: 'status', type: "enum('draft','live')", kind: 'text', nullable: false },
    { name: 'note', type: 'text', kind: 'text' }
];

const rows: GridRow[] = [
    { key: 'row:0', number: 1, cells: [7, 'Ada', 'draft', null] },
    { key: 'row:1', number: 2, cells: [8, 'Grace', 'live', 'hello'], edited: new Set([1]) },
    { key: 'new:1', number: null, cells: [{ kind: 'default' }, 'New', 'draft', null], state: 'inserted' }
];

const view = (index: number, extra: Partial<Parameters<typeof RecordView>[0]> = {}) => (
    <RecordView
        label="Fields of users"
        columns={columns}
        rows={rows}
        index={index}
        onIndexChange={() => {}}
        focusedColumn={null}
        onClose={() => {}}
        {...extra}
    />
);

describe('RecordView', () => {
    test('lists every column with its type and a field for its value', () => {
        const markup = render(view(0));
        expect(markup).toContain('aria-label="Fields of users"');
        for (const name of ['id', 'name', 'status', 'note']) {
            expect(markup).toContain(`>${name}</span>`);
        }
        expect(markup).toContain('>varchar(255)</span>');
        expect(markup).toContain('value="Ada"');
        expect(markup).toContain('value="7"');
    });

    test('keeps identifiers exact in read-only fields while amounts use region notation', () => {
        const source = fakeFormatSource();
        source.set({ region: 'nl-NL' });
        const previous = setFormatSource(source);
        try {
            const markup = renderToStaticMarkup(
                <UIProvider i18n={i18n} formatSource={source}>
                    <DatabaseProvider client={{} as DatabaseClient} numberNotation="region">
                        {view(0, {
                            columns: [
                                { name: 'person_id', type: 'bigint', kind: 'integer' },
                                { name: 'amount', type: 'decimal(10,2)', kind: 'decimal' }
                            ],
                            rows: [{ key: 'row:0', number: 1, cells: ['9007199254740993', '12900.50'] }]
                        })}
                    </DatabaseProvider>
                </UIProvider>
            );
            expect(markup).toContain('value="9007199254740993"');
            expect(markup).toContain('value="12.900,50"');
        } finally {
            setFormatSource(previous);
        }
    });

    test('shows NULL and DEFAULT as placeholders of an empty field', () => {
        expect(render(view(0))).toContain('placeholder="NULL"');
        expect(render(view(2))).toContain('placeholder="DEFAULT"');
    });

    test('says which row it shows and how far along the page that is', () => {
        const markup = render(view(1));
        expect(markup).toContain('Row 2');
        expect(markup).toContain('2 of 3 on this page');
        expect(render(view(2))).toContain('New row');
    });

    test('closes the previous button on the first row and the next on the last', () => {
        expect(render(view(0))).toMatch(/aria-label="Previous row"[^>]* disabled=""/);
        expect(render(view(0))).not.toMatch(/aria-label="Next row"[^>]* disabled=""/);
        expect(render(view(2))).toMatch(/aria-label="Next row"[^>]* disabled=""/);
    });

    test('draws an enum column as a picker rather than an input', () => {
        const markup = render(view(0));
        expect(markup).toContain('aria-label="status"');
        expect(markup.match(/<input/g)).toHaveLength(3);
    });

    test('makes the fields read only unless the view is editable', () => {
        expect(render(view(0)).match(/readOnly=""/g)).toHaveLength(3);
        expect(render(view(0, { editable: true })).match(/readOnly=""/g)).toBeNull();
    });

    test('marks the field of the focused column', () => {
        const markup = render(view(1, { focusedColumn: 1 }));
        expect(markup.match(/data-focused=""/g)).toHaveLength(1);
        expect(render(view(1)).match(/data-focused=""/g)).toBeNull();
    });

    test('offers to open up a long text, JSON or binary value, and nothing else', () => {
        const wide: GridColumn[] = [
            { name: 'id', type: 'int', kind: 'integer' },
            { name: 'doc', type: 'json', kind: 'json' },
            { name: 'body', type: 'text', kind: 'text' },
            { name: 'photo', type: 'blob', kind: 'binary' }
        ];
        const markup = render(
            <RecordView
                label="Fields"
                columns={wide}
                rows={[{ key: 'row:0', number: 1, cells: [1, '{"a":1}', { kind: 'longText', preview: 'Once', length: 9000 }, null] }]}
                index={0}
                onIndexChange={() => {}}
                focusedColumn={null}
                onClose={() => {}}
            />
        );
        expect(markup.match(/aria-label="Show the whole value"/g)).toHaveLength(3);
    });

    test('has a close button', () => {
        expect(render(view(0))).toContain('aria-label="Close record view"');
    });

    test('tints the field of a pending edit', () => {
        expect(render(view(1)).match(/bg-accent\/10/g)).toHaveLength(1);
    });

    test('draws the arrow of a reference where it can be followed', () => {
        const markup = render(view(0, { onFollow: () => {}, canFollow: (cell) => cell.column === 1 }));
        expect(markup.match(/aria-label="Go to referenced row"/g)).toHaveLength(1);
    });

    test('says there are no rows', () => {
        expect(
            render(
                <RecordView
                    label="Fields"
                    columns={columns}
                    rows={[]}
                    index={-1}
                    onIndexChange={() => {}}
                    focusedColumn={null}
                    onClose={() => {}}
                    empty="No rows here."
                />
            )
        ).toContain('No rows here.');
    });
});

describe('EnumPicker', () => {
    test('shows the value, or a faint NULL', () => {
        const type = { kind: 'enum' as const, values: ['a', 'b'] };
        expect(render(<EnumPicker type={type} value="a" nullable label="Status" onDone={() => {}} />)).toContain('>a</span>');
        expect(render(<EnumPicker type={type} value={null} nullable label="Status" onDone={() => {}} />)).toContain('text-text-faint">NULL</span>');
    });
});
