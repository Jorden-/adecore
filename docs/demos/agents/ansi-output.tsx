import { useEffect, useState } from 'react';
import { AnsiOutput, FadingWords } from '@adecore/agents-react/chat/ui';

const OUTPUT =
    '\u001b[1mbun test\u001b[0m v1.2.0\n\u001b[32m✓\u001b[0m returns the parsed body\n\u001b[32m✓\u001b[0m retries a 503 twice\n\u001b[31m✗\u001b[0m throws on a 404 at once\n\n \u001b[32m2 pass\u001b[0m\n \u001b[31m1 fail\u001b[0m';

const SENTENCE = 'Each word fades in as it arrives, the way a streamed reply does.';

export default function AnsiOutputDemo() {
    const [shown, setShown] = useState(0);
    const words = SENTENCE.split(' ');

    useEffect(() => {
        const timer = setInterval(() => setShown((count) => (count >= words.length + 6 ? 0 : count + 1)), 180);
        return () => clearInterval(timer);
    }, [words.length]);

    return (
        <div className="flex w-full max-w-xl flex-col gap-4">
            <pre className="overflow-x-auto rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                <AnsiOutput text={OUTPUT} />
            </pre>
            <p className="min-h-6 text-sm">
                <FadingWords text={words.slice(0, shown).join(' ')} />
            </p>
        </div>
    );
}
