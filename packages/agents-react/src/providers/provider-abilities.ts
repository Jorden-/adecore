import i18next from 'i18next';
import type { ProviderCapabilities, ProviderInfo } from '@adecore/agent-contracts';

/* What a provider offers, in one sentence, where it can be opened and whether its hooks report status. */
export function providerAbilities(provider: ProviderInfo): string {
    const where = provider.capabilities.chat ? i18next.t('agent-providers:abilities.chatAndTerminal') : i18next.t('agent-providers:abilities.terminalOnly');
    const status = provider.capabilities.hooks ? i18next.t('agent-providers:abilities.reportsStatus') : i18next.t('agent-providers:abilities.noStatus');
    return `${where} ${status}`;
}

/* Whether a message sent while a turn runs may join it. Undefined while the host has not answered `provider.list`, which steers nothing. */
export function canSteer(capabilities: ProviderCapabilities | undefined): boolean {
    return capabilities?.steer === true;
}
