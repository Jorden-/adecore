import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { FileTree, Tree, UIProvider, useFileTree, type FileTreeModel } from '../index.ts';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });

function Harness({
    onActivate,
    onLoad,
    onContext,
    onDrag,
    resetKey
}: {
    onActivate?(path: string): void;
    onLoad?(path: string): void;
    onContext?(path: string | null): void;
    onDrag?(path: string | null): void;
    resetKey?: string;
}) {
    const [checked, setChecked] = useState(false);
    const { model } = useFileTree({
        paths: ['src/one.ts', 'src/two.ts', 'README.md'],
        initialExpansion: 'open',
        flattenEmptyDirectories: true,
        dragAndDrop: { canDrag: () => true, canDrop: () => false }
    });
    useLayoutEffect(() => {
        exposed = model;
    }, [model]);
    return (
        <FileTree.Root
            model={model}
            label="Project files"
            resetKey={resetKey}
            onActivate={onActivate}
            onLoadChildren={onLoad}
            onRowContextMenu={(path) => onContext?.(path)}
            onRowDragStart={(path) => onDrag?.(path)}
            renderControl={(row) => <FileTree.Checkbox label={`Viewed ${row.path}`} checked={checked} onCheckedChange={setChecked} />}
            renderDecoration={(row) => <span>{row.kind === 'file' ? '+2' : '2 files'}</span>}
        />
    );
}

let exposed: FileTreeModel;

describe.skipIf(typeof document === 'undefined')('file tree interaction', () => {
    let root: Root;
    let container: HTMLDivElement;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
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
    const row = (path: string): HTMLElement => {
        const found = exposed
            .getFileTreeContainer()
            ?.shadowRoot?.querySelector<HTMLElement>(`[data-type="item"][data-item-path="${path}"]:not([data-item-parked])`);
        if (!found) {
            throw new Error(`Missing row ${path}`);
        }
        return found;
    };

    test('mounts named real checkboxes outside row buttons and isolates pointer changes from activation', async () => {
        const activated: string[] = [];
        await mount(<Harness onActivate={(path) => activated.push(path)} />);
        const checkbox = container.querySelector<HTMLElement>('[role="checkbox"][aria-label="Viewed src/one.ts"]')!;
        expect(checkbox).not.toBeNull();
        expect(checkbox.closest('button[data-type="item"]')).toBeNull();
        expect(exposed.getFileTreeContainer()!.shadowRoot!.querySelector('[role="tree"]')!.getAttribute('aria-label')).toBe('Project files');
        await change(() => checkbox.click());
        expect(checkbox.getAttribute('aria-checked')).toBe('true');
        expect(activated).toEqual([]);
        expect(exposed.getSelectedPaths()).toEqual([]);
        await change(() => {
            exposed.getItem('src/one.ts')?.focus();
            checkbox.focus();
        });
        await change(() => checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true, cancelable: true })));
        expect(exposed.getFocusedPath()).toBe('src/one.ts');
        await change(() => {
            checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true }));
            checkbox.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
        });
        expect(checkbox.getAttribute('aria-checked')).toBe('false');
        expect(activated).toEqual([]);
        await change(() => row('src/one.ts').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
        expect(activated).toEqual(['src/one.ts']);
    });

    test('retains mixed/disabled checkbox semantics and prevents a control key from reaching its row', async () => {
        let rowKeys = 0;
        let changes = 0;
        await mount(
            <Tree.Root onKeyDown={() => rowKeys++}>
                <Tree.Row>
                    <Tree.Checkbox label="All files" checked={false} indeterminate onCheckedChange={() => changes++} />
                    <Tree.Checkbox label="Unavailable" checked={false} disabled onCheckedChange={() => changes++} />
                </Tree.Row>
            </Tree.Root>
        );
        const mixed = container.querySelector<HTMLElement>('[aria-label="All files"]')!;
        expect(mixed.getAttribute('aria-checked')).toBe('mixed');
        await change(() => {
            mixed.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
            mixed.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
        });
        expect(changes).toBe(1);
        expect(rowKeys).toBe(0);
        const disabled = container.querySelector<HTMLButtonElement>('[aria-label="Unavailable"]')!;
        expect(disabled.getAttribute('aria-disabled')).toBe('true');
        await change(() => disabled.click());
        expect(changes).toBe(1);
    });

    test('slides the rows of a tree that scrolls sideways, as far as its widest row reaches', async () => {
        await mount(
            <Tree.Root overflow="scroll" aria-label="Objects">
                <Tree.Row>
                    <Tree.Label>a_very_long_name_of_a_column</Tree.Label>
                    <span>VARCHAR(255)</span>
                </Tree.Row>
            </Tree.Root>
        );
        const tree = container.querySelector<HTMLElement>('[role=tree]')!;
        const row = container.querySelector<HTMLElement>('[role=treeitem]')!;
        expect(tree.dataset.overflow).toBe('scroll');
        expect(tree.querySelector('.adecore-tree-shift')).not.toBeNull();
        const box = (left: number, right: number): DOMRect => ({
            left,
            right,
            width: right - left,
            top: 0,
            bottom: 25,
            height: 25,
            x: left,
            y: 0,
            toJSON: () => ({})
        });
        row.getBoundingClientRect = () => box(0, 100);
        (row.children[0] as HTMLElement).getBoundingClientRect = () => box(4, 120);
        (row.children[1] as HTMLElement).getBoundingClientRect = () => box(126, 160);
        await change(() => row.append(document.createElement('i')));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const shift = (): string => tree.style.getPropertyValue('--adecore-tree-shift');
        await change(() => tree.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true })));
        expect(shift()).toBe('30px');
        await change(() => tree.dispatchEvent(new WheelEvent('wheel', { deltaX: 500, bubbles: true, cancelable: true })));
        expect(shift()).toBe('60px');
        await change(() => tree.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })));
        expect(shift()).toBe('60px');
    });

    test('keeps the bar of a tree that scrolls sideways at its bottom edge, below rows that keep their height', async () => {
        // The rules of the theme for trees, without its layers, which the DOM of the tests does not read.
        const theme = await Bun.file(new URL('../theme.css', import.meta.url)).text();
        const rules = [...theme.matchAll(/(\.adecore-tree[^{}@]*)\{([^{}]*)\}/g)].map((match) => `${match[1]}{${match[2]}}`).join('\n');
        const style = document.createElement('style');
        style.textContent = rules;
        document.head.append(style);
        try {
            await mount(
                <>
                    <Tree.Root overflow="scroll" aria-label="Scrolls">
                        <Tree.Row>
                            <Tree.Label>one</Tree.Label>
                        </Tree.Row>
                    </Tree.Root>
                    <Tree.Root aria-label="Truncates">
                        <Tree.Row>
                            <Tree.Label>one</Tree.Label>
                        </Tree.Row>
                    </Tree.Root>
                </>
            );
            const scrolling = container.querySelector<HTMLElement>('[aria-label=Scrolls]')!;
            const bar = scrolling.lastElementChild as HTMLElement;
            expect(bar.className).toBe('adecore-tree-shift');
            expect(getComputedStyle(scrolling).display).toBe('flex');
            expect(getComputedStyle(scrolling).flexDirection).toBe('column');
            expect(getComputedStyle(bar).marginTop).toBe('auto');
            expect(getComputedStyle(bar).position).toBe('sticky');
            expect(getComputedStyle(scrolling.querySelector('[role=treeitem]')!).flexShrink).toBe('0');
            const truncating = container.querySelector<HTMLElement>('[aria-label=Truncates]')!;
            expect(getComputedStyle(truncating).display).not.toBe('flex');
        } finally {
            style.remove();
        }
    });

    test('cuts a row off at the end by default, without a bar', async () => {
        await mount(
            <Tree.Root aria-label="Objects">
                <Tree.Row>
                    <Tree.Label>name</Tree.Label>
                </Tree.Row>
            </Tree.Root>
        );
        const tree = container.querySelector<HTMLElement>('[role=tree]')!;
        expect(tree.dataset.overflow).toBe('truncate');
        expect(tree.querySelector('.adecore-tree-shift')).toBeNull();
    });

    test('follows keyboard focus after the engine handles the arrow and activates Enter once', async () => {
        const activated: string[] = [];
        await mount(<Harness onActivate={(path) => activated.push(path)} />);
        await change(() => FileTree.focusRow(exposed, 'src/one.ts'));
        const original = window.setTimeout;
        const deferred: (() => void)[] = [];
        window.setTimeout = ((callback: TimerHandler) => {
            if (typeof callback === 'function') {
                deferred.push(callback as () => void);
            }
            return 1;
        }) as typeof window.setTimeout;
        try {
            await change(() =>
                row('src/one.ts').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true, cancelable: true }))
            );
        } finally {
            window.setTimeout = original;
        }
        await change(() => deferred.forEach((callback) => callback()));
        expect(exposed.getFocusedPath()).toBe('src/two.ts');
        expect(exposed.getSelectedPaths()).toEqual(['src/two.ts']);
        await change(() => row('src/two.ts').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true })));
        expect(activated).toEqual(['src/two.ts']);
    });

    test('reports lazy expansion, supports multiselection, and retains context and drag hooks', async () => {
        const loaded: string[] = [];
        const context: (string | null)[] = [];
        const drag: (string | null)[] = [];
        await mount(<Harness onLoad={(path) => loaded.push(path)} onContext={(path) => context.push(path)} onDrag={(path) => drag.push(path)} />);
        expect(loaded).toEqual(['src/']);
        await change(() => FileTree.directoryHandle(exposed, 'src/')?.collapse());
        await change(() => FileTree.directoryHandle(exposed, 'src/')?.expand());
        expect(loaded).toEqual(['src/', 'src/']);
        await change(() => row('src/one.ts').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
        await change(() => row('src/two.ts').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, composed: true })));
        expect([...exposed.getSelectedPaths()].sort()).toEqual(['src/one.ts', 'src/two.ts']);
        await change(() => row('src/two.ts').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true })));
        expect(context).toEqual(['src/two.ts']);
        const event = new Event('dragstart', { bubbles: true, composed: true, cancelable: true });
        const transfer = new DataTransfer();
        transfer.setDragImage = () => {};
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        await change(() => row('src/two.ts').dispatchEvent(event));
        expect(drag).toEqual(['src/two.ts']);
    });

    test('shifts a long path horizontally, leaves vertical wheel input alone, and resets for a new root', async () => {
        const originalFrame = globalThis.requestAnimationFrame;
        const originalCancel = globalThis.cancelAnimationFrame;
        const originalRange = document.createRange;
        const originalStyle = globalThis.getComputedStyle;
        const frames = new Map<number, FrameRequestCallback>();
        let serial = 0;
        globalThis.requestAnimationFrame = (callback) => {
            frames.set(++serial, callback);
            return serial;
        };
        globalThis.cancelAnimationFrame = (id) => {
            frames.delete(id);
        };
        document.createRange = () => {
            const range = originalRange.call(document);
            Object.defineProperty(range, 'getBoundingClientRect', {
                value: () => {
                    const frame = container.querySelector<HTMLElement>('.adecore-file-tree');
                    const shift = Number.parseFloat(frame?.style.getPropertyValue('--adecore-tree-shift') ?? '') || 0;
                    return new DOMRect(44 - shift, 0, 216, 25);
                }
            });
            return range;
        };
        globalThis.getComputedStyle = (element, pseudo) =>
            new Proxy(originalStyle(element, pseudo), {
                get: (style, property) => {
                    if (property === 'paddingInlineEnd') {
                        return '8px';
                    }
                    if (property === 'marginInlineEnd') {
                        return '26px';
                    }
                    if (property === 'columnGap') {
                        return '6px';
                    }
                    return Reflect.get(style, property);
                }
            });
        const drawFrames = async (): Promise<void> => {
            for (let pass = 0; pass < 6 && frames.size > 0; pass++) {
                const current = [...frames.values()];
                frames.clear();
                await change(() => current.forEach((callback) => callback(0)));
            }
        };
        try {
            await mount(<Harness resetKey="first" />);
            const frame = container.querySelector<HTMLElement>('.adecore-file-tree')!;
            Object.defineProperty(frame, 'clientWidth', { value: 200 });
            for (const element of exposed.getFileTreeContainer()!.shadowRoot!.querySelectorAll<HTMLElement>('[data-type="item"]')) {
                element.getBoundingClientRect = () => new DOMRect(0, 0, 200, 25);
            }
            await drawFrames();
            await change(() => frame.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true })));
            expect(frame.style.getPropertyValue('--adecore-tree-shift')).toBe('30px');
            await change(() => frame.dispatchEvent(new WheelEvent('wheel', { deltaX: 2, deltaY: 40, bubbles: true, cancelable: true })));
            expect(frame.style.getPropertyValue('--adecore-tree-shift')).toBe('30px');
            await mount(<Harness resetKey="second" />);
            expect(frame.style.getPropertyValue('--adecore-tree-shift')).toBe('');
        } finally {
            globalThis.requestAnimationFrame = originalFrame;
            globalThis.cancelAnimationFrame = originalCancel;
            document.createRange = originalRange;
            globalThis.getComputedStyle = originalStyle;
        }
    });

    test('refreshes port contents after props change and removes slots on unmount', async () => {
        await mount(<Harness />);
        expect(container.querySelectorAll('[data-tree-slot="control"]').length).toBeGreaterThan(0);
        await mount(<div>Closed</div>);
        expect(container.querySelectorAll('[data-tree-slot]')).toHaveLength(0);
    });
});
