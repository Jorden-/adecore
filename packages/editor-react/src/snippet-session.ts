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

interface Field {
    index: number;
    ranges: EditorRange[];
    primary: number;
    parents: readonly number[];
}
interface Instance {
    fields: Field[];
    hull: EditorRange;
}

function mapRange(range: EditorRange, changes: readonly EditorContentChange[], grow: boolean): EditorRange {
    let { start, end } = range;
    for (const change of changes) {
        // Active fields and their parents include text inserted at their left edge.
        start = grow && comparePositions(start, change.range.start) === 0 ? change.range.start : shiftPosition(start, change);
        end = shiftPosition(end, change);
    }
    return { start, end };
}

function selectionsOf(field: Field): EditorRange[] {
    const primary = field.ranges[field.primary]!;
    const sorted = [...field.ranges].sort((left, right) => comparePositions(left.start, right.start));
    // The editor merges touching selections; keep these mirrors static instead of editing their union.
    if (sorted.some((range, index) => index > 0 && comparePositions(sorted[index - 1]!.end, range.start) >= 0)) {
        return [primary];
    }
    return [...field.ranges.filter((range) => range !== primary), primary];
}

export class SnippetFeature {
    private readonly language: Pick<EditorLanguage, 'editor' | 'onDispose'>;
    private instances: Instance[] = [];
    private order: number[] = [];
    private current = 0;
    private expectedSelections = 0;
    private selected: EditorRange[] = [];
    private visiting = false;
    private generation = 0;

    constructor(language: Pick<EditorLanguage, 'editor' | 'onDispose'>) {
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
        this.end();
        if (stops.length === 0) {
            return;
        }
        const starts = Array.isArray(start) ? start : [start as EditorPosition];
        this.order = stops.map((stop) => stop.index);
        this.instances = starts.map((at): Instance => ({
            hull: { start: at, end: positionInInsertion(at, text, text.length) },
            fields: stops.map((stop): Field => {
                const field = fields?.find((field) => field.index === stop.index);
                return {
                    index: stop.index,
                    primary: field?.primary ?? 0,
                    parents: field?.parents ?? [],
                    ranges: [...(field?.ranges ?? [stop]), ...(field?.linked ?? [])].map((range) => ({
                        start: positionInInsertion(at, text, range.start),
                        end: positionInInsertion(at, text, range.end)
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
        this.selected = [];
        this.current = 0;
    }

    private visit(index: number): void {
        const { editor } = this.language;
        this.current = index;
        const stop = this.order[index]!;
        const selections = this.instances.flatMap((instance) => {
            const field = instance.fields.find((field) => field.index === stop)!;
            return stop === 0 ? [field.ranges[field.primary]!] : selectionsOf(field);
        });
        const sorted = [...selections].sort((left, right) => comparePositions(left.start, right.start));
        const touching = sorted.some((range, index) => index > 0 && comparePositions(sorted[index - 1]!.end, range.start) >= 0);
        this.visiting = true;
        try {
            this.selected = touching ? [selections.at(-1)!] : selections;
            editor.setSelections(this.selected);
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
        const selected = this.selected;
        this.selected = this.selected.map((range) => mapRange(range, change.changes, true));
        const values = this.selected.map((range) => this.language.editor.textInRange(range));
        // Distributed paste or contextual smart typing can give synthetic carets different text.
        if (values.some((value) => value !== values[0])) {
            const caret = this.language.editor.getCaret();
            this.end();
            this.language.editor.setCaret(caret);
            return;
        }
        const index = this.order[this.current]!;
        const parents = this.instances[0]?.fields.find((field) => field.index === index)?.parents ?? [];
        for (const instance of this.instances) {
            instance.hull = mapRange(instance.hull, change.changes, true);
            for (const field of instance.fields) {
                if (!field.parents.includes(index)) {
                    continue;
                }
                const primary = field.ranges[field.primary];
                field.ranges = field.ranges.filter((range) => !selected.some((parent) => rangeHolds(parent, range.start) && rangeHolds(parent, range.end)));
                field.primary = Math.max(
                    0,
                    field.ranges.findIndex((range) => range === primary)
                );
            }
            instance.fields = instance.fields.filter((field) => field.ranges.length > 0);
            if (!instance.fields.some((field) => field.index === 0)) {
                instance.fields.push({ index: 0, primary: 0, parents: [], ranges: [{ start: instance.hull.end, end: instance.hull.end }] });
            }
            for (const field of instance.fields) {
                field.ranges = field.ranges.map((range) => mapRange(range, change.changes, field.index === index || parents.includes(field.index)));
            }
        }
        this.order = this.order.filter((index) => this.instances[0]?.fields.some((field) => field.index === index));
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
