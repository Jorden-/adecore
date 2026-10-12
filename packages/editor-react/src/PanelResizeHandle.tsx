import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
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
    const drag = useRef<{ startY: number; startHeight: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const available = availableHeightOf(container);
    const max = panelBodyMax(available);

    function settle(value: number): void {
        const next = clampPanelBody(value, availableHeightOf(container));
        onHeight(next);
        onCommit(next);
        revealRow(realTimers, container);
    }

    function down(event: PointerEvent<HTMLDivElement>): void {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, startHeight: height };
        setDragging(true);
    }

    function move(event: PointerEvent<HTMLDivElement>): void {
        if (drag.current !== null) {
            onHeight(clampPanelBody(drag.current.startHeight + event.clientY - drag.current.startY, availableHeightOf(container)));
        }
    }

    function up(event: PointerEvent<HTMLDivElement>): void {
        if (drag.current === null) {
            return;
        }
        const next = clampPanelBody(drag.current.startHeight + event.clientY - drag.current.startY, availableHeightOf(container));
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        settle(next);
    }

    function key(event: KeyboardEvent<HTMLDivElement>): void {
        const step = event.shiftKey ? PANEL_KEY_STEP * 4 : PANEL_KEY_STEP;
        const target = { ArrowUp: height - step, ArrowDown: height + step, Home: PANEL_BODY_MIN, End: max }[event.key];
        if (target === undefined) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        settle(target);
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
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key}
        />
    );
}
