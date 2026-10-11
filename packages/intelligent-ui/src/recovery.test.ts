import { describe, expect, test } from 'bun:test';
import { UI_CATALOG, type UiComponentName } from './catalog.ts';
import { compileUiBlock } from './compiler.ts';
import { evaluateUiBlock, resolveUiChoice, uiChoiceLabel, type UiViewNode } from './runtime.ts';

function block(source: string, final = true) {
    return compileUiBlock(source, { id: 'block', final, limits: { milliseconds: 5000 } });
}

function choices(source: string): UiViewNode[] {
    return evaluateUiBlock(block(source)).nodes.find((node) => node.type === 'Choices')!.children;
}

describe('a malformed prop', () => {
    test('a bare prop name is true, as in JSX, and keeps every label', () => {
        const compiled = block('<Choices><Choice primary context="Run">Run</Choice><Choice>Keep</Choice></Choices>');
        expect(compiled.diagnostics).toEqual([]);
        const [first, second] = choices('<Choices><Choice primary context="Run">Run</Choice><Choice>Keep</Choice></Choices>');
        expect(first!.props).toEqual({ primary: true, context: 'Run' });
        expect([uiChoiceLabel(first!), uiChoiceLabel(second!)]).toEqual(['Run', 'Keep']);
        expect(block('<Choices><Choice primary>Go</Choice></Choices>').nodes[0]!.children[0]!.props).toEqual({ primary: true });
    });

    test('costs only its own token: the tag still closes, its children and neighbors stay', () => {
        const compiled = block('<Choices><Choice tone=loud context="Run">Run</Choice><Choice>Keep</Choice></Choices>');
        expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['invalid_prop']);
        const [first, second] = compiled.nodes[0]!.children;
        expect(first!.error).toBe('invalid_syntax');
        expect(first!.props.context).toBe('Run');
        expect(first!.children.map((child) => child.props.text)).toEqual(['Run']);
        expect(second!.error).toBeUndefined();
        expect(compiled.fallback).toContain('Run');
        expect(compiled.fallback).toContain('Keep');
        expect(compiled.fallback).not.toContain('<Choice');
    });

    test('a tag that lost a prop and is never closed ends at its own bracket', () => {
        const compiled = block('<Summary>One</Summary>\n<Stat value=>\n<Summary>Two</Summary>');
        expect(compiled.nodes.map((node) => node.type)).toEqual(['Summary', 'Stat', 'Summary']);
        expect(compiled.nodes[1]!.error).toBeDefined();
    });

    test('waits for more text while it streams', () => {
        for (const prefix of ['<Choices><Choice primary', '<Choices><Choice primary ', '<Choices><Choice context="Ru']) {
            expect(block(prefix, false).diagnostics).toEqual([]);
        }
    });
});

describe('a Choice that cannot send', () => {
    test('is an error in a final block when it never closed or has no label', () => {
        const unclosed = block('<Choices><Choice context="Run checks">Run checks');
        expect(unclosed.nodes[0]!.children[0]!.error).toBe('unclosed_tag');
        for (const source of ['<Choices><Choice context="Run checks"></Choice></Choices>', '<Choices><Choice>  </Choice></Choices>']) {
            const compiled = block(source);
            expect(compiled.nodes[0]!.children[0]!.error).toBe('invalid_props');
            expect(compiled.diagnostics.map((diagnostic) => diagnostic.message)).toContain('A choice needs a visible label.');
        }
        expect(block('<Choices><Choice context="Run checks">Run checks', false).nodes[0]!.children[0]!.error).toBeUndefined();
        expect(block('<Choices><Choice>{$missing}</Choice></Choices>').nodes[0]!.children[0]!.error).toBeUndefined();
    });

    test('has no label for the page and is refused by the host, for the same reasons', () => {
        const refused = [
            '<Choices><Choice context="Run checks"></Choice></Choices>',
            '<Choices><Choice context="Run checks">Run checks',
            '<Choices><Choice context="Run checks">Run {$missing}</Choice></Choices>',
            '$empty = ""\n<Choices><Choice context="Run checks">{$empty}</Choice></Choices>'
        ];
        for (const source of refused) {
            const choice = choices(source)[0]!;
            expect(uiChoiceLabel(choice)).toBeNull();
            expect(() => resolveUiChoice(block(source), choice.id)).toThrow();
        }
        const valid = choices('<Choices><Choice context="Run checks"> Run   checks </Choice></Choices>')[0]!;
        expect(uiChoiceLabel(valid)).toBe('Run checks');
        expect(resolveUiChoice(block('<Choices><Choice context="Run checks"> Run   checks </Choice></Choices>'), valid.id).label).toBe('Run checks');
    });
});

/* Props that only style a node or drive local state; every other prop is content another reader needs. */
const PRESENTATIONAL: Partial<Record<UiComponentName, readonly string[]>> = {
    Summary: ['tone'],
    Callout: ['tone'],
    Tag: ['tone'],
    Stat: ['tone'],
    Chart: ['kind'],
    Column: ['as'],
    CodeBlock: ['language'],
    Image: ['generated', 'attachment'],
    Choice: ['primary', 'disabled'],
    Button: ['disabled'],
    Checklist: ['value'],
    Item: ['value'],
    Switch: ['value'],
    Slider: ['value', 'min', 'max', 'step', 'unit'],
    Segmented: ['value'],
    Option: ['value'],
    Show: ['when'],
    Each: ['items', 'as']
};

/* A source per component whose content props each carry a marker the fallback has to keep. */
const MARKED: Partial<Record<UiComponentName, string>> = {
    Summary: '<Summary tone="danger" badge="mark-badge">mark-title</Summary>',
    Callout: '<Callout tone="info" title="mark-title">mark-body</Callout>',
    Progress: '<Progress value={37} max={91}>mark-label</Progress>',
    Steps: '<Steps><Step state="failed" detail="mark-detail">mark-step</Step></Steps>',
    Stats: '<Stats><Stat label="mark-label" value={37} previous={91} unit="mark-unit"/></Stats>',
    EntityList: '<EntityList><Entry label="mark-label">mark-value</Entry></EntityList>',
    Table: '<Table rows={[{mark: 37}]}><Column key="mark" title="mark-title" unit="mark-unit"/></Table>',
    Chart: '<Chart kind="bar" unit="mark-unit" data={[{label: "mark-label", value: 37}]}/>',
    Tabs: '<Tabs><Tab title="mark-title">mark-body</Tab></Tabs>',
    Sections: '<Sections><Section title="mark-title">mark-body</Section></Sections>',
    Image: '<Image attachment="a1" alt="mark-alt"/>',
    Sources: '<Sources><Source title="mark-title" url="https://mark.example/"/></Sources>',
    File: '<File path="mark/path.ts" line={37}>mark-body</File>',
    Diff: '<Diff path="mark/path.ts"/>',
    Commit: '<Commit sha="abcdef1"/>',
    Node: '<Node id="mark-node"/>',
    Choices: '<Choices><Choice context="mark-context">mark-label</Choice></Choices>'
};

describe('the text fallback', () => {
    test('keeps every content prop of every component', () => {
        const nodes = (source: string): string[] => {
            const compiled = block(source);
            const types: string[] = [];
            const visit = (list: typeof compiled.nodes) => {
                for (const node of list) {
                    types.push(node.type);
                    visit(node.children);
                }
            };
            visit(compiled.nodes);
            return types;
        };
        const covered = new Set(Object.values(MARKED).flatMap((source) => nodes(source!)));
        for (const [name, entry] of Object.entries(UI_CATALOG)) {
            const content = Object.keys(entry.schema.shape ?? {}).filter((prop) => !PRESENTATIONAL[name as UiComponentName]?.includes(prop));
            if (content.length > 0) {
                expect(covered.has(name)).toBe(true);
            }
        }
        for (const source of Object.values(MARKED)) {
            const compiled = block(source!);
            expect(compiled.diagnostics).toEqual([]);
            for (const marker of source!.match(/mark[\w./-]*|\b(?:37|91|abcdef1|failed)\b/g) ?? []) {
                expect(compiled.fallback).toContain(marker.replace(/^https?:\/\//, ''));
            }
        }
    });

    test('says a step and its state and detail, and never the source of a tag', () => {
        expect(block('<Steps><Step state="pending" detail="Make a backup first.">Migration</Step></Steps>').fallback).toBe(
            'Migration (pending): Make a backup first.'
        );
        expect(block('<Choices><Choice tone=loud>Run</Choice></Choices>').fallback).not.toContain('<');
    });
});
