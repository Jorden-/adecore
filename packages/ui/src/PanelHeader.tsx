import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';
import { SectionLabel } from './SectionLabel.tsx';

export type PanelHeaderProps = useRender.ComponentProps<'header'> & {
    /* The panel's name, as a section label first on the bar. Left out when the caller lays out the name itself. */
    title?: ReactNode;
};

/*
 * The bar across the top of a side panel, as tall as a 48px toolbar beside it: the panel's name,
 * its own controls, and a close button last.
 */
export function PanelHeader({ title, render, className, ref, children, ...props }: PanelHeaderProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'header',
        props: {
            ...props,
            className: clsx('flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3', className),
            children: (
                <>
                    {title !== undefined && <SectionLabel className="shrink-0">{title}</SectionLabel>}
                    {children}
                </>
            )
        }
    });
}
