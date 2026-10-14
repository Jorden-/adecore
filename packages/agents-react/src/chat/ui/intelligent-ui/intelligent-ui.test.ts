import { afterEach, describe, expect, test } from 'bun:test';
import { createElement, Fragment, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileUiBlock, evaluateUiBlock, UI_CATALOG, UiState, type UiComponentName, type UiViewNode } from '@adecore/intelligent-ui';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { UiPageMemory } from './block-local';
import { uiChartAxis, uiChartCharacter, uiChartData, uiChartRange, uiChartText, uiChartTextWidth, niceCeiling, UI_CHART_SERIES } from './chart-data';
import i18next from 'i18next';
import { formatClock, formatDay, formatDayClock, setFormatSource, type FormatSource } from '@adecore/ui/format';
import { fakeFormatSource } from '@adecore/ui/testing';
import { uiBlockHead, uiEventTime, uiLiveChoiceReason, uiNodeLabel, uiNodeText, uiReasonText, uiUrlDomain, uiWithUnit } from './node-text';
import { UI_RENDERERS } from './registry';
import type { UiRenderContext, UiRenderer, UiRendererProps } from './render-context';
import { UiSourceCitation } from './renderers/content';
import { ChecklistRenderer } from './renderers/inputs';
import { uiTableCell, uiTableColumns } from './table-data';
import { UiBlockFrame, type UiBlockFrameProps } from './UiBlockFrame';

/* A component whose children go in as the children of `createElement`, as JSX would pass them. */
type Drawable<Props> = ComponentType<Omit<Props, 'children'>>;

const Frame = UiBlockFrame as Drawable<UiBlockFrameProps>;

const CONTEXT: UiRenderContext = { scopeId: 'scope', chatId: 'chat', itemId: 'item', blockId: 'block', phase: 'final', answer: null };

function compiled(source: string, final = true) {
    return compileUiBlock(source, { id: 'chat:item:block', final, limits: { milliseconds: 5000 } });
}

function evaluate(source: string, final = true): { nodes: UiViewNode[]; state: UiState } {
    const block = compiled(source, final);
    const state = new UiState(block);
    return { nodes: evaluateUiBlock(block, state, { milliseconds: 5000 }).nodes, state };
}

/* The smallest tree a runtime would draw, for these tests only: text as text, every other node through the registry. */
function drawn(nodes: readonly UiViewNode[], context: UiRenderContext): ReactNode {
    return nodes.map((node) => {
        if (node.type === '$text') {
            return createElement(Fragment, { key: node.id }, String(node.props.text));
        }
        const renderer = UI_RENDERERS[node.type as UiComponentName] as UiRenderer<unknown> | null;
        if (renderer === null) {
            return null;
        }
        return createElement(renderer as Drawable<UiRendererProps<unknown>>, { key: node.id, node, context }, drawn(node.children, context));
    });
}

let host: Partial<ChatHost> = {};

function markup(source: string, context: Partial<UiRenderContext> = {}, final = true): string {
    const full = { ...CONTEXT, ...context };
    const { nodes } = evaluate(source, final);
    return renderToStaticMarkup(createElement(ChatHostProvider, { host }, createElement(Frame, { nodes, phase: full.phase }, drawn(nodes, full))));
}

const REVIEW =
    '$selected = ["links", "preload"]\n<Summary tone="danger" badge="2 blocking">2 of 2 findings selected</Summary>' +
    '<Checklist value={$selected}><Item value="links"><File path="src/links.ts" line="148">Cuts a path</File></Item><Item value="preload">Bridge</Item></Checklist>' +
    '<Choices><Choice context={"Fix these findings: " + @Join($selected, ", ")} primary={true}>Fix {@Count($selected)}</Choice><Choice>Leave it</Choice></Choices>';

describe('the registry of intelligent UI renderers', () => {
    test('accounts for every catalog name, and only those', () => {
        expect(Object.keys(UI_RENDERERS).sort()).toEqual(Object.keys(UI_CATALOG).sort());
        expect(Object.keys(UI_RENDERERS)).toHaveLength(40);
        const empty = Object.entries(UI_RENDERERS)
            .filter(([, renderer]) => renderer === null)
            .map(([name]) => name)
            .sort();
        expect(empty).toEqual(['Column', 'Each', 'Option', 'Show']);
    });
});

describe('node text', () => {
    test('joins the text below a node and reads the head of a block', () => {
        const { nodes } = evaluate('$n = 3\n<Summary>Found {$n}   open <Tag>new</Tag> issues</Summary><Summary>Second</Summary>');
        expect(uiNodeText(nodes[0]!)).toContain('Found 3');
        expect(uiNodeLabel(nodes[0]!)).toBe('Found 3 open new issues');
        expect(uiBlockHead(nodes)).toEqual({ id: nodes[0]!.id, label: 'Found 3 open new issues' });
        expect(uiBlockHead(nodes.slice(1, 1))).toBeNull();
    });

    test('names a block by the words of its Summary, without the marks of its Markdown', () => {
        const { nodes } = evaluate('<Summary>Release `0.14.0` is **halfway**, see [notes](https://example.com)</Summary>');
        expect(uiBlockHead(nodes)?.label).toBe('Release 0.14.0 is halfway, see notes');
    });
});

describe('the frame of a block', () => {
    test('names the block by its Summary, gives only the head an icon, and says nothing in an empty footer', () => {
        const html = markup('<Summary tone="danger">Head</Summary><Summary tone="success">Sub</Summary>');
        expect(html).toContain('role="group" aria-label="Head"');
        expect(html).toContain('lucide-octagon-alert');
        expect(html).not.toContain('lucide-circle-check');
        expect(html).not.toContain('border-t');
        expect(html).not.toContain('aria-busy');
    });

    test('holds a skeleton while the fence has no node yet, and is busy while it streams', () => {
        const html = renderToStaticMarkup(createElement(Frame, { nodes: [], phase: 'streaming' }));
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('animate-pulse');
        expect(html).toContain('aria-label="Interactive block"');
    });

    test('writes the footer in its order', () => {
        const html = renderToStaticMarkup(
            createElement(Frame, {
                nodes: [],
                phase: 'final',
                live: { state: 'fresh', sources: ['launch.status'], readAt: null },
                answered: { label: 'Fix 2', at: Date.UTC(2026, 9, 9, 12, 7) },
                fixes: [
                    { code: 'unknown_prop', message: 'Stat: dropped tone="huge"' },
                    { code: 'refused_prop', message: 'Image: dropped url' }
                ],
                shownAsText: 'The block is too large to draw'
            })
        );
        const order = ['Live', 'Not read', 'Answered with “Fix 2”', '2 notes', 'Shown as text', 'The block is too large to draw'];
        expect(order.map((words) => html.indexOf(words))).toEqual([...order.map((words) => html.indexOf(words))].sort((a, b) => a - b));
        expect(order.every((words) => html.includes(words))).toBe(true);
        expect(html).toContain('unknown_prop');
        expect(html).toContain('aria-expanded="false"');
    });
});

test('a known reason code is worded here, and an unknown one reads as the reason the machine gave', () => {
    const t = i18next.getFixedT('en', 'agent-chat');
    expect(uiReasonText(t, 'refresh-limit', 'This query may refresh once every ten seconds.')).toBe('This source reads at most once every ten seconds.');
    expect(uiReasonText(t, 'outside-project', 'This file is outside the project.')).toBe('This is outside the project the agent wrote this in.');
    expect(uiReasonText(t, 'newer-code', 'A reason from a newer machine.')).toBe('A reason from a newer machine.');
    expect(uiReasonText(t, undefined, 'Plain')).toBe('Plain');
});

test('a unit stands apart from its number everywhere, except a percent sign', () => {
    expect([uiWithUnit('5', 'ms'), uiWithUnit('5', '%'), uiWithUnit('5', undefined)]).toEqual(['5\u00a0ms', '5%', '5']);
    const html = markup('$wait = 5\n<Slider value={$wait} min={1} max={10} unit="ms">Wait</Slider>');
    expect(html).toContain('>5\u00a0ms</span>');
    expect(html).toContain('aria-valuetext="5\u00a0ms"');
});

test('closed choices of a live block say whether data is still read or why a reading failed', () => {
    const t = i18next.getFixedT('en', 'agent-chat');
    const sources = ['status'];
    expect(uiLiveChoiceReason(t, { state: 'fresh', sources, readAt: 1 })).toBeNull();
    expect(uiLiveChoiceReason(t, { state: 'reading', sources, readAt: null })).toBe('Available once the live data is read');
    expect(uiLiveChoiceReason(t, { state: 'refused', sources, readAt: null, code: 'access-unavailable', reason: 'x' })).toBe(
        'The access of the chat that wrote this is no longer available.'
    );
    expect(uiLiveChoiceReason(t, { state: 'failed', sources, readAt: null, source: 'status' })).toBe('Could not read status');
});

test('a checklist, a list of sources and a table each have a name', () => {
    expect(markup('$picked = []\n<Checklist value={$picked}><Item value="a">A</Item></Checklist>')).toContain('role="group" aria-label="Checklist"');
    const sources = markup('<Sources><Source title="Docs" url="https://www.adecore.dev/guide"/></Sources>');
    const heading = /<span id="([^"]+)"[^>]*>Sources<\/span>/.exec(sources)?.[1];
    expect(heading).toBeDefined();
    expect(sources).toContain(`aria-labelledby="${heading}"`);
    expect(sources).not.toContain('aria-label="Sources"');
    expect(markup('<Table rows={[{name: "Core", size: 3}]}/>')).toContain('aria-label="Table of name, size"');
    expect(uiUrlDomain('https://www.adecore.dev/guide')).toBe('adecore.dev');
});

test('page memory forgets the value used longest ago past its limit', () => {
    const memory = new UiPageMemory<number>(2);
    memory.set('a', 1);
    memory.set('b', 2);
    expect(memory.get('a')).toBe(1);
    memory.set('c', 3);
    expect([memory.has('a'), memory.has('b'), memory.has('c'), memory.size]).toEqual([true, false, true, 2]);
});

describe('choices', () => {
    test('show their context below the label and stay closed while the reply streams', () => {
        const html = markup(REVIEW, { phase: 'streaming', onChoose: () => undefined });
        expect(html).toContain('Fix these findings: links, preload');
        expect(html).toMatch(/aria-disabled="true" aria-describedby="[^"]+"/);
        expect(html).toContain('opacity-60');
    });

    test('open once the block is done and a host can send them', () => {
        const open = markup(REVIEW, { onChoose: () => undefined });
        expect(open).not.toContain('aria-disabled');
        expect(markup(REVIEW)).toContain('aria-disabled="true"');
    });

    test('mark the chosen row and close the others', () => {
        const { nodes } = evaluate(REVIEW);
        const choiceId = nodes.find((node) => node.type === 'Choices')!.children.find((node) => node.type === 'Choice')!.id;
        const sent = markup(REVIEW, { onChoose: () => undefined, answer: { choiceId, state: 'sent' } });
        expect(sent).toContain('Sent');
        expect(sent).toContain('bg-accent-soft');
        expect(sent).toContain('opacity-50');
        expect(markup(REVIEW, { onChoose: () => undefined, answer: { choiceId, state: 'queued' } })).toContain('Queued');
        const failed = markup(REVIEW, { onChoose: () => undefined, failedChoiceId: choiceId });
        expect(failed).toContain('role="alert"');
        expect(failed).toContain('Could not send. Try again.');
    });
});

describe('long text', () => {
    test('a long step detail and a long badge take a line of their own instead of squeezing the title', () => {
        const long = 'Missing information and decisions before work go through the built-in question tool.';
        const step = markup(`<Steps><Step state="pending" detail="${long}">Give the question tool priority</Step></Steps>`);
        expect(step).toContain('flex-wrap');
        expect(step).toContain(long);
        const summary = markup(`<Summary badge="${long}">Result of the research</Summary>`);
        expect(summary).toContain(`<p class="w-full text-xs wrap-anywhere text-text-muted">${long}</p>`);
        expect(markup('<Summary badge="Draft">Release overview</Summary>')).not.toContain('<p class');
    });
});

describe('a choice the host would refuse', () => {
    test('is drawn as its text with no row to press, once the reply is done', () => {
        for (const source of [
            '<Choices><Choice context="Run checks"></Choice></Choices>',
            '<Choices><Choice context="Run checks">Run checks',
            '<Choices><Choice context="Run checks">Run {$missing}</Choice></Choices>'
        ]) {
            const html = markup(source, { onChoose: () => undefined });
            expect(html).not.toContain('<button');
            expect(html).toContain('Could not draw this part');
            expect(html).toContain('Run checks');
        }
        expect(markup('<Choices><Choice context="Run checks">Run checks</Choice></Choices>', { onChoose: () => undefined })).toContain('<button');
    });
});

describe('local inputs', () => {
    test('change their state only through the binding, once their node closed', () => {
        const { nodes, state } = evaluate(REVIEW);
        const list = nodes.find((node) => node.type === 'Checklist') as UiViewNode<{ value: (string | number | boolean | null)[] }>;
        const element = ChecklistRenderer({ node: list, children: null, context: CONTEXT }) as ReactElement<{ value: { toggle(value: unknown): void } }>;
        element.props.value.toggle('links');
        expect(state.scope().$selected).toEqual(['preload']);
    });

    test('are disabled without a binding or before their node closed', () => {
        const readOnly = { ...evaluate('<Switch value={true}>Show nits</Switch>').nodes[0]!, bindings: {} };
        const html = renderToStaticMarkup(
            createElement(UI_RENDERERS.Switch! as Drawable<UiRendererProps<{ value: boolean }>>, { node: readOnly as never, context: CONTEXT }, 'Show nits')
        );
        expect(html).toContain('data-disabled');
        const partial = markup('$count = 4\n<Slider value={$count} min={1} max={16}>Agents', {}, false);
        expect(partial).toContain('pointer-events-none opacity-60');
    });

    test('a segmented control with a sentence for a label stands in a column', () => {
        const long = 'Missing information and decisions before work go through the question tool';
        expect(markup(`$mode = "a"\n<Segmented value={$mode}><Option value="a">${long}</Option><Option value="b">Other</Option></Segmented>`)).toContain(
            'aria-orientation="vertical"'
        );
        expect(markup('$mode = "a"\n<Segmented value={$mode}><Option value="a">One</Option><Option value="b">Two</Option></Segmented>')).not.toContain(
            'aria-orientation'
        );
    });

    test('a button closes once the block is answered', () => {
        const html = markup('$mode = "all"\n<Button action={@Reset()}>Reset</Button>', { answer: { choiceId: 'other', state: 'sent' } });
        expect(html).toContain('Reset');
        expect(html).toContain('disabled');
    });

    test('label a slider and a segmented control with their text', () => {
        const html = markup(
            '$count = 8\n$mode = "all"\n<Slider value={$count} min={1} max={16}>Parallel agents</Slider><Segmented value={$mode}><Option value="all">All</Option><Option value="failed">Failing</Option></Segmented>'
        );
        expect(html).toContain('Parallel agents');
        expect(html).toContain('aria-checked="true"');
        expect(html).toContain('Failing');
    });
});

describe('text and status', () => {
    test('progress reads its value against its max, or as a percentage', () => {
        expect(markup('<Progress value={312} max={500}>Indexing files</Progress>')).toContain('312 of 500');
        expect(markup('<Progress value={46}>Share</Progress>')).toContain('46%');
    });

    test('a running step spins only while the block is live', () => {
        const source = '<Steps><Step state="running">Build</Step><Step state="done" detail="42 s">Lint</Step></Steps>';
        expect(markup(source)).toContain('lucide-circle-dot');
        expect(markup(source, { phase: 'streaming' }, false)).not.toContain('lucide-circle-dot');
        expect(markup(source)).toContain('42 s');
    });

    test('a timeline writes each time the way the region writes it, and reads a time without an offset as written', () => {
        const source =
            '<Timeline><Event at="14:02" tone="warning" detail="p95 above 2 s">Alert fired</Event>' +
            '<Event at="2026-10-14" tone="info">Rolled back</Event>' +
            '<Event at="2026-10-14T14:14:00">Recovered</Event>' +
            '<Event at="2026-10-14T14:20:00+02:00" tone="success">Checked</Event></Timeline>';
        const html = markup(source);
        expect(html).toContain('<ol class="chat-ui-nodes');
        expect(html).toContain('<time dateTime="14:02"');
        expect(html).toContain('p95 above 2 s');
        expect(html).toContain('aria-label="02:02 PM, Alert fired, Warning"');
        expect(html).toContain(`>${formatDay(new Date(2026, 9, 14))}</time>`);
        expect(html).toContain(`>${formatDayClock(new Date(2026, 9, 14, 14, 14))}</time>`);
        expect(html).toContain(`>${formatDayClock(new Date(Date.UTC(2026, 9, 14, 12, 20)))}</time>`);
        expect(html).toContain('text-status-needs-you');
        expect(html).toContain('group-last/event:hidden');
        const previous = setFormatSource(Object.assign(fakeFormatSource(), { region: () => 'nl-NL' }) as FormatSource);
        try {
            expect(uiEventTime('14:02')).toBe('14:02');
            expect(uiEventTime('14:02')).toBe(formatClock(new Date(2000, 0, 1, 14, 2)));
        } finally {
            setFormatSource(previous);
        }
    });

    test('a stat says how it changed without coloring it unless it has a tone', () => {
        const html = markup('<Stats><Stat label="Cold start" value={1.42} previous={1.9} unit="s"/></Stats>');
        expect(html).toContain('25% from 1.9 s');
        expect(html).toContain('text-text-faint');
        expect(markup('<Stats><Stat label="Tests" value={3} previous={0} tone="danger"/></Stats>')).toContain('text-status-error');
    });

    test('a live stat lights up once it changed, stays muted when stale and keeps the comparison the agent wrote', () => {
        const source = '<Stats><Stat label="Changed files" value={4} previous={2}/></Stats>';
        const asked: [string, string][] = [];
        const changed = markup(source, {
            liveValue: (nodeId, prop) => {
                asked.push([nodeId, prop]);
                return { previous: 3, changed: true, stale: false };
            }
        });
        expect(asked.map(([, prop]) => prop)).toEqual(['value']);
        expect(changed).toMatch(/<span class="text-text chat-ui-changed text-lg font-semibold tabular-nums">4<\/span>/);
        expect(changed).toContain('100% from 2');
        expect(markup(source, { liveValue: () => ({ previous: 4.001, changed: true, stale: false }) })).not.toContain('chat-ui-changed');
        const stale = markup(source, { liveValue: () => ({ changed: true, stale: true }) });
        expect(stale).toContain('text-text-muted text-lg');
        expect(stale).not.toContain('chat-ui-changed');
        expect(markup(source)).not.toContain('chat-ui-changed');
    });
});

describe('tables', () => {
    test('take columns from their Column children and protect values of the wrong kind', () => {
        const { nodes } = evaluate(
            '<Table rows={[{name: "Core", size: 32}, {name: "Client", size: "n/a"}]}><Column key="name"/><Column key="size" as="number" unit="ms"/><Column key="missing"/></Table>'
        );
        const columns = uiTableColumns(nodes[0] as never);
        expect(columns.map((column) => column.key)).toEqual(['name', 'size']);
        expect(uiTableCell('n/a', columns[1]!)).toEqual({ kind: 'text', text: 'n/a' });
        expect(uiTableCell(undefined, columns[1]!)).toEqual({ kind: 'empty' });
        expect(uiTableCell('12', columns[1]!)).toEqual({ kind: 'number', as: 'number', value: 12 });
    });

    test('a date beyond what a Date can hold is text, and the rest of the table still draws', () => {
        const column = { key: 'at', title: 'at', as: 'date' as const };
        for (const value of [1e20, 8.64e15 + 1, -8.64e15 - 1]) {
            expect(uiTableCell(value, column).kind).toBe('text');
        }
        expect(uiTableCell(8.64e15, column)).toEqual({ kind: 'date', at: 8.64e15 });
        expect(uiTableCell('2026-10-11T08:00:00Z', column)).toEqual({ kind: 'date', at: Date.parse('2026-10-11T08:00:00Z') });
        const html = markup('<Table rows={[{at: 1e20, name: "Far"}, {at: 0, name: "Epoch"}]}><Column key="at" as="date"/><Column key="name"/></Table>');
        expect(html).toContain('<table');
        expect(html).toContain('Epoch');
        expect(html).not.toContain('Could not draw this part');
    });

    test('a table without columns shows every key of its rows', () => {
        const { nodes } = evaluate('<Table rows={[{a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9}]}/>');
        expect(uiTableColumns(nodes[0] as never).map((column) => column.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    });

    test('show fifty rows until a person asks for all of them', () => {
        const rows = Array.from({ length: 60 }, (_, index) => `{n: ${index}}`).join(', ');
        const html = markup(`<Table rows={[${rows}]}/>`);
        expect(html.match(/<tr/g)).toHaveLength(51);
        expect(html).toContain('Show all 60 rows');
    });

    test('ask for the live state of numeric cells only, by row and key', () => {
        const asked: unknown[] = [];
        const html = markup(
            '<Table rows={[{name: "Core", size: 32}, {name: "Client", size: 40}]}><Column key="name"/><Column key="size" as="number"/></Table>',
            {
                liveValue: (_nodeId, prop, path) => {
                    asked.push([prop, path]);
                    return path?.[0] === 1 ? { previous: 38, changed: true, stale: false } : { changed: false, stale: true };
                }
            }
        );
        expect(asked).toEqual([
            ['rows', [0, 'size']],
            ['rows', [1, 'size']]
        ]);
        expect(html).toContain('<span class="text-text-muted">32</span>');
        expect(html).toContain('<span class="text-text chat-ui-changed">40</span>');
    });

    test('draw their text when no column is usable', () => {
        expect(markup('<Table rows={[{a: 1}]}><Column key="b"/></Table>')).toContain('Could not draw this part');
    });

    test('a file cell is its path as text, never a link nobody checked', () => {
        const html = markup('<Table rows={[{path: "src/a.ts"}]}><Column key="path" as="file"/></Table>', { link: () => ({ state: 'plain' }) });
        expect(html).toContain('<span class="font-mono text-code break-all">src/a.ts</span>');
        expect(html).not.toContain('tabindex');
    });
});

describe('charts', () => {
    test('keep up to six numeric series and leave gaps for values that are no number', () => {
        const data: Record<string, string | number | boolean | null>[] = [
            { label: 'Mon', a: 1, b: 'x', c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 },
            { label: 'Tue', a: null, c: 1 }
        ];
        const chart = uiChartData(data, 'bar')!;
        expect(chart.series.map((series) => series.key)).toEqual(['a', 'c', 'd', 'e', 'f', 'g']);
        expect(chart.series).toHaveLength(UI_CHART_SERIES);
        expect(chart.series[0]!.values).toEqual([1, null]);
        expect(uiChartData([{ label: 'x', value: 'none' }], 'bar')).toBeNull();
        expect(
            uiChartData(
                [
                    { label: 'x', a: 2 },
                    { label: 'y', a: 3, b: 4 }
                ],
                'stacked'
            )!.max
        ).toBe(7);
        expect([niceCeiling(41), niceCeiling(0.9), niceCeiling(212)]).toEqual([50, 1, 250]);
    });

    test('draw only once their node closed, and describe themselves', () => {
        const source = '<Chart kind="bar" data={[{label: "Core", passed: 32, failed: 1}]}/>';
        const partial = markup(source.slice(0, -2), { phase: 'streaming' }, false);
        expect(partial).not.toContain('role="img"');
        const html = markup(source);
        expect(html).toContain('role="img"');
        expect(html).toContain('highest passed for Core at 32');
        expect(html).toContain('<caption>Values</caption>');
        expect(markup('<Chart kind="line" data={[{label: "x", value: "none"}]}/>')).toContain('Could not draw this part');
    });

    test('a horizontal chart draws a negative value from zero to the left', () => {
        const html = markup('<Chart kind="hbar" data={[{label: "Balance", income: 10, cost: -6}]}/>');
        expect(html).not.toContain('NaN');
        expect(html).toContain('left:50%;width:50%');
        expect(html).toContain('left:20%;width:30%');
        const negative = markup('<Chart kind="hbar" data={[{label: "Core", value: -3}, {label: "Client", value: -1}]}/>');
        expect(negative).not.toContain('NaN');
        expect(negative).toContain('left:40%;width:60%');
        expect(negative).toContain('-3');
    });

    test('stacked data with a negative value stands side by side and says why', () => {
        const chart = uiChartData([{ label: 'Balance', income: 10, cost: -6 }], 'stacked')!;
        expect([chart.kind, chart.min, chart.max]).toEqual(['bar', -6, 10]);
        expect(markup('<Chart kind="stacked" data={[{label: "Balance", income: 10, cost: -6}]}/>')).toContain(
            'Negative values cannot be stacked, so the series stand side by side.'
        );
        expect(uiChartData([{ label: 'Total', a: 2, b: 3 }], 'stacked')!.kind).toBe('stacked');
    });

    test('say which rows and series they leave out, and keep every value reachable', () => {
        const rows = Array.from({ length: 61 }, (_, index) => ({ label: `Row ${index}`, count: index === 60 ? 1_000_000 : 1 }));
        const chart = uiChartData(rows, 'hbar')!;
        expect([chart.labels.length, chart.total, chart.truncated]).toEqual([60, 61, true]);
        const html = markup(`<Chart kind="hbar" data={${JSON.stringify(rows)}}/>`);
        expect(html).toContain('The first 60 of 61 rows are drawn.');
        expect(html).toContain('Show all values');
        expect(html).toContain('61 values, highest Row 60 at 1,000,000');
        expect(html).toContain('<th scope="row">Row 60</th>');
        const wide = '<Chart kind="stacked" data={[{label: "Total", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7}]}/>';
        expect(uiChartData([{ label: 'Total', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }], 'stacked')!.omitted).toEqual(['g']);
        const seven = markup(wide);
        expect(seven).toContain('g is not drawn.');
        expect(seven).toContain('<th scope="col">g</th>');
        expect(compiled(wide).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['too_many_series']);
        expect(markup('<Chart kind="bar" data={[{label: "Core", count: 2}]}/>')).not.toContain('Show all values');
    });

    test('an axis is as wide as its longest label, and a label never runs past its room', () => {
        expect(uiChartAxis(['0', '1', '2'], 326).axisWidth).toBe(44);
        const wide = uiChartAxis(['0', '500,000', '1,000,000'], 326);
        expect(wide.axisWidth).toBe(uiChartTextWidth('1,000,000') + 8);
        const narrow = uiChartAxis(['0', '1,000,000,000,000,000,000,000'], 326);
        expect(narrow.axisWidth).toBeLessThanOrEqual(130);
        expect(uiChartTextWidth(narrow.tickTexts[1]!) + 8).toBeLessThanOrEqual(130);
        expect(uiChartText('Zeer lange categorie zonder een compacte naam', 120)).toBe('Zeer lange cate…');
        expect(uiChartText('Core', 120)).toBe('Core');
    });

    test('text that grows with the root font size gets as much more room', () => {
        expect(uiChartCharacter(16)).toBe(7.5);
        expect(uiChartCharacter(32)).toBe(15);
        expect(uiChartCharacter(Number.NaN)).toBe(7.5);
        const large = uiChartAxis(['0', '500,000', '1,000,000'], 326, uiChartCharacter(32));
        expect(large.axisWidth).toBeGreaterThan(88);
        expect(large.axisWidth).toBeLessThanOrEqual(Math.floor(326 * 0.4));
        for (const text of large.tickTexts) {
            expect(uiChartTextWidth(text, uiChartCharacter(32)) + 8).toBeLessThanOrEqual(large.axisWidth);
        }
    });

    test('values a screen reader hears never widen the block they sit in', () => {
        expect(markup('<Chart kind="bar" data={[{label: "Big", count: 9e307}]}/>')).toMatch(/<div class="sr-only"><table>/);
    });

    test('numbers too large to scale draw as text, never as a coordinate that is not a number', () => {
        for (const source of [
            '<Chart kind="bar" data={[{label: "Huge", count: 1.5e308}]}/>',
            '<Chart kind="stacked" data={[{label: "Huge", a: 1e308, b: 1e308}]}/>'
        ]) {
            const html = markup(source);
            expect(html).not.toMatch(/NaN|Infinity/);
            expect(html).toContain('Could not draw this part');
        }
        expect(uiChartData([{ label: 'Wide', low: -9e307, high: 9e307 }], 'bar')).toBeNull();
        expect(uiChartRange(-3, 5)).toEqual({ low: -5, high: 5 });
        // A subnormal span would scale every coordinate by an infinite factor.
        expect(uiChartRange(0, Number.MIN_VALUE)).toBeNull();
        expect(uiChartRange(0, 1e-310)).toBeNull();
        expect(uiChartRange(0, 1e-300)).not.toBeNull();
        expect(uiChartData([{ label: 'Tiny', value: Number.MIN_VALUE }], 'bar')).toBeNull();
        const tiny = markup(`<Chart kind="hbar" data={[{label: "Tiny", value: ${Number.MIN_VALUE}}]}/>`);
        expect(tiny).not.toMatch(/NaN|Infinity/);
        expect(tiny).toContain('Could not draw this part');
        const drawn = markup('<Chart kind="bar" data={[{label: "Big", count: 9e307}]}/>');
        expect(drawn).not.toMatch(/NaN|Infinity/);
        expect(drawn).toContain('role="img"');
    });
});

describe('links', () => {
    test('stay plain text without a host, and become chips the host opens', () => {
        const source = '<File path="src/terminal/links.ts" line="148"/>';
        expect(markup(source)).toContain('src/terminal/links.ts:148');
        expect(markup(source)).not.toContain('<button');
        const chip = markup(source, { link: () => ({ state: 'chip' }), openLink: () => undefined });
        expect(chip).toContain('<button');
        expect(chip).toContain('links.ts');
        const plain = markup('<File path="~/.codex/config.toml"/>', { link: () => ({ state: 'plain' }) });
        expect(plain).toContain('tabindex="0"');
        expect(markup('<Commit sha="47946f746"/>')).toContain('47946f7');
    });
});

describe('content', () => {
    afterEach(() => {
        host = {};
    });

    test('an image reads only an attachment of the chat', () => {
        expect(markup('<Image generated="latest" alt="A rabbit"/>')).not.toContain('<img');
        host = {
            attachments: { useUrl: (_scope, _chat, id) => ({ url: `blob:${id}`, failure: null }), read: () => Promise.reject(new Error('Not read here')) }
        };
        const html = markup('<Image attachment="rabbit" alt="A rabbit">The rabbit</Image>');
        expect(html).toContain('src="blob:rabbit"');
        expect(html).toContain('<figcaption');
    });

    test('a gallery draws each image as a square cell in a grid that narrows with its container, and a missing one says so', () => {
        host = {
            attachments: {
                useUrl: (_scope, _chat, id) => (id === 'gone' ? { url: null, failure: 'Gone' } : { url: `blob:${id}`, failure: null }),
                read: () => Promise.reject(new Error('Not read here'))
            }
        };
        const html = markup(
            '<Gallery><Image attachment="a1" alt="Login">First screen</Image><Image attachment="gone" alt="Home"/><Image generated="latest" alt="Never made"/></Gallery>'
        );
        expect(html).toContain('@container');
        expect(html).toContain('grid-cols-2');
        expect(html).toContain('@min-[420px]:grid-cols-3');
        expect(html).toContain('aria-label="3 images"');
        expect(html).toContain('src="blob:a1"');
        expect(html).toContain('aspect-ratio:1');
        expect(html).toContain('<figcaption class="text-xs wrap-anywhere text-text-muted">First screen</figcaption>');
        expect(html).toContain('>Never made</figcaption>');
        expect(html).toContain('>Home</figcaption>');
        expect(markup('<Gallery><Image attachment="a1"/></Gallery>')).toContain('aria-label="1 image"');
    });

    test('a comparison wipes between two attachments, labeled, and shows the one left when the other is gone', () => {
        const use = (urls: Record<string, { url: string | null; failure: string | null }>) => {
            host = { attachments: { useUrl: (_scope, _chat, id) => urls[id]!, read: () => Promise.reject(new Error('Not read here')) } };
        };
        const source = '<Compare before="a1" after="a2" beforeLabel="Old" afterLabel="New">Header color</Compare>';
        use({ a1: { url: 'blob:a1', failure: null }, a2: { url: 'blob:a2', failure: null } });
        const both = markup(source);
        expect(both).toContain('role="slider"');
        expect(both).toContain('aria-label="Compare Old and New"');
        expect(both).toContain('aria-valuenow="50"');
        expect(both).toContain('src="blob:a1"');
        expect(both).toContain('src="blob:a2"');
        expect(both).toMatch(/>Old<\/span>[\s\S]*>New<\/span>/);
        expect(both).toContain('Header color</figcaption>');
        expect(markup('<Compare before="a1" after="a2"/>')).toContain('aria-label="Compare Before and After"');
        use({ a1: { url: 'blob:a1', failure: null }, a2: { url: null, failure: 'Gone' } });
        const alone = markup(source);
        expect(alone).not.toContain('role="slider"');
        expect(alone).toContain('src="blob:a1"');
        expect(alone).toContain('One image is not available');
        use({ a1: { url: null, failure: 'Gone' }, a2: { url: null, failure: 'Gone' } });
        expect(markup(source)).not.toContain('One image is not available');
        use({ a1: { url: 'blob:a1', failure: null }, a2: { url: null, failure: null } });
        const loading = markup(source);
        expect(loading).not.toContain('role="slider"');
        expect(loading).not.toContain('src=');
    });

    test('sources are numbered and open through the host only', () => {
        const source = '<Sources><Source title="Docs" url="https://www.adecore.dev/ui"/><Source title="Guide" url="https://example.com"/></Sources>';
        const html = markup(source);
        expect(html).toContain('adecore.dev');
        expect(html).not.toContain('<button');
        expect(html).not.toContain('href');
        expect(markup(source, { openUrl: () => undefined })).toContain('<button');
        expect(html.match(/<li data-ui-source="[^"]+" tabindex="-1"/g)).toHaveLength(2);
    });

    test('a citation is a number that loads nothing, and a button only when it can reveal its source', () => {
        const props = { number: 1, title: 'Docs', url: 'https://www.adecore.dev/ui' };
        const quiet = renderToStaticMarkup(createElement(UiSourceCitation, props));
        expect(quiet).toContain('>1</span>');
        expect(quiet).not.toContain('<button');
        expect(quiet).not.toContain('href');
        expect(quiet).not.toContain('adecore.dev');
        const button = renderToStaticMarkup(createElement(UiSourceCitation, { ...props, onReveal: () => undefined }));
        expect(button).toContain('<button type="button"');
        expect(button).toContain('aria-label="Source 1: Docs"');
        expect(button).not.toContain('href');
    });

    test('structure draws a tab strip and open sections', () => {
        const html = markup(
            '<Tabs><Tab title="First">One</Tab><Tab title="Second">Two</Tab></Tabs><Sections><Section title="Details">Text</Section></Sections>'
        );
        expect(html).toContain('First');
        expect(html).toContain('aria-expanded="true"');
    });
});
