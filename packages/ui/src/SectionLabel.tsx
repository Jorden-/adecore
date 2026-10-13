import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';

/* A label takes the line height of the row it sits in, which is why the size carries `/[inherit]`. */
const SECTION_LABEL = 'text-xs/[inherit] font-medium text-text-faint';

export type SectionLabelProps = useRender.ComponentProps<'span'>;

/*
 * The small label above a group of rows outside a popup: a sidebar's groups, a palette's sections,
 * the name of a field. Always sentence case. A `<span>` unless `render` makes it a heading or a label.
 */
export function SectionLabel({ render, className, ref, ...props }: SectionLabelProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'span',
        props: { ...props, className: clsx(SECTION_LABEL, className) }
    });
}
