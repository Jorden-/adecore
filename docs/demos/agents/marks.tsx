import type { AgentKind, UsageProvider } from '@adecore/agent-contracts';
import { AccountDot, AgentIcon, ProviderLogo, CliMark, CliTile } from '@adecore/agents-react/providers';
import { DemoChatHost } from '../shared/agents.tsx';

const KINDS: AgentKind[] = ['claude', 'codex', 'gemini', 'copilot', 'apple'];
const PROVIDERS: UsageProvider[] = ['claude', 'codex'];

export default function MarksDemo() {
    return (
        <DemoChatHost>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-xs text-text-muted">
                <span>AgentIcon</span>
                <span className="flex items-center gap-3 text-text">
                    {KINDS.map((kind) => (
                        <AgentIcon key={kind} kind={kind} size={20} />
                    ))}
                </span>
                <span>CliMark</span>
                <span className="flex items-center gap-3">
                    {KINDS.map((kind) => (
                        <CliMark key={kind} kind={kind} size={20} />
                    ))}
                </span>
                <span>CliTile</span>
                <span className="flex items-center gap-3">
                    <CliTile kind="claude" />
                    <CliTile kind="codex" />
                </span>
                <span>ProviderLogo</span>
                <span className="flex items-center gap-3 text-text">
                    {PROVIDERS.map((provider) => (
                        <ProviderLogo key={provider} provider={provider} size={20} />
                    ))}
                </span>
                <span>AccountDot</span>
                <span className="flex items-center gap-3">
                    <AccountDot color="blue" />
                    <AccountDot color="amber" />
                    <AccountDot color="teal" />
                    <AccountDot color={undefined} />
                </span>
            </div>
        </DemoChatHost>
    );
}
