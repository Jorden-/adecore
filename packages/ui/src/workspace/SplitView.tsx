import {
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type DragEvent,
    type FocusEvent,
    type KeyboardEvent,
    type ReactNode
} from 'react';
import { useRender } from '@base-ui/react/use-render';
import { GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton.tsx';
import { WorkspaceContext, type WorkspaceLayout } from './context.ts';
import {
    paneRadius,
    resizeSplit,
    splitGeometry,
    splitSideAt,
    tabGapAt,
    type SplitDivider,
    type SplitEdges,
    type SplitMinimum,
    type SplitRect
} from './geometry.ts';
import { splitPanes, updateSplitLayout, type SplitCommand, type SplitLayout, type SplitPane } from './model.ts';
import { TabStrip, type TabStripItem, type TabStripProps } from './TabStrip.tsx';
import { dropPreviewPath, rectPreview, tabPreview, type DropPreviewShape } from './preview.ts';

export interface SplitViewInfo {
    paneId: string;
    active: boolean;
}

export interface SplitViewBounds extends SplitViewInfo {
    viewId: string;
    /** Viewport coordinates, suitable for a native surface kept outside the layout's DOM. */
    rect: SplitRect;
    borderRadius: string;
}

export interface SplitDropTarget {
    paneId: string;
    /** A body drop names its zone; an omitted side denotes the tab strip. */
    side?: 'left' | 'right' | 'top' | 'bottom' | 'center';
    /** A gap in the original tab order, before the source is lifted out. */
    index?: number;
}

export interface SplitDrag {
    sourceId: string;
    viewId?: string;
}

export interface SplitViewProps extends Omit<useRender.ComponentProps<'div'>, 'children'> {
    value: SplitLayout;
    onValueChange(value: SplitLayout, command: SplitCommand): void;
    renderView(id: string, info: SplitViewInfo): ReactNode;
    getTab?(id: string): Omit<TabStripItem, 'id' | 'tabId' | 'panelId'>;
    renderPaneHeader?(pane: SplitPane): ReactNode;
    onClose?(id: string): void;
    onTabDoubleClick?: TabStripProps['onDoubleClick'];
    onTabContextMenu?: TabStripProps['onContextMenu'];
    onViewDragStart?(id: string, event: DragEvent<HTMLButtonElement>): void;
    canDrop?(drag: SplitDrag, target: SplitDropTarget): boolean;
    canDropExternal?(event: DragEvent<HTMLDivElement>, target: SplitDropTarget): boolean;
    onExternalDrop?(target: SplitDropTarget, event: DragEvent<HTMLDivElement>): void;
    onViewBoundsChange?(bounds: readonly SplitViewBounds[]): void;
    minimumResizeShare?: number;
    minimumSize?: SplitMinimum | ((pane: SplitPane) => SplitMinimum);
    layout?: WorkspaceLayout;
    flushEdges?: SplitEdges;
    showTabs?: boolean;
    headerHeight?: number;
}

interface Measurement {
    width: number;
    height: number;
    left: number;
    top: number;
    scaleX: number;
    scaleY: number;
}
const ZERO: Measurement = { width: 0, height: 0, left: 0, top: 0, scaleX: 1, scaleY: 1 };
const MINIMUM: SplitMinimum = { width: 120, height: 80 };

/* The pane's section or header under `container`, found by its data attribute rather than a selector, so no id needs escaping. */
function paneElement(container: ParentNode | null | undefined, attribute: 'splitPane' | 'splitHeader', paneId: string): HTMLElement | undefined {
    const selector = attribute === 'splitPane' ? '[data-split-pane]' : '[data-split-header]';
    return Array.from(container?.querySelectorAll<HTMLElement>(selector) ?? []).find((element) => element.dataset[attribute] === paneId);
}

function Divider({
    divider,
    minimumResizeShare,
    onResize,
    onEqualize
}: {
    divider: SplitDivider;
    minimumResizeShare: number;
    onResize(sizes: number[]): void;
    onEqualize(all: boolean): void;
}) {
    const { t } = useTranslation('ui');
    const cleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => cleanup.current?.(), []);
    const horizontal = divider.axis === 'horizontal';
    const before = divider.lengths.slice(0, divider.index + 1).reduce((sum, value) => sum + value, 0);
    const total = divider.lengths.reduce((sum, value) => sum + value, 0);
    const position = total ? Math.round((before / total) * 100) : 0;
    const limit = (delta: number): number =>
        resizeSplit(divider, delta, false, 0, minimumResizeShare)
            .slice(0, divider.index + 1)
            .reduce((sum, size) => sum + size, 0) * 100;
    return (
        <div
            role="separator"
            tabIndex={0}
            aria-label={t('workspace.resize')}
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-valuenow={position}
            aria-valuemin={total ? Math.floor(limit(-total)) : 0}
            aria-valuemax={total ? Math.ceil(limit(total)) : 100}
            className="ade-split-divider"
            style={{ left: divider.x, top: divider.y, width: divider.width, height: divider.height }}
            onDoubleClick={(event) => onEqualize(event.altKey)}
            onKeyDown={(event) => {
                const negative = horizontal ? 'ArrowLeft' : 'ArrowUp';
                const positive = horizontal ? 'ArrowRight' : 'ArrowDown';
                if (event.key === 'Enter') {
                    event.preventDefault();
                    onEqualize(event.altKey);
                } else if ([negative, positive, 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const delta = event.key === 'Home' ? -total : event.key === 'End' ? total : (event.key === negative ? -1 : 1) * (event.shiftKey ? 50 : 10);
                    onResize(resizeSplit(divider, delta, event.altKey, 0, minimumResizeShare));
                }
            }}
            onPointerDown={(event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                cleanup.current?.();
                const element = event.currentTarget;
                const pointerId = event.pointerId;
                const start = horizontal ? event.clientX : event.clientY;
                const parent = element.parentElement;
                const rect = parent?.getBoundingClientRect();
                const scale = horizontal ? (rect?.width ?? 1) / (parent?.clientWidth || 1) : (rect?.height ?? 1) / (parent?.clientHeight || 1);
                element.dataset.resizing = '';
                element.focus();
                const move = (next: PointerEvent): void => {
                    if (next.pointerId !== pointerId) {
                        return;
                    }
                    const delta = ((horizontal ? next.clientX : next.clientY) - start) / (scale || 1);
                    onResize(resizeSplit(divider, delta, next.altKey, 8 / (scale || 1), minimumResizeShare));
                };
                const end = (): void => {
                    element.removeEventListener('pointermove', move);
                    element.removeEventListener('pointerup', end);
                    element.removeEventListener('pointercancel', end);
                    element.removeEventListener('lostpointercapture', end);
                    element.ownerDocument.defaultView?.removeEventListener('blur', end);
                    delete element.dataset.resizing;
                    if (element.hasPointerCapture(pointerId)) {
                        element.releasePointerCapture(pointerId);
                    }
                    cleanup.current = null;
                };
                cleanup.current = end;
                element.setPointerCapture(pointerId);
                element.addEventListener('pointermove', move);
                element.addEventListener('pointerup', end);
                element.addEventListener('pointercancel', end);
                element.addEventListener('lostpointercapture', end);
                element.ownerDocument.defaultView?.addEventListener('blur', end);
            }}
        >
            <span />
        </div>
    );
}

export function SplitView({
    value,
    onValueChange,
    renderView,
    getTab,
    renderPaneHeader,
    onClose,
    onTabDoubleClick,
    onTabContextMenu,
    onViewDragStart,
    canDrop,
    canDropExternal,
    onExternalDrop,
    onViewBoundsChange,
    minimumSize = MINIMUM,
    minimumResizeShare = 0,
    layout: ownLayout,
    flushEdges,
    showTabs = true,
    headerHeight = 36,
    render,
    ref,
    className,
    style,
    ...props
}: SplitViewProps) {
    const { t } = useTranslation('ui');
    const inherited = useContext(WorkspaceContext);
    const layout = ownLayout ?? inherited.layout;
    const edges = flushEdges ?? inherited.edges;
    const root = useRef<HTMLDivElement>(null);
    const prefix = useId();
    const serial = useRef(0);
    const lastFocus = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const previous = lastFocus.current;
        const element = root.current;
        const active = element?.ownerDocument.activeElement;
        if (
            previous &&
            element &&
            (!previous.isConnected || previous.closest('[hidden]')) &&
            (!active || active === element.ownerDocument.body || active === previous)
        ) {
            const pane = paneElement(element, 'splitPane', value.focused);
            const target = pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? pane;
            target?.focus({ preventScroll: true });
        }
    });
    const [measurement, setMeasurement] = useState(ZERO);
    const [dragging, setDragging] = useState(false);
    const drag = useRef<(SplitDrag & { width: number }) | null>(null);
    const [preview, setPreview] = useState<DropPreviewShape | null>(null);
    const latest = useRef({ value, onValueChange });
    useLayoutEffect(() => {
        latest.current = { value, onValueChange };
    });
    const dispatch = useCallback((command: SplitCommand): void => {
        const state = latest.current;
        const next = updateSplitLayout(state.value, command);
        if (next !== state.value) {
            state.onValueChange(next, command);
        }
    }, []);
    const measure = useCallback((): void => {
        const element = root.current;
        if (!element) {
            return;
        }
        const rect = element.getBoundingClientRect();
        const next = {
            width: element.clientWidth,
            height: element.clientHeight,
            left: rect.left,
            top: rect.top,
            scaleX: rect.width / (element.clientWidth || 1),
            scaleY: rect.height / (element.clientHeight || 1)
        };
        setMeasurement((current) => (Object.keys(next).every((key) => current[key as keyof Measurement] === next[key as keyof Measurement]) ? current : next));
    }, []);
    useLayoutEffect(measure);
    useEffect(() => {
        const element = root.current;
        if (!element) {
            return;
        }
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(element);
        const view = element.ownerDocument.defaultView;
        view?.addEventListener('resize', measure);
        view?.addEventListener('scroll', measure, true);
        return () => {
            observer?.disconnect();
            view?.removeEventListener('resize', measure);
            view?.removeEventListener('scroll', measure, true);
        };
    }, [measure]);
    const stopDrag = useCallback((): void => {
        drag.current = null;
        setDragging(false);
        setPreview(null);
    }, []);
    useEffect(() => {
        if (!dragging) {
            return;
        }
        const document = root.current?.ownerDocument;
        const view = document?.defaultView;
        document?.addEventListener('dragend', stopDrag);
        document?.addEventListener('drop', stopDrag);
        view?.addEventListener('blur', stopDrag);
        return () => {
            document?.removeEventListener('dragend', stopDrag);
            document?.removeEventListener('drop', stopDrag);
            view?.removeEventListener('blur', stopDrag);
        };
    }, [dragging, stopDrag]);
    const gap = layout === 'roomy' ? 8 : 1;
    const barHeight = showTabs || renderPaneHeader ? Math.max(0, headerHeight) : 0;
    const geometry = splitGeometry(value, measurement.width, measurement.height, gap, (pane) =>
        typeof minimumSize === 'function' ? minimumSize(pane) : minimumSize
    );
    const panes = splitPanes(value.root);
    // A stable sibling order also avoids DOM moves, which reload embedded browsing contexts.
    const views = panes
        .flatMap((pane) => pane.views.map((viewId) => ({ pane, viewId })))
        .sort((left, right) => (left.viewId < right.viewId ? -1 : left.viewId > right.viewId ? 1 : 0));
    const visible = new Map(geometry.panes.map((pane) => [pane.pane.id, pane]));
    const radius = (rect: SplitRect): string => paneRadius(rect, measurement.width, measurement.height, edges, layout === 'roomy' ? 8 : 0);
    // A header squares off the top corners of the body under it.
    const bodyRadius = (rect: SplitRect, header: number): string => {
        const corners = radius(rect).split(' ');
        if (header > 0) {
            corners[0] = corners[1] = '0px';
        }
        return corners.join(' ');
    };
    const bounds: SplitViewBounds[] = panes.flatMap((pane) => {
        const rect = visible.get(pane.id);
        const header = Math.min(barHeight, rect?.height ?? 0);
        const body = rect
            ? {
                  x: measurement.left + rect.x * measurement.scaleX,
                  y: measurement.top + (rect.y + header) * measurement.scaleY,
                  width: rect.width * measurement.scaleX,
                  height: Math.max(0, rect.height - header) * measurement.scaleY
              }
            : { x: 0, y: 0, width: 0, height: 0 };
        const borderRadius = rect ? bodyRadius(rect, header) : '0px 0px 0px 0px';
        return pane.views.map((viewId) => ({ viewId, paneId: pane.id, active: !!rect && pane.active === viewId, rect: body, borderRadius }));
    });
    const boundsKey = JSON.stringify(bounds);
    const reportedBounds = useRef('');
    const boundsCallback = useRef(onViewBoundsChange);
    useLayoutEffect(() => {
        boundsCallback.current = onViewBoundsChange;
    });
    useEffect(() => () => boundsCallback.current?.([]), []);
    useLayoutEffect(() => {
        if (onViewBoundsChange && reportedBounds.current !== boundsKey) {
            reportedBounds.current = boundsKey;
            onViewBoundsChange(bounds);
        }
    });
    const id = (kind: string, viewId: string): string => `${prefix}-${kind}-${encodeURIComponent(viewId)}`;
    const startDrag = (pane: SplitPane, event: DragEvent<HTMLButtonElement>, viewId?: string): void => {
        drag.current = { sourceId: pane.id, viewId, width: event.currentTarget.closest('[data-document-tab]')?.getBoundingClientRect().width ?? 128 };
        event.dataTransfer.setData('application/x-adecore-view', JSON.stringify({ workspace: prefix, paneId: pane.id, viewId }));
        event.dataTransfer.effectAllowed = 'move';
        if (viewId) {
            onViewDragStart?.(viewId, event);
        }
        setDragging(true);
    };
    const commandFor = (target: SplitDropTarget): SplitCommand | null => {
        if (!drag.current) {
            return null;
        }
        const { sourceId, viewId } = drag.current;
        if (target.side === 'center') {
            return { type: 'swap', sourceId, targetId: target.paneId, viewId };
        }
        return {
            type: 'move',
            sourceId,
            viewId,
            targetId: target.paneId,
            side: target.side,
            index: target.index,
            newPaneId: `${prefix}-pane-${serial.current}`,
            splitId: `${prefix}-split-${serial.current}`
        };
    };
    const locateDrop = (event: DragEvent<HTMLDivElement>): { target: SplitDropTarget; shape: DropPreviewShape } | null => {
        const x = (event.clientX - measurement.left) / (measurement.scaleX || 1);
        const y = (event.clientY - measurement.top) / (measurement.scaleY || 1);
        const rect = geometry.panes.find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
        if (!rect) {
            return null;
        }
        const header = Math.min(barHeight, rect.height);
        const strip = paneElement(root.current, 'splitHeader', rect.pane.id);
        const tabRects = Array.from(strip?.querySelectorAll('[data-document-tab]') ?? [], (element) => element.getBoundingClientRect());
        const inHeader = y < rect.y + header;
        const side = inHeader ? undefined : (splitSideAt(rect, x, y) ?? 'center');
        const index = inHeader ? tabGapAt(tabRects, event.clientX) : undefined;
        const target: SplitDropTarget = { paneId: rect.pane.id, side, index };
        const command = commandFor(target);
        if (drag.current) {
            if (canDrop?.(drag.current, target) === false || !command || updateSplitLayout(value, command) === value) {
                return null;
            }
        } else if (!onExternalDrop || !canDropExternal?.(event, target)) {
            return null;
        }
        if (side === 'center') {
            return { target, shape: rectPreview(rect) };
        }
        if (side) {
            const horizontal = side === 'left' || side === 'right';
            const width = horizontal ? Math.max(0, (rect.width - gap) / 2) : rect.width;
            const height = horizontal ? rect.height : Math.max(0, (rect.height - gap) / 2);
            return {
                target,
                shape: rectPreview({
                    x: side === 'right' ? rect.x + rect.width - width : rect.x,
                    y: side === 'bottom' ? rect.y + rect.height - height : rect.y,
                    width,
                    height
                })
            };
        }
        if (header === 0) {
            return { target, shape: rectPreview(rect) };
        }
        const tabWidth = Math.min(rect.width, (drag.current?.width ?? 128) / (measurement.scaleX || 1));
        const next = tabRects[index ?? tabRects.length];
        const left = next?.left ?? tabRects.at(-1)?.right ?? measurement.left + rect.x * measurement.scaleX;
        const relative = Math.max(0, Math.min(rect.width - tabWidth, (left - measurement.left) / (measurement.scaleX || 1) - rect.x));
        return {
            target,
            shape: tabPreview(
                { gap: index ?? rect.pane.views.length, left: relative, tabWidth, width: rect.width, height: rect.height, barHeight: header },
                { x: rect.x, y: rect.y }
            )
        };
    };
    const focusDirection = (key: string): void => {
        const source = visible.get(value.focused);
        if (!source) {
            return;
        }
        const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
        const positive = key === 'ArrowRight' || key === 'ArrowDown';
        const center = (rect: SplitRect): number => (horizontal ? rect.x + rect.width / 2 : rect.y + rect.height / 2);
        const cross = (rect: SplitRect): number => (horizontal ? rect.y + rect.height / 2 : rect.x + rect.width / 2);
        const options = geometry.panes.filter((rect) => rect !== source && (positive ? center(rect) > center(source) : center(rect) < center(source)));
        options.sort(
            (left, right) =>
                Math.abs(center(left) - center(source)) +
                2 * Math.abs(cross(left) - cross(source)) -
                (Math.abs(center(right) - center(source)) + 2 * Math.abs(cross(right) - cross(source)))
        );
        const next = options[0];
        if (next) {
            dispatch({ type: 'focus', paneId: next.pane.id });
            const element = paneElement(root.current, 'splitPane', next.pane.id);
            element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
            if (!showTabs) {
                element?.focus();
            }
        }
    };
    return useRender({
        render,
        ref: [root, ref ?? null],
        defaultTagName: 'div',
        props: {
            ...props,
            className: clsx('ade-split-view', className),
            style,
            'data-layout': layout,
            'data-dragging': dragging || undefined,
            onFocusCapture: (event: FocusEvent<HTMLDivElement>) => {
                props.onFocusCapture?.(event);
                lastFocus.current = event.target;
            },
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                props.onKeyDown?.(event);
                const target = event.target as HTMLElement;
                const navigation =
                    target === event.currentTarget || target.matches('.ade-split-pane, .ade-split-content') || !!target.closest('.ade-split-header');
                if (!event.defaultPrevented && navigation && event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    focusDirection(event.key);
                }
                if (event.key === 'Escape') {
                    stopDrag();
                }
            },
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
                props.onDragOver?.(event);
                if (event.defaultPrevented) {
                    setPreview(null);
                    return;
                }
                const drop = locateDrop(event);
                setPreview(drop?.shape ?? null);
                if (drop) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = drag.current ? 'move' : 'copy';
                }
            },
            onDragLeave: (event: DragEvent<HTMLDivElement>) => {
                props.onDragLeave?.(event);
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                    setPreview(null);
                }
            },
            onDrop: (event: DragEvent<HTMLDivElement>) => {
                props.onDrop?.(event);
                if (event.defaultPrevented) {
                    stopDrag();
                    return;
                }
                const drop = locateDrop(event);
                if (drop) {
                    event.preventDefault();
                    event.stopPropagation();
                    const command = commandFor(drop.target);
                    if (command) {
                        serial.current++;
                        dispatch(command);
                    } else {
                        onExternalDrop?.(drop.target, event);
                    }
                }
                stopDrag();
            },
            children: (
                <>
                    {panes.map((pane) => {
                        const rect = visible.get(pane.id);
                        const header = Math.min(barHeight, rect?.height ?? 0);
                        return (
                            <section
                                key={pane.id}
                                data-split-pane={pane.id}
                                data-focused={value.focused === pane.id || undefined}
                                className="ade-split-pane"
                                aria-label={t('workspace.pane')}
                                tabIndex={-1}
                                hidden={!rect}
                                inert={!rect}
                                style={rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: radius(rect) } : undefined}
                                onFocusCapture={() => dispatch({ type: 'focus', paneId: pane.id })}
                                onPointerDown={() => dispatch({ type: 'focus', paneId: pane.id })}
                            >
                                {header > 0 && (
                                    <div className="ade-split-header" data-split-header={pane.id} style={{ height: header }}>
                                        {renderPaneHeader ? (
                                            renderPaneHeader(pane)
                                        ) : (
                                            <>
                                                <TabStrip
                                                    items={pane.views.map((viewId) => {
                                                        const metadata = getTab?.(viewId);
                                                        return {
                                                            ...metadata,
                                                            id: viewId,
                                                            label: metadata?.label ?? viewId,
                                                            tabId: id('tab', viewId),
                                                            panelId: id('view', viewId)
                                                        };
                                                    })}
                                                    value={pane.active}
                                                    focused={value.focused === pane.id}
                                                    onValueChange={(viewId) => dispatch({ type: 'activate', paneId: pane.id, viewId })}
                                                    onClose={onClose ?? ((viewId) => dispatch({ type: 'close', viewId }))}
                                                    onDoubleClick={onTabDoubleClick}
                                                    onContextMenu={onTabContextMenu}
                                                    onDragStart={(viewId, event) => startDrag(pane, event, viewId)}
                                                    onDragEnd={stopDrag}
                                                />
                                                <IconButton
                                                    icon={GripVertical}
                                                    size="sm"
                                                    label={t('workspace.movePane')}
                                                    draggable
                                                    onDragStart={(event) => startDrag(pane, event)}
                                                    onDragEnd={stopDrag}
                                                />
                                                <IconButton
                                                    icon={value.maximized === pane.id ? Minimize2 : Maximize2}
                                                    size="sm"
                                                    label={t(value.maximized === pane.id ? 'workspace.restore' : 'workspace.maximize')}
                                                    onClick={() => dispatch({ type: 'maximize', paneId: value.maximized === pane.id ? null : pane.id })}
                                                />
                                            </>
                                        )}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                    {views.map(({ pane, viewId }) => {
                        const rect = visible.get(pane.id);
                        const active = !!rect && pane.active === viewId;
                        const header = Math.min(barHeight, rect?.height ?? 0);
                        const position: CSSProperties = rect
                            ? {
                                  left: rect.x,
                                  top: rect.y + header,
                                  width: rect.width,
                                  height: Math.max(0, rect.height - header),
                                  borderRadius: bodyRadius(rect, header)
                              }
                            : {};
                        return (
                            <div
                                key={viewId}
                                id={id('view', viewId)}
                                role="tabpanel"
                                aria-labelledby={showTabs && !renderPaneHeader ? id('tab', viewId) : undefined}
                                aria-label={!showTabs || renderPaneHeader ? (getTab?.(viewId).label ?? viewId) : undefined}
                                className="ade-split-content"
                                data-split-view-id={viewId}
                                hidden={!active}
                                inert={!active}
                                tabIndex={0}
                                style={position}
                                onFocusCapture={() => dispatch({ type: 'focus', paneId: pane.id })}
                                onPointerDown={() => dispatch({ type: 'focus', paneId: pane.id })}
                            >
                                {renderView(viewId, { paneId: pane.id, active })}
                            </div>
                        );
                    })}
                    {geometry.dividers.map((divider) => (
                        <Divider
                            key={`${divider.splitId}:${divider.index}`}
                            divider={divider}
                            minimumResizeShare={minimumResizeShare}
                            onResize={(sizes) => dispatch({ type: 'resize', splitId: divider.splitId, sizes })}
                            onEqualize={(all) =>
                                dispatch(
                                    all
                                        ? {
                                              type: 'equalizeAxis',
                                              axis: divider.axis,
                                              length: divider.axis === 'horizontal' ? measurement.width : measurement.height,
                                              gap
                                          }
                                        : { type: 'equalize', splitId: divider.splitId, index: divider.index }
                                )
                            }
                        />
                    ))}
                    {preview && (
                        <svg className="ade-split-preview" width="100%" height="100%" aria-hidden="true">
                            <path style={{ d: `path("${dropPreviewPath(preview)}")` }} />
                        </svg>
                    )}
                </>
            )
        }
    });
}
