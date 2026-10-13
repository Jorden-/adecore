import { Markdown, MessageMarkdown, ReplyMarkdown } from '@adecore/agents-react/chat/ui';

const REPLY = `The retry lives in \`fetchJson\`:

\`\`\`ts
await wait(250 * 2 ** attempt);
\`\`\`

| Status | Retried |
| --- | --- |
| 503 | Yes |
| 404 | No |`;

export default function MarkdownDemo() {
    return (
        <div className="flex w-full max-w-xl flex-col gap-4">
            <MessageMarkdown text={'Review @src/http.ts with $review\nand keep the <Reading> type.'} mentions={['src/http.ts']} skills={['review']} />
            <ReplyMarkdown text={REPLY} streaming={false} />
            <Markdown text={'A note from the app,\nwith the line break kept.'} breaks fileLinks={false} />
        </div>
    );
}
