import { useLayoutEffect, useMemo, useState, type Ref } from 'react';
import clsx from 'clsx';
import { fitMiddle, type MiddleCut } from './middle-truncate.ts';
import { mergeRefs } from './merge-refs.ts';
import { Tooltip } from './Tooltip.tsx';

export interface MiddleTruncateProps {
    text: string;
    /* The whole text on hover and focus while it is cut. Off where the caller's own tooltip already says it. */
    tooltip?: boolean;
    className?: string;
    ref?: Ref<HTMLSpanElement>;
}

let canvas: HTMLCanvasElement | null = null;

/* How wide a text is drawn in the face of `element`, or null where the page cannot tell (no canvas). */
function textMeasure(element: HTMLElement): ((text: string) => number) | null {
    const view = element.ownerDocument.defaultView;
    canvas ??= element.ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context === null || view === null) {
        return null;
    }
    const style = view.getComputedStyle(element);
    context.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if ('letterSpacing' in context) {
        context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    }
    return (text) => context.measureText(text).width;
}

function sameCut(first: MiddleCut | null, second: MiddleCut | null): boolean {
    return first?.head === second?.head && first?.tail === second?.tail;
}

/*
 * A path or a branch name on one line that keeps its start and its end and cuts the middle. It asks
 * for the width of the whole text and measures what it gets. The part it cuts stays in the element
 * at no width, so selecting, copying and finding read the whole text.
 */
export function MiddleTruncate({ text, tooltip = true, className, ref }: MiddleTruncateProps) {
    const [element, setElement] = useState<HTMLSpanElement | null>(null);
    const [cut, setCut] = useState<MiddleCut | null>(null);
    const rootRef = useMemo(() => mergeRefs(setElement, ref), [ref]);

    useLayoutEffect(() => {
        if (element === null) {
            return;
        }
        const update = (): void => {
            const measure = textMeasure(element);
            // Layout rounds what a canvas measures, so a text a fraction wider than its box still fits.
            const next = measure === null ? null : fitMiddle(text, element.getBoundingClientRect().width + 0.5, measure);
            setCut((current) => (sameCut(current, next) ? current : next));
        };
        update();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, text]);

    const content = (
        <span ref={rootRef} className={clsx('middle-truncate', className)} data-text={text}>
            {cut === null ? (
                text
            ) : (
                <>
                    <span className="middle-truncate-head">{cut.head}</span>
                    <span className="middle-truncate-middle">{cut.middle}</span>
                    {cut.tail}
                </>
            )}
        </span>
    );
    // Only a cut text has more to say, and a long list of whole ones keeps no hover handlers.
    if (cut === null || !tooltip) {
        return content;
    }
    return <Tooltip label={text}>{content}</Tooltip>;
}
