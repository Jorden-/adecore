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

export class SnippetFeature {
    private readonly language: Pick<EditorLanguage, 'editor' | 'onDispose'> & Partial<Pick<EditorLanguage, 'popups'>>;
    private instances: Instance[] = [];
    private order: number[] = [];
    private current = 0;
    private expectedSelections = 0;
    private visiting = false;
    private generation = 0;

    constructor(language: Pick<EditorLanguage, 'editor' | 'onDispose'> & Partial<Pick<EditorLanguage, 'popups'>>) {
        this.language = language;
        const { editor } = language;
        const offs = [editor.onKeyDown((event) => this.key(event)), editor.onTextChange((change) => this.edited(change)), editor.onCaret(() => this.moved())];
        language.onDispose(() => {
            this.end();
            for (const off of offs) {
                off();
            }
        });
    }

    get isActive(): boolean {
        return this.order.length > 0;
    }

    begin(start: EditorPosition | readonly EditorPosition[], text: string, stops: readonly SnippetStop[], fields?: readonly SnippetField[]): void {
        const starts = Array.isArray(start) ? start : [start as EditorPosition];
        this.beginInstances(starts.map((start) => ({ start, text, stops, fields })));
    }

    beginInstances(insertions: readonly { start: EditorPosition; text: string; stops: readonly SnippetStop[]; fields?: readonly SnippetField[] }[]): void {
        this.end();
        const primary = insertions.at(-1);
        if (primary === undefined || primary.stops.length === 0) {
            return;
        }
        this.order = primary.stops.map((stop) => stop.index);
        this.instances = insertions.map(({ start: at, text, stops, fields }): Instance => ({
            hull: { start: at, end: positionInInsertion(at, text, text.length) },
            selected: [],
            fields: stops.map((stop): Field => {
                const field = fields?.find((field) => field.index === stop.index);
                return {
                    index: stop.index,
                    primary: field?.primary ?? 0,
                    ranges: [...(field?.ranges ?? [stop]), ...(field?.linked ?? [])].map((range) => ({
                        start: positionInInsertion(at, text, range.start),
                        end: positionInInsertion(at, text, range.end),
                        ...(range.parents === undefined ? {} : { parents: range.parents })
                    }))
                };
            })
        }));
        this.visit(0);
    }

    end(): void {
        this.generation++;
        this.instances = [];
        this.order = [];
        this.current = 0;
    }

    private visit(index: number): void {
        const { editor } = this.language;
        this.current = index;
        const stop = this.order[index]!;
        const selections = this.instances.flatMap((instance) => {
            const field = instance.fields.find((field) => field.index === stop);
            instance.selected = field === undefined ? [] : stop === 0 ? [field.ranges[field.primary]!] : selectionsOf(field);
            return instance.selected;
        });
        const sorted = [...selections].sort((left, right) => comparePositions(left.start, right.start));
        const touching = sorted.some((range, index) => index > 0 && comparePositions(sorted[index - 1]!.end, range.start) >= 0);
        this.visiting = true;
        try {
            if (touching) {
                const primary = selections.at(-1)!;
                for (const instance of this.instances) {
                    instance.selected = instance.selected.includes(primary) ? [primary] : [];
                }
            }
            editor.setSelections(touching ? [selections.at(-1)!] : selections);
            this.expectedSelections = editor.getSelections().length;
        } finally {
            this.visiting = false;
        }
        if (stop === 0 || index === this.order.length - 1) {
            this.end();
        }
    }

    private key(event: KeyboardEvent): boolean {
        if (!this.isActive || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            return false;
        }
        if (event.key === 'Tab') {
            this.visit(event.shiftKey ? Math.max(0, this.current - 1) : this.current + 1);
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

    private edited(change: EditorTextChange): void {
        if (!this.isActive) {
            return;
        }
        if (change.source !== 'input') {
            this.end();
            return;
        }
        const index = this.order[this.current]!;
        for (const instance of this.instances) {
            const selected = instance.selected;
            const active = instance.fields.find((field) => field.index === index)?.ranges ?? [];
            instance.selected = selected.map((range) => mapRange(range, change.changes, true));
            const values = instance.selected.map((range) => this.language.editor.textInRange(range));
            // Per-caret variables may differ between instances; mirrors within each must agree.
            if (values.some((value) => value !== values[0])) {
                const caret = this.language.editor.getCaret();
                this.end();
                this.language.editor.setCaret(caret);
                return;
            }
            instance.hull = mapRange(instance.hull, change.changes, true);
            for (const field of instance.fields) {
                const primary = field.ranges[field.primary];
                field.ranges = field.ranges.filter(
                    (range) =>
                        !range.parents?.includes(index) ||
                        !change.changes.some(
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
                field.ranges = field.ranges.map((range) => {
                    const grows = new Set(
                        change.changes.filter((edit) =>
                            field.index === index
                                ? rangeHolds(range, edit.range.start) && rangeHolds(range, edit.range.end)
                                : active.some(
                                      (child) =>
                                          child.parents?.includes(field.index) &&
                                          rangeHolds(range, child.start) &&
                                          rangeHolds(range, child.end) &&
                                          rangeHolds(child, edit.range.start)
                                  )
                        )
                    );
                    return mapRange(range, change.changes, (edit) => grows.has(edit));
                });
            }
            instance.fields = instance.fields.filter((field) => field.ranges.length > 0);
            if (!instance.fields.some((field) => field.index === 0)) {
                instance.fields.push({ index: 0, primary: 0, ranges: [{ start: instance.hull.end, end: instance.hull.end }] });
            }
        }
        this.order = this.order.filter((index) => this.instances.at(-1)?.fields.some((field) => field.index === index));
        this.current = this.order.indexOf(index);
    }

    private moved(): void {
        if (!this.isActive || this.visiting) {
            return;
        }
        const { editor } = this.language;
        if (editor.getSelections().length < this.expectedSelections) {
            this.end();
            return;
        }
        const generation = this.generation;
        // The caret event precedes text changes; wait until ranges have followed the edit.
        queueMicrotask(() => {
            if (generation === this.generation && this.isActive && !rangeHolds(this.instances.at(-1)!.hull, editor.getCaret())) {
                this.end();
            }
        });
    }
}
