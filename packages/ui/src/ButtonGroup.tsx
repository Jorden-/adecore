import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';

export type ButtonGroupProps = useRender.ComponentProps<'div'>;

/* Icon buttons that belong together sit 1px apart; groups keep the wider gap of their container. */
export function ButtonGroup({ render, className, ref, ...props }: ButtonGroupProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'div',
        props: { ...props, className: clsx('inline-flex items-center gap-px', className) }
    });
}
