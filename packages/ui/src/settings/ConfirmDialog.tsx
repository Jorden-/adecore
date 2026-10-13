import type { Ref } from 'react';
import { PromptDialog } from '../PromptDialog.tsx';

export interface ConfirmDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    description: string;
    confirmLabel: string;
    /* Closes the dialog once it resolves; a rejection stays on screen as the reason. */
    onConfirm(): Promise<void>;
    /* Extra on the popup. */
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/* One destructive step, asked before it happens, over whichever dialog it was opened from. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, className, ref }: ConfirmDialogProps) {
    return (
        <PromptDialog
            ref={ref}
            className={className}
            open={open}
            nested
            danger
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            onConfirm={async () => {
                await onConfirm();
                onOpenChange(false);
            }}
            onOpenChange={onOpenChange}
        />
    );
}
