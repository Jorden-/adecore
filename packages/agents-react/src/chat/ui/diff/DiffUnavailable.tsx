import { useTranslation } from 'react-i18next';
import { useReviewSettled } from './review-settle';

export function DiffUnavailable({ path }: { path: string }) {
    useReviewSettled();
    const { t } = useTranslation('agent-chat');
    return (
        <div role="status" data-diff-unavailable className="px-3 py-2 text-xs text-text-muted">
            <p className="truncate font-mono">{path}</p>
            <p>{t('work.diffUnavailable')}</p>
        </div>
    );
}
