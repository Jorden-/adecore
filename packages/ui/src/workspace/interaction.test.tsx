import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '../UIProvider.tsx';
import { SplitView } from './SplitView.tsx';
import { ContextMenu } from '../index.ts';
import { DocumentTab, TabStrip } from './TabStrip.tsx';
import { Workspace } from './Workspace.tsx';
import { createSplitLayout, updateSplitLayout, type SplitBranch, type SplitCommand, type SplitLayout } from './model.ts';
import type { WorkspaceLayout } from './context.ts';
import i18next from 'i18next';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
let command: (value: SplitCommand) => void;
let setAppearance: (value: WorkspaceLayout) => void;
let current: SplitLayout;
let mounts = 0;
let unmounts = 0;
let viewRenders = 0;

function Editor({ id }: { id: string }) {
    const [value, setValue] = useState(id);
    useEffect(() => {
        mounts++;
        return () => {
            unmounts++;
        };
    }, []);
    return <input aria-label={id} value={value} onChange={(event) => setValue(event.target.value)} />;
}

function Harness({ onClose, initial, minimumSize }: { onClose?(id: string): void; initial?: SplitLayout; minimumSize?: { width: number; height: number } }) {
    const [value, setValue] = useState(() => initial ?? createSplitLayout(['a', 'b']));
    const [layout, setLayout] = useState<WorkspaceLayout>('standard');
    useEffect(() => {
        command = (next) => setValue((previous) => updateSplitLayout(previous, next));
        setAppearance = setLayout;
        current = value;
    }, [value]);
    return (
        <Workspace layout={layout} toolbar={<span>Toolbar</span>} sidebar={<span>Sidebar</span>}>
            <SplitView
                value={value}
                onValueChange={setValue}
                renderView={(id) => {
                    viewRenders++;
                    return <Editor id={id} />;
                }}
                onClose={onClose}
                minimumSize={minimumSize}
            />
        </Workspace>
    );
}

describe.skipIf(typeof document === 'undefined')('workspace interaction', () => {
    let container: HTMLDivElement;
    let root: Root;
    let widthDescriptor: PropertyDescriptor | undefined;
    let heightDescriptor: PropertyDescriptor | undefined;
    beforeEach(() => {
        mounts = 0;
        unmounts = 0;
        widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
        heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get() {
                return this.classList.contains('ade-split-view') ? 800 : 0;
            }
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get() {
                return this.classList.contains('ade-split-view') ? 400 : 0;
            }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        if (widthDescriptor) {
            Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
        } else {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
        }
        if (heightDescriptor) {
            Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
        } else {
            Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
        }
    });
    const mount = async (node: ReactNode): Promise<void> => {
        await act(async () => {
            root.render(<UIProvider i18n={i18n}>{node}</UIProvider>);
        });
    };
    const change = async (run: () => void): Promise<void> => {
        await act(async () => {
            run();
        });
    };
    test('keeps the exact view DOM across splits, moves, maximize, and layout changes', async () => {
        await mount(<Harness />);
        const editor = container.querySelector('input[aria-label="a"]');
        const host = editor?.parentElement;
        const order = Array.from(container.querySelectorAll('[data-split-view-id]'), (node) => node.getAttribute('data-split-view-id'));
        await change(() => command({ type: 'move', sourceId: 'main', targetId: 'main', viewId: 'a', side: 'right', newPaneId: 'second', splitId: 'split' }));
        expect(Array.from(container.querySelectorAll('[data-split-view-id]'), (node) => node.getAttribute('data-split-view-id'))).toEqual(order);
        await change(() => command({ type: 'swap', sourceId: 'second', targetId: 'main' }));
        await change(() => command({ type: 'maximize', paneId: 'second' }));
        await change(() => setAppearance('roomy'));
        await change(() => command({ type: 'maximize', paneId: null }));
        await change(() => command({ type: 'move', sourceId: 'second', targetId: 'main', viewId: 'a' }));
        expect(container.querySelector('input[aria-label="a"]')).toBe(editor);
        expect(editor?.parentElement).toBe(host);
        expect(Array.from(container.querySelectorAll('[data-split-view-id]'), (node) => node.getAttribute('data-split-view-id'))).toEqual(order);
        expect(mounts).toBe(2);
        expect(unmounts).toBe(0);
        await change(() => command({ type: 'close', viewId: 'a' }));
        expect(unmounts).toBe(1);
        expect(current.root).toMatchObject({ views: ['b'] });
    });
    test.each(['horizontal', 'vertical'] as const)('balances neighbors or the entire %s split with Option', async (axis) => {
        const initial: SplitLayout = {
            root: {
                type: 'split',
                id: 'row',
                axis,
                sizes: [0.2, 0.3, 0.5],
                children: ['a', 'b', 'c'].map((id) => ({ type: 'pane', id, views: [id], active: id }))
            },
            focused: 'a',
            maximized: null
        };
        await mount(<Harness initial={initial} />);
        const divider = container.querySelector('[role="separator"]')!;
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect((current.root as SplitBranch).sizes).toEqual([0.25, 0.25, 0.5]);
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true })));
        expect((current.root as SplitBranch).sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
        await change(() => command({ type: 'resize', splitId: 'row', sizes: [0.2, 0.3, 0.5] }));
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, shiftKey: true })));
        expect((current.root as SplitBranch).sizes).toEqual([0.25, 0.25, 0.5]);
    });
    test.each(['right', 'bottom'] as const)('double-click balances panes created by repeated %s splits', async (side) => {
        let initial = createSplitLayout(['a'], 'a');
        for (const [source, id, splitId] of [
            ['a', 'b', 'row'],
            ['b', 'c', 'nested']
        ] as const) {
            initial = updateSplitLayout(initial, { type: 'split', paneId: source, side, splitId, newPane: { type: 'pane', id, views: [id], active: id } });
        }
        await mount(<Harness initial={initial} />);
        const offset = side === 'right' ? 'left' : 'top';
        const divider = [...container.querySelectorAll<HTMLElement>('[role="separator"]')].sort(
            (first, second) => parseFloat(first.style[offset]) - parseFloat(second.style[offset])
        )[0]!;
        const dimension = side === 'right' ? 'width' : 'height';
        const sizes = (): number[] => [...container.querySelectorAll<HTMLElement>('[data-split-pane]')].map((pane) => parseFloat(pane.style[dimension]));
        const before = sizes();
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        const after = sizes();
        expect(Math.abs(after[0]! - after[1]!)).toBeLessThanOrEqual(1);
        expect(after[2]).toBe(before[2]);
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true })));
        const equal = sizes();
        expect(Math.max(...equal) - Math.min(...equal)).toBeLessThanOrEqual(1);
        expect(mounts).toBe(3);
        expect(unmounts).toBe(0);
    });
    test.each(['horizontal', 'vertical'] as const)('Option balances the whole %s axis from the deepest divider', async (axis) => {
        const side = axis === 'horizontal' ? 'right' : 'bottom';
        const cross = axis === 'horizontal' ? 'bottom' : 'right';
        let initial = createSplitLayout(['brief'], 'brief');
        for (const [source, id, direction, splitId] of [
            ['brief', 'preview', side, 'outer'],
            ['preview', 'output', cross, 'cross-one'],
            ['output', 'draft-one', side, 'middle'],
            ['draft-one', 'draft-two', cross, 'cross-two'],
            ['draft-two', 'draft-three', side, 'inner']
        ] as const) {
            initial = updateSplitLayout(initial, {
                type: 'split',
                paneId: source,
                side: direction,
                splitId,
                newPane: { type: 'pane', id, views: [id], active: id }
            });
        }
        await mount(<Harness initial={initial} minimumSize={{ width: 0, height: 0 }} />);
        const position = axis === 'horizontal' ? 'left' : 'top';
        const dimension = axis === 'horizontal' ? 'width' : 'height';
        const orientation = axis === 'horizontal' ? 'vertical' : 'horizontal';
        const dividers = [...container.querySelectorAll<HTMLElement>(`[role="separator"][aria-orientation="${orientation}"]`)];
        const divider = dividers.sort((first, second) => parseFloat(second.style[position]) - parseFloat(first.style[position]))[0]!;
        const editor = container.querySelector('input[aria-label="draft-two"]');
        const crossSizes = (): number[][] => {
            const result: number[][] = [];
            const visit = (node: SplitLayout['root']): void => {
                if (node.type === 'split') {
                    if (node.axis !== axis) {
                        result.push(node.sizes);
                    }
                    node.children.forEach(visit);
                }
            };
            visit(current.root);
            return result;
        };
        const before = crossSizes();
        await change(() => divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true })));
        const sizes = ['brief', 'output', 'draft-two', 'draft-three'].map((id) =>
            parseFloat(container.querySelector<HTMLElement>(`[data-split-pane="${id}"]`)!.style[dimension])
        );
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(crossSizes()).toEqual(before);
        expect(container.querySelector('input[aria-label="draft-two"]')).toBe(editor);
        expect(mounts).toBe(6);
        expect(unmounts).toBe(0);
    });
    test('renders once for a drop zone however often the pointer moves inside it', async () => {
        await mount(<Harness />);
        const dragEvent = (type: string, x: number, y: number): Event => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            const transfer = { setData: () => {}, effectAllowed: 'all', dropEffect: 'none', types: [] };
            Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, dataTransfer: { value: transfer } });
            return event;
        };
        const view = container.querySelector<HTMLElement>('.ade-split-view')!;
        await change(() => container.querySelector('[data-document-tab="a"] [role="tab"]')!.dispatchEvent(dragEvent('dragstart', 20, 10)));
        await change(() => view.dispatchEvent(dragEvent('dragover', 780, 200)));
        expect(view.querySelector('.ade-drop-preview')).not.toBeNull();
        const settled = viewRenders;
        for (const x of [776, 770, 764, 790]) {
            await change(() => view.dispatchEvent(dragEvent('dragover', x, 210)));
        }
        expect(viewRenders).toBe(settled);
        await change(() => view.dispatchEvent(dragEvent('dragover', 20, 200)));
        expect(viewRenders).toBeGreaterThan(settled);
    });
    test('resizes once per frame while the divider is dragged', async () => {
        const initial: SplitLayout = {
            root: {
                type: 'split',
                id: 'row',
                axis: 'horizontal',
                sizes: [0.5, 0.5],
                children: ['a', 'b'].map((id) => ({ type: 'pane', id, views: [id], active: id }))
            },
            focused: 'a',
            maximized: null
        };
        const frames: FrameRequestCallback[] = [];
        const original = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => frames.push(callback);
        try {
            await mount(<Harness initial={initial} />);
            const divider = container.querySelector<HTMLElement>('[role="separator"]')!;
            divider.setPointerCapture = () => {};
            divider.hasPointerCapture = () => false;
            const pointer = (type: string, x: number): PointerEvent => new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x });
            await change(() => divider.dispatchEvent(pointer('pointerdown', 400)));
            await change(() => {
                for (const x of [380, 360, 340]) {
                    divider.dispatchEvent(pointer('pointermove', x));
                }
            });
            expect((current.root as SplitBranch).sizes).toEqual([0.5, 0.5]);
            expect(frames).toHaveLength(1);
            await change(() => frames.shift()!(0));
            const sizes = (current.root as SplitBranch).sizes;
            expect(sizes[0]).toBeLessThan(0.5);
            await change(() => divider.dispatchEvent(pointer('pointermove', 300)));
            await change(() => divider.dispatchEvent(pointer('pointerup', 300)));
            expect((current.root as SplitBranch).sizes[0]).toBeLessThan(sizes[0]!);
        } finally {
            window.requestAnimationFrame = original;
        }
    });
    test('leaves an asynchronously approved close to the application', async () => {
        const requests: string[] = [];
        await mount(<Harness onClose={(id) => requests.push(id)} />);
        const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close a"]');
        expect(close).not.toBeNull();
        await change(() => close?.click());
        expect(requests).toEqual(['a']);
        expect(current.root).toMatchObject({ views: ['a', 'b'] });
        await change(() => command({ type: 'close', viewId: 'a' }));
        expect(current.root).toMatchObject({ views: ['b'] });
    });
    test('restores focus after closing the active tab without restoring its old state', async () => {
        await mount(<Harness />);
        const first = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
        await change(() => first.focus());
        await change(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
        expect(current.root).toMatchObject({ views: ['b'], active: 'b' });
        expect(document.activeElement?.getAttribute('role')).toBe('tab');
        expect(document.activeElement?.textContent).toBe('b');
    });
    test('standalone tabs navigate with the keyboard and expose their panels', async () => {
        const selected: string[] = [];
        await mount(
            <TabStrip
                items={[
                    { id: 'a', label: 'First', tabId: 'tab-a', panelId: 'panel-a' },
                    { id: 'b', label: 'Second' }
                ]}
                value="a"
                onValueChange={(id) => selected.push(id)}
            />
        );
        const tab = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
        expect(tab.getAttribute('aria-controls')).toBe('panel-a');
        await change(() => tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        expect(selected).toEqual(['b']);
        expect(document.activeElement?.textContent).toContain('Second');
    });
    test('custom tabs keep their menu trigger, keyboard navigation and approved close', async () => {
        const selected: string[] = [];
        const closed: string[] = [];
        await mount(
            <TabStrip
                items={[
                    { id: 'a', label: 'a' },
                    { id: 'b', label: 'b' }
                ]}
                value="a"
                onValueChange={(id) => selected.push(id)}
                renderTab={(item) => (
                    <ContextMenu.Root>
                        <ContextMenu.Trigger
                            render={
                                <DocumentTab item={{ ...item, label: `File ${item.id}`, unsaved: 'Unsubmitted edits' }} onClose={() => closed.push(item.id)} />
                            }
                        />
                        <ContextMenu.Popup>
                            <ContextMenu.Item>Inspect</ContextMenu.Item>
                        </ContextMenu.Popup>
                    </ContextMenu.Root>
                )}
            />
        );
        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs).toHaveLength(2);
        expect(container.querySelector('[data-document-tab="a"]')?.classList.contains('ade-document-tab')).toBe(true);
        expect(tabs[0]?.textContent).toContain('File a');
        await change(() => tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        expect(selected).toEqual(['b']);
        await change(() => tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
        expect(closed).toEqual(['b']);
    });
    test("does not consume an editor's Alt + arrow keys", async () => {
        await mount(<Harness />);
        const input = container.querySelector('input')!;
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
        await change(() => input.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
    });
    test('workspaces have independent selection and unique panel IDs', async () => {
        await mount(
            <>
                <Harness />
                <Harness />
            </>
        );
        const roots = container.querySelectorAll('.ade-split-view');
        const firstTabs = roots[0]!.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        await change(() => firstTabs[1]!.click());
        expect(roots[0]!.querySelector('[aria-selected="true"]')?.textContent).toBe('b');
        expect(roots[1]!.querySelector('[aria-selected="true"]')?.textContent).toBe('a');
        const ids = Array.from(container.querySelectorAll('[role="tabpanel"]'), (node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe.skipIf(typeof document === 'undefined')('tab strip reveal', () => {
    const STRIP_WIDTH = 200;
    const names = ['clientWidth', 'scrollWidth', 'scrollLeft', 'getBoundingClientRect'] as const;
    const scrolls = new WeakMap<HTMLElement, number>();
    let widths: Record<string, number>;
    let descriptors: Partial<Record<(typeof names)[number], PropertyDescriptor>>;
    let container: HTMLDivElement;
    let root: Root;
    const isStrip = (element: HTMLElement): boolean => element.classList.contains('ade-tab-strip');
    const tabsOf = (element: HTMLElement): HTMLElement[] => Array.from(element.querySelectorAll<HTMLElement>('[data-document-tab]'));
    const rect = (left: number, width: number): DOMRect =>
        ({ left, width, right: left + width, x: left, y: 0, top: 0, bottom: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
    beforeEach(() => {
        widths = { a: 100, b: 100, c: 100, d: 100, e: 100 };
        descriptors = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
        Object.defineProperties(HTMLElement.prototype, {
            clientWidth: {
                configurable: true,
                get(this: HTMLElement) {
                    return isStrip(this) ? STRIP_WIDTH : 0;
                }
            },
            scrollWidth: {
                configurable: true,
                get(this: HTMLElement) {
                    return isStrip(this) ? tabsOf(this).reduce((sum, tab) => sum + widths[tab.dataset.documentTab!]!, 0) : 0;
                }
            },
            scrollLeft: {
                configurable: true,
                get(this: HTMLElement) {
                    return scrolls.get(this) ?? 0;
                },
                set(this: HTMLElement, value: number) {
                    scrolls.set(this, isStrip(this) ? Math.max(0, Math.min(value, this.scrollWidth - this.clientWidth)) : value);
                }
            },
            getBoundingClientRect: {
                configurable: true,
                value(this: HTMLElement) {
                    const strip = this.closest<HTMLElement>('.ade-tab-strip');
                    if (!strip || this === strip) {
                        return rect(0, strip ? STRIP_WIDTH : 0);
                    }
                    const tabs = tabsOf(strip);
                    const index = tabs.indexOf(this.closest<HTMLElement>('[data-document-tab]')!);
                    const start = tabs.slice(0, index).reduce((sum, tab) => sum + widths[tab.dataset.documentTab!]!, 0);
                    return rect(start - strip.scrollLeft, widths[tabs[index]!.dataset.documentTab!]!);
                }
            }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        names.forEach((name) => {
            const descriptor = descriptors[name];
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor);
            } else {
                Reflect.deleteProperty(HTMLElement.prototype, name);
            }
        });
    });
    const show = async (value: string): Promise<HTMLElement> => {
        await act(async () => {
            root.render(
                <UIProvider i18n={i18n}>
                    <TabStrip
                        items={Object.keys(widths).map((id) => ({ id, label: `${id} ${widths[id]}` }))}
                        value={value}
                        onValueChange={() => {}}
                        style={{ '--fade-size': '24px' } as CSSProperties}
                    />
                </UIProvider>
            );
        });
        return container.querySelector<HTMLElement>('.ade-tab-strip')!;
    };
    test('scrolls the active tab clear of the fades and leaves a tab in view alone', async () => {
        expect((await show('a')).scrollLeft).toBe(0);
        expect((await show('e')).scrollLeft).toBe(300);
        expect((await show('c')).scrollLeft).toBe(176);
        const strip = await show('a');
        expect(strip.scrollLeft).toBe(0);
        strip.scrollLeft = 50;
        expect((await show('b')).scrollLeft).toBe(50);
    });
    test('follows a tab whose width settles later, until a person scrolls the strip', async () => {
        widths.f = 40;
        expect((await show('f')).scrollLeft).toBe(340);
        widths.f = 120;
        expect((await show('f')).scrollLeft).toBe(420);
        const strip = container.querySelector<HTMLElement>('.ade-tab-strip')!;
        await act(async () => {
            strip.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
        });
        expect(strip.scrollLeft).toBe(320);
        widths.f = 160;
        expect((await show('f')).scrollLeft).toBe(320);
        expect((await show('a')).scrollLeft).toBe(0);
    });
});
