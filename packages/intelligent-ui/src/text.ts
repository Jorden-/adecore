import { UI_CATALOG, UI_GROUPS } from './catalog.ts';
import { uiPropList } from './prop-list.ts';
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
        '<Choices><Choice context="Review the release overview">Continue</Choice></Choices>',
        '```'
    ].join('\n');
}

export function uiSessionNote({ fenceLanguage = UI_FENCE_LANGUAGE }: UiTextOptions = {}): string {
    return `${uiSyntax(fenceLanguage)} Prose outside. Only named catalog props, no styling. $name = literal JSON; input value={$name}; Button action={@Set($name, literal)}, {@Reset($name)} or {@Reset()} changes local state only; braced expressions: @Count, @Filter(list,row,predicate), @Sum, @Join, @Round. Show/Each control children. Choices only offer optional next steps after a finished answer; ask for information or a decision needed before acting with your own question tool if you have one, otherwise in prose. Choice labels and precise context stay visible and send once. Image: attachment or generated="latest", never URL/path. No code execution. State resets on reload. Catalog (? means optional props): ${uiCompactCatalog()}\nExample:\n${uiExample(fenceLanguage)}\n`;
}

export function uiReferenceText({ fenceLanguage = UI_FENCE_LANGUAGE }: UiTextOptions = {}): string {
    const groups = Object.entries(UI_GROUPS)
        .map(([group, definition]) => {
            const components = Object.entries(UI_CATALOG)
                .filter(([, entry]) => entry.group === group)
                .map(([name, entry]) => {
                    const props = uiPropList(entry).join(', ');
                    return `${name}: ${entry.description}${props ? ` Props: ${props}.` : ''}`;
                });
            return [definition.description, definition.rules, ...components].join('\n');
        })
        .join('\n\n');
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
