import type { ComponentProps, ReactElement, ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { useRender } from '@base-ui/react/use-render';
import { Icon } from './Icon.tsx';
import type { Shortcut } from './shortcut.ts';
import { Spinner } from './Spinner.tsx';
import { Tooltip, type TooltipSide } from './Tooltip.tsx';
import { ICON_BUTTON_CLASS, ICON_BUTTON_ICON_SIZE, type IconButtonSize } from './icon-button-size.ts';

export type { IconButtonSize };

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
    /* Left out for a button that draws something other than one Lucide glyph, handed in as children. */
    icon?: LucideIcon;
    /* The accessible name, and the tooltip unless `tooltip` says otherwise. */
    label: string;
    /* A tooltip that says more than the name (a reason it is disabled), or `false` for none at all. */
    tooltip?: ReactNode | false;
    kbd?: Shortcut | string;
    tooltipSide?: TooltipSide;
    size?: IconButtonSize;
    /* A toggle that is on, drawn as a pressed key. Use `aria-pressed` instead where the button is a real toggle. */
    active?: boolean;
    /* A `Spinner` in place of the icon, for a step that is running. */
    busy?: boolean;
    /** @deprecated Turns the icon; use `busy`, which draws a `Spinner` in its place. */
    spin?: boolean;
    /* Classes for the icon rather than the button: a tone of its own, a turn, a fill. The size stays the button's. */
    iconClassName?: string;
    /* Drawn after the icon: a count, or a word beside it together with `w-auto`. */
    children?: ReactNode;
    /* Another element to be the button, such as a menu trigger: `render={<Menu.Trigger />}`. */
    render?: useRender.RenderProp;
}

/* Every button that is an icon and no word. A square, and the one place the icon inside it is sized. */
export function IconButton({
    icon,
    label,
    tooltip,
    kbd,
    tooltipSide,
    size = 'md',
    active = false,
    busy = false,
    spin = false,
    iconClassName,
    render,
    className,
    ref,
    children,
    ...props
}: IconButtonProps) {
    const button = useRender({
        render: render ?? <button type="button" />,
        ref,
        props: {
            'aria-label': label,
            'data-active': active ? 'true' : undefined,
            ...props,
            className: clsx('icon-btn', ICON_BUTTON_CLASS[size], className),
            children: (
                <>
                    {busy ? (
                        <Spinner size={ICON_BUTTON_ICON_SIZE[size]} className={iconClassName} />
                    ) : (
                        icon !== undefined && <Icon icon={icon} size={ICON_BUTTON_ICON_SIZE[size]} className={clsx(spin && 'animate-spin', iconClassName)} />
                    )}
                    {children}
                </>
            )
        }
    });
    if (tooltip === false) {
        return button;
    }
    return (
        <Tooltip label={tooltip ?? label} kbd={kbd} side={tooltipSide}>
            {button as ReactElement<Record<string, unknown>>}
        </Tooltip>
    );
}
