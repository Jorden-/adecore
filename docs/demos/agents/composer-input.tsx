import { useRef, useState } from 'react';
import { Button } from '@adecore/ui';
import { ComposerInput, type ComposerInputHandle } from '@adecore/agents-react/chat/ui';

export default function ComposerInputDemo() {
    const [text, setText] = useState('');
    const input = useRef<ComposerInputHandle>(null);

    return (
        <div className="flex w-full max-w-md flex-col gap-2">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
                <ComposerInput ref={input} value={text} placeholder="Describe the change" disabled={false} tabbable onChange={(value) => setText(value)} />
            </div>
            <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => input.current?.insert('@src/http.ts')}>
                    Insert a path
                </Button>
                <span className="text-xs text-text-muted">{text.length} characters</span>
            </div>
        </div>
    );
}
