import { createSnippetTransformClient, type SnippetTransformClient } from './snippet-transform-client.ts';
import type { SnippetTransformJob } from './snippet-transform-protocol.ts';
import type { EditorContentChange, EditorPosition, EditorRange, EditorTextChange } from '@adecore/editor';
import { comparePositions, rangeHolds, shiftPosition } from './diagnostics-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import type { SnippetField, SnippetStop } from './snippet.ts';

export function positionInInsertion(start: EditorPosition, text: string, offset: number): EditorPosition {
    const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
    return lines.length === 1
        ? { line: start.line, character: start.character + offset }
        : { line: start.line + lines.length - 1, character: lines[lines.length - 1]!.length };
}

interface SessionRange extends EditorRange {
    readonly parents?: readonly number[];
}

interface Field {
    index: number;
    ranges: SessionRange[];
    primary: number;
    choices?: readonly string[];
    divergent?: boolean;
}
interface Instance {
    fields: Field[];
    hull: EditorRange;
    selected: SessionRange[];
}

function mapRange<Range extends EditorRange>(
    range: Range,
    changes: readonly EditorContentChange[],
    grow: boolean | ((change: EditorContentChange) => boolean)
): Range {
    let { start, end } = range;
    for (const change of changes) {
        const grows = typeof grow === 'boolean' ? grow : grow(change);
        const empty = comparePositions(start, end) === 0;
        const insertAtEnd = comparePositions(change.range.start, change.range.end) === 0 && comparePositions(end, change.range.start) === 0;
        // Active fields and their parents include text inserted at their left edge.
        start = grows && comparePositions(start, change.range.start) === 0 ? change.range.start : shiftPosition(start, change);
        end = !grows && !empty && insertAtEnd ? end : shiftPosition(end, change);
    }
    return { ...range, start, end };
}

function selectionsOf(field: Field): SessionRange[] {
    const primary = field.ranges[field.primary]!;
    const sorted = [...field.ranges].sort((left, right) => comparePositions(left.start, right.start));
    // The editor merges touching selections; keep these mirrors static instead of editing their union.
    if (sorted.some((range, index) => index > 0 && comparePositions(sorted[index - 1]!.end, range.start) >= 0)) {
        return [primary];
    }
    return [...field.ranges.filter((range) => range !== primary), primary];
}

interface Frame {
    instances: Instance[];
    order: number[];
    current: number;
    expectedSelections: number;
}

export interface SnippetInsertion {
    readonly start: EditorPosition;
    readonly text: string;
    readonly stops: readonly SnippetStop[];
    readonly fields?: readonly SnippetField[];
}

type SnippetHost = Pick<EditorLanguage, 'editor' | 'onDispose'> & Partial<Pick<EditorLanguage, 'popups' | 'pick' | 'project'>>;
const MAX_FRAMES = 8;
const MAX_RANGES = 1000;

function frameOf(insertions: readonly SnippetInsertion[]): Frame | null {
    const primary = insertions.at(-1);
    if (primary === undefined || primary.stops.length === 0) {
        return null;
    }
    return {
        order: primary.stops.map((stop) => stop.index),
        current: 0,
        expectedSelections: 0,
        instances: insertions.map(({ start: at, text, stops, fields }): Instance => ({
            hull: { start: at, end: positionInInsertion(at, text, text.length) },
            selected: [],
            fields: stops.map((stop): Field => {
                const field = fields?.find((field) => field.index === stop.index);
                return {
                    index: stop.index,
                    primary: field?.primary ?? 0,
                    choices: field?.choices,
                    ranges: [...(field?.ranges ?? [stop]), ...(field?.linked ?? [])].map((range) => ({
                        start: positionInInsertion(at, text, range.start),
                        end: positionInInsertion(at, text, range.end),
                        ...(range.parents === undefined ? {} : { parents: range.parents })
                    }))
                };
            })
        }))
    };
}

function rangeCount(frame: Frame): number {
    return frame.instances.reduce((total, instance) => total + instance.fields.reduce((count, field) => count + field.ranges.length, 0), 0);
}

function selectedOf(frame: Frame): SessionRange[] {
    const stop = frame.order[frame.current]!;
    const selections = frame.instances.flatMap((instance) => {
        const field = instance.fields.find((field) => field.index === stop);
        instance.selected = field === undefined ? [] : stop === 0 ? [field.ranges[field.primary]!] : selectionsOf(field);
        return instance.selected;
    });
    const sorted = [...selections].sort((left, right) => comparePositions(left.start, right.start));
    if (sorted.some((range, index) => index > 0 && comparePositions(sorted[index - 1]!.end, range.start) >= 0)) {
        const primary = selections.at(-1)!;
        for (const instance of frame.instances) {
            instance.selected = instance.selected.includes(primary) ? [primary] : [];
        }
        return [primary];
    }
    return selections;
}

function activeOwners(active: readonly SessionRange[], changes: readonly EditorContentChange[]): ReadonlyMap<EditorContentChange, SessionRange> {
    const sorted = [...active].sort((left, right) => comparePositions(left.start, right.start) || comparePositions(left.end, right.end));
    const owners = new Map<EditorContentChange, SessionRange>();
    for (const edit of changes) {
        let low = 0;
        let high = sorted.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (comparePositions(sorted[middle]!.start, edit.range.start) <= 0) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        const range = sorted[low - 1];
        if (range !== undefined && rangeHolds(range, edit.range.start) && rangeHolds(range, edit.range.end)) {
            owners.set(edit, range);
        }
    }
    return owners;
}

export class SnippetFeature {
    private readonly language: SnippetHost;
    private frames: Frame[] = [];
    private visiting = false;
    private applying = false;
    private extras: readonly EditorContentChange[] = [];
    private generation = 0;
    private choicePrefix: string | null = null;
    private transforms: SnippetTransformClient | null = null;

    constructor(language: SnippetHost) {
        this.language = language;
        const { editor } = language;
        const offs = [editor.onKeyDown((event) => this.key(event)), editor.onTextChange((change) => this.edited(change)), editor.onCaret(() => this.moved())];
        language.onDispose(() => {
            this.transforms?.dispose();
            this.end();
            for (const off of offs) {
                off();
            }
        });
    }

    async transformVariables(jobs: readonly SnippetTransformJob[]): Promise<readonly string[] | null> {
        const factory = this.language.project?.host.snippetTransformWorker;
        if (factory === undefined) {
            return null;
        }
        this.transforms ??= createSnippetTransformClient({ workerFactory: factory });
        try {
            return await this.transforms.transform(jobs);
        } catch {
            // A refused or timed-out transform retains the untransformed snippet.
            return null;
        }
    }

    get isActive(): boolean {
        return this.frames.length > 0;
    }

    get token(): number {
        return this.generation;
    }

    begin(start: EditorPosition | readonly EditorPosition[], text: string, stops: readonly SnippetStop[], fields?: readonly SnippetField[]): void {
        const starts = Array.isArray(start) ? start : [start as EditorPosition];
        this.beginInstances(starts.map((start) => ({ start, text, stops, fields })));
    }

    beginInstances(insertions: readonly SnippetInsertion[], options: { nested?: boolean } = {}): void {
        const ranges = insertions.reduce(
            (total, insertion) =>
                total +
                (insertion.fields === undefined
                    ? insertion.stops.length
                    : insertion.fields.reduce((count, field) => count + field.ranges.length + (field.linked?.length ?? 0), 1)),
            0
        );
        if (ranges > MAX_RANGES) {
            this.end();
            return;
        }
        const frame = frameOf(insertions);
        if (frame === null) {
            if (!options.nested) {
                this.end();
            }
            return;
        }
        const parent = this.frames.at(-1);
        const nested =
            options.nested &&
            parent !== undefined &&
            frame.instances.every((instance) =>
                parent.instances.some((parent) =>
                    parent.selected.some((range) => rangeHolds(range, instance.hull.start) && rangeHolds(range, instance.hull.end))
                )
            );
        if (!nested || this.frames.length >= MAX_FRAMES || this.frames.reduce((total, frame) => total + rangeCount(frame), rangeCount(frame)) > MAX_RANGES) {
            this.end();
        }
        if (rangeCount(frame) > MAX_RANGES) {
            return;
        }
        this.closeChoices();
        this.frames.push(frame);
        this.generation++;
        this.visit(0);
    }

    /* Imports can touch a hull's edge; their affinity must differ from edits inside its active field. */
    applyEdits(changes: readonly EditorContentChange[], token: number, extras: readonly EditorContentChange[] = []): boolean {
        const frame = this.frames.at(-1);
        const fits =
            frame !== undefined &&
            changes.every((edit) =>
                extras.includes(edit)
                    ? frame.instances.every(
                          (instance) => comparePositions(edit.range.end, instance.hull.start) <= 0 || comparePositions(edit.range.start, instance.hull.end) >= 0
                      )
                    : frame.instances.some((instance) =>
                          instance.selected.some((range) => rangeHolds(range, edit.range.start) && rangeHolds(range, edit.range.end))
                      )
            );
        if (token !== this.generation || !fits) {
            this.end();
            return this.language.editor.applyEdits(changes);
        }
        this.applying = true;
        this.extras = extras;
        try {
            return this.language.editor.applyEdits(changes);
        } finally {
            this.applying = false;
            this.extras = [];
        }
    }

    end(): void {
        this.closeChoices();
        this.generation++;
        this.frames = [];
    }

    private closeChoices(): void {
        const view = this.language.popups?.getState().pick;
        if (this.choicePrefix !== null && view?.groups.some((group) => group.rows.some((row) => row.id.startsWith(this.choicePrefix!)))) {
            this.language.pick?.close();
        }
        this.choicePrefix = null;
    }

    private pop(): void {
        this.closeChoices();
        this.frames.pop();
        this.generation++;
        const parent = this.frames.at(-1);
        if (parent !== undefined) {
            selectedOf(parent);
            parent.expectedSelections = this.language.editor.getSelections().length;
        }
    }

    private visit(index: number, choices = true): void {
        const frame = this.frames.at(-1);
        if (frame === undefined) {
            return;
        }
        this.closeChoices();
        this.generation++;
        frame.current = index;
        const stop = frame.order[index]!;
        const selections = selectedOf(frame);
        if (selections.length === 0) {
            this.end();
            return;
        }
        this.visiting = true;
        try {
            this.language.editor.setSelections(selections);
            frame.expectedSelections = this.language.editor.getSelections().length;
        } finally {
            this.visiting = false;
        }
        if (stop === 0 || index === frame.order.length - 1) {
            this.pop();
        } else if (choices) {
            this.openChoices(frame);
        }
    }

    private openChoices(frame: Frame): void {
        const field = frame.instances.at(-1)?.fields.find((field) => field.index === frame.order[frame.current]);
        if (field?.choices === undefined || field.choices.length === 0 || this.language.pick === undefined) {
            return;
        }
        const token = this.generation;
        const prefix = `snippet-${token}-`;
        this.choicePrefix = prefix;
        this.language.pick.open({
            anchor: field.ranges[field.primary]!.start,
            title: this.language.project?.i18n.t('editor:language.snippet.choices'),
            active: prefix + Math.max(0, field.choices.indexOf(this.language.editor.textInRange(field.ranges[field.primary]!))),
            groups: [{ title: null, rows: field.choices.map((label, index) => ({ id: prefix + index, label, detail: '' })) }],
            accept: (id) => {
                if (token !== this.generation) {
                    return;
                }
                const text = field.choices![Number(id.slice(prefix.length))];
                if (text === undefined) {
                    return;
                }
                const changes = frame.instances.flatMap((instance) => instance.selected.map((range) => ({ range, text })));
                this.applyEdits(changes, token);
                if (this.frames.at(-1) === frame) {
                    this.visit(frame.current, false);
                }
            },
            onTab: (backwards) => {
                if (token === this.generation) {
                    this.step(backwards);
                }
            }
        });
    }

    private step(backwards: boolean): void {
        const frame = this.frames.at(-1);
        if (frame === undefined) {
            return;
        }
        if (backwards && frame.current === 0 && this.frames.length > 1) {
            this.pop();
            this.visit(this.frames.at(-1)!.current);
        } else {
            this.visit(backwards ? Math.max(0, frame.current - 1) : frame.current + 1);
        }
    }

    private key(event: KeyboardEvent): boolean {
        if (!this.isActive || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            return false;
        }
        if (event.key === 'Tab') {
            this.step(event.shiftKey);
            return true;
        }
        if (event.key === 'Escape') {
            const popups = this.language.popups?.getState();
            if (popups !== undefined && [popups.completion, popups.signature, popups.hover, popups.pick, popups.peek].some((popup) => popup !== null)) {
                return false;
            }
            const caret = this.language.editor.getCaret();
            this.end();
            this.language.editor.setCaret(caret);
            return true;
        }
        return false;
    }

    private mapFrame(frame: Frame, changes: readonly EditorContentChange[], extras: ReadonlySet<EditorContentChange>): boolean {
        const index = frame.order[frame.current]!;
        const owned = changes.filter((edit) => !extras.has(edit));
        for (const instance of frame.instances) {
            const active = instance.fields.find((field) => field.index === index)?.ranges ?? [];
            const owners = activeOwners(active, owned);
            instance.selected = instance.selected.map((range) => mapRange(range, changes, (edit) => !extras.has(edit)));
            const values = instance.selected.map((range) => this.language.editor.textInRange(range));
            const field = instance.fields.find((field) => field.index === index);
            if (values.some((value) => value !== values[0])) {
                if (field === undefined || (!this.applying && !field.divergent)) {
                    return false;
                }
                // Per-caret completion variables intentionally give parent mirrors different values.
                field.divergent = true;
            } else if (field !== undefined) {
                field.divergent = false;
            }
            instance.hull = mapRange(instance.hull, changes, (edit) => !extras.has(edit));
            for (const field of instance.fields) {
                const primary = field.ranges[field.primary];
                field.ranges = field.ranges.filter(
                    (range) =>
                        !range.parents?.includes(index) ||
                        !owned.some(
                            (edit) =>
                                comparePositions(edit.range.start, edit.range.end) < 0 &&
                                (comparePositions(range.start, range.end) === 0
                                    ? rangeHolds(edit.range, range.start)
                                    : comparePositions(edit.range.start, range.end) < 0 && comparePositions(range.start, edit.range.end) < 0)
                        )
                );
                field.primary = Math.max(
                    0,
                    field.ranges.findIndex((range) => range === primary)
                );
                field.ranges = field.ranges.map((range) =>
                    mapRange(range, changes, (edit) => {
                        const owner = owners.get(edit);
                        return (
                            owner !== undefined &&
                            (field.index === index
                                ? owner === range
                                : owner.parents?.includes(field.index) === true && rangeHolds(range, owner.start) && rangeHolds(range, owner.end))
                        );
                    })
                );
            }
            instance.fields = instance.fields.filter((field) => field.ranges.length > 0);
            if (!instance.fields.some((field) => field.index === 0)) {
                instance.fields.push({ index: 0, primary: 0, ranges: [{ start: instance.hull.end, end: instance.hull.end }] });
            }
        }
        frame.order = frame.order.filter((index) => frame.instances.at(-1)?.fields.some((field) => field.index === index));
        frame.current = frame.order.indexOf(index);
        return frame.current !== -1;
    }

    private edited(change: EditorTextChange): void {
        if (!this.isActive) {
            return;
        }
        if (change.source !== 'input' && !this.applying) {
            this.end();
            return;
        }
        const extras = new Set(
            change.changes.filter((change) =>
                this.extras.some(
                    (extra) =>
                        comparePositions(extra.range.start, change.range.start) === 0 &&
                        comparePositions(extra.range.end, change.range.end) === 0 &&
                        extra.text === change.text
                )
            )
        );
        for (const frame of this.frames) {
            if (!this.mapFrame(frame, change.changes, extras)) {
                const caret = this.language.editor.getCaret();
                this.end();
                this.language.editor.setCaret(caret);
                return;
            }
        }
    }

    private moved(): void {
        const frame = this.frames.at(-1);
        if (frame === undefined || this.visiting || this.applying) {
            return;
        }
        const { editor } = this.language;
        if (editor.getSelections().length < frame.expectedSelections) {
            this.end();
            return;
        }
        const generation = this.generation;
        // The caret event precedes text changes; wait until ranges have followed the edit.
        queueMicrotask(() => {
            if (generation !== this.generation) {
                return;
            }
            while (this.frames.length > 0 && !rangeHolds(this.frames.at(-1)!.instances.at(-1)!.hull, editor.getCaret())) {
                this.pop();
            }
        });
    }
}
