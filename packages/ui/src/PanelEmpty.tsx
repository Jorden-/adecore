import type { ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from './EmptyState.tsx';

export interface PanelEmptyProps {
    /* The panel's own header, kept above the sentence so a person can still act while nothing is listed. */
    header?: ReactNode;
    icon?: LucideIcon;
    /* A `Spinner` in place of the icon, for a panel that is still loading. */
    busy?: boolean;
    action?: ReactNode;
    /* The sunken ground, for a box that has none behind it yet (a card on a canvas) rather than a panel that does. */
    sunken?: boolean;
    /*
     * A panel is one track of a flex column and takes what is left of it; a card is a box with a
     * height of its own, and `grow` means nothing to the block that lays it out.
     */
    fill?: 'grow' | 'full';
    children: ReactNode;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/* What a panel or a card shows while it holds nothing: a sentence, one icon, at most one button. */
export function PanelEmpty({ header, icon, busy = false, action, sunken = false, fill = 'grow', children, className, ref }: PanelEmptyProps) {
    return (
        <div ref={ref} className={clsx('grid min-h-0 place-items-center', fill === 'full' ? 'h-full' : 'grow', sunken && 'bg-surface-sunken', className)}>
            {header}
            <EmptyState icon={icon} busy={busy} action={action}>
                {children}
            </EmptyState>
        </div>
    );
}
