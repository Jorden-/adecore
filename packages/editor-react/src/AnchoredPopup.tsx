import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorRect } from '@adecore/editor';
import { placePopup, type PlaceOptions } from './popup-placement.ts';

export interface AnchoredPopupProps {
    /* The character the popup belongs to, in the page's pixels. */
    rect: EditorRect;
    className?: string;
    /* What the card does with content past its room: `scroll` it, or `clip` it for content that scrolls on its own. `scroll` without one. */
    overflow?: 'scroll' | 'clip';
    children: ReactNode;
    placement?: PlaceOptions;
    onPointerEnter?(): void;
    onPointerLeave?(): void;
}

/*
 * A card next to a character of the editor, portaled to the page: inside a scaled canvas node it would be
 * drawn at that scale and clipped by the node. Placed from the character's screen rectangle, so it holds at any zoom.
 */
export function AnchoredPopup({ rect, className, overflow = 'scroll', children, placement, onPointerEnter, onPointerLeave }: AnchoredPopupProps) {
    const element = useRef<HTMLDivElement>(null);

    // Every render, since the character moves when the editor scrolls and the card's own size follows its content.
    useLayoutEffect(() => {
        const popup = element.current;
        if (popup === null) {
            return;
        }
        popup.style.maxHeight = '';
        const size = { width: popup.offsetWidth, height: popup.offsetHeight };
        const placed = placePopup(rect, size, { width: window.innerWidth, height: window.innerHeight }, placement);
        popup.style.left = `${Math.round(placed.left)}px`;
        popup.style.top = `${Math.round(placed.top)}px`;
        popup.style.maxHeight = `${Math.floor(placed.maxHeight)}px`;
        popup.style.visibility = 'visible';
    });

    return createPortal(
        <div
            ref={element}
            className={`fixed top-0 left-0 z-(--z-popup) ${overflow === 'clip' ? 'overflow-hidden' : 'overflow-y-auto'} rounded-lg border border-border bg-surface-raised text-text shadow-(--float-shadow) ${className ?? ''}`}
            style={{ visibility: 'hidden' }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
        >
            {children}
        </div>,
        document.body
    );
}
