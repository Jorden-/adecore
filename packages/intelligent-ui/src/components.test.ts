import { describe, expect, test } from 'bun:test';
import { compileUiBlock } from './compiler.ts';
import { evaluateUiBlock } from './runtime.ts';

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
