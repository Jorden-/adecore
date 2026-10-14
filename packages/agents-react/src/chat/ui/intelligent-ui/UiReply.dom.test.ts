import { test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const PRELOAD = './packages/ui/src/file-tree/testing/preload.ts';
const files = [
    'SubagentTimeline.test.ts',
    'Timeline.host.test.ts',
    'intelligent-ui/UiReply.queries.test.ts',
    'intelligent-ui/UiReply.choices.test.ts',
    'intelligent-ui/UiReply.media.test.ts',
    'intelligent-ui/UiReply.fields.test.ts',
    'intelligent-ui/UiReply.map.test.ts'
];

// React and Base UI must first load with a DOM; isolate these from the server-rendered suite.
test.each(files)(
    '%s in a DOM',
    async (file) => {
        const child = Bun.spawn([process.execPath, 'test', '--preload', PRELOAD, `./packages/agents-react/src/chat/ui/${file}`], {
            cwd: ROOT,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 50_000
        });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) {
            throw new Error(`${file} failed:\n${stderr}\n${stdout}`);
        }
    },
    60_000
);
