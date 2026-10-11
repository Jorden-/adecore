import type { ModelInfo, ProviderInfo } from '@adecore/agent-contracts';

/* A model row, or the one row that folds the legacy models open. Both take a turn in the arrow keys. */
export type PickerEntry = { kind: 'model'; provider: ProviderInfo; model: ModelInfo } | { kind: 'legacy'; count: number };

function matches(model: ModelInfo, query: string): boolean {
    return model.name.toLowerCase().includes(query) || model.slug.toLowerCase().includes(query);
}

/*
 * The rows of the model list. A model an old CLI cannot run is a row like any other, so a search for
 * only that model still finds the row that explains why it cannot be picked.
 */
export function pickerEntriesOf(providers: readonly ProviderInfo[], query: string, legacyOpen: boolean): PickerEntry[] {
    const rows = providers.flatMap((entry) => entry.models.map((model) => ({ kind: 'model' as const, provider: entry, model })));
    if (query !== '') {
        return rows.filter((row) => matches(row.model, query));
    }
    const live = rows.filter((row) => !row.model.legacy);
    const legacy = rows.filter((row) => row.model.legacy);
    if (legacy.length === 0) {
        return live;
    }
    return legacyOpen ? [...live, { kind: 'legacy', count: legacy.length }, ...legacy] : [...live, { kind: 'legacy', count: legacy.length }];
}
