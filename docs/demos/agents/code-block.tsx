import { CodeBlock } from '@adecore/agents-react/chat/ui';

const CODE = `export async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(url);
        if (response.ok) {
            return response.json() as Promise<T>;
        }
    }
}`;

export default function CodeBlockDemo() {
    return (
        <div className="w-full max-w-xl">
            <CodeBlock code={CODE} lang="ts" />
        </div>
    );
}
