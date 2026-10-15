import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { UiBudget } from './budget.ts';
import { compileUi, compileUiBlock, uiHasFence, uiMayReferenceHost } from './compiler.ts';
import { UI_CATALOG, UI_CATALOG_VERSION, UI_GROUPS, uiCatalogText } from './catalog.ts';
import { copyUiValue, evaluateUiExpression, parseUiExpression, sameUiValue } from './expression.ts';
import { evaluateUiBlock, UiState } from './runtime.ts';
import { UiBlockSchema, UiNodeSchema } from './protocol.ts';
import { uiCompactCatalog, uiFallbackText, uiGroupReference, uiReferenceText, uiSessionNote } from './text.ts';

function expression(source: string, variables = {}): unknown {
    return evaluateUiExpression(parseUiExpression(source, new UiBudget({ milliseconds: 5000 })), variables, new UiBudget({ milliseconds: 5000 }));
}

function block(source: string, final = true) {
    return compileUiBlock(source, { id: 'chat:item:block', final, limits: { milliseconds: 5000 } });
}

describe('bounded expressions', () => {
    test('compares values without regard to the order of their keys', () => {
        expect(sameUiValue({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
        expect(sameUiValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(sameUiValue([1, 2], [2, 1])).toBe(false);
        expect(sameUiValue([], {})).toBe(false);
        expect(sameUiValue(null, {})).toBe(false);
    });

    test('arithmetic, strings, own fields and short circuiting', () => {
        expect(expression('1 + 2 * 3')).toBe(7);
        expect(expression('"Fix " + @Count($selected)', { $selected: ['one', 'two'] })).toBe('Fix 2');
        expect(expression('$rows[0].value', { $rows: [{ value: 42 }] })).toBe(42);
        expect(expression('false && $missing')).toBe(false);
        expect(expression('true || $missing')).toBe(true);
        expect(expression('@Round(14.159, 2)')).toBe(14.16);
        expect(expression('@Sum([{value: 2}, {value: 3}], "value")')).toBe(5);
        expect(expression('@Join(["a", "b"], ", ")')).toBe('a, b');
        expect(expression('@Filter($rows, row, row.failed)', { $rows: [{ failed: false }, { failed: true }] })).toEqual([{ failed: true }]);
    });

    test('never calls JavaScript or reads prototypes', () => {
        for (const source of [
            'globalThis',
            'fetch("https://example.com")',
            '$value.toString()',
            '$value["constructor"]',
            '$value.__proto__',
            '@eval("1")',
            '() => 1',
            '{__proto__: {}}',
            '{constructor: 1}',
            '$value.prototype'
        ]) {
            expect(() => expression(source, { $value: {} })).toThrow();
        }
        const object = Object.create({ inherited: 2 });
        expect(() => expression('$value.inherited', { $value: object })).toThrow();
        let called = false;
        const accessor = Object.defineProperty({}, 'secret', {
            enumerable: true,
            get() {
                called = true;
                return 1;
            }
        });
        expect(() => expression('$value.secret', { $value: accessor })).toThrow();
        expect(called).toBe(false);
        expect(() => expression('1 / 0')).toThrow();
        expect(() => expression('@Set($value, 1)', { $value: 0 })).toThrow();
        expect(() => expression('@Query("tasks", {})')).toThrow();
    });

    test('budgets count helper work and bound strings, depth and time', () => {
        const parsed = parseUiExpression('@Sum($items)');
        expect(() => evaluateUiExpression(parsed, { $items: Array(30).fill(1) }, new UiBudget({ iterations: 40 }))).toThrow('iteration budget');
        const joined = parseUiExpression('@Join($items, "abcdefgh")');
        expect(() => evaluateUiExpression(joined, { $items: Array(10).fill('abc') }, new UiBudget({ stringLength: 40 }))).toThrow();
        expect(() => parseUiExpression(`${'('.repeat(40)}1${')'.repeat(40)}`)).toThrow('nesting budget');
        expect(() => parseUiExpression('1 + 2', new UiBudget({ steps: 2 }))).toThrow();
        let time = 0;
        const timed = new UiBudget({ milliseconds: 10 }, () => time++ * 20);
        expect(() => parseUiExpression('1', timed)).toThrow('work budget');
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => copyUiValue(circular)).toThrow();
        expect(() => copyUiValue(new Array(1))).toThrow();
    });
});

const EXAMPLES = [
    '<Summary tone="success">Ready to ship</Summary>',
    '$selected = ["links", "preload"]\n$show = false\n<Summary>{@Count($selected)} selected</Summary><Switch value={$show}>Show nits</Switch><Checklist value={$selected}><Item value="links"><File path="src/links.ts" line="148">Fix a path</File></Item><Show when={$show}><Item value="nits">Nits</Item></Show></Checklist><Choices><Choice context={"Fix " + @Join($selected, ", ")}>Fix {@Count($selected)}</Choice></Choices>',
    '<Stats><Stat label="Passed" value={32} previous={29} tone="success"/></Stats><EntityList><Entry label="Owner">Bas</Entry></EntityList>',
    '<Table rows={[{name: "Core", size: 32}]}><Column key="name"/><Column key="size" as="number"/></Table>',
    '<Chart kind="bar" data={[{label: "Core", passed: 32, failed: 1}]}/>',
    '<Tabs><Tab title="First">One</Tab><Tab title="Second">Two</Tab></Tabs><Sections><Section title="Details">Text</Section></Sections>',
    '<CodeBlock language="ts">const markup = "<b>{text}</b>";</CodeBlock><Sources><Source title="Docs" url="https://adecore.dev/"/></Sources>',
    '$count = 4\n$mode = "all"\n<Slider value={$count} min={1} max={16}/><Segmented value={$mode}><Option value="all">All</Option><Option value="failed">Failed</Option></Segmented><Button action={@Set($mode, "failed")}>Failed only</Button><Button action={@Reset()} disabled={$mode == "all"}>Reset</Button>',
    '$rows = [{name: "Core"}, {name: "Client"}]\n<EntityList><Each items={$rows} as="row"><Entry label={row.name}>Ready</Entry></Each></EntityList>',
    '<Image generated="latest" alt="A rabbit"/><Steps><Step state="done">Built</Step><Step state="pending">Review</Step></Steps>',
    '<Timeline><Event at="14:02" tone="warning" detail="p95 above 2 s">Alert fired</Event><Event at="2026-10-14T14:09:00Z">Rolled back</Event></Timeline>',
    '<Gallery><Image attachment="a1" alt="Login">Before</Image><Image attachment="a2" alt="Home"/></Gallery><Compare before="a1" after="a2" beforeLabel="Old">Header</Compare>',
    '$q = "ada"\n$kind = "bug"\n<TextField value={$q} maxLength={32} placeholder="Name">Who</TextField><Select value={$kind}><Option value="bug">Bug</Option><Option value="idea">Idea</Option></Select>'
];

describe('streaming compiler', () => {
    test('compiles all catalog examples and evaluates them', () => {
        for (const source of EXAMPLES) {
            const compiled = block(source);
            expect(compiled.diagnostics).toEqual([]);
            const evaluated = evaluateUiBlock(compiled, undefined, { milliseconds: 5000 });
            expect(evaluated.diagnostics).toEqual([]);
            expect(evaluated.nodes.length).toBeGreaterThan(0);
            expect(compiled.fallback).not.toBe('');
        }
        expect(Object.keys(UI_CATALOG)).toHaveLength(44);
        expect(uiCatalogText()).toContain('Image(attachment?, generated?, alt?)');
        expect(uiCatalogText()).toContain('Button(action, disabled?)');
    });

    test('every prefix is bounded and retains stable nodes after their tag arrives', () => {
        for (const source of EXAMPLES) {
            const complete = block(source);
            const ids = new Set(complete.nodes.map((node) => node.id));
            for (let i = 0; i <= source.length; i++) {
                const partial = block(source.slice(0, i), false);
                expect(partial.diagnostics.some((diagnostic) => diagnostic.code === 'budget_exceeded')).toBe(false);
                for (const node of partial.nodes) {
                    expect(ids.has(node.id)).toBe(true);
                }
            }
        }
    });

    test('preserves spaces between expressions, tags and inline links', () => {
        const compiled = block('$count = 3\n<Summary>Found {$count} <Tag>new</Tag></Summary><File path="a.ts"/> <File path="b.ts"/>');
        const evaluated = evaluateUiBlock(compiled);
        expect(evaluated.nodes[0].children.map((node) => (node.type === '$text' ? node.props.text : node.children[0].props.text)).join('')).toBe('Found 3 new');
        expect(evaluated.nodes[2].props.text).toBe(' ');
        expect(block('<Summary>One</Summary>\n\n<Summary>Two</Summary>').nodes).toHaveLength(2);
    });

    test('finds multiple fences and preserves surrounding text offsets', () => {
        const source = 'Before\n```ui\n<Summary>One</Summary>\n```\nBetween\n~~~ui\n<Tag>Two</Tag>\n~~~\nAfter';
        const compiled = compileUi(source, { id: 'item', final: true });
        expect(compiled).toHaveLength(2);
        expect(source.slice(compiled[0].start, compiled[0].end)).toStartWith('```ui');
        expect(compiled[0].fallback).toBe('One');
        expect(compiled[1].fallback).toBe('Two');
        const otherFence = '````md\n```ui\n<Summary>Hidden</Summary>\n```\n````';
        expect(compileUi(otherFence, { id: 'item' })).toEqual([]);
        const partial = compileUi('```ui\n<Summary>Still writing', { id: 'item' });
        expect(partial[0].complete).toBe(false);
        expect(partial[0].nodes[0].complete).toBe(false);
    });

    test('tells a reply that may reach the host from one that cannot', () => {
        expect(uiMayReferenceHost('<Summary>Plain</Summary>')).toBe(false);
        expect(uiMayReferenceHost('$rows = @Query("rows", {})')).toBe(true);
        expect(uiMayReferenceHost('<Diff path="a.ts"/>')).toBe(true);
        expect(uiMayReferenceHost('<Nodes/>')).toBe(false);
        expect(uiMayReferenceHost('<Map><Place lat={52} lon={5}>Utrecht</Place></Map>')).toBe(false);
        expect(uiMayReferenceHost('<Place address="Domplein 1, Utrecht">Dom</Place>')).toBe(true);
        expect(uiMayReferenceHost('<Place detail="a > b" address="Domplein 1">Dom</Place>')).toBe(true);
        expect(uiMayReferenceHost('<Place lat={52} lon={5} detail="address=">Dom</Place>')).toBe(false);
    });

    test('reads only the fence language the host names', () => {
        const source = '```ui\n<Summary>Default</Summary>\n```\n```legacy-ui\n<Summary>Named</Summary>\n```';
        expect(compileUi(source, { id: 'item', final: true }).map((compiled) => compiled.fallback)).toEqual(['Default']);
        expect(compileUi(source, { id: 'item', final: true, fenceLanguage: 'legacy-ui' }).map((compiled) => compiled.fallback)).toEqual(['Named']);
        expect(uiHasFence('Text\n  ~~~ legacy-ui \r\n<Tag>Open')).toBe(false);
        expect(uiHasFence('Text\n  ~~~ legacy-ui \r\n<Tag>Open', 'legacy-ui')).toBe(true);
        expect(uiHasFence('```\nui')).toBe(false);
        expect(uiSessionNote({ fenceLanguage: 'legacy-ui' })).toContain('```legacy-ui\n');
        expect(uiReferenceText({ fenceLanguage: 'legacy-ui' })).toContain('fenced legacy-ui block');
    });

    test('isolates unknown tags, refused props and invalid groups', () => {
        const compiled = block(
            '<Unknown>Keep this text</Unknown><Summary style="color:red" tone="success">Valid</Summary><Image url="https://example.com/a.png"/><Choice>Orphan</Choice>'
        );
        expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            'unknown_component',
            'refused_prop',
            'refused_prop',
            'invalid_props',
            'invalid_parent'
        ]);
        expect(compiled.fallback).toContain('Keep this text');
        expect(compiled.nodes[1].props).toEqual({ tone: 'success' });
        const evaluated = evaluateUiBlock(compiled);
        expect(evaluated.nodes[0].error).toBe('unknown_component');
        expect(evaluated.nodes[1].error).toBeUndefined();
        expect(evaluated.nodes[2].error).toBe('invalid_props');
    });

    test('reports malformed final input but keeps neighboring elements', () => {
        const compiled = block('<Summary>One</Summary>\n<Stat value=>\n<Summary>Two</Summary>');
        expect(compiled.diagnostics.length).toBeGreaterThan(0);
        expect(compiled.fallback).toContain('One');
        expect(compiled.fallback).toContain('Two');
        expect(block('<Summary>Unclosed').diagnostics.map((item) => item.code)).toContain('unclosed_tag');
        expect(block('$number = -4\n<Summary>{$number}</Summary>').diagnostics).toEqual([]);
        expect(block('<Callout tone="info" title="Still writ', false).nodes[0].props.title).toBe('Still writ');
        expect(block(EXAMPLES[1]).fallback).toContain('Fix links, preload');
    });

    test('whole-block budgets produce one bounded fallback diagnosis', () => {
        const huge = compileUiBlock('x'.repeat(100), { id: 'item', final: true, limits: { characters: 20 } });
        expect(huge.nodes).toEqual([]);
        expect(huge.fallback).toHaveLength(20);
        expect(huge.diagnostics.map((item) => item.code)).toEqual(['budget_exceeded']);
        const nested = block(`${'<Summary>'.repeat(40)}text${'</Summary>'.repeat(40)}`);
        expect(nested.diagnostics).toHaveLength(1);
        expect(nested.diagnostics[0].code).toBe('budget_exceeded');
        const many = block('<Unknown>text</Unknown>'.repeat(40));
        expect(many.diagnostics.length).toBeLessThanOrEqual(20);
    });

    test('queries only compile against host schemas and are read only', () => {
        const source = '$tasks = @Query("tasks", {limit: 10})\n<Summary>{@Count($tasks)} tasks</Summary>';
        expect(block(source).diagnostics[0].code).toBe('unknown_query');
        const compiled = compileUiBlock(source, { id: 'block', final: true, querySchemas: { tasks: z.strictObject({ limit: z.number().int().max(20) }) } });
        expect(compiled.diagnostics).toEqual([]);
        const state = new UiState(compiled);
        state.setQuery('$tasks', [1, 2], compiled);
        expect(evaluateUiBlock(compiled, state).diagnostics).toEqual([]);
        expect(() => state.run(parseUiExpression('@Set($tasks, [])'))).toThrow();
        expect(() => state.setQuery('$other', [], compiled)).toThrow();
        const changed = { ...compiled, queries: { $tasks: { source: 'tasks', args: { limit: 5 } } } };
        state.sync(changed);
        expect(() => state.setQuery('$tasks', [1, 2], compiled)).toThrow();
        expect(evaluateUiBlock(changed, state).diagnostics[0].code).toBe('refused_access');
    });
});

describe('local state and evaluation', () => {
    test('bindings update dependent text; streaming inputs do not change state', () => {
        const compiled = block('$count = 4\n<Slider value={$count} min={1} max={16}/><Summary>{$count * 2}</Summary>');
        const state = new UiState(compiled);
        const first = evaluateUiBlock(compiled, state);
        first.nodes[0].bindings.value.onValueChange(8);
        const second = evaluateUiBlock(compiled, state);
        expect(second.nodes[1].children[0].props.text).toBe('16');
        second.nodes[0].bindings.value.onValueChange(99);
        expect(state.scope().$count).toBe(8);
        const partial = block('$count = 4\n<Slider value={$count} min={1} max={16}>', false);
        const pendingState = new UiState(partial);
        evaluateUiBlock(partial, pendingState).nodes[0].bindings.value.onValueChange(8);
        expect(pendingState.scope().$count).toBe(4);
    });

    test('preserves edits across recompiles, resets changed defaults and reloads', () => {
        const compiled = block('$count = 4\n<Summary>{$count}</Summary>');
        const state = new UiState(compiled);
        state.run(parseUiExpression('@Set($count, $count + 1)'));
        state.sync(block('$count = 4\n<Summary>{$count} items</Summary>'));
        expect(state.scope().$count).toBe(5);
        state.sync(block('$count = 8\n<Summary>{$count}</Summary>'));
        expect(state.scope().$count).toBe(8);
        expect(new UiState(compiled).scope().$count).toBe(4);
        state.run(parseUiExpression('@Reset()'));
        expect(state.scope().$count).toBe(8);
        state.sync({ ...compiled, id: 'other-block' });
        expect(state.scope().$count).toBe(4);
        expect(() => state.set('$count', 'four')).toThrow();
    });

    test('a Button keeps its action unevaluated and runs it only on local state', () => {
        const compiled = block(
            '$mode = "all"\n$tab = 1\n<Button action={@Set($mode, "failed")}>Failed</Button><Button action={@Reset($mode)}>All</Button><Summary>{$mode}</Summary>'
        );
        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.nodes[0].expressions.action).toEqual(parseUiExpression('@Set($mode, "failed")'));
        expect(compiled.nodes[0].fallback).toBe('Failed\n');
        const state = new UiState(compiled);
        const [set, reset] = evaluateUiBlock(compiled, state).nodes;
        expect(set.props).toEqual({});
        set.onAction!();
        expect(state.scope().$mode).toBe('failed');
        expect(evaluateUiBlock(compiled, state).nodes[2].children[0].props.text).toBe('failed');
        reset.onAction!();
        expect(state.scope().$mode).toBe('all');
        const pending = block('$mode = "all"\n<Button action={@Set($mode, "failed")}>Failed', false);
        const pendingState = new UiState(pending);
        evaluateUiBlock(pending, pendingState).nodes[0].onAction!();
        expect(pendingState.scope().$mode).toBe('all');
        const disabled = block('$mode = "all"\n<Button action={@Set($mode, "failed")} disabled={true}>Failed</Button>');
        const disabledState = new UiState(disabled);
        evaluateUiBlock(disabled, disabledState).nodes[0].onAction!();
        expect(disabledState.scope().$mode).toBe('all');
    });

    test('a Button refuses an action on a query, an undeclared variable or a computed value', () => {
        const schemas = { tasks: z.strictObject({ limit: z.number() }) };
        const compile = (source: string) => compileUiBlock(source, { id: 'block', final: true, querySchemas: schemas });
        const refused = (source: string) => compile(source).nodes.at(-1)!.error;
        expect(refused('$tasks = @Query("tasks", {limit: 1})\n<Button action={@Set($tasks, [])}>Clear</Button>')).toBe('refused_binding');
        expect(refused('<Button action={@Set($missing, 1)}>Set</Button>')).toBe('refused_binding');
        expect(refused('$count = 1\n<Button action={@Set($count, $count + 1)}>More</Button>')).toBe('refused_action');
        expect(refused('$count = 1\n<Button action={@Count($count)}>Count</Button>')).toBe('refused_action');
        expect(refused('$count = 1\n<Button>Nothing</Button>')).toBe('invalid_props');
        expect(refused('$count = 1\n<Button action="@Reset()">Text</Button>')).toBe('refused_action');
        const tampered = compile('$count = 1\n<Button action={@Reset()}>Reset</Button>');
        tampered.nodes[0].expressions.action = parseUiExpression('@Set($other, 1)');
        expect(evaluateUiBlock(tampered).nodes[0].error).toBe('refused_binding');
    });

    test('resolves Show and Each and bounds repeated output before allocation', () => {
        const compiled = block(
            '$rows = [{name: "Core"}, {name: "Client"}]\n<Show when={false}><Summary>Hidden</Summary></Show><Each items={$rows} as="row"><Summary>{row.name}</Summary></Each>'
        );
        const evaluated = evaluateUiBlock(compiled);
        expect(evaluated.nodes.map((node) => node.children[0].props.text)).toEqual(['Core', 'Client']);
        expect(evaluated.nodes[0].id).not.toBe(evaluated.nodes[1].id);
        const exhausted = evaluateUiBlock(compiled, undefined, { iterations: 5 });
        expect(exhausted.diagnostics.some((item) => item.code === 'budget_exceeded')).toBe(true);
        expect(exhausted.nodes).toHaveLength(1);
        expect(exhausted.nodes[0].type).toBe('Each');
        expect(exhausted.nodes[0].error).toBe('budget_exceeded');
        const future = evaluateUiBlock({ ...compiled, catalogVersion: 999 });
        expect(future.nodes[0].error).toBe('unknown_catalog');
    });
});

describe('open wire and agent text', () => {
    test('agent instructions demonstrate real fenced components and local bindings', () => {
        for (const instruction of [uiSessionNote(), uiReferenceText()]) {
            const example = /```ui\n([\s\S]*?)\n```/.exec(instruction)?.[0];
            expect(example).toBeDefined();
            const compiled = compileUi(example!, { id: 'instruction-example', final: true });
            expect(compiled).toHaveLength(1);
            expect(compiled[0].diagnostics).toEqual([]);
            expect(compiled[0].nodes.some((node) => node.type === 'Summary')).toBe(true);
            const view = evaluateUiBlock(compiled[0]);
            const toggle = view.nodes.find((node) => node.type === 'Switch');
            expect(toggle?.bindings.value.value).toBe(false);
            expect(instruction).not.toContain('Summary(');
        }
    });

    test('accepts future component names, props, expression kinds and catalog versions', () => {
        const compiled = block('<Summary>Current</Summary>');
        const node = {
            ...compiled.nodes[0],
            type: 'FutureWidget',
            props: { newMode: 'future', payload: [null, { nested: 42 }] },
            expressions: { value: { kind: 'future', extension: true } }
        };
        expect(UiNodeSchema.safeParse(node).success).toBe(true);
        const wire = JSON.parse(JSON.stringify({ ...compiled, catalogVersion: 999, nodes: [node] }));
        const parsed = UiBlockSchema.parse(wire);
        expect(parsed.nodes[0].props).toEqual(node.props);
        const evaluated = evaluateUiBlock(parsed);
        expect(evaluated.nodes[0].error).toBe('unknown_catalog');
        expect(evaluated.nodes[0].fallback).toBe('Current\n');
        expect(() => z.toJSONSchema(UiBlockSchema)).not.toThrow();
    });

    test('reads the fallback between prose and lists the catalog from its schemas', () => {
        const text = 'Before\n```ui\n<Summary>Readable</Summary>\n```\nAfter';
        expect(uiFallbackText(text, compileUi(text, { id: 'item', final: true }))).toBe('Before\nReadable\nAfter');
        expect(uiFallbackText(text, [{ ...block('<Summary>Invalid range</Summary>'), start: 200, end: 210 }])).toBe(text);
        expect(uiCompactCatalog()).toContain('Slider: value,min,max,step?,unit?');
        expect(uiReferenceText()).toContain('Image accepts a chat attachment');
        expect(uiSessionNote()).toContain('@Filter(list,row,predicate)');
        expect(uiSessionNote().length).toBeLessThan(2400);
    });

    test('names the components per group with their required props in a note that still carries the example', () => {
        const names = uiSessionNote({ catalog: 'names', detailHint: '`tool help ui <group>` gives props' });
        expect(names.length).toBeLessThan(2200);
        expect(names).toContain('```ui\n');
        expect(names).toContain('(`tool help ui <group>` gives props)');
        expect(names).toContain(
            'status: Summary, Callout tone, Tag, Progress (text: label), Steps, Step state (text: label), Timeline, Event at (text: title)'
        );
        expect(names).not.toContain('Slider: value');
        expect(names).not.toContain('step?');
        expect(uiSessionNote({ catalog: 'names' })).toContain('Components by group, required props (text: words between the tags):\n');
        for (const group of Object.keys(UI_GROUPS)) {
            expect(names).toContain(`\n${group}: `);
        }
        const example = /```ui\n([\s\S]*?)\n```/.exec(names)![0];
        expect(compileUi(example, { id: 'names-example', final: true })[0].diagnostics).toEqual([]);
        expect(uiSessionNote({ catalog: 'props' })).toBe(uiSessionNote());
    });

    test('names the required props and the role of the text in the short note', () => {
        const names = uiSessionNote({ catalog: 'names' });
        expect(names).toContain('(text: words between the tags)');
        expect(names).toContain('Event at (text: title)');
        expect(names).toContain('Place lat lon|address (text: name)');
        expect(names).toContain('TextField value (text: label)');
        expect(names).toContain('Option value (text: label)');
        for (const [name, entry] of Object.entries(UI_CATALOG)) {
            const line = names.split('\n').find((candidate) => candidate.startsWith(`${entry.group}: `))!;
            const own = new RegExp(`(?:: |, )${name}( [^,(]*)?(?: \\(text: \\w+\\))?(?:,|$)`).exec(line);
            expect(own, name).not.toBeNull();
            for (const prop of Object.entries(entry.schema.shape).filter(([, schema]) => !schema.isOptional())) {
                const words = 'needs' in entry ? entry.needs : own![1];
                expect(words, `${name} ${prop[0]}`).toContain(prop[0]);
            }
        }
    });

    test('gives one group with its rules and the props of each component', () => {
        const data = uiGroupReference('data');
        expect(data.split('\n')[0]).toBe(UI_GROUPS.data.description);
        expect(data).toContain(UI_GROUPS.data.rules);
        expect(data).toContain('Stat: A labeled value and optional previous value. Props: label, value, previous?, unit?, tone?.');
        expect(data).not.toContain('Summary:');
        expect(uiReferenceText()).toContain(data);
    });

    test('keeps the catalog at version 1', () => {
        // A bump makes every block unreadable on an older native client.
        expect(UI_CATALOG_VERSION).toBe(1);
    });

    test('keeps a question the turn waits on out of Choices, naming no tool', () => {
        for (const instruction of [uiSessionNote(), uiSessionNote({ catalog: 'names' }), uiReferenceText()]) {
            expect(instruction).toContain('shortcuts after finished work that the person may ignore');
            expect(instruction).toContain('a go-ahead for work you would otherwise do');
            expect(instruction).toMatch(/ask (with|that with) your own question tool if you have one, otherwise in prose/);
            expect(instruction).not.toMatch(/AskUserQuestion|request_user_input|ask_user/i);
        }
    });
});
