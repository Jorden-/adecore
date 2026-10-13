import type {
    ChatApprovalItem,
    ChatInfo,
    ChatItem,
    ChatSkill,
    ChatSubagentItem,
    ChatToolItem,
    ModelOptionDescriptor,
    ProviderAccounts,
    ProviderCapabilities,
    ProviderInfo,
    UsageBucket,
    UsageLimitsSnapshot,
    UsageProvider,
    UsageSummaryPayload,
    UsageSummaryResult,
    UsageTotals
} from '@adecore/agent-contracts';
import type { SubagentTask } from '@adecore/agents-react';

/* The moment the demos were loaded; every time in the fixtures counts back from it. */
export const NOW = Date.now();
const MINUTE = 60_000;

export const DEMO_CWD = '/home/sam/projects/weather-station';

const EFFORT: ModelOptionDescriptor = {
    id: 'effort',
    label: 'Effort',
    type: 'select',
    choices: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' }
    ],
    defaultChoice: 'medium'
};

const THINKING: ModelOptionDescriptor = { id: 'thinking', label: 'Thinking', type: 'boolean', defaultValue: true, description: 'Think before answering.' };

const CAPABILITIES: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: true,
    streamsToolOutput: false,
    diffs: 'before-after',
    attachments: true,
    mentions: true,
    denyReason: true,
    allowAlways: true,
    asyncQuestions: false,
    compaction: 'prompt',
    reportsCost: true,
    reportsContextWindow: true,
    reportsThinking: true,
    slashCommands: true
};

export const PROVIDERS: ProviderInfo[] = [
    {
        kind: 'claude',
        name: 'Claude Code',
        installed: true,
        version: '2.1.0',
        models: [
            { slug: 'sonnet', name: 'Sonnet', legacy: false, isDefault: true, options: [EFFORT, THINKING] },
            { slug: 'opus', name: 'Opus', badge: 'Most capable', legacy: false, isDefault: false, options: [EFFORT, THINKING] },
            { slug: 'haiku', name: 'Haiku', legacy: false, isDefault: false, options: [THINKING] }
        ],
        defaultModel: 'sonnet',
        capabilities: CAPABILITIES,
        resumeCommand: 'claude {flags} --resume {id}'
    },
    {
        kind: 'codex',
        name: 'Codex',
        installed: true,
        version: '0.150.0',
        models: [
            { slug: 'gpt-codex', name: 'GPT Codex', legacy: false, isDefault: true, options: [EFFORT] },
            { slug: 'gpt-codex-mini', name: 'GPT Codex Mini', legacy: false, isDefault: false, options: [EFFORT] }
        ],
        defaultModel: 'gpt-codex',
        capabilities: { ...CAPABILITIES, streamsToolOutput: true, diffs: 'unified', denyReason: false, asyncQuestions: true, compaction: 'native' },
        resumeCommand: 'codex resume {id} {flags}'
    }
];

export const ACCENTS = [
    { id: 'blue', color: '#2563eb' },
    { id: 'violet', color: '#7c3aed' },
    { id: 'rose', color: '#e11d48' },
    { id: 'amber', color: '#d97706' },
    { id: 'green', color: '#16a34a' },
    { id: 'teal', color: '#0d9488' }
];

export function initialAccounts(): ProviderAccounts {
    return {
        accounts: {
            claude: { kind: 'claude', color: 'blue' },
            'claude-work': { kind: 'claude', label: 'Work', color: 'amber', home: '~/.agents/claude-work' },
            codex: { kind: 'codex', color: 'teal' }
        },
        statuses: [
            status('claude', 'claude', 'sam@example.com', 'Max', '/home/sam/.claude'),
            status('claude-work', 'claude', 'sam@acme.example', 'Team', '/home/sam/.agents/claude-work'),
            status('codex', 'codex', 'sam@example.com', 'Pro', '/home/sam/.codex')
        ],
        secretsAvailable: true,
        loginCommands: { claude: 'claude /login', codex: 'codex login' }
    };
}

function status(id: string, kind: string, email: string, plan: string, home: string): ProviderAccounts['statuses'][number] {
    return { id, kind, state: 'ready', email, plan, organization: null, home, transcripts: `${home}/projects`, message: null, checkedAt: NOW - 4 * MINUTE };
}

export const SKILLS: ChatSkill[] = [
    { name: 'review', description: 'Review the changes on this branch', source: 'user' },
    { name: 'release-notes', description: 'Write release notes since the last tag', source: 'project' }
];

/* A small picture of a sunny field, for the thumbnails. */
export const PICTURE = {
    name: 'station-view.png',
    mime: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAN0lEQVR42mNwazpBFcQwahDVDPp1wgYZkWkQmilYzRo1iEoGUS3WRrMIlQyy6QmgCho1aCgaBADagUjEGwjoPQAAAABJRU5ErkJggg=='
};

export const FILES = [
    'src/http.ts',
    'src/http.test.ts',
    'src/sensors/barometer.ts',
    'src/sensors/thermometer.ts',
    'src/station.ts',
    'README.md',
    'package.json'
];

export function chatInfo(chatId: string, patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: DEMO_CWD,
        agentSessionId: 'session-1',
        model: 'sonnet',
        selection: { model: 'sonnet', options: { effort: 'medium' } },
        runtimeMode: 'auto-accept-edits',
        status: 'idle',
        running: true,
        activeTurnId: null,
        slashCommands: ['compact', 'clear', 'review'],
        skills: ['review'],
        usage: {
            contextTokens: 41_200,
            contextWindow: 200_000,
            costUsd: 0.42,
            turns: 2,
            breakdown: { toolOutput: 12_400, filesRead: 9_800, conversation: 6_100, system: 12_900 }
        },
        createdAt: NOW - 40 * MINUTE,
        ...patch
    };
}

const HTTP_BEFORE = `export async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(\`\${response.status} \${response.statusText}\`);
    }
    return response.json() as Promise<T>;
}
`;

const HTTP_AFTER = `export async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(url);
        if (response.ok) {
            return response.json() as Promise<T>;
        }
        if (attempt === attempts || response.status < 500) {
            throw new Error(\`\${response.status} \${response.statusText}\`);
        }
        await wait(250 * 2 ** attempt);
    }
}
`;

const REPLY = `\`fetchJson\` now retries a failed request up to three times, waiting 500 ms, then 1 s, then 2 s.

- Only a server error (5xx) is retried. A 4xx means the request itself is wrong, so it throws at once.
- \`attempts\` is a parameter with a default of 3, so the barometer can ask for more.

\`\`\`ts
const reading = await fetchJson<Reading>(\`\${station}/barometer\`, 5);
\`\`\`

The four tests in \`src/http.test.ts\` pass.`;

/* The thread of a chat that took two turns: one with tools, an edit and a reply; one that ran a helper agent. */
export function chatItems(): ChatItem[] {
    const at = (minutes: number): number => NOW - minutes * MINUTE;
    const subagent: ChatSubagentItem = {
        id: 'item-subagent',
        createdAt: at(8),
        turnId: 'turn-2',
        kind: 'subagent',
        toolUseId: 'call-subagent',
        description: 'Find every caller of fetchJson',
        subagentType: 'Explore',
        model: 'haiku',
        prompt: 'List every caller of fetchJson and say which ones handle errors.',
        background: false,
        status: 'done',
        startedAt: at(8),
        finishedAt: at(7),
        summary: null,
        result: 'Three callers: `barometer.ts` and `thermometer.ts` catch errors, `station.ts` does not.',
        usage: { totalTokens: 18_400, toolUses: 4, durationMs: 41_000 },
        lastTool: 'Grep',
        itemsTruncated: false
    };
    return [
        { id: 'turn-1', createdAt: at(30), turnId: 'turn-1', kind: 'turn', state: 'done', endedAt: at(28), costUsd: 0.31 },
        {
            id: 'item-user-1',
            createdAt: at(30),
            turnId: 'turn-1',
            kind: 'user',
            text: 'Add a retry with backoff to `fetchJson` in @src/http.ts, and run its tests.',
            mentions: ['src/http.ts']
        },
        {
            id: 'item-thinking-1',
            createdAt: at(30),
            turnId: 'turn-1',
            kind: 'thinking',
            text: 'The helper throws on the first failed response. A retry belongs in the loop around fetch, and only for server errors.',
            streaming: false,
            endedAt: at(30) + 6000
        },
        tool('item-read', 'turn-1', at(29), 'Read', { file_path: `${DEMO_CWD}/src/http.ts` }, HTTP_BEFORE),
        tool('item-grep', 'turn-1', at(29), 'Grep', { pattern: 'fetchJson' }, 'src/sensors/barometer.ts\nsrc/sensors/thermometer.ts\nsrc/station.ts'),
        tool(
            'item-edit',
            'turn-1',
            at(29),
            'Edit',
            { file_path: `${DEMO_CWD}/src/http.ts`, old_string: HTTP_BEFORE, new_string: HTTP_AFTER },
            'The file was updated.'
        ),
        {
            id: 'item-approval',
            createdAt: at(28),
            turnId: 'turn-1',
            kind: 'approval',
            requestId: 'request-test',
            toolUseId: 'call-item-test',
            toolName: 'Bash',
            input: { command: 'bun test src/http.test.ts' },
            description: null,
            canAllowAlways: false,
            decision: 'allow'
        },
        tool(
            'item-test',
            'turn-1',
            at(28),
            'Bash',
            { command: 'bun test src/http.test.ts', description: 'Run the tests of the http helper' },
            '\u001b[1mbun test\u001b[0m v1.2.0\n\nsrc/http.test.ts:\n\u001b[32m✓\u001b[0m returns the parsed body\n\u001b[32m✓\u001b[0m retries a 503 twice\n\u001b[32m✓\u001b[0m throws on a 404 at once\n\u001b[32m✓\u001b[0m gives up after three attempts\n\n \u001b[32m4 pass\u001b[0m\n 0 fail'
        ),
        { id: 'item-reply-1', createdAt: at(28), turnId: 'turn-1', kind: 'assistant', text: REPLY, streaming: false, parentToolUseId: null },
        { id: 'item-compaction', createdAt: at(12), turnId: null, kind: 'compaction', preTokens: 96_300 },
        { id: 'turn-2', createdAt: at(9), turnId: 'turn-2', kind: 'turn', state: 'done', endedAt: at(6), costUsd: 0.11 },
        { id: 'item-user-2', createdAt: at(9), turnId: 'turn-2', kind: 'user', text: 'Which callers still need to handle the error?' },
        subagent,
        {
            id: 'item-reply-2',
            createdAt: at(6),
            turnId: 'turn-2',
            kind: 'assistant',
            text: 'Only `src/station.ts` lets the error escape: `refresh()` awaits `fetchJson` without a `try`. The two sensors already catch it and keep their last reading.',
            streaming: false,
            parentToolUseId: null
        }
    ];
}

function tool(id: string, turnId: string, createdAt: number, name: string, input: Record<string, string>, output: string): ChatItem {
    return { id, createdAt, turnId, kind: 'tool', toolUseId: `call-${id}`, name, input, output, state: 'done', parentToolUseId: null };
}

/* The conversation of the helper agent, as `chat.subagent` reads it from the CLI's own transcript. */
export function subagentItems(): ChatItem[] {
    const at = NOW - 8 * MINUTE;
    return [
        { id: 'sub-user', createdAt: at, turnId: null, kind: 'user', text: 'List every caller of fetchJson and say which ones handle errors.' },
        tool('sub-grep', 'sub', at + 2000, 'Grep', { pattern: 'fetchJson\\(' }, 'src/sensors/barometer.ts:14\nsrc/sensors/thermometer.ts:9\nsrc/station.ts:31'),
        tool('sub-read', 'sub', at + 5000, 'Read', { file_path: `${DEMO_CWD}/src/station.ts` }, '...'),
        {
            id: 'sub-reply',
            createdAt: at + 40_000,
            turnId: null,
            kind: 'assistant',
            text: 'Three callers: `barometer.ts` and `thermometer.ts` catch errors, `station.ts` does not.',
            streaming: false,
            parentToolUseId: null
        }
    ];
}

/* A workflow halfway: the first phase done, two agents of the second at work and one waiting for its turn. */
export function workflowTool(): ChatToolItem {
    const at = NOW - 6 * MINUTE;
    return {
        id: 'item-workflow',
        createdAt: at,
        turnId: 'turn-2',
        kind: 'tool',
        toolUseId: 'call-workflow',
        name: 'Workflow',
        input: { name: 'harden-sensors' },
        output: null,
        state: 'running',
        parentToolUseId: null,
        workflow: {
            name: 'Harden the sensors',
            phases: [
                { index: 0, title: 'Survey' },
                { index: 1, title: 'Fix' }
            ],
            agents: [
                {
                    index: 0,
                    label: 'Map the callers',
                    phaseIndex: 0,
                    agentId: 'agent-map',
                    status: 'done',
                    startedAt: at,
                    durationMs: 48_000,
                    lastTool: 'Grep'
                },
                {
                    index: 1,
                    label: 'Barometer',
                    phaseIndex: 1,
                    agentId: 'agent-barometer',
                    status: 'running',
                    startedAt: at + 60_000,
                    durationMs: null,
                    lastTool: 'Edit'
                },
                {
                    index: 2,
                    label: 'Thermometer',
                    phaseIndex: 1,
                    agentId: 'agent-thermometer',
                    status: 'running',
                    startedAt: at + 62_000,
                    durationMs: null,
                    lastTool: 'Read'
                },
                { index: 3, label: 'Station', phaseIndex: 1, agentId: null, status: 'running', startedAt: null, durationMs: null, lastTool: null }
            ],
            lastProgressAt: NOW - 20_000
        }
    };
}

/* Agents the app started with tasks of its own, one at work and one done, with the task each one runs under. */
export function taskRows(): { item: ChatSubagentItem; task: SubagentTask }[] {
    const task = (id: string, description: string, startedAt: number, finishedAt: number | null): ChatSubagentItem => ({
        id,
        createdAt: startedAt,
        turnId: 'turn-2',
        kind: 'subagent',
        toolUseId: `call-${id}`,
        description,
        subagentType: null,
        prompt: description,
        background: true,
        status: finishedAt === null ? 'running' : 'done',
        startedAt,
        finishedAt,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    });
    return [
        {
            item: task('task-docs', 'Write the changelog for the retry', NOW - 3 * MINUTE, null),
            task: { status: 'open', createdAt: NOW - 3 * MINUTE, settledAt: null }
        },
        {
            item: task('task-tests', 'Add a test for a 503 answer', NOW - 9 * MINUTE, NOW - 5 * MINUTE),
            task: { status: 'done', createdAt: NOW - 9 * MINUTE, settledAt: NOW - 5 * MINUTE }
        }
    ];
}

/* The titles of two chats that went on from the first turn, as the app's own list names them. */
export const FORK_TITLES: Readonly<Record<string, string>> = {
    'chat-fork-jitter': 'Backoff with jitter',
    'chat-fork-codex': 'The same retry in Codex'
};

/* The permission the agent asks for when a message mentions a check. */
export function commandApproval(turnId: string): ChatApprovalItem {
    return {
        id: `approval-${turnId}`,
        createdAt: Date.now(),
        turnId,
        kind: 'approval',
        requestId: `request-${turnId}`,
        toolUseId: null,
        toolName: 'Bash',
        input: { command: 'bun run check', description: 'Type check and lint the project' },
        description: 'Type check and lint the project before reporting back.',
        canAllowAlways: true,
        allowAlways: { label: 'Allow bun run for this session', description: 'Commands that start with bun run need no approval until the session ends.' },
        decision: 'pending'
    };
}

/* A weight between 0 and 1 that stays the same for a slot, so every load draws the same weeks of work. */
function seeded(slot: string, salt: number): number {
    let hash = salt;
    for (const char of slot) {
        hash = (hash * 31 + char.charCodeAt(0)) % 9973;
    }
    return hash / 9973;
}

function totalsOf(tokens: number): UsageTotals {
    return {
        calls: Math.round(tokens / 9000),
        input: Math.round(tokens * 0.05),
        cacheRead: Math.round(tokens * 0.8),
        cacheWrite: Math.round(tokens * 0.1),
        cacheWrite1h: 0,
        output: Math.round(tokens * 0.05),
        reasoning: Math.round(tokens * 0.01)
    };
}

function slotsOf(payload: UsageSummaryPayload): string[] {
    if (payload.resolution === 'hour') {
        return Array.from({ length: new Date().getHours() + 1 }, (_, hour) => `${payload.to}T${String(hour).padStart(2, '0')}`);
    }
    const slots: string[] = [];
    const day = new Date(`${payload.from}T00:00:00`);
    const end = new Date(`${payload.to}T00:00:00`);
    while (day <= end) {
        slots.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
        day.setDate(day.getDate() + 1);
    }
    return slots;
}

const MODELS: { provider: UsageProvider; model: string; account: string; perToken: number; share: number }[] = [
    { provider: 'claude', model: 'sonnet', account: 'claude', perToken: 0.0000011, share: 1 },
    { provider: 'claude', model: 'opus', account: 'claude-work', perToken: 0.0000042, share: 0.35 },
    { provider: 'codex', model: 'gpt-codex', account: 'codex', perToken: 0.0000009, share: 0.5 }
];

export function usageSummary(payload: UsageSummaryPayload): UsageSummaryResult {
    const scale = payload.resolution === 'hour' ? 0.12 : 1;
    const buckets: UsageBucket[] = slotsOf(payload).flatMap((slot) =>
        MODELS.filter((model) => payload.accounts === undefined || payload.accounts.includes(model.account)).flatMap((model, index) => {
            const weight = seeded(slot, index + 7);
            if (weight < 0.25) {
                return [];
            }
            const tokens = Math.round(2_400_000 * weight * model.share * scale);
            return [
                {
                    slot,
                    provider: model.provider,
                    model: model.model,
                    ...(payload.accounts === undefined ? {} : { account: model.account }),
                    totals: totalsOf(tokens),
                    costUsd: Math.round(tokens * model.perToken * 100) / 100,
                    cacheSavingsUsd: Math.round(tokens * model.perToken * 300) / 100,
                    sessions: 1 + Math.round(weight * 3)
                }
            ];
        })
    );
    const models = MODELS.map((model) => {
        const own = buckets.filter((bucket) => bucket.model === model.model);
        const tokens = own.reduce((sum, bucket) => sum + bucket.totals.input + bucket.totals.cacheRead + bucket.totals.cacheWrite + bucket.totals.output, 0);
        return {
            provider: model.provider,
            model: model.model,
            totals: totalsOf(tokens),
            costUsd: own.reduce((sum, bucket) => sum + (bucket.costUsd ?? 0), 0),
            priceBasis: 'exact' as const,
            pricedAs: null
        };
    }).filter((model) => model.costUsd > 0);
    const cost = (provider: UsageProvider, factor: number): { costUsd: number; tokens: number } => {
        const own = buckets.filter((bucket) => bucket.provider === provider);
        return {
            costUsd: Math.round(own.reduce((sum, bucket) => sum + (bucket.costUsd ?? 0), 0) * factor * 100) / 100,
            tokens: Math.round(own.reduce((sum, bucket) => sum + bucket.totals.cacheRead, 0) * factor)
        };
    };
    const projects = [
        { folder: DEMO_CWD, name: 'weather-station', factor: 0.7 },
        { folder: '/home/sam/projects/garden-planner', name: 'garden-planner', factor: 0.3 }
    ].map(({ folder, name, factor }) => {
        const claude = cost('claude', factor);
        const codex = cost('codex', factor);
        return {
            folder,
            name,
            projectId: null,
            byProvider: { claude, codex },
            totals: totalsOf(claude.tokens + codex.tokens),
            costUsd: claude.costUsd + codex.costUsd
        };
    });
    return {
        ...payload,
        buckets,
        models,
        projects,
        sessions: Math.max(1, Math.round(buckets.length / 2)),
        scan: { at: NOW - 2 * MINUTE, files: 1284, changedFiles: 3, durationMs: 420, running: false, failed: false },
        pricing: { source: 'snapshot', fetchedAt: null, models: 312 },
        rate: { currency: 'EUR', rate: 0.92, date: new Date(NOW).toISOString().slice(0, 10), fetchedAt: NOW - 60 * MINUTE },
        roots: [
            { provider: 'claude', path: '/home/sam/.claude/projects', status: 'ok', message: null },
            { provider: 'codex', path: '/home/sam/.codex/sessions', status: 'ok', message: null }
        ],
        accounts: [
            { id: 'claude', kind: 'claude', label: 'Claude Code', color: 'blue' },
            { id: 'claude-work', kind: 'claude', label: 'Work', color: 'amber' },
            { id: 'codex', kind: 'codex', label: 'Codex', color: 'teal' }
        ]
    };
}

export function usageLimits(): UsageLimitsSnapshot {
    const HOUR = 60 * MINUTE;
    return {
        providers: [
            {
                kind: 'claude',
                account: { id: 'claude', label: 'Claude Code', color: 'blue' },
                plan: 'max',
                checkedAt: NOW - 3 * MINUTE,
                source: 'probe',
                windows: [
                    { id: 'session', kind: 'session', label: 'Session', used: 0.62, resetsAt: NOW + 2 * HOUR + 14 * MINUTE, durationMs: 5 * HOUR },
                    { id: 'weekly', kind: 'weekly', label: 'Week', used: 0.31, resetsAt: NOW + 4 * 24 * HOUR, durationMs: 7 * 24 * HOUR }
                ],
                cost: null,
                unavailable: null
            },
            {
                kind: 'claude',
                account: { id: 'claude-work', label: 'Work', color: 'amber' },
                plan: 'team',
                checkedAt: NOW - 3 * MINUTE,
                source: 'probe',
                windows: [
                    { id: 'session', kind: 'session', label: 'Session', used: 0.08, resetsAt: NOW + 4 * HOUR, durationMs: 5 * HOUR },
                    { id: 'weekly', kind: 'weekly', label: 'Week', used: 0.54, resetsAt: NOW + 2 * 24 * HOUR, durationMs: 7 * 24 * HOUR }
                ],
                cost: null,
                unavailable: null
            },
            {
                kind: 'codex',
                account: { id: 'codex', label: 'Codex', color: 'teal' },
                plan: 'pro',
                checkedAt: NOW - 3 * MINUTE,
                source: 'probe',
                windows: [
                    { id: 'primary', kind: 'session', label: '5 hours', used: 0.93, resetsAt: NOW + 38 * MINUTE, durationMs: 5 * HOUR },
                    { id: 'secondary', kind: 'weekly', label: 'Week', used: 0.47, resetsAt: NOW + 5 * 24 * HOUR, durationMs: 7 * 24 * HOUR }
                ],
                cost: null,
                unavailable: null
            }
        ]
    };
}

/* A drawn landscape and a sticker without a ground, as data URLs, under the ids the generated image tools name. */
export function generatedImageUrls(): Record<string, string> {
    const landscape =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768"><defs><linearGradient id="sky" x2="0" y2="1"><stop offset="0" stop-color="#f6d7a7"/><stop offset="1" stop-color="#9cc4d8"/></linearGradient></defs><rect width="1024" height="768" fill="url(#sky)"/><circle cx="740" cy="250" r="90" fill="#fbe9b7"/><path d="M0 560 Q260 420 520 540 T1024 500 V768 H0Z" fill="#6f9a7b"/><path d="M0 640 Q300 560 620 650 T1024 620 V768 H0Z" fill="#4e7a62"/></svg>';
    const sticker =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="200" fill="#e87ba4"/><circle cx="196" cy="216" r="28" fill="#2b2b2b"/><circle cx="316" cy="216" r="28" fill="#2b2b2b"/><path d="M176 316 Q256 386 336 316" stroke="#2b2b2b" stroke-width="24" fill="none" stroke-linecap="round"/></svg>';
    const url = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return { 'image-landscape': url(landscape), 'image-sticker': url(sticker) };
}

/* An image generation in each of the states its row draws. */
export function generatedImageTools(): Record<'generating' | 'ready' | 'transparent' | 'missing' | 'failed' | 'tooLarge', ChatToolItem> {
    const tool = (id: string, patch: Partial<ChatToolItem>): ChatToolItem => ({
        id,
        kind: 'tool',
        createdAt: NOW - MINUTE,
        turnId: 'turn-image',
        toolUseId: id,
        name: 'ImageGeneration',
        input: {},
        output: null,
        state: 'done',
        parentToolUseId: null,
        ...patch
    });
    const attachment = (id: string, name: string, size: number, width: number, height: number) => ({
        id,
        name,
        mime: 'image/png',
        size,
        path: `/home/sam/.agents/attachments/${id}.png`,
        width,
        height
    });
    return {
        generating: tool('image-generating', { state: 'running', createdAt: NOW - 8_000 }),
        ready: tool('image-ready', {
            input: {
                attachment: attachment('image-landscape', 'hills-at-dusk.png', 1_260_000, 1024, 768),
                revisedPrompt:
                    'Soft rolling hills at dusk in watercolor, a pale moon over a warm sky, two layers of green fields in the foreground, muted evening colors.'
            }
        }),
        transparent: tool('image-transparent', {
            input: {
                attachment: attachment('image-sticker', 'smiling-sticker.png', 184_000, 512, 512),
                revisedPrompt: 'A round pink sticker with a smiling face, flat colors, on a transparent background.',
                transparentBackground: true
            }
        }),
        missing: tool('image-missing', { input: { attachment: attachment('image-gone', 'station-mascot.png', 940_000, 1024, 1024) } }),
        failed: tool('image-failed', { state: 'error', output: 'content_policy: the request was refused' }),
        tooLarge: tool('image-large', { input: { attachment: attachment('image-huge', 'poster.png', 14_000_000, 4096, 4096) } })
    };
}
