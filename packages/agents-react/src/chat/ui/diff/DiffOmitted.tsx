import { useTranslation } from 'react-i18next';

export function DiffOmitted({ path }: { path: string }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div role="status" data-diff-omitted className="px-3 py-2 text-xs text-text-muted">
            <p className="truncate font-mono">{path}</p>
            <p>{t('work.omitted.tooLarge')}</p>
        </div>
    );
}
