import type { ModelInfo, ProviderInfo } from '@adecore/agent-contracts';

export interface ModelRequirement {
    /* The CLI's name, as the provider list gives it. */
    cli: string;
    minVersion: string;
}

function partsOf(version: string, strict: boolean): number[] | null {
    const found = (strict ? /^(\d+)\.(\d+)(?:\.(\d+))?$/ : /(\d+)\.(\d+)\.(\d+)/).exec(version);
    return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3] ?? 0)];
}

/* Whether the model's reported name is this model: its slug, the slug with a suffix such as `[1m]`. */
function isReported(slug: string, reported: ReadonlySet<string>): boolean {
    return [...reported].some((name) => name === slug || name.startsWith(`${slug}[`));
}

/*
 * What a model asks of the CLI that is too old for it, or null when nothing blocks it: no minimum is
 * known, the CLI's version is not a readable x.y.z (so an unknown version invents no requirement), the
 * CLI is new enough, or a chat of this provider already reported running the model.
 */
export function modelRequirementOf(model: ModelInfo, provider: ProviderInfo, reported: ReadonlySet<string>): ModelRequirement | null {
    const minimum = model.minCliVersion === undefined ? null : partsOf(model.minCliVersion, true);
    const installed = provider.version === null ? null : partsOf(provider.version, false);
    if (minimum === null || installed === null || isReported(model.slug, reported)) {
        return null;
    }
    for (let i = 0; i < 3; i++) {
        if (installed[i] !== minimum[i]) {
            return (installed[i] ?? 0) > (minimum[i] ?? 0) ? null : { cli: provider.name, minVersion: model.minCliVersion ?? '' };
        }
    }
    return null;
}
