import { describe, expect, test } from 'bun:test';
import { compileUiBlock } from './compiler.ts';
import { evaluateUiBlock } from './runtime.ts';

function block(source: string, final = true) {
    return compileUiBlock(source, { id: 'chat:item:block', final, limits: { milliseconds: 5000 } });
}

describe('the number of children after an Each or a Show drew them', () => {
    const ids = (count: number) => JSON.stringify(Array.from({ length: count }, (_, i) => `a${i}`));

    test('a gallery shows its first 24 images of an Each and says so, a map its first 50 places', () => {
        const gallery = block(`<Gallery><Each items={${ids(60)}} as="id"><Image attachment={id}/></Each></Gallery>`);
        expect(gallery.diagnostics).toEqual([]);
        const evaluated = evaluateUiBlock(gallery);
        expect(evaluated.nodes[0].error).toBeUndefined();
        expect(evaluated.nodes[0].children).toHaveLength(24);
        expect(evaluated.nodes[0].children[23].props).toEqual({ attachment: 'a23' });
        expect(evaluated.diagnostics.map((item) => item.code)).toEqual(['too_many_children']);
        const map = block(`<Map><Each items={${ids(80)}} as="name"><Place address={name}>{name}</Place></Each></Map>`);
        expect(evaluateUiBlock(map).nodes[0].children).toHaveLength(50);
    });

    test('a gallery or a timeline that an Each or a Show leaves empty fails alone', () => {
        const empty = block('$ids = []\n<Summary>Shots</Summary><Gallery><Each items={$ids} as="id"><Image attachment={id}/></Each></Gallery>');
        expect(empty.diagnostics).toEqual([]);
        const [, gallery] = evaluateUiBlock(empty).nodes;
        expect(gallery.error).toBe('invalid_props');
        const hidden = block('$on = false\n<Timeline><Show when={$on}><Event at="14:02">Alert</Event></Show></Timeline>');
        expect(hidden.diagnostics).toEqual([]);
        expect(evaluateUiBlock(hidden).nodes[0].error).toBe('invalid_props');
        const shown = block('$on = true\n<Timeline><Show when={$on}><Event at="14:02">Alert</Event></Show></Timeline>');
        expect(evaluateUiBlock(shown).nodes[0].error).toBeUndefined();
    });

    test('a container still being written is not refused for the children it has not got yet', () => {
        expect(evaluateUiBlock(block('<Timeline>', false)).nodes[0].error).toBeUndefined();
    });
});
