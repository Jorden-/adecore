import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';

export type KeyValueListRootProps = useRender.ComponentProps<'dl'> & {
    /* A hairline between rows, for a long list such as the headers of a message. Without it the rows sit close, for a few facts in a card. */
    divided?: boolean;
};

/*
 * The names take the width of the widest one, up to two fifths of the list, and a longer name wraps
 * there. Every item is a subgrid of the list, so the names line up across rows and a hairline runs
 * under both columns.
 */
export function KeyValueListRoot({ divided = false, render, className, ref, ...props }: KeyValueListRootProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'dl',
        props: {
            ...props,
            className: clsx(
                'grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-3 text-xs',
                divided ? 'divide-y divide-border-soft *:py-1.5' : 'gap-y-1',
                className
            )
        }
    });
}

export type KeyValueListItemProps = useRender.ComponentProps<'div'>;

export function KeyValueListItem({ render, className, ref, ...props }: KeyValueListItemProps) {
    return useRender({ render, ref, defaultTagName: 'div', props: { ...props, className: clsx('col-span-2 grid grid-cols-subgrid', className) } });
}

export type KeyValueListNameProps = useRender.ComponentProps<'dt'>;

export function KeyValueListName({ render, className, ref, ...props }: KeyValueListNameProps) {
    return useRender({ render, ref, defaultTagName: 'dt', props: { ...props, className: clsx('min-w-0 break-words text-text-faint', className) } });
}

export type KeyValueListValueProps = useRender.ComponentProps<'dd'> & {
    /* A value read back letter by letter, such as a header, an id or a path. */
    mono?: boolean;
};

/* Selectable, unlike the interface around it, so a long value can be copied. */
export function KeyValueListValue({ mono = false, render, className, ref, ...props }: KeyValueListValueProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'dd',
        props: { ...props, className: clsx('min-w-0 break-words text-text select-text', mono && 'font-mono text-code', className) }
    });
}
