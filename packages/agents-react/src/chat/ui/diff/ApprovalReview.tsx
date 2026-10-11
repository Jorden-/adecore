import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { ReviewDiff } from './ReviewDiff';
import type { ReviewEntry } from './review-plan';

export function ApprovalReview({ entries, maxHeight }: { entries: readonly ReviewEntry[]; maxHeight: number }) {
    const { t } = useTranslation('agent-prompts');
    const [selected, setSelected] = useState<string | null>(null);
    const active = entries.find((entry) => entry.key === selected) ?? entries[0];
    const labels = useMemo(() => {
        const totals = new Map<string, number>();
        const counts = new Map<string, number>();
        for (const entry of entries) {
            totals.set(entry.path, (totals.get(entry.path) ?? 0) + 1);
        }
        return entries.map((entry) => {
            const count = (counts.get(entry.path) ?? 0) + 1;
            counts.set(entry.path, count);
            const total = totals.get(entry.path)!;
            const suffix = total > 1 ? ` (${formatNumber(count)}/${formatNumber(total)})` : '';
            return { short: `${entry.path.split(/[\\/]/).at(-1)}${suffix}`, full: `${entry.path}${suffix}` };
        });
    }, [entries]);
    if (active === undefined) {
        return null;
    }
    return (
        <div>
            {entries.length > 1 && (
                <>
                    <div role="toolbar" aria-label={t('approval.reviewChanges')} className="flex flex-wrap gap-1 border-b border-border p-1">
                        {entries.map((entry, index) => (
                            <Button
                                key={entry.key}
                                size="sm"
                                variant={active.key === entry.key ? 'secondary' : 'ghost'}
                                aria-label={labels[index]!.full}
                                aria-pressed={active.key === entry.key}
                                onClick={() => setSelected(entry.key)}
                            >
                                {labels[index]!.short}
                            </Button>
                        ))}
                    </div>
                    <p className="break-all px-3 py-2 font-mono text-xs text-text-muted">{active.path}</p>
                </>
            )}
            <ReviewDiff key={active.key} entry={active} maxHeight={maxHeight} />
        </div>
    );
}
