import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { ReviewSettleContext } from './review-settle';
import { ReviewDiff } from './ReviewDiff';
import { reviewSize, type ReviewEntry } from './review-plan';
import { useReviewStack, type ReviewStack } from './use-review-stack';

export function ReviewStackView({ entries, stack }: { entries: readonly ReviewEntry[]; stack: ReviewStack }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div data-review-stack>
            {entries.map((entry) => (
                <div key={entry.key} className="border-t border-border first:border-t-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <p className="min-w-0 grow break-all font-mono text-xs text-text-muted">{entry.path}</p>
                        {stack.slots.get(entry.key) === 'deferred' && (
                            <Button size="sm" data-review-show={entry.key} onClick={() => stack.promote(entry.key)}>
                                {t('work.showDiff')}
                            </Button>
                        )}
                    </div>
                    {stack.ready.has(entry.key) ? (
                        <ReviewSettleContext value={{ key: entry.key, settle: stack.settle }}>
                            <ReviewDiff entry={entry} />
                        </ReviewSettleContext>
                    ) : stack.slots.get(entry.key) === 'editor' ? (
                        <div
                            data-review-pending={entry.key}
                            role="status"
                            className="px-3 py-2 text-xs text-text-faint"
                            style={{ height: Math.max(28, Math.min(reviewSize(entry).rows * 20, 480)) }}
                        >
                            {t('work.loadingDiff')}
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

export function DiffStack({ entries }: { entries: readonly ReviewEntry[] }) {
    const stack = useReviewStack(entries);
    return <ReviewStackView entries={entries} stack={stack} />;
}
