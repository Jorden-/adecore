type Bundle = Record<string, unknown>;

/* The words of this package, a namespace per surface, which the app adds to its i18next beside its own namespaces. */
export const AGENTS_NAMESPACES = ['agent-chat', 'agent-prompts', 'agent-providers', 'agent-usage'] as const;

export type AgentsNamespace = (typeof AGENTS_NAMESPACES)[number];

type Files = Record<AgentsNamespace, () => Promise<{ default: Bundle }>>;

async function open(files: Files): Promise<Record<AgentsNamespace, Bundle>> {
    return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([namespace, file]) => [namespace, (await file()).default]))) as Record<
        AgentsNamespace,
        Bundle
    >;
}

/* The words are modules, not JSON: Node needs `with { type: 'json' }` on a JSON import, and a browser refuses it on the JavaScript Vite serves. */
/* One loader per language that answers every namespace of it, so a bundler splits them and a window only downloads the language it shows. */
export const AGENTS_LOCALES: Record<string, () => Promise<Record<AgentsNamespace, Bundle>>> = {
    en: () =>
        open({
            'agent-chat': () => import('./locales/en/agent-chat'),
            'agent-prompts': () => import('./locales/en/agent-prompts'),
            'agent-providers': () => import('./locales/en/agent-providers'),
            'agent-usage': () => import('./locales/en/agent-usage')
        }),
    nl: () =>
        open({
            'agent-chat': () => import('./locales/nl/agent-chat'),
            'agent-prompts': () => import('./locales/nl/agent-prompts'),
            'agent-providers': () => import('./locales/nl/agent-providers'),
            'agent-usage': () => import('./locales/nl/agent-usage')
        })
};
