import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { EditorLayout } from './layout.ts';
import { mountEditor, type MountedEditor } from './testing.ts';
import type { LineTokenizer } from './types.ts';

/*
 * What one keystroke costs in a document of 100,000 lines, counted in work rather than time: CI runners
 * are too noisy for a tight clock, and every regression this guards against (a full lex, a layout of
 * every line, a read of the whole text) shows up as a count long before it shows up as milliseconds.
 */

const LINES = 100_000;

/* Short functions, where the scope guide of the caret stops at the function around it. */
function codeDocument(): string {
    const lines: string[] = [];
    for (let index = 0; lines.length < LINES; index++) {
        lines.push(
            `function block${index}(alpha, beta) {`,
            '    const value = compute(alpha, beta);',
            `    if (value > ${index}) {`,
            `        return other[${index}];`,
            '    }',
            '    return value;',
            '}',
            ''
        );
    }
    return lines.join('\n');
}

/* One long run at a single indentation, such as a large array literal: the worst case for the scope guide, and long enough lines to wrap. */
function flatLine(line: number): string {
    return `    const value${line} = compute(alpha, beta) + other[${line}] * factor(gamma, delta) - remainder(epsilon, ${line}); // a note`;
}

function flatDocument(): string {
    return Array.from({ length: LINES }, (_, line) => flatLine(line)).join('\n');
}

interface Budget {
    /* Lines the layout builds rows for again. */
    readonly laidOut: number;
    /* Lines the grammar colors again. */
    readonly lexedLines: number;
    readonly getLine: number;
    /* Characters read from the document through `getLine`, `slice` and `getText`. */
    readonly charactersRead: number;
    readonly elementsCreated: number;
}

/* The most a scope guide reads each way from the caret, GUIDE_RUN_LINES of the view. */
const GUIDE_RUN_LINES = 5_000;

/*
 * About twice what the costliest keystroke of each run took when this was written (code: 3 lines laid out,
 * 2 lexed, 270 lines and 9 KiB read, 559 elements; flat: the same plus the scope guide, 10,219 lines and
 * 1.2 MiB read). The elements are the gutter and the overlays of the rows on screen, which are drawn anew.
 */
const CODE: Budget = { laidOut: 8, lexedLines: 8, getLine: 500, charactersRead: 16 * 1024, elementsCreated: 1_000 };
const FLAT_GET_LINE = CODE.getLine + 2 * GUIDE_RUN_LINES;
const BUDGETS: Record<'code' | 'flat', Budget> = {
    code: CODE,
    // The scope guide of a run at one indentation reads its full bound each way, every line of it whole.
    flat: { ...CODE, getLine: FLAT_GET_LINE, charactersRead: FLAT_GET_LINE * flatLine(LINES).length }
};

/*
 * The median keystroke takes about 1 ms (code) and 3 ms (flat) on a laptop. A gate twenty times above
 * that only trips on a shared runner for a regression the size of the 92 ms full lex fixed in #57.
 */
const MEDIAN_MS = 60;

const KEYSTROKES = 40;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function countingGrammar(): { lines: number; tokenizer: LineTokenizer } {
    const grammar = {
        lines: 0,
        tokenizer: {
            tokenizeLine: (text: string, state: unknown) => {
                grammar.lines++;
                return { tokens: [{ length: text.length, color: '', fontStyle: 0 }], state };
            },
            sameState: (left: unknown, right: unknown) => left === right
        }
    };
    return grammar;
}

/* Lets the coloring the editor slices into timers run out, so its work counts against the keystroke that caused it. */
async function idle(grammar: { lines: number }): Promise<void> {
    let before = -1;
    while (before !== grammar.lines) {
        before = grammar.lines;
        await pause(2);
    }
}

function keystroke(mounted: MountedEditor, index: number): void {
    if (index % 20 === 19) {
        mounted.press('Enter');
    } else if (index % 10 === 9) {
        mounted.press('Backspace');
    } else {
        mounted.type('x');
    }
}

const restores: (() => void)[] = [];

afterEach(() => {
    while (restores.length > 0) {
        restores.pop()!();
    }
});

function counters(mounted: MountedEditor) {
    type RowBuilder = { buildRows(structure: unknown, from: number, to: number, index: number): unknown };
    const getLine = spyOn(DocumentModel.prototype, 'getLine');
    const slice = spyOn(DocumentModel.prototype, 'slice');
    const getText = spyOn(DocumentModel.prototype, 'getText');
    const buildRows = spyOn(EditorLayout.prototype as unknown as RowBuilder, 'buildRows');
    const createElement = spyOn(mounted.page.document, 'createElement');
    const spies = [getLine, slice, getText, buildRows, createElement];
    restores.push(() => spies.forEach((spy) => spy.mockRestore()));
    // Editors other tests left mounted run their timers while this one waits, so only the calls on this editor's document count.
    const ours = (context: unknown): boolean => (context as DocumentModel).getLineCount() >= LINES;
    const oursLayout = (context: unknown): boolean => ours((context as { document: unknown }).document);
    const results = <Value>(spy: { mock: { contexts: unknown[]; results: { value: unknown }[] } }): Value[] =>
        spy.mock.results.filter((_, index) => ours(spy.mock.contexts[index])).map((result) => result.value as Value);
    return {
        reset: (): void => spies.forEach((spy) => spy.mockClear()),
        read: () => {
            const lines = results<{ text: string }>(getLine).map((line) => line.text);
            const texts = [...lines, ...results<string>(slice), ...results<string>(getText)];
            return {
                laidOut: buildRows.mock.calls
                    .filter((_, index) => oursLayout(buildRows.mock.contexts[index]))
                    .reduce((sum, [, from, to]) => sum + to - from + 1, 0),
                getLine: lines.length,
                getText: results(getText).length,
                charactersRead: texts.reduce((sum, text) => sum + text.length, 0),
                elementsCreated: createElement.mock.calls.length
            };
        }
    };
}

describe('a keystroke in a document of 100,000 lines', () => {
    const documents = { code: codeDocument(), flat: flatDocument() };

    for (const name of ['code', 'flat'] as const) {
        for (const wrap of [false, true]) {
            test(`stays within its budget in the ${name} document${wrap ? ', wrapped' : ''}`, async () => {
                const grammar = countingGrammar();
                // Between a parenthesis and a name, so the bracket pair at the caret is looked up on every keystroke.
                const mounted = mountEditor({ text: documents[name], line: 50_002, column: 28 }, { tokenizer: async () => grammar.tokenizer });
                restores.push(() => mounted.editor.dispose());
                Object.defineProperties(mounted.viewport, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
                mounted.editor.setWrap(wrap);
                if (wrap && name === 'flat') {
                    expect(mounted.editor.getLineHeight(0)).toBeGreaterThan(mounted.editor.getBaseLineHeight!());
                }
                await idle(grammar);
                // The first Enter reads every line above the caret to fill the model's cache of typing contexts, once per document.
                for (let index = 0; index < 20; index++) {
                    keystroke(mounted, index);
                }
                await idle(grammar);

                const count = counters(mounted);
                const work: (ReturnType<typeof count.read> & { lexedLines: number })[] = [];
                const times: number[] = [];
                for (let index = 0; index < KEYSTROKES; index++) {
                    count.reset();
                    grammar.lines = 0;
                    const started = performance.now();
                    keystroke(mounted, index);
                    times.push(performance.now() - started);
                    await idle(grammar);
                    work.push({ ...count.read(), lexedLines: grammar.lines });
                }

                const budget = BUDGETS[name];
                const most = (key: keyof (typeof work)[number]): number => Math.max(...work.map((entry) => entry[key]));
                times.sort((left, right) => left - right);
                // `ADECORE_KEYSTROKE_REPORT=1` prints what each run measured, to set the budgets again.
                if (process.env.ADECORE_KEYSTROKE_REPORT) {
                    console.log(
                        JSON.stringify({
                            name,
                            wrap,
                            ...Object.fromEntries(Object.keys(budget).map((key) => [key, most(key as keyof Budget)])),
                            medianMs: times[KEYSTROKES / 2]
                        })
                    );
                }
                expect(mounted.editor.getCaret().line).toBe(50_004);
                // A renamed method would leave its spy counting nothing and the gate passing.
                expect(Math.min(most('laidOut'), most('lexedLines'), most('getLine'), most('elementsCreated'))).toBeGreaterThan(0);
                expect(most('getText')).toBe(0);
                expect(most('laidOut')).toBeLessThanOrEqual(budget.laidOut);
                expect(most('lexedLines')).toBeLessThanOrEqual(budget.lexedLines);
                expect(most('getLine')).toBeLessThanOrEqual(budget.getLine);
                expect(most('charactersRead')).toBeLessThanOrEqual(budget.charactersRead);
                expect(most('elementsCreated')).toBeLessThanOrEqual(budget.elementsCreated);
                expect(times[KEYSTROKES / 2]!).toBeLessThan(MEDIAN_MS);
            });
        }
    }
});
