import type { Ref } from 'react';
import clsx from 'clsx';
import { Check, Minus } from 'lucide-react';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Icon } from './Icon.tsx';

export interface CheckboxProps {
    checked: boolean;
    onCheckedChange(checked: boolean): void;
    /* The accessible name; a `<label>` around the box and its text usually carries the visible one. */
    label: string;
    /* Some of the items it stands for are picked and some are not, as on a box that picks every row of a list. */
    indeterminate?: boolean;
    disabled?: boolean;
    className?: string;
    ref?: Ref<HTMLButtonElement>;
}

/* Picked or not, as one item out of a list or an option that waits for a Save button. */
export function Checkbox({ checked, onCheckedChange, label, indeterminate = false, disabled, className, ref }: CheckboxProps) {
    return (
        <BaseCheckbox.Root
            ref={ref}
            checked={checked}
            indeterminate={indeterminate}
            onCheckedChange={(next) => onCheckedChange(next)}
            aria-label={label}
            disabled={disabled}
            className={clsx(
                'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface text-accent-text transition-colors',
                'data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent data-disabled:opacity-50',
                className
            )}
        >
            <BaseCheckbox.Indicator
                render={(props, state) => (
                    <span {...props}>
                        <Icon icon={state.indeterminate ? Minus : Check} size={12} />
                    </span>
                )}
            />
        </BaseCheckbox.Root>
    );
}
