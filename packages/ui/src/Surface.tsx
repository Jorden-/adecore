import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';

const FLOAT = 'border border-border bg-[color-mix(in_srgb,var(--surface-raised)_88%,transparent)] shadow-float backdrop-blur-[14px]';

export type SurfaceProps = useRender.ComponentProps<'div'>;

/*
 * The glass card that floats over the content under it: a dock, a banner, a toast, a find bar, a
 * chip over a scrolling thread. It brings the ground, the border and the shadow; the caller brings
 * the shape (radius, padding, height) and the position.
 */
export function Surface({ render, className, ref, ...props }: SurfaceProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'div',
        props: { ...props, className: clsx(FLOAT, className) }
    });
}
