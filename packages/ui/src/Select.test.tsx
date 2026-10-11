import { describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { Select, type SelectProps } from './Select.tsx';
import { UIProvider } from './UIProvider.tsx';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });

const render = (node: ReactNode): string => renderToStaticMarkup(<UIProvider i18n={i18n}>{node}</UIProvider>);
const items = ['One', 'Two', 'Three'].map((label) => ({ value: label.toLowerCase(), label }));
const base: SelectProps<string> = { label: 'Number', value: 'two', onValueChange: () => {}, items };

describe('a select', () => {
    test('draws the same trigger with or without search', () => {
        const plain = render(<Select {...base} />);
        const searching = render(<Select {...base} searchable />);
        for (const markup of [plain, searching]) {
            expect(markup).toContain('aria-label="Number"');
            expect(markup).toContain('>Two<');
        }
        expect(searching).toContain('aria-haspopup="dialog"');
        expect(plain).toContain('aria-haspopup="listbox"');
    });

    test('searches from a number of options on, counting the options of every group', () => {
        expect(render(<Select {...base} searchable={4} />)).toContain('aria-haspopup="listbox"');
        expect(render(<Select {...base} searchable={3} />)).toContain('aria-haspopup="dialog"');
        const groups = [{ label: 'A', items: items.slice(0, 2) }, { label: 'B', items: items.slice(2) }];
        expect(render(<Select {...base} items={groups} searchable={3} />)).toContain('aria-haspopup="dialog"');
    });
});
