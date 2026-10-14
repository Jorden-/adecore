import { expect, test } from 'bun:test';
import { librarySourceAliases } from './.vitepress/library-source.ts';

function resolve(specifier: string): string | undefined {
    const alias = librarySourceAliases().find((entry) => entry.find.test(specifier));
    return alias && specifier.replace(alias.find, alias.replacement);
}

test('docs resolve exact, nested, wildcard and asset source exports from workspace manifests', () => {
    expect(resolve('@adecore/ui')).toEndWith('/packages/ui/src/index.ts');
    expect(resolve('@adecore/ui/testing/dedupe')).toEndWith('/packages/ui/src/testing/dedupe.ts');
    expect(resolve('@adecore/agents/chat')).toEndWith('/packages/agents/src/chat/index.ts');
    expect(resolve('@adecore/agents/providers/codex-models.json')).toEndWith('/packages/agents/src/providers/codex-models.json');
    expect(resolve('@adecore/agents-react/locales/nl/agent-chat')).toEndWith('/packages/agents-react/src/locales/nl/agent-chat.ts');
    expect(resolve('@adecore/service/definitions')).toEndWith('/packages/service/src/definitions.ts');
    expect(resolve('@adecore/terminal/terminal.css')).toEndWith('/packages/terminal/src/terminal.css');
    expect(resolve('@adecore/ui-unknown')).toBeUndefined();
});
