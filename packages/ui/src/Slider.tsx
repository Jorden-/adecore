import { useId, type Ref } from 'react';
import clsx from 'clsx';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { formatFixed } from './format/number.ts';
import { placesOf } from './step-places.ts';

export interface SliderProps {
    value: number;
    onValueChange(value: number): void;
    min: number;
    max: number;
    step?: number;
    /* Places after the separator, always shown. Defaults to the places `step` is written with. */
    decimals?: number;
    /* Printed right after the number, such as `px` or `%`. */
    unit?: string;
    /* Shown above the track and read as the slider's name. */
    label: string;
    disabled?: boolean;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/* A number picked along a range: the label and the value on one line, the track under them. */
export function Slider({ value, onValueChange, min, max, step = 1, decimals = placesOf(step), unit, label, disabled, className, ref }: SliderProps) {
    const labelId = useId();
    const reading = formatFixed(value, decimals);
    // Base UI adds steps in floating point, so 0.2 plus 0.1 would arrive as 0.30000000000000004.
    const places = Math.max(placesOf(step), placesOf(min));
    // Base UI's Page Up jumps 10 whatever the range; a tenth of the range suits 0 to 1 as well as 0 to 1000.
    const largeStep = Math.max(step, Math.round((max - min) / 10 / step) * step);

    return (
        <BaseSlider.Root
            ref={ref}
            value={value}
            onValueChange={(next) => onValueChange(Number(next.toFixed(places)))}
            min={min}
            max={max}
            step={step}
            largeStep={largeStep}
            disabled={disabled}
            aria-labelledby={labelId}
            className={clsx('flex flex-col gap-1 data-disabled:opacity-50', className)}
        >
            <div className="flex items-baseline justify-between gap-3 text-xs">
                <span id={labelId} className="min-w-0 truncate text-text">
                    {label}
                </span>
                {/* The thumb already says the value through `aria-valuetext`. */}
                <span aria-hidden className="shrink-0 text-text-muted tabular-nums">
                    {reading}
                    {unit}
                </span>
            </div>
            {/* The padding gives the thumb room at either end; Base UI leaves it out of the pointer's position. */}
            <BaseSlider.Control className="flex h-5 touch-none items-center px-2 select-none">
                <BaseSlider.Track className="relative h-1 w-full rounded-full bg-border-strong">
                    <BaseSlider.Indicator className="rounded-full bg-accent" />
                    <BaseSlider.Thumb
                        getAriaValueText={() => `${reading}${unit ?? ''}`}
                        className="block size-4 rounded-full bg-surface-raised shadow-raised outline-offset-2 outline-accent has-focus-visible:outline-2"
                    />
                </BaseSlider.Track>
            </BaseSlider.Control>
        </BaseSlider.Root>
    );
}
