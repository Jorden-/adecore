import { useState, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, Trash, X } from 'lucide-react';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { Kbd } from './Kbd.tsx';
import { Spinner } from './Spinner.tsx';
import { Surface } from './Surface.tsx';
import { elapsedOf, type Toast, type ToastAction, type ToastDeadline, type ToastStoreHook } from './toast-store.ts';

const ICON = {
    success: CircleCheck,
    error: CircleAlert,
    deleted: Trash
} as const;

const TONE = {
    progress: 'text-text-muted',
    success: 'text-status-idle',
    error: 'text-status-error',
    deleted: 'text-text-muted'
} as const;

/* The box is as tall as the title's own line, so what sits beside the title centers on that line. */
const TITLE_LINE = 'flex h-(--text-sm--line-height) shrink-0 items-center';

/*
 * How long the offer in a toast still stands, drawn from the timer that takes the toast away: the
 * ring starts as far along as that timer already is, so both end together. With motion off it stays full.
 */
function TimerRing({ deadline, onDismiss }: { deadline: ToastDeadline; onDismiss(): void }) {
    const { t } = useTranslation('ui');
    const lifetime = deadline.end - deadline.start;
    const [elapsed] = useState(() => elapsedOf(deadline, Date.now()));
    return (
        <IconButton size="xs" label={t('action.dismiss')} className="group/ring relative -my-px" onClick={onDismiss}>
            <svg width={16} height={16} viewBox="0 0 16 16" className="-rotate-90" aria-hidden>
                <circle cx={8} cy={8} r={6} fill="none" strokeWidth={2} className="stroke-border" />
                <circle
                    cx={8}
                    cy={8}
                    r={6}
                    fill="none"
                    strokeWidth={2}
                    pathLength={1}
                    strokeDasharray={1}
                    className="toast-timer-arc stroke-current"
                    style={{ animationDuration: `${lifetime}ms`, animationDelay: `${-elapsed}ms` }}
                />
            </svg>
            <Icon icon={X} size={8} className="absolute opacity-0 group-hover/ring:opacity-100 group-focus-visible/ring:opacity-100" />
        </IconButton>
    );
}

function ActionButton({ action }: { action: ToastAction }) {
    return (
        <span className="flex items-center gap-2">
            <Button size="xs" onClick={action.run}>
                {action.label}
            </Button>
            {action.shortcut && <Kbd shortcut={action.shortcut} className="font-sans text-xs text-text-faint" />}
        </span>
    );
}

function ToastCard<T extends Toast>({ toast, footer, onDismiss }: { toast: T; footer?: (toast: T) => ReactNode; onDismiss(): void }) {
    const { t } = useTranslation('ui');
    // A toast that goes by itself keeps its close button out of sight until the pointer or the keyboard is on it.
    const leaves = toast.kind === 'deleted' || (toast.kind === 'success' && toast.persist !== true);
    const actions = [...(toast.action === undefined ? [] : [toast.action]), ...(toast.actions ?? [])];
    // An offer that runs out shows how long it has left instead.
    const countdown = actions.length > 0 ? toast.deadline : undefined;
    return (
        <Surface className="group flex items-start gap-3 rounded-[10px] py-2.5 pr-2 pl-3">
            <span className={clsx(TITLE_LINE, 'w-4 justify-center')}>
                {toast.kind === 'progress' ? (
                    <Spinner size={16} className={TONE.progress} />
                ) : (
                    <Icon icon={ICON[toast.kind]} size={16} className={TONE[toast.kind]} />
                )}
            </span>
            <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-sm break-words text-text">{toast.title}</span>
                {/* Wraps rather than clips: the line under the title is the one that says what went
                   wrong, and a reason cut off at the card's edge is no reason at all. */}
                {toast.description !== undefined && toast.description !== '' && (
                    <span className="text-xs break-words text-pretty text-text-muted">{toast.description}</span>
                )}
                {/* Two or more would squeeze the title beside them, so they get a line of their own. */}
                {actions.length > 1 && (
                    <span className="mt-1 -ml-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {actions.map((action) => (
                            <ActionButton key={action.label} action={action} />
                        ))}
                    </span>
                )}
                {footer?.(toast)}
            </div>
            {actions.length === 1 && (
                <span className={TITLE_LINE}>
                    <ActionButton action={actions[0]} />
                </span>
            )}
            {countdown !== undefined ? (
                <TimerRing key={countdown.start} deadline={countdown} onDismiss={onDismiss} />
            ) : (
                <IconButton
                    icon={X}
                    size="xs"
                    label={t('action.dismiss')}
                    className={clsx('-my-px', leaves && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}
                    onClick={onDismiss}
                />
            )}
        </Surface>
    );
}

export interface ToastsProps<T extends Toast> {
    store: ToastStoreHook<T>;
    /* Drawn under the description, for what only the app knows how to offer, such as copying a command's output. */
    footer?: (toast: T) => ReactNode;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/*
 * Bottom right, over everything: what an action is doing while it runs and how it went when it is
 * over, and a deletion that can still be taken back. A success takes itself away after four seconds,
 * a deletion after eight, and a failure waits to be read.
 */
export function Toasts<T extends Toast>({ store, footer, className, ref }: ToastsProps<T>) {
    const toasts = store((state) => state.toasts);
    // Stays mounted with nothing in it: a screen reader skips what a live region says the moment it is inserted.
    return (
        <div
            ref={ref}
            className={clsx('fixed right-4 bottom-4 z-(--z-popup) flex w-90 max-w-[calc(100vw-32px)] flex-col gap-2', className)}
            role="status"
            aria-live="polite"
        >
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} footer={footer} onDismiss={() => store.getState().dismiss(toast.id)} />
            ))}
        </div>
    );
}
