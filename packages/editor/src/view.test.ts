import { describe, expect, spyOn, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { createPage } from './testing.ts';
import { EditorView } from './view.ts';
import { SETTINGS, mount, rendered } from './view.fixture.test.ts';

describe('the fold ranges a server hands over', () => {
    test('stay on their text through an edit before them, their first and last line cut where the server said', () => {
        const source = '<?php\nuse App\\A;\nuse App\\B;\nuse App\\C;\n\nfinal class D {}';
        const { host, model, view } = mount(source, { language: 'php' });
        const at = (line: number, column: number) => model.offsetAt({ line, column });
        view.setFoldHints({ ranges: [{ from: at(1, 0), to: at(3, 0), kind: 'imports', head: at(1, 3), tail: at(3, 9) }] });
        model.applyEdits([{ from: at(1, 0), to: at(1, 0), text: '// imports\n' }]);
        view.refreshFolds();
        view.toggleFold(2);
        expect(rendered(host)).toEqual(['0', '1', '2', '5', '6']);
        expect([...host.querySelectorAll('.se-line[data-line="2"] .se-run')].map((run) => run.textContent)).toEqual(['use', ';']);
    });
});

describe('a row of the host', () => {
    test('takes the height the browser measures for it once it is drawn', () => {
        const page = createPage();
        const observed: Element[] = [];
        let measure: (entries: { target: Element }[]) => void = () => {};
        const ResizeObserver = class {
            constructor(callback: (entries: { target: Element }[]) => void) {
                measure = callback;
            }

            observe(element: Element): void {
                observed.push(element);
            }

            unobserve(): void {}

            disconnect(): void {}
        };
        // On this page alone: a LinkeDOM window writes through to the global one, where every later test would find it.
        const scoped = new Proxy(page.window, { get: (target, key) => (key === 'ResizeObserver' ? ResizeObserver : Reflect.get(target, key)) });
        Object.defineProperty(page.document, 'defaultView', { value: scoped });
        const model = new DocumentModel('one\ntwo\nthree');
        const view = new EditorView(page.host, model, SETTINGS);
        view.setBlockWidgets('host', [{ id: 'note', at: 0, placement: 'below', height: 20, render: () => {} }]);
        const before = view.contentHeight;
        const row = observed.find((element) => (element as HTMLElement).dataset.rowKey === 'block:note') as HTMLElement;
        row.getBoundingClientRect = () => ({ height: 70 }) as DOMRect;
        measure([{ target: row }]);
        expect(view.contentHeight).toBe(before + 50);
        expect(page.host.querySelector<HTMLElement>('.se-line[data-line="1"]')!.style.top).toBe('90px');
        view.dispose();
    });
});

describe('a notice', () => {
    test('shows a while and then hides', () => {
        const timers: { callback: () => void; delay: number }[] = [];
        const set = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
            timers.push({ callback, delay: delay ?? 0 });
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);
        try {
            const { host, view } = mount('one');
            const notice = host.querySelector<HTMLElement>('.se-notice')!;
            view.notify('The file is read only');
            expect(notice.hidden).toBe(false);
            expect(notice.textContent).toBe('The file is read only');
            timers.filter((timer) => timer.delay === 3000).forEach((timer) => timer.callback());
            expect(notice.hidden).toBe(true);
        } finally {
            set.mockRestore();
        }
    });
});
