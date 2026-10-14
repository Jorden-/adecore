import { cloneElement, isValidElement, type ReactElement, type ReactNode, type Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Icon } from './Icon.tsx';
import { Spinner } from './Spinner.tsx';

// One size in a panel, a card and a dialog alike, so no caller picks its own.
const ICON_SIZE = 20;

export interface EmptyStateProps {
    /* A Lucide icon, or a mark of another kind (a provider's logo) that takes a `size`. */
    icon?: LucideIcon | ReactElement<{ size?: number }>;
    /* A `Spinner` in place of the icon, for a state that is still loading. */
    busy?: boolean;
    /* A heading above the sentence, for a state that is an outcome rather than a list with nothing in it. */
    title?: ReactNode;
    /* One sentence. What is missing, and what puts something there. */
    children: ReactNode;
    /* The button or the shortcut that fills the space; kept to one. */
    action?: ReactNode;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/* What a list, a canvas or a thread shows before it holds anything. */
export function EmptyState({ icon, busy = false, title, children, action, className, ref }: EmptyStateProps) {
    return (
        <div ref={ref} className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-8 text-center', className)}>
            {(busy || icon) && (
                <span className="text-text-faint">
                    {busy ? (
                        <Spinner size={ICON_SIZE} />
                    ) : isValidElement(icon) ? (
                        cloneElement(icon, { size: ICON_SIZE })
                    ) : (
                        icon && <Icon icon={icon} size={ICON_SIZE} />
                    )}
                </span>
            )}
            {title && <p className="text-sm font-medium text-text">{title}</p>}
            <p className="max-w-[280px] text-xs leading-snug text-text-muted">{children}</p>
            {/* The button is an answer to the sentence, not a third line of it. */}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}
