import type { ComponentProps } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useRender } from '@base-ui/react/use-render';
import { Icon } from './Icon.tsx';

/* `focus-ring` for the swatch that is a menu item rather than a button, which the keyboard reaches all the same. */
const SWATCH = 'focus-ring grid h-6 w-6 place-items-center rounded-full text-accent-text';

/* The ring of the picked color is offset against whatever the swatch stands on. */
const PICKED_RING = {
    surface: 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
    popup: 'ring-2 ring-accent ring-offset-1 ring-offset-surface-raised'
} as const;

export interface ColorSwatchProps extends ComponentProps<'button'> {
    /* Any CSS color. Without one the swatch is an outlined circle: "no color", or the button that opens the rest of a palette. */
    color?: string;
    picked?: boolean;
    /* On the surface behind a popup, or inside the popup itself. */
    on?: keyof typeof PICKED_RING;
    /* Another element to be the swatch, such as a menu trigger, or `<Menu.Item unstyled />` so the row's padding and highlight stay off it. */
    render?: useRender.RenderProp;
}

/*
 * One color, drawn as the color itself. Its name belongs in a tooltip, so the circle carries a tick
 * alone when it is picked. Children replace the tick, such as the ellipsis of a "more colors" swatch.
 */
export function ColorSwatch({ color, picked = false, on = 'surface', render, className, style, ref, children, ...props }: ColorSwatchProps) {
    return useRender({
        render: render ?? <button type="button" />,
        ref,
        props: {
            ...props,
            className: clsx(SWATCH, color === undefined ? 'border border-border-strong text-text-muted' : picked && PICKED_RING[on], className),
            style: color === undefined ? style : { ...style, background: color },
            children: children ?? (picked && <Icon icon={Check} size={12} />)
        }
    });
}
