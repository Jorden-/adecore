import { expect, test } from 'bun:test';
import type { ProviderCapabilities } from '@adecore/agent-contracts';
import { canSteer } from './provider-abilities';

test('only a provider that reports steer takes a message into a running turn', () => {
    expect(canSteer({ steer: true } as ProviderCapabilities)).toBe(true);
    expect(canSteer({ steer: false } as ProviderCapabilities)).toBe(false);
    // A host from before the field, and one that has not answered `provider.list` yet, queue every send.
    expect(canSteer({} as ProviderCapabilities)).toBe(false);
    expect(canSteer(undefined)).toBe(false);
});
