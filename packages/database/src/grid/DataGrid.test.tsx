import { afterAll, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { UIProvider } from '@adecore/ui';
import { setFormatSource, type FormatSource } from '@adecore/ui/format';
import { fakeFormatSource } from '@adecore/ui/testing';
import { DatabaseProvider } from '../DatabaseProvider.tsx';
import type { NumberNotation } from './display.ts';
import type { DatabaseClient } from '../client/types.ts';
import { DataGrid } from './DataGrid.tsx';
import type { GridColumn, GridRow } from './types.ts';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });

const client = { session: () => ({}) } as unknown as DatabaseClient;

const render = (node: ReactNode): string =>
    renderToStaticMarkup(
        <UIProvider i18n={i18n}>
            <DatabaseProvider client={client}>{node}</DatabaseProvider>
        </UIProvider>
    );

const columns: GridColumn[] = [
    { name: 'id', type: 'INTEGER', kind: 'integer', primaryKey: true },
    { name: 'name', type: 'TEXT', kind: 'text' },
    { name: 'avatar', type: 'BLOB', kind: 'binary' }
];

const rows: GridRow[] = [
    { key: 'row:0', number: 1, cells: [7, 'Ada', null] },
    {
        key: 'row:1',
        number: 2,
        cells: [8, { kind: 'longText', preview: 'Grace', length: 900 }, { kind: 'binary', hex: 'abcdef0123456789aa', length: 4096 }],
        edited: new Set([1])
    },
    { key: 'new:1', number: null, cells: [{ kind: 'default' }, 'New', null], state: 'inserted' },
    { key: 'row:2', number: 3, cells: [9, 'Linus', null], state: 'deleted' }
];

describe('DataGrid', () => {
    test('draws rows of plain text without a DatabaseProvider, in the words of the package', async () => {
        const own = i18next.createInstance();
        await own.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
        const markup = renderToStaticMarkup(
            <UIProvider i18n={own}>
                <DataGrid
                    label="cities.csv"
                    columns={[
                        { name: 'city', type: '', kind: 'text' },
                        { name: 'country', type: '', kind: 'text' }
                    ]}
                    rows={[
                        { key: '0', number: 1, cells: ['Utrecht', 'NL'] },
                        { key: '1', number: 2, cells: ['Antwerp', ''] }
                    ]}
                />
            </UIProvider>
        );
        expect(markup).toContain('aria-label="cities.csv"');
        expect(markup.match(/aria-label="Column menu"/g)).toHaveLength(2);
        expect(markup).toContain('Utrecht');
        expect(markup).toContain('Antwerp');
        expect(markup).not.toContain('NULL');
    });

    test('is a grid with its counts, header row and a row per row', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).toContain('role="grid"');
        expect(markup).toContain('aria-label="Users"');
        expect(markup).toContain('aria-rowcount="5"');
        expect(markup).toContain('aria-colcount="4"');
        expect(markup.match(/role="columnheader"/g)).toHaveLength(3);
        expect(markup.match(/role="gridcell"/g)).toHaveLength(12);
    });

    test('draws a yellow key on a primary key column', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup.match(/lucide-key-round /g)).toHaveLength(1);
        expect(markup).toMatch(/lucide-key-round [^"]*text-\(--file-icon-yellow\)/);
    });

    test('draws the header and the gutter on the surface of the cells, with a soft line between columns', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).not.toContain('bg-surface-raised');
        expect(markup).toMatch(/aria-rowindex="1" class="sticky top-0 z-20 flex w-full border-b border-border bg-surface"/);
        expect(markup).toMatch(/role="columnheader"[^>]*class="[^"]*border-r border-border-soft/);
    });

    test('sets the header of a number against the end, like its cells', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        const triggers = [...markup.matchAll(/role="columnheader"[\s\S]*?<\/div>/g)].map((match) => match[0]);
        expect(triggers[0]).toContain('justify-end');
        expect(triggers[1]).not.toContain('justify-end');
    });

    test('draws no column as picked before a header is clicked', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup.match(/role="columnheader"[^>]*aria-selected="false"/g)).toHaveLength(3);
        expect(markup).not.toContain('bg-accent text-accent-text');
    });

    test('draws NULL faint, numbers at the end and the gutter of an inserted row as a plus', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).toContain('text-text-faint">NULL<');
        expect(markup).toContain('justify-end tabular-nums');
        expect(markup).toContain('>+</div>');
    });

    test('shows a binary value as hex with its size and a long text as a preview', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).toContain('0xabcdef0123456789');
        expect(markup).toContain('4 KB');
        expect(markup).toContain('Grace…');
    });

    test('tints edited cells, inserted rows and rows marked for deletion', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).toContain('bg-accent/10');
        expect(markup).toContain('bg-positive/10');
        expect(markup).toContain('line-through');
    });

    test('draws only a window of a long table', () => {
        const many: GridRow[] = Array.from({ length: 10_000 }, (_, index) => ({ key: `row:${index}`, number: index + 1, cells: [index, 'x', null] }));
        const markup = render(<DataGrid label="Users" columns={columns} rows={many} />);
        const drawn = markup.match(/role="row"/g)!.length;
        // The rows in view, a viewport more below them, and the header row.
        expect(drawn).toBeGreaterThan(40);
        expect(drawn).toBeLessThan(100);
        expect(markup).toContain('aria-rowcount="10001"');
        expect(markup).toContain('height:280000px');
    });

    test('runs the header to the right edge and leaves no edge after the last column', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        expect(markup).toMatch(/aria-rowindex="1" class="sticky top-0 z-20 flex w-full[^"]*"/);
        expect(markup.match(/role="columnheader"[^>]*class="[^"]*border-r-0/g)).toHaveLength(1);
    });

    test('names the sort of a header and numbers the arrows when there are several', () => {
        const single = render(
            <DataGrid label="Users" columns={columns} rows={rows} sorts={[{ column: 'name', direction: 'desc' }]} onSortsChange={() => {}} />
        );
        expect(single).toContain('aria-sort="descending"');
        expect(single.match(/aria-sort="none"/g)).toHaveLength(2);
        expect(single).toContain('lucide-arrow-down');
        const several = render(
            <DataGrid
                label="Users"
                columns={columns}
                rows={rows}
                sorts={[
                    { column: 'name', direction: 'asc' },
                    { column: 'id', direction: 'desc' }
                ]}
                onSortsChange={() => {}}
            />
        );
        expect(several).toContain('aria-sort="ascending"');
        expect(several).toContain('tabular-nums">2<');
    });

    test('offers no sorting without onSortsChange', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} sorts={[{ column: 'name', direction: 'asc' }]} />);
        expect(markup).not.toContain('aria-sort');
    });

    test('has a menu button on every header', () => {
        expect(render(<DataGrid label="Users" columns={columns} rows={rows} />).match(/aria-label="Column menu"/g)).toHaveLength(3);
    });

    test('marks no cell as selected before one has the focus', () => {
        expect(render(<DataGrid label="Users" columns={columns} rows={rows} />).match(/role="gridcell"[^>]*aria-selected="false"/g)).toHaveLength(12);
    });

    test('pins no column until a person does', () => {
        expect(render(<DataGrid label="Users" columns={columns} rows={rows} />)).not.toMatch(/role="gridcell"[^>]*class="[^"]*bg-clip-border/);
    });

    test('says why there are no rows under the header', () => {
        expect(render(<DataGrid label="Users" columns={columns} rows={[]} empty="Nothing here." />)).toContain('Nothing here.');
    });

    test('sizes columns in whole pixels between 64 and 320', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} />);
        const widths = [...markup.matchAll(/role="columnheader"[^>]*style="width:(\d+)px"/g)].map((match) => Number(match[1]));
        expect(widths).toHaveLength(3);
        for (const width of widths) {
            expect(width).toBeGreaterThanOrEqual(64);
            expect(width).toBeLessThanOrEqual(320);
        }
    });

    test('draws nothing over the value of a cell that can be followed', () => {
        const markup = render(<DataGrid label="Users" columns={columns} rows={rows} onFollow={() => {}} canFollow={() => true} />);
        expect(markup).not.toContain('Go to referenced row');
    });
});

describe('DataGrid numbers in a Dutch region', () => {
    const source = fakeFormatSource();
    source.set({ region: 'nl-NL' });
    const previous: FormatSource = setFormatSource(source);

    afterAll(() => {
        setFormatSource(previous);
    });

    const numbers: GridColumn[] = [
        { name: 'id', type: 'BIGINT', kind: 'integer' },
        { name: 'price', type: 'DECIMAL(10,2)', kind: 'decimal' },
        { name: 'ratio', type: 'DOUBLE', kind: 'float' },
        { name: 'name', type: 'TEXT', kind: 'text' }
    ];
    const values: GridRow[] = [{ key: 'row:0', number: 1234, cells: ['9007199254740993', '12900.50', -0.25, '1234'] }];

    const renderIn = (numberNotation: NumberNotation): string =>
        renderToStaticMarkup(
            <UIProvider i18n={i18n} formatSource={source}>
                <DatabaseProvider client={client} numberNotation={numberNotation}>
                    <DataGrid label="Prices" columns={numbers} rows={values} />
                </DatabaseProvider>
            </UIProvider>
        );

    test('draws the cells of numeric columns in the region notation', () => {
        const markup = renderIn('region');
        expect(markup).toContain('>9007199254740993<');
        expect(markup).toContain('>12.900,50<');
        expect(markup).toContain('>-0,25<');
        expect(markup).toContain('>1234<');
    });

    test('keys and ID names stay exact while an ordinary integer uses region notation', () => {
        const identifierColumns: GridColumn[] = [
            { name: 'serial', kind: 'integer', type: 'int', primaryKey: true },
            { name: 'owner', kind: 'integer', type: 'int', foreignKey: true },
            { name: 'sequence', kind: 'integer', type: 'int', autoIncrement: true },
            { name: 'person_id', kind: 'integer', type: 'int' },
            { name: 'personId', kind: 'integer', type: 'int' },
            { name: 'alias', kind: 'integer', type: 'int', source: { schema: 'app', table: 'person', column: 'person_id' } },
            { name: 'paid', kind: 'integer', type: 'int' }
        ];
        const markup = renderToStaticMarkup(
            <UIProvider i18n={i18n} formatSource={source}>
                <DatabaseProvider client={client} numberNotation="region">
                    <DataGrid label="Identifiers" columns={identifierColumns} rows={[{ key: 'row', number: 1, cells: identifierColumns.map(() => 1234567) }]} />
                </DatabaseProvider>
            </UIProvider>
        );
        expect(markup.match(/>1234567</g)).toHaveLength(6);
        expect(markup).toContain('>1.234.567<');
    });

    test('draws them as the server wrote them in the database notation', () => {
        const markup = renderIn('database');
        expect(markup).toContain('>9007199254740993<');
        expect(markup).toContain('>12900.50<');
        expect(markup).toContain('>-0.25<');
    });

    test('draws the row number in the region notation in either', () => {
        expect(renderIn('database')).toContain('>1.234</div>');
        expect(renderIn('region')).toContain('>1.234</div>');
    });
});
