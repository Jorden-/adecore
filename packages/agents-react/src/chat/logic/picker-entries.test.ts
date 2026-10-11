import { describe, expect, test } from 'bun:test';
import type { ModelInfo, ProviderInfo } from '@adecore/agent-contracts';
import { pickerEntriesOf } from './picker-entries';

const model = (slug: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ slug, name: slug, legacy: false, isDefault: false, options: [], ...extra });
const provider = (models: ModelInfo[]): ProviderInfo => ({ kind: 'claude', name: 'Claude Code', version: '1.0.0', models }) as ProviderInfo;

describe('pickerEntriesOf', () => {
    test('a search for only a model an old CLI cannot run still finds its row', () => {
        const blocked = model('claude-opus-9', { minCliVersion: '9.0' });
        const entries = pickerEntriesOf([provider([blocked])], 'opus', false);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: 'model', model: { slug: 'claude-opus-9' } });
    });

    test('legacy models sit behind one expander row', () => {
        const providers = [provider([model('a'), model('b', { legacy: true })])];
        expect(pickerEntriesOf(providers, '', false).map((entry) => entry.kind)).toEqual(['model', 'legacy']);
        expect(pickerEntriesOf(providers, '', true).map((entry) => entry.kind)).toEqual(['model', 'legacy', 'model']);
    });
});
