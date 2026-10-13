import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';

const VARIANT = {
    /* A row of a list that reads as a table and fills the width of its panel: commits, processes,
       branches. Square, so the rows stack into one block. It carries no padding; the caller pads 12px
       beside text and 4px beside a button. */
    flat: 'flex h-7 items-center',
    /* A row of a list a person finds their way through: a sidebar, devices, recent files. Inset from
       the edge and rounded, so each row reads as a place of its own. */
    inset: 'flex h-8 items-center rounded-md px-2'
} as const;

export type ListRowProps = useRender.ComponentProps<'div'> & {
    variant: keyof typeof VARIANT;
};

/* The height and the shape of one row of a list. What it does (a button, a link, a menu trigger) comes from `render`. */
export function ListRow({ variant, render, className, ref, ...props }: ListRowProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'div',
        props: { ...props, className: clsx(VARIANT[variant], className) }
    });
}
