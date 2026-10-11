import { expect, test } from 'bun:test';
import { composerMenuAria, optionIdOf } from './menu-aria';

const base = { label: 'Message', listId: 'list', activeIndex: 2, count: 3 };

test('a closed menu controls and points at nothing', () => {
    const aria = composerMenuAria({ ...base, open: false });
    expect(aria).toEqual({ 'aria-label': 'Message', 'aria-autocomplete': 'list' });
});

test('an open menu without rows controls and points at nothing', () => {
    expect(composerMenuAria({ ...base, open: true, count: 0 })).not.toHaveProperty('aria-controls');
    expect(composerMenuAria({ ...base, open: true, count: 0 })).not.toHaveProperty('aria-activedescendant');
});

test('an open menu points at the option the ids name', () => {
    const aria = composerMenuAria({ ...base, open: true });
    expect(aria['aria-controls']).toBe('list');
    expect(aria['aria-activedescendant']).toBe(optionIdOf('list', 2));
});
