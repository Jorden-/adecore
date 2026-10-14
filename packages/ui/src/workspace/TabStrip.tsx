import {
    createContext,
    useContext,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type DragEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactNode,
    type UIEvent,
    type WheelEvent
} from 'react';
import { useRender } from '@base-ui/react/use-render';
import { Pin, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon.tsx';
import { IconButton, type IconButtonProps } from '../IconButton.tsx';
import { Tooltip } from '../Tooltip.tsx';
import { tabGapAt, tabRevealScrollLeft } from './geometry.ts';

/* Where an arrow, Home or End moves the selection from `index`, wrapping at either end; null for any other key. */
function tabIndexForKey(key: string, index: number, count: number): number | null {
    switch (key) {
        case 'ArrowRight':
            return (index + 1) % count;
        case 'ArrowLeft':
            return (index + count - 1) % count;
        case 'Home':
            return 0;
        case 'End':
            return count - 1;
        default:
            return null;
    }
}

export interface TabStripItem {
    id: string;
    label: string;
    hint?: string;
    icon?: ReactNode;
    detail?: ReactNode;
    attention?: ReactNode;
    unsaved?: boolean | string;
    pinned?: boolean;
    closable?: boolean;
    tabId?: string;
    panelId?: string;
}

export interface TabStripProps extends Omit<useRender.ComponentProps<'div'>, 'children' | 'onDragStart' | 'onDragEnd' | 'onDoubleClick' | 'onContextMenu'> {
    items: readonly TabStripItem[];
    value: string | null;
    onValueChange(value: string): void;
    renderTab?(item: TabStripItem): ReactNode;
    focused?: boolean;
    insertAt?: number | null;
    onClose?(id: string): void;
    onDoubleClick?(id: string, event: MouseEvent<HTMLButtonElement>): void;
    onContextMenu?(id: string, event: MouseEvent<HTMLSpanElement>): void;
    onDragStart?(id: string, event: DragEvent<HTMLButtonElement>): void;
    onDragEnd?(event: DragEvent<HTMLButtonElement>): void;
    onTabDragOver?(index: number, event: DragEvent<HTMLDivElement>): void;
    onTabDrop?(index: number, event: DragEvent<HTMLDivElement>): void;
}

export function TabStrip({
    items,
    value,
    onValueChange,
    renderTab,
    focused = true,
    insertAt,
    onClose,
    onDoubleClick,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onTabDragOver,
    onTabDrop,
    render,
    className,
    ref,
    ...props
}: TabStripProps) {
    const { t } = useTranslation('ui');
    const strip = useRef<HTMLDivElement>(null);
    const closingFocus = useRef<string | null>(null);
    useLayoutEffect(() => {
        if (closingFocus.current && !items.some((item) => item.id === closingFocus.current)) {
            closingFocus.current = null;
            const target = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? strip.current?.querySelector<HTMLElement>('[role="tab"]');
            target?.focus({ preventScroll: true });
        }
    });
    const close = (id: string, action?: () => void): void => {
        if (strip.current?.contains(strip.current.ownerDocument.activeElement)) {
            closingFocus.current = id;
        }
        if (action) {
            action();
        } else {
            onClose?.(id);
        }
    };
    const [edges, setEdges] = useState({ start: false, end: false });
    const [insertion, setInsertion] = useState(0);
    const measure = useCallback((): void => {
        const element = strip.current;
        if (!element) {
            return;
        }
        const start = element.scrollLeft > 0;
        const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
        setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
        if (insertAt !== undefined && insertAt !== null) {
            const tabs = Array.from(element.querySelectorAll<HTMLElement>('[data-document-tab]'));
            const after = tabs[insertAt];
            const last = tabs.at(-1);
            setInsertion(after?.offsetLeft ?? (last ? last.offsetLeft + last.offsetWidth : 0));
        }
    }, [insertAt]);
    // Stays set after the active tab changes, as its width can settle frames later; a person's own scroll ends it.
    const revealing = useRef(false);
    const reveal = (): void => {
        const element = strip.current;
        const selected = element?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (!revealing.current || !element || !selected) {
            return;
        }
        const container = selected.closest<HTMLElement>('[data-document-tab]');
        const tab = container && element.contains(container) ? container : selected;
        const fade = parseFloat(getComputedStyle(element).getPropertyValue('--fade-size')) || 0;
        const bounds = element.getBoundingClientRect();
        const rect = tab.getBoundingClientRect();
        const left = tabRevealScrollLeft(element, rect.left - bounds.left - element.clientLeft + element.scrollLeft, rect.width, fade);
        if (left !== element.scrollLeft) {
            element.scrollLeft = left;
        }
    };
    useLayoutEffect(() => {
        revealing.current = true;
    }, [value]);
    useLayoutEffect(() => {
        reveal();
        measure();
    });
    useEffect(() => {
        const element = strip.current;
        if (!element || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => {
            reveal();
            measure();
        });
        observer.observe(element);
        element.querySelectorAll('[data-document-tab]').forEach((tab) => observer.observe(tab));
        return () => observer.disconnect();
    });
    const gap = (event: DragEvent<HTMLDivElement>): number => {
        const rects = Array.from(event.currentTarget.querySelectorAll('[data-document-tab]'), (tab) => tab.getBoundingClientRect());
        return tabGapAt(rects, event.clientX);
    };
    const context: TabContextValue = {
        items,
        value,
        onValueChange,
        onClose,
        onDoubleClick,
        onContextMenu,
        onDragStart,
        onDragEnd,
        close,
        focus: (index) => strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
    };
    return useRender({
        render,
        ref: [strip, ref ?? null],
        defaultTagName: 'div',
        props: {
            ...props,
            role: 'tablist',
            'aria-label': props['aria-label'] ?? t('workspace.tabs'),
            className: clsx('ade-tab-strip scroll-fade-x', className),
            'data-focused': focused || undefined,
            'data-fade-start': edges.start || undefined,
            'data-fade-end': edges.end || undefined,
            onScroll: (event: UIEvent<HTMLDivElement>) => {
                props.onScroll?.(event);
                measure();
            },
            onWheel: (event: WheelEvent<HTMLDivElement>) => {
                props.onWheel?.(event);
                if (event.defaultPrevented) {
                    return;
                }
                revealing.current = false;
                if (!event.deltaX && event.deltaY) {
                    event.currentTarget.scrollLeft += event.deltaY;
                }
            },
            onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
                props.onPointerDown?.(event);
                // A press on the strip itself grabs its scrollbar, and a touch may pan it.
                if (event.target === event.currentTarget || event.pointerType === 'touch') {
                    revealing.current = false;
                }
            },
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
                props.onDragOver?.(event);
                if (!event.defaultPrevented) {
                    onTabDragOver?.(gap(event), event);
                }
            },
            onDrop: (event: DragEvent<HTMLDivElement>) => {
                props.onDrop?.(event);
                if (!event.defaultPrevented) {
                    onTabDrop?.(gap(event), event);
                }
            },
            children: (
                <>
                    {items.map((item) => (
                        <TabContext.Provider key={item.id} value={context}>
                            {renderTab ? renderTab(item) : <DocumentTab item={item} />}
                        </TabContext.Provider>
                    ))}
                    {insertAt !== undefined && insertAt !== null && <span aria-hidden="true" className="ade-tab-insertion" style={{ left: insertion }} />}
                </>
            )
        }
    });
}

interface TabContextValue extends Pick<
    TabStripProps,
    'items' | 'value' | 'onValueChange' | 'onClose' | 'onDoubleClick' | 'onContextMenu' | 'onDragStart' | 'onDragEnd'
> {
    close(id: string, action?: () => void): void;
    focus(index: number): void;
}
const TabContext = createContext<TabContextValue | null>(null);

export interface DocumentTabProps extends Omit<useRender.ComponentProps<'span'>, 'children' | 'onDoubleClick' | 'onDragStart' | 'onDragEnd'> {
    item: TabStripItem;
    onClose?(): void;
    closeShortcut?: IconButtonProps['kbd'];
    onDoubleClick?: TabStripProps['onDoubleClick'];
    onDragStart?: TabStripProps['onDragStart'];
    onDragEnd?: TabStripProps['onDragEnd'];
}

/** A tab with application-owned metadata and menus, rendered inside TabStrip's renderTab slot. */
export function DocumentTab({ item, onClose, closeShortcut, onDoubleClick, onDragStart, onDragEnd, className, render, ref, ...props }: DocumentTabProps) {
    const context = useContext(TabContext);
    if (!context) {
        throw new Error('DocumentTab must be rendered inside TabStrip.');
    }
    const { t } = useTranslation('ui');
    const { items, value, onValueChange } = context;
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const close = (): void => context.close(item.id, onClose);
    const closable = item.closable !== false && (onClose ?? context.onClose) !== undefined;
    return useRender({
        render,
        ref,
        defaultTagName: 'span',
        props: {
            ...props,
            className: clsx('ade-document-tab', className),
            'data-document-tab': item.id,
            'data-active': item.id === value || undefined,
            'data-detail': !!item.detail || undefined,
            onContextMenu: (event: MouseEvent<HTMLSpanElement>) => {
                props.onContextMenu?.(event);
                context.onContextMenu?.(item.id, event);
            },
            children: (
                <>
                    <Tooltip label={item.hint ?? item.label}>
                        <button
                            type="button"
                            role="tab"
                            id={item.tabId}
                            aria-controls={item.panelId}
                            aria-selected={item.id === value}
                            tabIndex={item.id === value || (value === null && index === 0) ? 0 : -1}
                            className="ade-document-tab-open"
                            draggable={!!(onDragStart ?? context.onDragStart)}
                            onClick={() => onValueChange(item.id)}
                            onDoubleClick={(event) => (onDoubleClick ?? context.onDoubleClick)?.(item.id, event)}
                            onDragStart={(event) => {
                                event.stopPropagation();
                                (onDragStart ?? context.onDragStart)?.(item.id, event);
                            }}
                            onDragEnd={onDragEnd ?? context.onDragEnd}
                            onKeyDown={(event) => {
                                const next = tabIndexForKey(event.key, index, items.length);
                                if (next !== null) {
                                    event.preventDefault();
                                    onValueChange(items[next]!.id);
                                    context.focus(next);
                                } else if (event.key === 'Delete' && closable) {
                                    event.preventDefault();
                                    close();
                                }
                            }}
                        >
                            {item.icon}
                            <span className="truncate">{item.label}</span>
                            {item.detail}
                            {item.attention}
                            {item.unsaved && (
                                <span className="ade-tab-unsaved">
                                    <span className="sr-only">{typeof item.unsaved === 'string' ? item.unsaved : t('workspace.unsaved')}</span>
                                </span>
                            )}
                        </button>
                    </Tooltip>
                    {item.pinned && <Icon icon={Pin} size={12} className="shrink-0 text-text-muted" />}
                    {closable && (
                        <IconButton
                            icon={X}
                            size="2xs"
                            label={t('workspace.closeTab', { name: item.label })}
                            kbd={closeShortcut}
                            className="ade-document-tab-close"
                            onClick={close}
                        />
                    )}
                </>
            )
        }
    });
}
