import { ProvidersPane } from '@adecore/agents-react/providers';
import { AgentDemo } from '../shared/agents.tsx';

export default function ProvidersPaneDemo() {
    return (
        <AgentDemo>
            <div className="flex h-[520px] w-full overflow-hidden rounded-lg border border-border bg-surface">
                <ProvidersPane />
            </div>
        </AgentDemo>
    );
}
