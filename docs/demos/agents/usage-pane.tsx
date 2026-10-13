import { useState } from 'react';
import { UsagePane } from '@adecore/agents-react/usage';
import { AgentDemo } from '../shared/agents.tsx';

export default function UsagePaneDemo() {
    const [asked, setAsked] = useState(0);

    return (
        <AgentDemo>
            <div className="flex w-full max-w-xl flex-col gap-2">
                <UsagePane onOpenPage={() => setAsked((count) => count + 1)} />
                <p className="text-xs text-text-muted">
                    {asked === 0 ? 'The app opens the usage page from here.' : `Asked to open the usage page ${asked} times.`}
                </p>
            </div>
        </AgentDemo>
    );
}
