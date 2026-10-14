import { LazyBoundary } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../../lazy';
import type { ReviewEntry } from './review-plan';

const EditDiff = lazyNamed(() => import('../EditDiff'), 'default');
const UnifiedDiff = lazyNamed(() => import('../UnifiedDiff'), 'default');

export function ReviewDiff({ entry, maxHeight = 480 }: { entry: ReviewEntry; maxHeight?: number }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div data-review-entry={entry.key}>
            <LazyBoundary fallback={<p className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</p>}>
                {entry.change.kind === 'edit' ? (
                    <EditDiff change={entry.change.edit} maxHeight={maxHeight} />
                ) : (
                    <UnifiedDiff change={entry.change.patch} contents={entry.change.contents} maxHeight={maxHeight} />
                )}
            </LazyBoundary>
        </div>
    );
}
