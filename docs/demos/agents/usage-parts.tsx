import { useState } from 'react';
import { Segmented } from '@adecore/ui';
import { formatTokens } from '@adecore/ui/format';
import { windowFor, type UsageMetric } from '@adecore/agents-react/state';
import { useMoney, deriveUsage, labelEveryFor, UsageBreakdown, UsageChart, UsageSummary, UsageTiles } from '@adecore/agents-react/usage';
import { usageSummary } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';

const summary = usageSummary(windowFor('30d'));

function Parts() {
    const [metric, setMetric] = useState<UsageMetric>('cost');
    const money = useMoney();
    const derived = deriveUsage(summary, metric);

    return (
        <div className="flex w-full flex-col gap-6">
            <Segmented<UsageMetric>
                value={metric}
                label="Metric"
                options={[
                    { id: 'cost', label: 'Cost' },
                    { id: 'tokens', label: 'Tokens' }
                ]}
                onValueChange={setMetric}
            />
            <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
                <UsageSummary metric={metric} costUsd={derived.costUsd} totals={derived.totals} sessions={summary.sessions} providers={derived.providers} />
                <UsageChart
                    slots={derived.slots}
                    providers={derived.active}
                    format={metric === 'cost' ? money : formatTokens}
                    labelEvery={labelEveryFor(derived.slots.length)}
                />
            </div>
            <UsageTiles totals={derived.totals} cacheSavingsUsd={derived.cacheSavingsUsd} />
            <UsageBreakdown summary={summary} metric={metric} providers={derived.active} />
        </div>
    );
}

export default function UsagePartsDemo() {
    return (
        <AgentDemo>
            <Parts />
        </AgentDemo>
    );
}
