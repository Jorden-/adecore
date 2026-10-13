import { createContext, useContext, type ComponentProps, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { useRender } from '@base-ui/react/use-render';
import { withClass } from '../class-name.ts';
import { Icon } from '../Icon.tsx';
import { Tooltip } from '../Tooltip.tsx';
import { splitPlacement, type PlacementKey } from '../placement.ts';
import { renderPositioner } from '../popup-layer.ts';

/* Where a popup opens from decides where it goes when a call site says nothing. */
type MenuKind = 'menu' | 'context' | 'submenu';

const MenuKindContext = createContext<MenuKind>('menu');

type PositionerProps = ComponentProps<typeof BaseMenu.Positioner>;

type Placement = Pick<PositionerProps, PlacementKey>;

/*
 * A menu hangs under its trigger, lined up with its start, unless there is no room. A context menu
 * opens at the pointer, which its positioner already knows. A submenu sits beside its row, pulled
 * up by the popup's own padding so its first row lines up with the row that opened it.
 */
const PLACEMENT: Record<MenuKind, Placement> = {
    menu: { side: 'bottom', align: 'start', sideOffset: 6 },
    context: {},
    submenu: { sideOffset: 4, alignOffset: -4 }
};

/* The label above a group of rows. It takes the line height of the row it sits in. */
export const MENU_LABEL = 'px-2.5 pt-1.5 pb-0.5 text-xs/[inherit] text-text-faint';

/* A trailing hint in a row: what the item does to something else, never a shortcut. A shortcut stays a `Kbd`, which `.menu-item` already pushes to the right. */
const MENU_HINT = 'ml-auto pl-3 text-xs/[inherit] text-text-faint';

/* The hairline between two groups of rows. It runs the whole width of the popup, which is what the
   negative margin buys back from its 4px of padding, and it is softer than a border a surface ends with. */
const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-border-soft';

export function MenuRoot(props: ComponentProps<typeof BaseMenu.Root>) {
    return (
        <MenuKindContext value="menu">
            <BaseMenu.Root {...props} />
        </MenuKindContext>
    );
}

export function ContextMenuRoot(props: ComponentProps<typeof BaseContextMenu.Root>) {
    return (
        <MenuKindContext value="context">
            <BaseContextMenu.Root {...props} />
        </MenuKindContext>
    );
}

export function MenuSubmenuRoot(props: ComponentProps<typeof BaseMenu.SubmenuRoot>) {
    return (
        <MenuKindContext value="submenu">
            <BaseMenu.SubmenuRoot {...props} />
        </MenuKindContext>
    );
}

export const MenuTrigger = BaseMenu.Trigger;

export const ContextMenuTrigger = BaseContextMenu.Trigger;

export type MenuPopupProps = ComponentProps<typeof BaseMenu.Popup> & Placement;

/*
 * The shell every menu is drawn in: the portal, the layer it sits on and the gap to its trigger are
 * decided once. The popup scrolls inside the room the window leaves it; `className` adds a minimum
 * width or a layout of its own, such as a grid of swatches.
 */
export function MenuPopup({ className, ...props }: MenuPopupProps) {
    const defaults = PLACEMENT[useContext(MenuKindContext)];
    const [placement, popupProps] = splitPlacement(props);
    return (
        <BaseMenu.Portal>
            <BaseMenu.Positioner
                className="popup-positioner"
                render={renderPositioner}
                {...placement}
                side={placement.side ?? defaults.side}
                align={placement.align ?? defaults.align}
                sideOffset={placement.sideOffset ?? defaults.sideOffset}
                alignOffset={placement.alignOffset ?? defaults.alignOffset}
            >
                <BaseMenu.Popup className={withClass('menu-popup', className)} {...popupProps} />
            </BaseMenu.Positioner>
        </BaseMenu.Portal>
    );
}

type ItemLook = {
    /*
     * Leaves the row out: no padding, highlight or indicator, only what makes it an item (the arrow
     * keys, typeahead, closing the menu). For an icon button, a swatch, a link or a segment inside a
     * menu, which draws itself and its own highlight.
     */
    unstyled?: boolean;
};

type MenuItemProps = ComponentProps<typeof BaseMenu.Item> & ItemLook;

export function MenuItem({ unstyled = false, className, ...props }: MenuItemProps) {
    return <BaseMenu.Item className={unstyled ? className : withClass('menu-item', className)} {...props} />;
}

export interface MenuCheckProps {
    /* One of several is a bare tick; on or off is a tick in an outlined box, which says the row can be off. */
    kind: 'radio' | 'checkbox';
    /* Only for a row that is not a radio or checkbox item, and so has no indicator of its own. */
    checked?: boolean;
    className?: string;
    ref?: Ref<HTMLSpanElement>;
}

/*
 * The slot before the label of a row that can be checked, in a menu or a list that reads as one. It
 * is one line of the row tall, so a row with a second line keeps the tick beside its first. Radio and
 * checkbox items draw it themselves; a plain row that shows a state hands it `checked`.
 */
export function MenuCheck({ kind, checked, className, ref }: MenuCheckProps) {
    const tick = <Icon icon={Check} size={kind === 'radio' ? 14 : 12} />;
    const indicator =
        checked !== undefined ? (
            checked && tick
        ) : kind === 'radio' ? (
            <BaseMenu.RadioItemIndicator className="flex">{tick}</BaseMenu.RadioItemIndicator>
        ) : (
            <BaseMenu.CheckboxItemIndicator className="flex">{tick}</BaseMenu.CheckboxItemIndicator>
        );
    return (
        <span ref={ref} className={clsx('grid h-lh w-4 shrink-0 place-items-center', className)}>
            {kind === 'checkbox' ? <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">{indicator}</span> : indicator}
        </span>
    );
}

type Indicator = {
    /* Where the tick or the box sits: before the label, or at the end of the row, for an option that reads as a label with its control after it. */
    indicator?: 'start' | 'end';
};

type MenuCheckboxItemProps = ComponentProps<typeof BaseMenu.CheckboxItem> & ItemLook & Indicator & { children?: ReactNode };

/* A row that is on or off. The box before its label is part of it. */
export function MenuCheckboxItem({ unstyled = false, indicator = 'start', className, children, ...props }: MenuCheckboxItemProps) {
    if (unstyled) {
        return (
            <BaseMenu.CheckboxItem className={className} {...props}>
                {children}
            </BaseMenu.CheckboxItem>
        );
    }
    return (
        <BaseMenu.CheckboxItem className={withClass('menu-item', className)} {...props}>
            {indicator === 'start' && <MenuCheck kind="checkbox" />}
            {children}
            {indicator === 'end' && <MenuCheck kind="checkbox" className="ml-auto" />}
        </BaseMenu.CheckboxItem>
    );
}

export const MenuRadioGroup = BaseMenu.RadioGroup;

type MenuRadioItemProps = ComponentProps<typeof BaseMenu.RadioItem> & ItemLook & Indicator & { children?: ReactNode };

/* One of several. The tick before its label is part of it. */
export function MenuRadioItem({ unstyled = false, indicator = 'start', className, children, ...props }: MenuRadioItemProps) {
    if (unstyled) {
        return (
            <BaseMenu.RadioItem className={className} {...props}>
                {children}
            </BaseMenu.RadioItem>
        );
    }
    return (
        <BaseMenu.RadioItem className={withClass('menu-item', className)} {...props}>
            {indicator === 'start' && <MenuCheck kind="radio" />}
            {children}
            {indicator === 'end' && <MenuCheck kind="radio" className="ml-auto" />}
        </BaseMenu.RadioItem>
    );
}

type SubmenuTriggerProps = ComponentProps<typeof BaseMenu.SubmenuTrigger> & {
    children?: ReactNode;
    /* The chevron at the end of the row that says it opens more. Off for a row that carries a hint there instead. */
    chevron?: boolean;
};

export function MenuSubmenuTrigger({ className, children, chevron = true, ...props }: SubmenuTriggerProps) {
    return (
        <BaseMenu.SubmenuTrigger className={withClass('menu-item', className)} {...props}>
            {children}
            {chevron && <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />}
        </BaseMenu.SubmenuTrigger>
    );
}

export type MenuRowProps = useRender.ComponentProps<'div'>;

/*
 * A row with buttons at its end that reads as one row. Its first item is the row, every `RowAction`
 * and `RowSubmenuTrigger` after it an item of its own, so the arrow keys reach each.
 */
export function MenuRow({ render, className, ref, ...props }: MenuRowProps) {
    return useRender({ render, ref, defaultTagName: 'div', props: { role: 'group', ...props, className: clsx('menu-row', className) } });
}

type RowButton = {
    icon: LucideIcon;
    /* The button's accessible name. Unlike the `label` of an item, typing never lands on the button. */
    label: string;
    /* Classes for the icon rather than the button, such as a fill. The size stays the row's. */
    iconClassName?: string;
};

export type MenuRowActionProps = Omit<ComponentProps<typeof BaseMenu.Item>, 'children' | 'label'> & RowButton;

/* A button in a `Menu.Row` that acts at once, named by its tooltip. `closeOnClick={false}` keeps the menu open. */
export function MenuRowAction({ icon, label, iconClassName, className, ...props }: MenuRowActionProps) {
    return (
        <Tooltip label={label} name>
            <BaseMenu.Item className={withClass('menu-item menu-row-action', className)} {...props}>
                <Icon icon={icon} size={14} className={iconClassName} />
            </BaseMenu.Item>
        </Tooltip>
    );
}

export type MenuRowSubmenuTriggerProps = Omit<ComponentProps<typeof BaseMenu.SubmenuTrigger>, 'children' | 'label'> & RowButton;

/*
 * A button in a `Menu.Row` that opens a submenu, inside a `Menu.SubmenuRoot`. It has no tooltip: the
 * submenu opens on the same hover and says what the button holds.
 */
export function MenuRowSubmenuTrigger({ icon, label, iconClassName, className, ...props }: MenuRowSubmenuTriggerProps) {
    return (
        <BaseMenu.SubmenuTrigger className={withClass('menu-item menu-row-action', className)} aria-label={label} {...props}>
            <Icon icon={icon} size={14} className={iconClassName} />
        </BaseMenu.SubmenuTrigger>
    );
}

/* Also right between two groups of rows in a popover that reads as a menu. */
export function MenuSeparator({ className, ...props }: ComponentProps<typeof BaseSeparator>) {
    return <BaseSeparator className={withClass(MENU_SEPARATOR, className)} {...props} />;
}

export const MenuGroup = BaseMenu.Group;

type MenuGroupLabelProps = ComponentProps<typeof BaseMenu.GroupLabel> & {
    /* Leaves the label's type and padding out, for a group that lays out its own heading. */
    unstyled?: boolean;
};

export function MenuGroupLabel({ unstyled = false, className, ...props }: MenuGroupLabelProps) {
    return <BaseMenu.GroupLabel className={unstyled ? className : withClass(MENU_LABEL, className)} {...props} />;
}

export type MenuLabelProps = useRender.ComponentProps<'div'>;

/* A label above rows that are not a `Menu.Group` of their own, such as a row of swatches. */
export function MenuLabel({ render, className, ref, ...props }: MenuLabelProps) {
    return useRender({ render, ref, defaultTagName: 'div', props: { ...props, className: clsx(MENU_LABEL, className) } });
}

export type MenuHintProps = useRender.ComponentProps<'span'>;

export function MenuHint({ render, className, ref, ...props }: MenuHintProps) {
    return useRender({ render, ref, defaultTagName: 'span', props: { ...props, className: clsx(MENU_HINT, className) } });
}
