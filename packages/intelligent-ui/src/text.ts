import { UI_CATALOG, UI_GROUPS, type UiGroupName } from './catalog.ts';
import { uiPropList, uiRequirement } from './prop-list.ts';
import { UI_FENCE_LANGUAGE, type UiBlock } from './compiler.ts';

export function uiCompactCatalog(): string {
    return Object.entries(UI_CATALOG)
        .map(([name, entry]) => {
            const props = uiPropList(entry).join(',');
            return `${name}${props ? `: ${props}` : ''}`;
        })
        .join(' · ');
}

export interface UiTextOptions {
    // The info string the host's compiler looks for; `UI_FENCE_LANGUAGE` without one.
    fenceLanguage?: string;
    // What the session note lists: every component with its props, or only the names per group.
    catalog?: 'props' | 'names';
    // With `names`, how the agent gets the props of a group, in the host's own words.
    detailHint?: string;
}

function uiSyntax(language: string): string {
    return `Write XML-like component tags inside a fenced ${language} block. Put text between opening and closing tags; empty components end with />. Quote string props; put numbers, booleans and expressions in braces.`;
}

function uiExample(language: string): string {
    return [
        '```' + language,
        '$enabled = false',
        '<Summary badge="Draft">Release overview</Summary>',
        '<Stats><Stat label="Tests" value={42}/></Stats>',
        '<Switch value={$enabled}>Notify me</Switch>',
        '```'
    ].join('\n');
}

function uiGroupComponents(group: string) {
    return Object.entries(UI_CATALOG).filter(([, entry]) => entry.group === group);
}

/* One line per group with its components and what each needs, for a host that hands the optional props out per group. */
function uiGroupNames(detailHint: string | undefined): string {
    const lines = Object.keys(UI_GROUPS).map(
        (group) =>
            `${group}: ${uiGroupComponents(group)
                .map(([name, entry]) => uiRequirement(name, entry))
                .join(', ')}`
    );
    return `Components by group${detailHint ? ` (${detailHint})` : ''}, required props (text: words between the tags):\n${lines.join('\n')}`;
}

export function uiSessionNote({ fenceLanguage = UI_FENCE_LANGUAGE, catalog = 'props', detailHint }: UiTextOptions = {}): string {
    const components = catalog === 'names' ? uiGroupNames(detailHint) : `Catalog (? means optional props): ${uiCompactCatalog()}`;
    return `${uiSyntax(fenceLanguage)} Prose outside. Only named catalog props, no styling. $name = literal JSON; input value={$name}; Button action={@Set($name, literal)}, {@Reset($name)} or {@Reset()} changes local state only; braced expressions: @Count, @Filter(list,row,predicate), @Sum, @Join, @Round. Show/Each control children. Choices are shortcuts after finished work that the person may ignore. When your turn would end waiting on the person (a missing fact, a decision, a go-ahead for work you would otherwise do), ask with your own question tool if you have one, otherwise in prose, never with Choices. Choice labels and precise context stay visible and send once. Image: attachment or generated="latest", never URL/path. No code execution. State resets on reload. ${components}\nExample:\n${uiExample(fenceLanguage)}\n`;
}

/* One group as the reference writes it: its description and rules, then every component with its props. */
export function uiGroupReference(group: UiGroupName): string {
    const components = uiGroupComponents(group).map(([name, entry]) => {
        const props = uiPropList(entry).join(', ');
        return `${name}: ${entry.description}${props ? ` Props: ${props}.` : ''}`;
    });
    return [UI_GROUPS[group].description, UI_GROUPS[group].rules, ...components].join('\n');
}

export function uiReferenceText({ fenceLanguage = UI_FENCE_LANGUAGE }: UiTextOptions = {}): string {
    const groups = (Object.keys(UI_GROUPS) as UiGroupName[]).map(uiGroupReference).join('\n\n');
    return `${uiSyntax(fenceLanguage)}\nExample:\n${uiExample(fenceLanguage)}\n\n${groups}`;
}

export function uiFallbackText(text: string, blocks: readonly UiBlock[]): string {
    let result = '';
    let position = 0;
    for (const block of [...blocks].sort((first, second) => first.start - second.start)) {
        if (block.start < position || block.end < block.start || block.end > text.length) {
            continue;
        }
        result += text.slice(position, block.start) + block.fallback + '\n';
        position = block.end;
    }
    return result + text.slice(position);
}
