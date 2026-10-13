import { useNow } from '@adecore/ui';
import { AccountLimitsList, LimitsList, WindowBar, useLimitGroups, UsageLimits } from '@adecore/agents-react/usage';
import { usageLimits } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';

const limits = usageLimits();

function Lists() {
    const now = useNow(60_000);
    const groups = useLimitGroups(limits);

    return (
        <div className="flex w-full flex-col gap-8">
            <UsageLimits />
            <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <span className="text-xs text-text-muted">LimitsList</span>
                    <LimitsList limits={limits} now={now} compact />
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-xs text-text-muted">AccountLimitsList</span>
                    <AccountLimitsList groups={groups} now={now} />
                </div>
            </div>
            <div className="flex max-w-sm flex-col gap-2">
                <span className="text-xs text-text-muted">WindowBar</span>
                <WindowBar window={limits.providers[2]!.windows[0]!} now={now} compact={false} />
            </div>
        </div>
    );
}

export default function UsageLimitsDemo() {
    return (
        <AgentDemo>
            <Lists />
        </AgentDemo>
    );
}
