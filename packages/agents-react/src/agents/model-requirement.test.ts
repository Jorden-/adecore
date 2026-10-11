import { describe, expect, test } from 'bun:test';
import type { ModelInfo, ProviderInfo } from '@adecore/agent-contracts';
import { modelRequirementOf } from './model-requirement';

const model = (minCliVersion?: string): ModelInfo => ({
    slug: 'claude-opus-9',
    name: 'Opus 9',
    legacy: false,
    isDefault: false,
    options: [],
    ...(minCliVersion === undefined ? {} : { minCliVersion })
});
const provider = (version: string | null): ProviderInfo => ({ name: 'Claude Code', version }) as ProviderInfo;
const NONE: ReadonlySet<string> = new Set();

describe('modelRequirementOf', () => {
    test('a model with no minimum asks nothing', () => {
        expect(modelRequirementOf(model(), provider('1.0.0'), NONE)).toBeNull();
    });

    test('an unreadable version invents no requirement', () => {
        expect(modelRequirementOf(model('2.1'), provider(null), NONE)).toBeNull();
        expect(modelRequirementOf(model('2.1'), provider('Disabled in Settings'), NONE)).toBeNull();
    });

    test('a CLI at or above the minimum is fine', () => {
        expect(modelRequirementOf(model('2.1'), provider('2.1.0 (Claude Code)'), NONE)).toBeNull();
        expect(modelRequirementOf(model('2.1.4'), provider('2.1.4'), NONE)).toBeNull();
        expect(modelRequirementOf(model('2.1'), provider('3.0.0'), NONE)).toBeNull();
    });

    test('an older CLI is named with the minimum', () => {
        expect(modelRequirementOf(model('2.1'), provider('2.0.9 (Claude Code)'), NONE)).toEqual({ cli: 'Claude Code', minVersion: '2.1' });
        expect(modelRequirementOf(model('2.1.4'), provider('2.1.3'), NONE)).toEqual({ cli: 'Claude Code', minVersion: '2.1.4' });
        expect(modelRequirementOf(model('10.0'), provider('9.9.9'), NONE)).not.toBeNull();
    });

    test('a model a chat reported running is not blocked', () => {
        expect(modelRequirementOf(model('9.0'), provider('1.0.0'), new Set(['claude-opus-9']))).toBeNull();
        expect(modelRequirementOf(model('9.0'), provider('1.0.0'), new Set(['claude-opus-9[1m]']))).toBeNull();
        expect(modelRequirementOf(model('9.0'), provider('1.0.0'), new Set(['claude-opus-90']))).not.toBeNull();
    });
});
