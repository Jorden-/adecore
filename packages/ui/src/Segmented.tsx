import type { KeyboardEvent, Ref } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon.tsx';

export interface SegmentedOption<T extends string> {
    id: T;
    label: string;
    icon?: LucideIcon;
}

export interface SegmentedProps<T extends string> {
    value: T;
    onValueChange(id: T): void;
    options: readonly SegmentedOption<T>[];
    /* The accessible name of the group. */
    label: string;
    disabled?: boolean;
    /* `vertical` stacks the options in a column as wide as its container, for labels too long to stand side by side. */
    orientation?: 'horizontal' | 'vertical';
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/*
 * One of a few options side by side in one sunken track, the picked one lifted out of it. A radio
 * group: one tab stop, and the arrows pick and focus the next option, around the ends.
 */
export function Segmented<T extends string>({ value, onValueChange, options, label, disabled, orientation = 'horizontal', className, ref }: SegmentedProps<T>) {
    const vertical = orientation === 'vertical';
    const picked = options.findIndex((option) => option.id === value);
    const stop = picked === -1 ? 0 : picked;

    function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const next =
            event.key in STEPS
                ? (index + STEPS[event.key]! + options.length) % options.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : null;
        if (next === null) {
            return;
        }
        event.preventDefault();
        onValueChange(options[next]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    }

    return (
        <div
            ref={ref}
            className={clsx(
                'flex rounded-lg bg-surface-sunken p-0.5 text-xs font-medium',
                vertical ? 'w-full flex-col items-stretch gap-0.5' : 'min-h-8 w-fit items-center',
                className
            )}
            role="radiogroup"
            aria-label={label}
            aria-orientation={vertical ? 'vertical' : undefined}
        >
            {options.map((option, index) => (
                <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={value === option.id}
                    tabIndex={index === stop ? 0 : -1}
                    disabled={disabled}
                    className={clsx(
                        'flex min-h-7 items-center gap-1.5 rounded-md px-3 py-1 text-left transition-colors disabled:opacity-50',
                        value === option.id ? 'bg-surface-raised text-text shadow-raised' : 'text-text-muted hover:text-text'
                    )}
                    onClick={() => onValueChange(option.id)}
                    onKeyDown={(event) => move(event, index)}
                >
                    {option.icon && <Icon icon={option.icon} size={14} className="shrink-0" />}
                    {option.label}
                </button>
            ))}
        </div>
    );
}
