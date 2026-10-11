import clsx from 'clsx';
import { useReviewSettled } from './review-settle';

export function RawDiff({ text, overflow, fill, maxHeight }: { text: string; overflow: 'wrap' | 'scroll'; fill: boolean; maxHeight?: number }) {
    useReviewSettled();
    return (
        <pre
            data-diff-raw
            className={clsx(
                'overflow-auto px-3 py-2 font-mono text-code text-text-muted select-text',
                fill && 'h-full min-h-0',
                overflow === 'wrap' ? 'whitespace-pre-wrap' : 'whitespace-pre'
            )}
            style={fill ? undefined : { maxHeight: maxHeight ?? 256 }}
        >
            {text.replace(/\n$/, '')}
        </pre>
    );
}
