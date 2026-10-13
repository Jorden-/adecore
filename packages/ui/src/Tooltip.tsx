import { useCallback, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { Kbd } from './Kbd.tsx';
import type { Shortcut } from './shortcut.ts';
import { registerShortcutHint } from './shortcut-hints.ts';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

/* One provider per app. Tooltips share a delay, so moving along a row of buttons feels instant. `UIProvider` mounts it. */
export function TooltipProvider({ children }: { children: ReactNode }) {
    return (
        <BaseTooltip.Provider delay={150} closeDelay={0}>
            {children}
        </BaseTooltip.Provider>
    );
}

export interface TooltipProps {
    label: ReactNode;
    open?: boolean;
    onOpenChange?(open: boolean): void;
    /* A virtual anchor positions a controlled hint over canvas content without adding an input target. */
    anchor?: ComponentProps<typeof BaseTooltip.Positioner>['anchor'];
    /* A shortcut, or a short phrase about a key that is not one ("Shift skips the cache"). */
    kbd?: Shortcut | string;
    side?: TooltipSide;
    sideOffset?: number;
    /* Makes the label the accessible name of the trigger as well: what an icon-only button needs,
       and the way to keep the name and the tooltip from ever saying two different things. */
    name?: boolean;
    /* Keeps the hint closed, for a trigger that only needs one some of the time. */
    disabled?: boolean;
    /* The trigger element. Its own children and handlers are kept; Base UI merges the tooltip props in. */
    children?: ReactElement<Record<string, unknown>>;
}

/* A hint on hover and on keyboard focus. Every hint in an app is one of these, never a `title`. */
export function Tooltip({ label, open, onOpenChange, anchor, kbd, side = 'top', sideOffset = 6, name = false, disabled = false, children }: TooltipProps) {
    // Held Cmd (Ctrl off macOS) prints this shortcut under the trigger (`ShortcutHints`).
    const hintRef = useCallback(
        (element: HTMLElement | null) => {
            if (element === null || kbd === undefined || typeof kbd === 'string') {
                return undefined;
            }
            return registerShortcutHint(element, kbd);
        },
        [kbd]
    );

    return (
        <BaseTooltip.Root disabled={disabled} open={open} onOpenChange={onOpenChange} disableHoverablePopup={children === undefined}>
            {children && <BaseTooltip.Trigger ref={hintRef} render={children} aria-label={name && typeof label === 'string' ? label : undefined} />}
            <BaseTooltip.Portal>
                <BaseTooltip.Positioner anchor={anchor} side={side} sideOffset={sideOffset} className="tooltip-positioner">
                    <BaseTooltip.Popup role="tooltip" className="tooltip-popup">
                        <BaseTooltip.Viewport className="max-w-72 px-[9px] py-[5px] text-pretty">
                            <span className="wrap-anywhere">{label}</span>
                            {/* The viewport wraps its children in a div of its own, so the 8px
                                between the label and the shortcut has to sit on the shortcut itself. */}
                            {kbd !== undefined &&
                                (typeof kbd === 'string' ? (
                                    <Kbd variant="inline" className="ml-2">
                                        {kbd}
                                    </Kbd>
                                ) : (
                                    <Kbd shortcut={kbd} variant="inline" className="ml-2" />
                                ))}
                        </BaseTooltip.Viewport>
                    </BaseTooltip.Popup>
                </BaseTooltip.Positioner>
            </BaseTooltip.Portal>
        </BaseTooltip.Root>
    );
}
