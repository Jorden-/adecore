import { describe, expect, test } from 'bun:test';
import { compileUiBlock } from './compiler.ts';
import { evaluateUiBlock, resolveUiChoice, UiState } from './runtime.ts';
import { UI_CATALOG } from './catalog.ts';
import { uiPlaceQueries } from './places.ts';

function block(source: string, final = true) {
    return compileUiBlock(source, { id: 'chat:item:block', final, limits: { milliseconds: 5000 } });
}

/* The codes of the diagnostics and the first error among a block's nodes, depth first. */
function problems(source: string): { diagnostics: string[]; errors: string[] } {
    const compiled = block(source);
    const errors: string[] = [];
    const visit = (nodes: readonly { type: string; error?: string; children: any[] }[]) => {
        for (const node of nodes) {
            if (node.error) {
                errors.push(`${node.type}:${node.error}`);
            }
            visit(node.children);
        }
    };
    visit(compiled.nodes);
    return { diagnostics: compiled.diagnostics.map((item) => item.code), errors };
}

describe('Timeline and Event', () => {
    const INCIDENT =
        '<Summary tone="danger">Checkout was down for 12 minutes</Summary>' +
        '<Timeline><Event at="14:02" tone="warning" detail="p95 above 2 s">Alert fired</Event>' +
        '<Event at="14:09" tone="info">Rolled back the release</Event>' +
        '<Event at="2026-10-14T14:14:00+02:00" tone="success">Recovered</Event></Timeline>';

    test('compiles an incident without diagnostics and evaluates every event', () => {
        const compiled = block(INCIDENT);
        expect(compiled.diagnostics).toEqual([]);
        const timeline = evaluateUiBlock(compiled).nodes[1];
        expect(timeline.type).toBe('Timeline');
        expect(timeline.children.map((child) => child.type)).toEqual(['Event', 'Event', 'Event']);
        expect(timeline.children[0].props).toEqual({ at: '14:02', tone: 'warning', detail: 'p95 above 2 s' });
    });

    test('a complete timeline without an event is invalid, an open one is not yet', () => {
        expect(problems('<Timeline></Timeline>').errors).toEqual(['Timeline:invalid_props']);
        expect(problems('<Timeline>Nothing here</Timeline>').errors).toEqual(['Timeline:invalid_props']);
        expect(block('<Timeline>', false).nodes[0].error).toBeUndefined();
        expect(block('<Timeline><Event at="14:02">One</Event>', false).nodes[0].error).toBeUndefined();
    });

    test('counts events that a Show or an Each will draw', () => {
        const each = '$rows = [{at: "14:02", name: "Alert"}]\n<Timeline><Each items={$rows} as="row"><Event at={row.at}>{row.name}</Event></Each></Timeline>';
        expect(problems(each)).toEqual({ diagnostics: [], errors: [] });
        const show = '$on = true\n<Timeline><Show when={$on}><Event at="14:02">Alert</Event></Show></Timeline>';
        expect(problems(show)).toEqual({ diagnostics: [], errors: [] });
    });

    test('an event with a bad time fails alone and shows as text', () => {
        const source = '<Timeline><Event at="14:02">Alert</Event><Event at="soon" tone="info" detail="later">Rolled back</Event></Timeline>';
        const compiled = block(source);
        expect(compiled.diagnostics.map((item) => item.code)).toEqual(['invalid_props']);
        const [good, bad] = compiled.nodes[0].children;
        expect(good.error).toBeUndefined();
        expect(bad.error).toBe('invalid_props');
        expect(bad.fallback).toBe('soon Rolled back (info): later\n');
        expect(compiled.nodes[0].error).toBeUndefined();
        expect(problems('<Timeline><Event at="2026-02-30">Never</Event></Timeline>').errors).toEqual(['Event:invalid_props']);
    });

    test('an event stands only in a timeline, which holds only events', () => {
        expect(problems('<Event at="14:02">Alone</Event>').errors).toEqual(['Event:invalid_parent']);
        expect(problems('<Timeline><Event at="14:02">One</Event><Tag>x</Tag></Timeline>').errors).toEqual(['Tag:invalid_child']);
        expect(problems('<Timeline><Event at="14:02" style="x">One</Event></Timeline>').diagnostics).toEqual(['refused_prop']);
    });

    test('falls back to one line per event', () => {
        const compiled = block(INCIDENT);
        expect(compiled.fallback).toBe(
            'Checkout was down for 12 minutes\n' +
                '14:02 Alert fired (warning): p95 above 2 s\n' +
                '14:09 Rolled back the release (info)\n' +
                '2026-10-14T14:14:00+02:00 Recovered (success)'
        );
        expect(block('<Timeline><Event at="09:00">Plain</Event></Timeline>').fallback).toBe('09:00 Plain');
    });
});

describe('Gallery and Compare', () => {
    const images = (count: number) => Array.from({ length: count }, (_, i) => `<Image attachment="a${i}" alt="Screen ${i}">Caption ${i}</Image>`).join('');

    test('a gallery holds one to 24 images, counting what an Each or a Show will draw', () => {
        expect(block(`<Gallery>${images(2)}</Gallery>`).diagnostics).toEqual([]);
        expect(block(`<Gallery>${images(24)}</Gallery>`).diagnostics).toEqual([]);
        expect(problems(`<Gallery>${images(25)}</Gallery>`).errors).toEqual(['Gallery:invalid_props']);
        expect(problems('<Gallery></Gallery>').errors).toEqual(['Gallery:invalid_props']);
        expect(block('<Gallery>', false).nodes[0].error).toBeUndefined();
        const each = '$ids = ["a", "b"]\n<Gallery><Each items={$ids} as="id"><Image attachment={id}/></Each></Gallery>';
        expect(problems(each)).toEqual({ diagnostics: [], errors: [] });
    });

    test('a gallery holds only images, and each image still needs an attachment or the latest one', () => {
        expect(problems('<Gallery><Image attachment="a1"/><Tag>x</Tag></Gallery>').errors).toEqual(['Tag:invalid_child']);
        expect(problems('<Gallery><Image alt="none"/></Gallery>').errors).toEqual(['Image:invalid_props']);
        expect(problems('<Gallery><Image url="https://example.com/a.png"/></Gallery>').diagnostics).toContain('refused_prop');
    });

    test('a comparison names two attachments and never takes an address', () => {
        const ok = block('<Compare before="a1" after="a2" beforeLabel="Old" afterLabel="New">Header color</Compare>');
        expect(ok.diagnostics).toEqual([]);
        expect(evaluateUiBlock(ok).nodes[0].props).toEqual({ before: 'a1', after: 'a2', beforeLabel: 'Old', afterLabel: 'New' });
        expect(problems('<Compare before="a1"/>').errors).toEqual(['Compare:invalid_props']);
        expect(problems('<Compare before="" after="a2"/>').errors).toEqual(['Compare:invalid_props']);
        expect(problems('<Compare before="a1" after="a2" src="https://example.com/a.png"/>').diagnostics).toEqual(['refused_prop']);
    });

    test('falls back to the images and to one line for a comparison', () => {
        expect(block('<Gallery><Image attachment="a1" alt="Login">First</Image><Image attachment="a2" alt="Home"/></Gallery>').fallback).toBe(
            '[Image: Login]First\n[Image: Home]'
        );
        expect(block('<Compare before="a1" after="a2">Header color</Compare>').fallback).toBe('[Compare: Before a1, After a2] Header color');
        expect(block('<Compare before="a1" after="a2" beforeLabel="Old" afterLabel="New"/>').fallback).toBe('[Compare: Old a1, New a2]');
    });
});

describe('TextField and Select', () => {
    const FORM =
        '$name = "Ada"\n$kind = "bug"\n<TextField value={$name} maxLength={8} placeholder="Your name">Name</TextField>' +
        '<Select value={$kind}><Option value="bug">Bug</Option><Option value="idea">Idea</Option></Select>' +
        '<Choices><Choice context={"Report " + $kind + " from " + $name}>Send</Choice></Choices>';

    test('compiles with bindings, and Option stands in either parent', () => {
        const compiled = block(FORM);
        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.nodes[0].bindings).toEqual({ value: '$name' });
        expect(compiled.nodes[1].bindings).toEqual({ value: '$kind' });
        expect(UI_CATALOG.Option.parent).toEqual(['Segmented', 'Select']);
        expect(block('<Segmented value="a"><Option value="a">A</Option></Segmented>').diagnostics).toEqual([]);
        expect(problems('<Option value="a">A</Option>').errors).toEqual(['Option:invalid_parent']);
        expect(problems('<Tabs><Tab title="x"><Option value="a">A</Option></Tab></Tabs>').errors).toContain('Option:invalid_parent');
        expect(problems('<Select value="a"><Tag>x</Tag></Select>').errors).toEqual(['Tag:invalid_child']);
    });

    test('a text field holds up to maxLength characters, 256 without one', () => {
        expect(problems(`$q = "${'x'.repeat(256)}"\n<TextField value={$q}>Query</TextField>`)).toEqual({ diagnostics: [], errors: [] });
        expect(problems(`$q = "${'x'.repeat(257)}"\n<TextField value={$q}>Query</TextField>`).errors).toEqual(['TextField:invalid_props']);
        expect(problems('$q = "abcdef"\n<TextField value={$q} maxLength={5}>Query</TextField>').errors).toEqual(['TextField:invalid_props']);
        expect(problems(`$q = "${'x'.repeat(1024)}"\n<TextField value={$q} maxLength={1024}>Query</TextField>`).errors).toEqual([]);
        expect(problems('$q = ""\n<TextField value={$q} maxLength={1025}>Query</TextField>').errors).toEqual(['TextField:invalid_props']);
        expect(problems('$q = ""\n<TextField value={$q} maxLength={0}>Query</TextField>').errors).toEqual(['TextField:invalid_props']);
        expect(problems(`$q = ""\n<TextField value={$q} placeholder="${'x'.repeat(129)}">Query</TextField>`).errors).toEqual(['TextField:invalid_props']);
    });

    test('a typed value past the limit is refused by the binding and by a Choice that carries it', () => {
        const compiled = block(FORM);
        const state = new UiState(compiled);
        const field = evaluateUiBlock(compiled, state).nodes[0];
        field.bindings.value.onValueChange('Grace');
        expect(state.scope().$name).toBe('Grace');
        field.bindings.value.onValueChange('Grace Hopper');
        expect(state.scope().$name).toBe('Grace');
        const choice = evaluateUiBlock(compiled, state).nodes[2].children[0];
        expect(resolveUiChoice(compiled, choice.id, { $name: 'Grace' }).context).toBe('Report bug from Grace');
        expect(() => resolveUiChoice(compiled, choice.id, { $name: 'Grace Hopper' })).toThrow('does not match its control');
        expect(() => resolveUiChoice(compiled, choice.id, { $name: 42 })).toThrow();
    });

    test('a select offers only its own options to a Choice', () => {
        const compiled = block(FORM);
        const choice = evaluateUiBlock(compiled).nodes[2].children[0];
        expect(resolveUiChoice(compiled, choice.id, { $kind: 'idea' }).context).toBe('Report idea from Ada');
        expect(() => resolveUiChoice(compiled, choice.id, { $kind: 'question' })).toThrow('outside the visible control');
        expect(() => resolveUiChoice(compiled, choice.id, { $kind: 'idea' })).not.toThrow();
    });

    test('falls back to the label and the options, never the typed value', () => {
        expect(block(FORM).fallback).toBe('Name\nBug (chosen)\nIdea\nSend\nReport bug from Ada');
    });

    test('a dropdown and a segmented control say which option they start on, and a bare value of no option marks none', () => {
        expect(block('<Segmented value="all"><Option value="failed">Failed</Option><Option value="all">All</Option></Segmented>').fallback).toBe(
            'Failed\nAll (chosen)'
        );
        expect(block('$kind = 2\n<Select value={$kind}>Kind<Option value={1}>Bug</Option><Option value={2}>Idea</Option></Select>').fallback).toBe(
            'Kind\nBug\nIdea (chosen)'
        );
        expect(block('<Select value="other"><Option value="a">A</Option></Select>').fallback).toBe('A');
    });

    test('a select keeps the text beside its options as its label', () => {
        const compiled = block(FORM.replace('<Select value={$kind}>', '<Select value={$kind}>Kind of report'));
        expect(compiled.diagnostics).toEqual([]);
        const select = evaluateUiBlock(compiled).nodes[1];
        expect(select.children.filter((child) => child.type === '$text').map((child) => child.props.text)).toEqual(['Kind of report']);
    });
});

describe('Map and Place', () => {
    const places = (count: number) => Array.from({ length: count }, (_, i) => `<Place lat={52} lon={5}>Stop ${i}</Place>`).join('');
    const UTRECHT =
        '$picked = ""\n<Summary>Three stops in Utrecht</Summary>' +
        '<Map value={$picked}><Place lat={52.0907} lon={5.1214} value="dom" detail="Climb the tower">Domtoren</Place>' +
        '<Place address="Oudegracht 245, Utrecht" value="gracht">Oudegracht</Place>' +
        '<Place lat={52.0894} lon={5.1103} address="Utrecht Centraal">Station</Place></Map>' +
        '<Choices><Choice context={"Plan around " + $picked}>Plan</Choice></Choices>';

    test('compiles a map of both forms without diagnostics and binds its value', () => {
        const compiled = block(UTRECHT);
        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.nodes[1].bindings).toEqual({ value: '$picked' });
        const map = evaluateUiBlock(compiled).nodes[1];
        expect(map.children.map((child) => child.type)).toEqual(['Place', 'Place', 'Place']);
        expect(map.children[1].props).toEqual({ address: 'Oudegracht 245, Utrecht', value: 'gracht' });
    });

    test('a place needs lat with lon, or an address', () => {
        expect(problems('<Map><Place lat={52}>Half</Place></Map>').errors).toEqual(['Place:invalid_props']);
        expect(problems('<Map><Place lon={5}>Half</Place></Map>').errors).toEqual(['Place:invalid_props']);
        expect(problems('<Map><Place detail="Nowhere">Nothing</Place></Map>').errors).toEqual(['Place:invalid_props']);
        expect(problems('<Map><Place lat={0} lon={0}>Null Island</Place></Map>')).toEqual({ diagnostics: [], errors: [] });
        expect(problems('<Map><Place lat={90} lon={-180}>Edge</Place></Map>').errors).toEqual([]);
        expect(problems('<Map><Place lat={91} lon={5}>Past the pole</Place></Map>').errors).toEqual(['Place:invalid_props']);
        expect(problems('<Map><Place lat={52} lon={181}>Past the line</Place></Map>').errors).toEqual(['Place:invalid_props']);
        expect(problems(`<Map><Place address="${'x'.repeat(513)}">Long</Place></Map>`).errors).toEqual(['Place:invalid_props']);
    });

    test('a map holds one to 50 places, counting what an Each or a Show will draw', () => {
        expect(problems(`<Map>${places(50)}</Map>`)).toEqual({ diagnostics: [], errors: [] });
        expect(problems(`<Map>${places(51)}</Map>`).errors).toEqual(['Map:invalid_props']);
        expect(problems('<Map></Map>').errors).toEqual(['Map:invalid_props']);
        expect(block('<Map>', false).nodes[0].error).toBeUndefined();
        const each = '$rows = [{name: "Dom"}]\n<Map><Each items={$rows} as="row"><Place address="Domplein 1, Utrecht">{row.name}</Place></Each></Map>';
        expect(problems(each)).toEqual({ diagnostics: [], errors: [] });
    });

    test('a place stands only in a map, which holds only places, and no prop takes a map address', () => {
        expect(problems('<Place lat={52} lon={5}>Alone</Place>').errors).toEqual(['Place:invalid_parent']);
        expect(problems('<Map><Place lat={52} lon={5}>One</Place><Tag>x</Tag></Map>').errors).toEqual(['Tag:invalid_child']);
        expect(problems('<Map tiles="https://tiles.example/{z}/{x}/{y}"><Place lat={52} lon={5}>One</Place></Map>').diagnostics).toEqual(['refused_prop']);
    });

    test('one bad place fails alone and shows as text', () => {
        const compiled = block('<Map><Place lat={52} lon={5}>Good</Place><Place lat={200} lon={5}>Bad</Place></Map>');
        expect(compiled.diagnostics.map((item) => item.code)).toEqual(['invalid_props']);
        const [good, bad] = compiled.nodes[0].children;
        expect(good.error).toBeUndefined();
        expect(bad.error).toBe('invalid_props');
        expect(compiled.nodes[0].error).toBeUndefined();
    });

    test('falls back to a numbered list with the coordinates, the address and the detail', () => {
        expect(block(UTRECHT).fallback).toBe(
            'Three stops in Utrecht\n' +
                '1. Domtoren (52.0907, 5.1214): Climb the tower\n' +
                '2. Oudegracht, Oudegracht 245, Utrecht\n' +
                '3. Station (52.0894, 5.1103), Utrecht Centraal\n' +
                'Plan\n' +
                'Plan around'
        );
        expect(block('<Map><Place lat={1} lon={2}>First\nline</Place></Map>').fallback).toBe('1. First line (1, 2)');
        const failed = block('<Map><Place lat={1} lon={2}>One</Place><Place lat={200} lon={2}>Bad</Place><Place lat={3} lon={4}>Two</Place></Map>');
        expect(failed.fallback).toBe('1. One (1, 2)\nBad (200, 2)\n2. Two (3, 4)');
        const each = block(
            '$names = ["A 1", "B 2"]\n<Map><Place lat={1} lon={2}>First</Place><Each items={$names} as="n"><Place address={n}>{n}</Place></Each></Map>'
        );
        expect(each.fallback).toContain('1. First (1, 2)');
        expect(each.fallback).toContain('2. ');
    });

    test('a Choice carries the picked place only when a place offers its value', () => {
        const compiled = block(UTRECHT);
        const choice = evaluateUiBlock(compiled).nodes[2].children[0];
        expect(resolveUiChoice(compiled, choice.id, { $picked: 'dom' }).context).toBe('Plan around dom');
        expect(resolveUiChoice(compiled, choice.id, { $picked: '' }).context).toBe('Plan around ');
        expect(() => resolveUiChoice(compiled, choice.id, { $picked: 'elsewhere' })).toThrow('outside the visible control');
    });
});

describe('the places a host looks up', () => {
    test('names each place that gives an address, also one with coordinates, with its name', () => {
        const compiled = block(
            '<Map><Place lat={52} lon={5} address="Utrecht">Known</Place><Place address="  Domplein 1, Utrecht ">Dom   <Tag>tower</Tag></Place>' +
                '<Place address="Oudegracht 245">Gracht</Place></Map>'
        );
        const [known, dom, gracht] = evaluateUiBlock(compiled).nodes[0].children;
        expect(uiPlaceQueries(compiled)).toEqual({
            [known.id]: { address: 'Utrecht', name: 'Known' },
            [dom.id]: { address: 'Domplein 1, Utrecht', name: 'Dom tower' },
            [gracht.id]: { address: 'Oudegracht 245', name: 'Gracht' }
        });
        expect(uiPlaceQueries(block('<Map><Place lat={52} lon={5}>Known</Place></Map>'))).toEqual({});
    });

    test('follows an Each, and skips a place that failed, and refuses a block that is still being written', () => {
        const each = block('$rows = ["A 1", "B 2"]\n<Map><Each items={$rows} as="row"><Place address={row}>Stop</Place></Each></Map>');
        expect(Object.values(uiPlaceQueries(each)).map((query) => query.address)).toEqual(['A 1', 'B 2']);
        expect(uiPlaceQueries(block('<Map><Place address="">Empty</Place><Place lat={500} lon={5} address="X">Bad</Place></Map>'))).toEqual({});
        expect(() => uiPlaceQueries(block('<Map><Place address="Domplein 1">Dom', false))).toThrow('completed');
    });
});
