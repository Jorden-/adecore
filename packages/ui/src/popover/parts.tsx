import type { ComponentProps } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card';
import { withClass } from '../class-name.ts';
import { splitPlacement, type PlacementKey } from '../placement.ts';
import { renderPositioner } from '../popup-layer.ts';

/*
 * The surface a popup is drawn on. `menu` is the padded card menus use, `picker` a card whose
 * content runs to its edges (a search field on top of a list), and `plain` leaves the surface to the caller.
 */
const POPUP_VARIANT = {
    menu: 'menu-popup',
    picker: 'picker-popup',
    plain: ''
} as const;

export type PopupVariant = keyof typeof POPUP_VARIANT;

type Placement = Pick<ComponentProps<typeof BasePopover.Positioner>, PlacementKey>;

export const PopoverRoot = BasePopover.Root;

export const PopoverTrigger = BasePopover.Trigger;

export const PopoverClose = BasePopover.Close;

export const PopoverTitle = BasePopover.Title;

export const PopoverDescription = BasePopover.Description;

export type PopoverPopupProps = ComponentProps<typeof BasePopover.Popup> &
    Placement & {
        variant?: PopupVariant;
    };

/* The portal, the positioner and the popup of a popover: under its trigger and lined up with its start unless it says otherwise. */
export function PopoverPopup({ variant = 'menu', side = 'bottom', align = 'start', sideOffset = 8, className, ...props }: PopoverPopupProps) {
    const [placement, popupProps] = splitPlacement(props);
    return (
        <BasePopover.Portal>
            <BasePopover.Positioner className="popup-positioner" render={renderPositioner} {...placement} side={side} align={align} sideOffset={sideOffset}>
                <BasePopover.Popup className={withClass(POPUP_VARIANT[variant], className)} {...popupProps} />
            </BasePopover.Positioner>
        </BasePopover.Portal>
    );
}

export const PreviewCardRoot = BasePreviewCard.Root;

export const PreviewCardTrigger = BasePreviewCard.Trigger;

export type PreviewCardPopupProps = ComponentProps<typeof BasePreviewCard.Popup> &
    Placement & {
        variant?: PopupVariant;
    };

/* A card that opens while the pointer rests on its trigger, drawn like a popover. */
export function PreviewCardPopup({ variant = 'menu', side = 'bottom', align = 'start', sideOffset = 8, className, ...props }: PreviewCardPopupProps) {
    const [placement, popupProps] = splitPlacement(props);
    return (
        <BasePreviewCard.Portal>
            <BasePreviewCard.Positioner className="z-(--z-popup)" {...placement} side={side} align={align} sideOffset={sideOffset}>
                <BasePreviewCard.Popup className={withClass(POPUP_VARIANT[variant], className)} {...popupProps} />
            </BasePreviewCard.Positioner>
        </BasePreviewCard.Portal>
    );
}
