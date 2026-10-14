import { Component, type ErrorInfo, type ReactNode } from 'react';
import clsx from 'clsx';
import { Copy, RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button.tsx';
import { ButtonGroup } from './ButtonGroup.tsx';
import { copyText } from './clipboard.ts';
import { errorMessageOf, errorReport, shouldReset, type ResetKeys } from './error-boundary.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';

export interface ErrorBoundaryProps {
    /* What failed, as the first line of the message: "This view failed to render". */
    label: string;
    /* What the children draw from; the boundary tries again when one of them changes. */
    resetKeys?: ResetKeys;
    /* A small surface, so its message drops the icon and the spacing. */
    compact?: boolean;
    /* The last resort has nothing around it to fall back to, so it offers a reload as well. */
    reload?: boolean;
    /* The box of the message; by default it covers the positioned parent. */
    className?: string;
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: unknown;
    failed: boolean;
    componentStack: string | null;
}

const CLEAR: ErrorBoundaryState = { error: null, failed: false, componentStack: null };

interface FallbackProps {
    label: string;
    error: unknown;
    componentStack: string | null;
    compact: boolean;
    reload: boolean;
    className: string;
    onRetry(): void;
}

/* A function component, so the words come from the i18next instance the app renders with. */
function ErrorFallback({ label, error, componentStack, compact, reload, className, onRetry }: FallbackProps) {
    const { t } = useTranslation('ui');
    return (
        <div role="alert" className={clsx('grid place-items-center overflow-auto bg-surface', compact ? 'p-3' : 'p-6', className)}>
            <div className={clsx('flex max-w-[360px] flex-col items-center text-center', compact ? 'gap-1' : 'gap-2')}>
                {!compact && <Icon icon={TriangleAlert} size={20} className="text-status-error" />}
                <p className="text-sm font-medium text-text">{label}</p>
                <p className="line-clamp-4 text-xs break-words text-text-muted">{errorMessageOf(error)}</p>
                <div className={clsx('flex items-center gap-2', compact ? 'mt-1' : 'mt-2')}>
                    <Button variant="secondary" size="sm" onClick={onRetry}>
                        {t('action.retry')}
                    </Button>
                    {reload && (
                        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                            <Icon icon={RotateCw} size={14} />
                            {t('action.reload')}
                        </Button>
                    )}
                    <ButtonGroup>
                        <IconButton icon={Copy} size="sm" label={t('action.copyError')} onClick={() => copyText(errorReport(label, error, componentStack))} />
                    </ButtonGroup>
                </div>
            </div>
        </div>
    );
}

/*
 * Keeps a render failure to the subtree it happened in. Without one React unmounts the whole tree,
 * and whatever lives in it (an embedded page, a running terminal) goes down with it. Key it so it
 * resets only while it holds an error: `resetKeys` for what the children draw from.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    override state: ErrorBoundaryState = CLEAR;

    static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
        return { error, failed: true };
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
        console.error(`${this.props.label}:`, error, info.componentStack);
        this.setState({ componentStack: info.componentStack ?? null });
    }

    override componentDidUpdate(previous: ErrorBoundaryProps): void {
        if (shouldReset(this.state.failed, previous.resetKeys ?? [], this.props.resetKeys ?? [])) {
            this.reset();
        }
    }

    reset(): void {
        this.setState(CLEAR);
    }

    override render(): ReactNode {
        if (!this.state.failed) {
            return this.props.children;
        }
        const { label, compact = false, reload = false, className = 'absolute inset-0' } = this.props;
        return (
            <ErrorFallback
                label={label}
                error={this.state.error}
                componentStack={this.state.componentStack}
                compact={compact}
                reload={reload}
                className={className}
                onRetry={() => this.reset()}
            />
        );
    }
}
