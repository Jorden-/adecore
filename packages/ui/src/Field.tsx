import { useId, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';
import { useRender } from '@base-ui/react/use-render';
import { FieldContext } from './field-context.ts';
import { SectionLabel } from './SectionLabel.tsx';

const HINT = 'text-xs text-text-muted';
const ERROR = 'text-xs text-status-error';
// Beside the control the label reads at the size of what is typed, on the middle of the control's first line however tall it grows.
const LABEL_BESIDE = 'flex h-8 items-center self-start text-sm text-text-muted';

const isShown = (line: ReactNode): boolean => line !== undefined && line !== null && line !== '';

export type FieldHintProps = useRender.ComponentProps<'p'>;

/* The line under a field that says what goes in it. */
export function FieldHint({ render, className, ref, ...props }: FieldHintProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'p',
        props: { ...props, className: clsx('mt-1', HINT, className) }
    });
}

export type FormErrorProps = useRender.ComponentProps<'p'>;

/* What went wrong in a dialog or a form. An alert, so a screen reader hears it arrive. */
export function FormError({ render, className, ref, ...props }: FormErrorProps) {
    return useRender({
        render,
        ref,
        defaultTagName: 'p',
        props: { role: 'alert', ...props, className: clsx(ERROR, className) }
    });
}

/* A group's label names it through `aria-labelledby`; a control's points at the control. */
function FieldLabel({ id, group, horizontal, children }: { id: string; group: boolean; horizontal: boolean; children: ReactNode }) {
    if (horizontal) {
        return group ? (
            <span id={`${id}-label`} className={LABEL_BESIDE}>
                {children}
            </span>
        ) : (
            <label htmlFor={`${id}-control`} className={LABEL_BESIDE}>
                {children}
            </label>
        );
    }
    return group ? (
        <SectionLabel id={`${id}-label`}>{children}</SectionLabel>
    ) : (
        <SectionLabel render={<label htmlFor={`${id}-control`} />}>{children}</SectionLabel>
    );
}

export interface FieldProps {
    label?: ReactNode;
    hint?: ReactNode;
    /* Shown under the control and marks it invalid; null or empty shows nothing. */
    error?: ReactNode;
    /*
     * For what a `<label>` cannot point at: a `Segmented`, a `Select`, cards to choose from, a path
     * in a box with a button beside it. The label then names a group around it, which the hint and
     * the error describe.
     */
    group?: boolean;
    /* `horizontal` puts the label in a column of its own beside the control, for a form in a dialog where a stack of fields would scroll. */
    orientation?: 'vertical' | 'horizontal';
    className?: string;
    ref?: Ref<HTMLDivElement>;
    /* The control. An `Input` or a `TextArea` connects to the label and the lines under it by itself, unless the field is a `group`. */
    children: ReactNode;
}

/*
 * A labelled control, or a labelled group, with an optional hint and error under it, stacked 6px apart.
 * Beside each other the label column is 112px, so the controls of every field in a form line up.
 */
export function Field({ label, hint, error, group = false, orientation = 'vertical', className, ref, children }: FieldProps) {
    const horizontal = orientation === 'horizontal';
    const id = useId();
    const hasLabel = label !== undefined;
    const hasHint = isShown(hint);
    const hasError = isShown(error);
    const describedBy = [hasHint ? `${id}-hint` : null, hasError ? `${id}-error` : null].filter((part) => part !== null).join(' ') || undefined;
    return (
        <div
            ref={ref}
            role={group ? 'group' : undefined}
            aria-labelledby={group && hasLabel ? `${id}-label` : undefined}
            aria-describedby={group ? describedBy : undefined}
            className={clsx(horizontal ? 'grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1.5' : 'flex flex-col gap-1.5', className)}
        >
            {hasLabel && (
                <FieldLabel id={id} group={group} horizontal={horizontal}>
                    {label}
                </FieldLabel>
            )}
            {/* A group describes itself, so an input inside it stays unconnected rather than taking an id nothing points at. */}
            <FieldContext value={group ? null : { id: `${id}-control`, describedBy, invalid: hasError }}>
                {horizontal ? <div className="col-start-2 min-w-0">{children}</div> : children}
            </FieldContext>
            {/* The stack already puts 6px above each line, so neither takes the margin a standalone hint has. */}
            {hasHint && (
                <p id={`${id}-hint`} className={clsx(HINT, horizontal && 'col-start-2')}>
                    {hint}
                </p>
            )}
            {hasError && (
                <p id={`${id}-error`} role="alert" className={clsx(ERROR, 'break-words', horizontal && 'col-start-2')}>
                    {error}
                </p>
            )}
        </div>
    );
}
