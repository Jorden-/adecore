import { GeneratedImageRow } from '@adecore/agents-react/chat/ui';
import { generatedImageTools } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';
import { DEMO_CHAT } from '../shared/agents-host.ts';

const tools = generatedImageTools();

export default function GeneratedImageDemo() {
    return (
        <AgentDemo>
            <div className="chat-thread flex w-full max-w-2xl flex-col gap-3">
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.ready} />
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.transparent} />
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.generating} />
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.missing} />
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.failed} />
                <GeneratedImageRow chatId={DEMO_CHAT} tool={tools.tooLarge} />
            </div>
        </AgentDemo>
    );
}
