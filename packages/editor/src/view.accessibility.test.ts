import { describe, expect, test } from 'bun:test';
import { mount } from './view.fixture.test.ts';

const text = 'function a() {\n    one();\n    two();\n}\nconst b = 1;\n';

describe('input popup', () => {
    test('points the input at a list and its active option, and lets go when it closes', () => {
        const { host, view } = mount('a');
        const input = host.querySelector('textarea')!;
        view.setInputPopup({ controls: 'list', activeDescendant: 'list-2' });
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-autocomplete')).toBe('list');
        expect(input.getAttribute('aria-controls')).toBe('list');
        expect(input.getAttribute('aria-activedescendant')).toBe('list-2');
        view.setInputPopup({ controls: 'list' });
        expect(input.hasAttribute('aria-activedescendant')).toBe(false);
        view.setInputPopup(null);
        for (const name of ['aria-expanded', 'aria-autocomplete', 'aria-controls', 'aria-activedescendant']) {
            expect(input.hasAttribute(name)).toBe(false);
        }
    });
});

describe('announcements', () => {
    test('speak through a polite region that draws nothing and speaks a repeated sentence again', () => {
        const { host, view } = mount('a');
        const live = host.querySelector('.se-live')!;
        expect(live.getAttribute('aria-live')).toBe('polite');
        view.announce('Field 1 of 2');
        const first = live.firstChild;
        expect(live.textContent).toBe('Field 1 of 2');
        view.announce('Field 1 of 2');
        expect(live.firstChild).not.toBe(first);
        expect(host.querySelector('.se-notice')!.hasAttribute('hidden')).toBe(true);
    });
});

describe('fold controls', () => {
    test('name their lines, say whether they are open, and follow the host messages', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        const toggle = (): HTMLElement => host.querySelector('.se-fold-toggle') as HTMLElement;
        expect(toggle().getAttribute('aria-label')).toBe('Fold lines 1 to 4');
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        view.toggleFold(0);
        expect(toggle().getAttribute('aria-label')).toBe('Unfold lines 1 to 4');
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        view.settings.messages = { unfold: 'Open {start}-{end}' };
        view.toggleFold(0);
        view.toggleFold(0);
        expect(toggle().getAttribute('aria-label')).toBe('Open 1-4');
    });
});

describe('line labels', () => {
    test('add hidden text to the gutter and hide the drawn number it replaces', () => {
        const { host, view } = mount('one\ntwo');
        view.setLineLabels((line) => (line === 1 ? 'Added, new line 2' : null));
        const items = [...host.querySelectorAll('.se-line-number')];
        expect(items[0]!.querySelector('.se-sr-only')).toBeNull();
        expect(items[0]!.querySelector('span')!.hasAttribute('aria-hidden')).toBe(false);
        expect(items[1]!.querySelector('.se-sr-only')!.textContent).toBe('Added, new line 2');
        expect(items[1]!.querySelector('span')!.getAttribute('aria-hidden')).toBe('true');
        view.setLineLabels(null);
        expect(host.querySelector('.se-sr-only')).toBeNull();
    });
});
