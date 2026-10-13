import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRender } from '@base-ui/react/use-render';
import { FileTree as PierreFileTree, type FileTreeProps as PierreProps } from '@pierre/trees/react';
import type { FileTree, FileTreeVisibleRow } from '@pierre/trees';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { mergeRefs } from '../merge-refs.ts';
import { directoryHandle, extendsSelection, followFocus, movesFocus, menuTargetsOf, rowPathOf, visibleRows } from './helpers.ts';
import { useFileTreeShift } from './use-file-tree-shift.tsx';
import { useFileTreeSlots } from './use-slots.ts';

export type FileTreeRootProps = useRender.ComponentProps<'div'> & {
    model: FileTree;
    label?: string;
    resetKey?: string;
    selectionFollowsFocus?: boolean;
    onActivate?(path: string): void;
    onFocusMove?(path: string): void;
    onLoadChildren?(path: string): void;
    onRowContextMenu?(path: string, targets: readonly string[], event: MouseEvent): void;
    onRowDragStart?(path: string, targets: readonly string[], event: DragEvent): void;
    onExpandedPathsChange?(paths: readonly string[]): void;
    renderControl?(row: FileTreeVisibleRow): ReactNode;
    renderDecoration?(row: FileTreeVisibleRow): ReactNode;
    treeProps?: Omit<PierreProps, 'model'>;
};

function inSlot(event: Event): boolean {
    return event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute('data-tree-slot'));
}

export function FileTreeRoot({
    model,
    label,
    resetKey,
    selectionFollowsFocus = true,
    onActivate,
    onFocusMove,
    onLoadChildren,
    onExpandedPathsChange,
    onRowContextMenu,
    onRowDragStart,
    renderControl,
    renderDecoration,
    treeProps,
    render,
    className,
    ref,
    children,
    onClick,
    onKeyDownCapture,
    ...props
}: FileTreeRootProps) {
    const { t } = useTranslation('ui');
    const [frame, setFrame] = useState<HTMLDivElement | null>(null);
    const { attach, bar } = useFileTreeShift(model, resetKey);
    const frameRef = useCallback(
        (node: Element | null) => {
            setFrame(node as HTMLDivElement | null);
            attach(node as HTMLElement | null);
            mergeRefs<Element>(ref)(node);
        },
        [ref, attach]
    );
    const slots = useFileTreeSlots(model, frame, label ?? t('tree.label'));
    const latestLoads = useRef({ onLoadChildren, onExpandedPathsChange });
    useLayoutEffect(() => {
        latestLoads.current = { onLoadChildren, onExpandedPathsChange };
    }, [onLoadChildren, onExpandedPathsChange]);
    const cancelFocus = useRef<(() => void) | undefined>(undefined);

    useEffect(() => () => cancelFocus.current?.(), [model]);

    useEffect(() => {
        let previous = new Set<string>();
        let disposed = false;
        let pending = false;
        const report = (): void => {
            pending = false;
            if (disposed) {
                return;
            }
            const rows = visibleRows(model).filter((row) => row.kind === 'directory');
            const known = new Set(rows.map((row) => row.path));
            const expanded = new Set([...previous].filter((path) => !known.has(path)));
            for (const row of rows) {
                if (row.isExpanded) {
                    expanded.add(row.path);
                }
            }
            const opened = [...expanded].filter((path) => !previous.has(path));
            const changed = opened.length > 0 || [...previous].some((path) => !expanded.has(path));
            previous = expanded;
            if (changed) {
                latestLoads.current.onExpandedPathsChange?.([...expanded]);
            }
            for (const path of opened) {
                latestLoads.current.onLoadChildren?.(path);
            }
        };
        const schedule = (): void => {
            if (!pending) {
                pending = true;
                queueMicrotask(report);
            }
        };
        const unsubscribe = model.subscribe(schedule);
        report();
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [model]);

    useEffect(() => {
        if (frame === null) {
            return;
        }
        const onClickRow = (event: MouseEvent): void => {
            if (event.defaultPrevented || inSlot(event) || extendsSelection(event)) {
                return;
            }
            const path = rowPathOf({ nativeEvent: event });
            if (path !== null && directoryHandle(model, path) === null) {
                onActivate?.(path);
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.defaultPrevented || inSlot(event)) {
                return;
            }
            if (movesFocus(event) && selectionFollowsFocus) {
                cancelFocus.current?.();
                // beta.6 stops the key in its own handler; selection must follow after that handler moves focus.
                cancelFocus.current = followFocus(model, onFocusMove);
            } else if (event.key === 'Enter' && !event.altKey && !event.metaKey && !event.ctrlKey) {
                const path = model.getFocusedPath();
                if (path === null) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const directory = directoryHandle(model, path);
                if (directory) {
                    directory.toggle();
                } else {
                    onActivate?.(path);
                }
            }
        };
        const withTargets =
            <RowEvent extends Event>(handle?: (path: string, targets: readonly string[], event: RowEvent) => void) =>
            (event: RowEvent): void => {
                if (inSlot(event)) {
                    return;
                }
                const path = rowPathOf({ nativeEvent: event });
                if (path !== null) {
                    handle?.(path, menuTargetsOf(path, model.getSelectedPaths()), event);
                }
            };
        const onContext = withTargets(onRowContextMenu);
        const onDrag = withTargets(onRowDragStart);
        frame.addEventListener('click', onClickRow);
        frame.addEventListener('keydown', onKey, true);
        frame.addEventListener('contextmenu', onContext);
        frame.addEventListener('dragstart', onDrag);
        return () => {
            frame.removeEventListener('click', onClickRow);
            frame.removeEventListener('keydown', onKey, true);
            frame.removeEventListener('contextmenu', onContext);
            frame.removeEventListener('dragstart', onDrag);
        };
    }, [frame, model, selectionFollowsFocus, onActivate, onFocusMove, onRowContextMenu, onRowDragStart]);

    return useRender({
        render,
        ref: frameRef,
        defaultTagName: 'div',
        props: {
            ...props,
            className: clsx('adecore-tree adecore-file-tree', className),
            onClick,
            onKeyDownCapture,
            children: (
                <>
                    <PierreFileTree {...treeProps} model={model} className={clsx('adecore-file-tree-host', treeProps?.className)} />
                    {slots.map(({ row, control, decoration }) => (
                        <span key={control.slot} style={{ display: 'contents' }}>
                            {createPortal(renderControl?.(row), control)}
                            {createPortal(renderDecoration?.(row), decoration)}
                        </span>
                    ))}
                    {children}
                    {bar}
                </>
            )
        }
    });
}
