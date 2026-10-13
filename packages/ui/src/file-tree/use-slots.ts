import { useEffect, useId, useState } from 'react';
import { flushSync } from 'react-dom';
import type { FileTree, FileTreeVisibleRow } from '@pierre/trees';
import { pathOfRow, visibleRows, visibleRowsAround } from './helpers.ts';
import { FILE_TREE_CSS } from './style.ts';

export interface RowSlot {
    row: FileTreeVisibleRow;
    control: HTMLElement;
    decoration: HTMLElement;
}

export interface Port {
    rowElement: HTMLElement;
    control: HTMLElement;
    decoration: HTMLElement;
    lightControl: HTMLElement;
    lightDecoration: HTMLElement;
}

/*
 * The rows of the mounted window, read from the spacer beta.6 puts above it (its first index times the
 * row height), so a scroll frame copies those and not every visible row. The whole list stands in when
 * the spacer is missing or the model already moved past what is mounted.
 */
function mountedRows(model: FileTree, shadow: ShadowRoot, elements: readonly HTMLElement[]): FileTreeVisibleRow[] {
    const spacer = shadow.querySelector<HTMLElement>('[data-file-tree-virtualized-sticky-offset]');
    const offset = spacer === null ? Number.NaN : Number.parseFloat(spacer.style.height);
    const itemHeight = model.getItemHeight();
    if (!Number.isFinite(offset) || itemHeight <= 0) {
        return visibleRows(model);
    }
    // A folder pinned to the top leaves the flow, but still takes its index in the window.
    const pinned = shadow.querySelectorAll('[data-file-tree-sticky-row="true"]').length;
    const rows = visibleRowsAround(model, Math.round(offset / itemHeight), elements.length + pinned);
    const paths = new Set(rows.map((row) => row.path));
    return elements.every((element) => element.dataset.itemPath === undefined || paths.has(element.dataset.itemPath)) ? rows : visibleRows(model);
}

/*
 * Lines the ports up with their rows: every size first, then the spaces they reserve, then every offset,
 * then the ports, so a pass forces two layouts at most however many rows are mounted.
 */
export function positionPorts(ports: Iterable<Port>): void {
    const spaced = [...ports].map((port) => ({
        port,
        control: port.lightControl.childNodes.length > 0 ? Math.ceil(port.lightControl.getBoundingClientRect().width) + 6 : 0,
        decoration: port.lightDecoration.childNodes.length > 0 ? Math.ceil(port.lightDecoration.getBoundingClientRect().width) + 6 : 0
    }));
    for (const { port, control, decoration } of spaced) {
        setSpace(port.rowElement, '--adecore-tree-control-space', control);
        setSpace(port.rowElement, '--adecore-tree-decoration-space', decoration);
    }
    const placed = spaced.map(({ port, control, decoration }) => {
        const row = port.rowElement;
        const content = row.querySelector<HTMLElement>('[data-item-section="content"]');
        const icon = row.querySelector<HTMLElement>('[data-item-section="icon"]');
        return {
            port,
            top: `${row.offsetTop}px`,
            controlLeft: `${row.offsetLeft + (icon?.offsetLeft ?? 4) - control}px`,
            decorationLeft: `${row.offsetLeft + (content === null ? row.offsetWidth - decoration - 2 : content.offsetLeft + content.offsetWidth + 6)}px`
        };
    });
    for (const { port, top, controlLeft, decorationLeft } of placed) {
        port.control.style.top = top;
        port.control.style.left = controlLeft;
        port.decoration.style.top = top;
        port.decoration.style.left = decorationLeft;
    }
}

// An unchanged space is left alone, so a pass that only scrolled measures once.
function setSpace(row: HTMLElement, name: string, space: number): void {
    const value = `${space}px`;
    if (row.style.getPropertyValue(name) !== value) {
        row.style.setProperty(name, value);
    }
}

// beta.6 owns button rows. Sibling slots keep real controls outside those buttons and in the app's stylesheet.
export function useFileTreeSlots(model: FileTree, frame: HTMLElement | null, label: string) {
    const prefix = useId().replaceAll(':', '');
    const [slots, setSlots] = useState<RowSlot[]>([]);

    useEffect(() => {
        if (frame === null) {
            return;
        }
        const ports = new Map<HTMLElement, Port>();
        let shadow: ShadowRoot | null = null;
        let style: HTMLStyleElement | null = null;
        let serial = 0;
        let disposed = false;
        let pending = false;
        let snapshot: string | null = null;

        const position = (): void => positionPorts(ports.values());

        const resize = new ResizeObserver(position);
        const dropPort = (port: Port): void => {
            port.control.remove();
            port.decoration.remove();
            resize.unobserve(port.lightControl);
            resize.unobserve(port.lightDecoration);
            port.lightControl.remove();
            port.lightDecoration.remove();
        };
        const makePort = (element: HTMLElement, host: HTMLElement, kind: 'control' | 'decoration'): { container: HTMLElement; target: HTMLElement } => {
            const container = document.createElement('span');
            container.dataset.treePort = kind;
            const slot = document.createElement('slot');
            slot.name = `${prefix}-${kind}-${serial}`;
            container.append(slot);
            element.parentElement?.append(container);
            const target = document.createElement('span');
            target.slot = slot.name;
            target.dataset.treeSlot = kind;
            target.className = kind === 'control' ? 'adecore-tree-control' : 'adecore-tree-decoration';
            // React delegates to this portal target before the event reaches the engine's shadow tree.
            for (const type of ['click', 'dblclick', 'keydown', 'keyup', 'pointerdown', 'dragstart']) {
                target.addEventListener(type, (event) => event.stopPropagation());
            }
            host.append(target);
            resize.observe(target);
            return { container, target };
        };
        const scan = (): void => {
            pending = false;
            if (disposed) {
                return;
            }
            const current = model.getFileTreeContainer();
            if (!current?.shadowRoot) {
                return;
            }
            if (shadow !== current.shadowRoot) {
                shadow = current.shadowRoot;
                style = document.createElement('style');
                style.dataset.adecoreTreeStyle = 'true';
                style.textContent = FILE_TREE_CSS;
                shadow.append(style);
                changes.observe(shadow, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['data-item-path', 'aria-selected', 'aria-expanded']
                });
                changes.observe(current, { childList: true, subtree: true });
                resize.observe(current);
            }
            shadow.querySelector('[role="tree"]')?.setAttribute('aria-label', label);
            const elements = [
                ...shadow.querySelectorAll<HTMLElement>('[data-type="item"]:not([data-item-parked="true"]):not([data-file-tree-sticky-row="true"])')
            ];
            const rows = mountedRows(model, shadow, elements);
            const byPath = new Map(rows.map((row) => [pathOfRow(row), row]));
            const byIndex = new Map(rows.map((row) => [row.index, row]));
            const live = new Set(elements);
            for (const [element, port] of ports) {
                if (!live.has(element)) {
                    dropPort(port);
                    ports.delete(element);
                }
            }
            const next: RowSlot[] = [];
            for (const element of elements) {
                const path = element.dataset.itemPath;
                const row = path === undefined ? undefined : byPath.get(path);
                if (row === undefined) {
                    continue;
                }
                element.dataset.interactive = 'true';
                element.dataset.joinedStart = String(row.isSelected && byIndex.get(row.index - 1)?.isSelected === true);
                element.dataset.joinedEnd = String(row.isSelected && byIndex.get(row.index + 1)?.isSelected === true);
                let port = ports.get(element);
                if (port === undefined) {
                    serial++;
                    const control = makePort(element, current, 'control');
                    const decoration = makePort(element, current, 'decoration');
                    port = {
                        rowElement: element,
                        control: control.container,
                        decoration: decoration.container,
                        lightControl: control.target,
                        lightDecoration: decoration.target
                    };
                    ports.set(element, port);
                }
                if (port.control.dataset.itemPath !== row.path) {
                    port.control.dataset.itemPath = row.path;
                }
                if (port.decoration.dataset.itemPath !== row.path) {
                    port.decoration.dataset.itemPath = row.path;
                }
                port.lightControl.dataset.itemPath = row.path;
                port.lightDecoration.dataset.itemPath = row.path;
                next.push({ row, control: port.lightControl, decoration: port.lightDecoration });
            }
            const key = next
                .map(({ row, control }) => `${control.slot}:${row.path}:${row.isSelected}:${row.isExpanded}:${row.isFocused}:${row.name}`)
                .join('|');
            if (snapshot !== key) {
                snapshot = key;
                // Recycled rows must paint with their new portal contents in the same frame.
                flushSync(() => setSlots(next));
            }
            position();
        };
        const schedule = (): void => {
            if (!pending && !disposed) {
                pending = true;
                queueMicrotask(scan);
            }
        };
        const shifts = new MutationObserver(position);
        shifts.observe(frame, { attributes: true, attributeFilter: ['style'] });
        const changes = new MutationObserver(schedule);
        changes.observe(frame, { childList: true, subtree: true });
        const unsubscribe = model.subscribe(schedule);
        schedule();
        return () => {
            disposed = true;
            unsubscribe();
            changes.disconnect();
            shifts.disconnect();
            resize.disconnect();
            style?.remove();
            for (const port of ports.values()) {
                port.rowElement.style.removeProperty('--adecore-tree-control-space');
                port.rowElement.style.removeProperty('--adecore-tree-decoration-space');
                dropPort(port);
            }
        };
    }, [frame, model, label, prefix]);

    return slots;
}
