import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PANEL_BODY_MIN, PANEL_KEY_STEP, availableHeightOf, clampPanelBody, panelBodyMax } from './panel-size.ts';
import { realTimers, revealRow } from './timers.ts';

interface Props {
    container: HTMLElement;
    height: number;
    onHeight(height: number): void;
    onCommit(height: number): void;
}

/* The bottom edge of a panel: a drag, or the arrow keys, change the height of its body. */
export function PanelResizeHandle({ container, height, onHeight, onCommit }: Props) {
    const { t } = useTranslation('editor');
    const drag = useRef<{ startY: number; startHeight: number; lastY: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const [max, setMax] = useState(() => panelBodyMax(availableHeightOf(container)));

    useEffect(() => {
        const viewport = container.closest<HTMLElement>('.se-viewport');
        const Observer = viewport?.ownerDocument.defaultView?.ResizeObserver;
        if (viewport === null || viewport === undefined || Observer === undefined) {
            return;
        }
        const observer = new Observer(() => setMax(panelBodyMax(availableHeightOf(container))));
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [container]);

    function settle(value: number, from: number): void {
        const next = clampPanelBody(value, availableHeightOf(container));
        onHeight(next);
        if (next !== from) {
            onCommit(next);
            revealRow(realTimers, container);
        }
    }

    function heightAt(clientY: number): number {
        return clampPanelBody(drag.current!.startHeight + clientY - drag.current!.startY, availableHeightOf(container));
    }

    function down(event: PointerEvent<HTMLDivElement>): void {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, startHeight: height, lastY: event.clientY };
        setDragging(true);
    }

    function move(event: PointerEvent<HTMLDivElement>): void {
        if (drag.current !== null) {
            drag.current.lastY = event.clientY;
            onHeight(heightAt(event.clientY));
        }
    }

    // Also the end of a drag whose capture was lost, such as a container that was replaced under the pointer.
    function end(event: PointerEvent<HTMLDivElement>): void {
        if (drag.current === null) {
            return;
        }
        const { startHeight } = drag.current;
        const next = heightAt(drag.current.lastY);
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        settle(next, startHeight);
    }

    function key(event: KeyboardEvent<HTMLDivElement>): void {
        const step = event.shiftKey ? PANEL_KEY_STEP * 4 : PANEL_KEY_STEP;
        const end = panelBodyMax(availableHeightOf(container));
        const target = { ArrowUp: height - step, ArrowDown: height + step, Home: PANEL_BODY_MIN, End: end }[event.key];
        if (target === undefined) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        settle(target, height);
    }

    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('language.panel.resize')}
            aria-valuemin={PANEL_BODY_MIN}
            aria-valuemax={max}
            aria-valuenow={height}
            tabIndex={0}
            data-dragging={dragging}
            className="absolute inset-x-0 bottom-0 z-10 h-1 cursor-row-resize touch-none outline-none hover:bg-accent-soft focus-visible:bg-accent-soft data-[dragging=true]:bg-accent-soft"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onKeyDown={key}
        />
    );
}
