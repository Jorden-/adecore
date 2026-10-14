import type { UsageLimitsSnapshot, UsageSummaryPayload, UsageSummaryResult } from '@adecore/agent-contracts';
import { chatStorageKey, chatStorageLegacyKeys, createChatStore, onChatStorageConfiguration } from '../storage';
import { persistedJson } from '../chat/persisted-json';
import { localTimeZone } from '@adecore/ui/format';
import { useChatScope } from '../scope';
import type { UsageCurrency } from '../usage/format';

export type UsagePeriod = 'today' | '7d' | '30d' | '90d';
export type UsageMetric = 'cost' | 'tokens';

/* Only the id and the length. A store has no words, so the page names a period in its own language. */
export const USAGE_PERIODS: readonly { id: UsagePeriod; days: number }[] = [
    { id: 'today', days: 1 },
    { id: '7d', days: 7 },
    { id: '30d', days: 30 },
    { id: '90d', days: 90 }
];

const storageKey = (): string => chatStorageKey('usage');

export let USAGE_PREFERENCES_KEY = storageKey();
onChatStorageConfiguration(() => {
    USAGE_PREFERENCES_KEY = storageKey();
});

interface Preferences {
    period: UsagePeriod;
    metric: UsageMetric;
    /* Dollars until someone asks for euros; it is the viewer's setting, not the project's. */
    currency: UsageCurrency;
}

const DEFAULTS: Preferences = { period: '7d', metric: 'cost', currency: 'USD' };

function parsePreferences(raw: string | null): Preferences {
    try {
        const stored = JSON.parse(raw ?? '{}') as Partial<Preferences>;
        return {
            period: USAGE_PERIODS.some((period) => period.id === stored.period) ? stored.period! : DEFAULTS.period,
            metric: stored.metric === 'tokens' || stored.metric === 'cost' ? stored.metric : DEFAULTS.metric,
            currency: stored.currency === 'EUR' ? 'EUR' : DEFAULTS.currency
        };
    } catch {
        return DEFAULTS;
    }
}

const storage = persistedJson(storageKey, parsePreferences, DEFAULTS, () => chatStorageLegacyKeys('usage'));

/* The three stored choices out of the store, so a setter writes the other two back unchanged. */
function chosen(state: Preferences): Preferences {
    return { period: state.period, metric: state.metric, currency: state.currency };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/* The viewer's own calendar day; the host may stand in another zone and buckets in this one. */
export function dayOf(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* What a period asks for: today in hours from local midnight, every other period a bar per calendar day. */
export function windowFor(period: UsagePeriod, now = new Date()): UsageSummaryPayload {
    const days = USAGE_PERIODS.find((entry) => entry.id === period)?.days ?? 7;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return {
        from: dayOf(from),
        to: dayOf(now),
        resolution: period === 'today' ? 'hour' : 'day',
        timeZone: localTimeZone() ?? 'UTC'
    };
}

/* A period, and only the usage of one account when one is picked; null is every account. */
export function summaryPayload(period: UsagePeriod, account: string | null, now = new Date()): UsageSummaryPayload {
    return account === null ? windowFor(period, now) : { ...windowFor(period, now), accounts: [account] };
}

/* What was asked, so an answer to the question before this one is never drawn over a newer one. */
export function askedKey(payload: UsageSummaryPayload): string {
    return `${payload.from}\0${payload.to}\0${payload.resolution}\0${payload.timeZone}\0${payload.accounts?.join(',') ?? ''}`;
}

/* The numbers of one host: its transcripts, priced by it. */
interface UsageRow {
    /* The question the summary on screen answers, or null while nothing has come back yet. */
    asked: string | null;
    summary: UsageSummaryResult | null;
    /* True while the host has not answered the question that is being asked now. */
    loading: boolean;
    /* The last request failed; the summary before it stays on screen under a red line. */
    failed: boolean;
    limits: UsageLimitsSnapshot | null;
}

/* One object for a host nothing was read from yet, so a selector gets a stable snapshot. */
const EMPTY: UsageRow = { asked: null, summary: null, loading: false, failed: false, limits: null };

interface UsageStore extends Preferences {
    byScope: Record<string, UsageRow>;
    /*
     * The host the usage page shows, by scope id, or null for the one around it. Not stored: a
     * remembered host outlives this client's knowledge of it. It does survive closing the page.
     */
    chosen: string | null;
    /* Which host's numbers the page shows; null hands it back to the one around it. */
    choose(scopeId: string | null): void;
    setPeriod(period: UsagePeriod): void;
    setMetric(metric: UsageMetric): void;
    setCurrency(currency: UsageCurrency): void;
    setLoading(scopeId: string, loading: boolean): void;
    receive(scopeId: string, asked: string, summary: UsageSummaryResult): void;
    fail(scopeId: string): void;
    setLimits(scopeId: string, limits: UsageLimitsSnapshot): void;
    /* A host that is forgotten takes its numbers with it; the three preferences are the viewer's and stay. */
    forget(scopeId: string): void;
}

/* Reads the period, metric and currency again, once another window of the same origin wrote them. */
export function reloadUsagePreferences(): void {
    useUsageStore.setState(storage.read());
}

export const useUsageStore = createChatStore<UsageStore>(
    (set, get) => {
        const choosePreference = (change: Partial<Preferences>): void => {
            storage.write({ ...chosen(get()), ...change });
            set(change);
        };
        const patchRow = (scopeId: string, change: Partial<UsageRow>): void => {
            set({ byScope: { ...get().byScope, [scopeId]: { ...(get().byScope[scopeId] ?? EMPTY), ...change } } });
        };
        return {
            ...DEFAULTS,
            byScope: {},
            chosen: null,
            choose(scopeId) {
                set({ chosen: scopeId });
            },
            setPeriod(period) {
                choosePreference({ period });
            },
            setMetric(metric) {
                choosePreference({ metric });
            },
            setCurrency(currency) {
                choosePreference({ currency });
            },
            setLoading(scopeId, loading) {
                patchRow(scopeId, { loading });
            },
            receive(scopeId, asked, summary) {
                patchRow(scopeId, { asked, summary, loading: false, failed: false });
            },
            fail(scopeId) {
                patchRow(scopeId, { loading: false, failed: true });
            },
            setLimits(scopeId, limits) {
                patchRow(scopeId, { limits });
            },
            forget(scopeId) {
                const { [scopeId]: _gone, ...rest } = get().byScope;
                set({ byScope: rest });
            }
        };
    },
    (store) => store.setState(storage.read())
);

/*
 * The viewer's preferences over the numbers of the host in scope. The usage page renders its picked
 * host as a scope of its own, so browsing another host's spend never moves the limit bars outside it.
 */
export type UsageView = Preferences & UsageRow;

export function useUsage<T>(select: (view: UsageView) => T): T {
    const { id } = useChatScope();
    return useUsageStore((s) => select({ period: s.period, metric: s.metric, currency: s.currency, ...(s.byScope[id] ?? EMPTY) }));
}
