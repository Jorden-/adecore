import { compareSnippetOrder, snippetOrderOf } from './snippet-range-order.ts';
import { SnippetFieldTransforms, type FieldTransformTarget } from './snippet-field-transforms.ts';
import { SnippetTransformError } from './snippet-transform-client.ts';
import { acquireSnippetTransforms, type SnippetTransformLease } from './snippet-transform-queue.ts';
import { realTimers, type Timers } from './timers.ts';
import { MAX_TRANSFORM_CHARACTERS, type SnippetTransformJob } from './snippet-transform-protocol.ts';
import type { EditorContentChange, EditorPosition, EditorRange, EditorTextChange } from '@adecore/editor';
import { comparePositions, rangeHolds, shiftPosition } from './diagnostics-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import type { SnippetField, SnippetStop, SnippetTransform } from './snippet.ts';

export function positionInInsertion(start: EditorPosition, text: string, offset: number): EditorPosition {
    const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
    return lines.length === 1
        ? { line: start.line, character: start.character + offset }
        : { line: start.line + lines.length - 1, character: lines[lines.length - 1]!.length };
}

interface SessionRange extends EditorRange {
    readonly id: symbol;
    readonly order: readonly number[];
    readonly ancestors?: readonly symbol[];
    readonly transform?: SnippetTransform;
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
    readonly exits: Map<number, number>;
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
    const positions = [...insertions].sort((left, right) => comparePositions(left.start, right.start));
    const instanceOrder = new Map(positions.map((insertion, index) => [insertion.start, index]));
    if (primary === undefined || primary.stops.length === 0) {
        return null;
    }
    return {
        order: primary.stops.map((stop) => stop.index),
        current: 0,
        expectedSelections: 0,
        exits: new Map(),
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
                        id: Symbol('snippet-range'),
                        order: [instanceOrder.get(at)!, snippetOrderOf(range) ?? (stop.index === 0 ? Infinity : stops.indexOf(stop))],
                        ...(range.transform === undefined ? {} : { transform: range.transform }),
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
    private placed: SessionRange[] = [];
    private visiting = false;
    private applying = false;
    private extras: readonly EditorContentChange[] = [];
    private generation = 0;
    private choicePrefix: string | null = null;
    private readonly transforms: SnippetTransformLease | null;
    private readonly fieldTransforms: SnippetFieldTransforms;
    private exitGeneration = 0;
    private detached: {
        targets: readonly FieldTransformTarget[];
        ranges: ReadonlyMap<symbol, EditorRange>;
        map: <Range extends EditorRange>(range: Range, parent?: (target: FieldTransformTarget) => boolean) => Range;
    } | null = null;

    constructor(language: SnippetHost, timers: Timers = realTimers) {
        this.language = language;
        this.transforms = language.project === undefined ? null : acquireSnippetTransforms(language.project, timers);
        const { editor } = language;
        this.fieldTransforms = new SnippetFieldTransforms(editor, this.transforms, (targets, values) => this.applyFieldTransforms(targets, values));
        const offs = [editor.onKeyDown((event) => this.key(event)), editor.onTextChange((change) => this.edited(change)), editor.onCaret(() => this.moved())];
        language.onDispose(() => {
            this.transforms?.dispose();
            this.end();
            for (const off of offs) {
                off();
            }
        });
    }

    async transformVariables(jobs: readonly SnippetTransformJob[], current: () => boolean = () => true): Promise<readonly string[] | null> {
        if (this.transforms === null) {
            return null;
        }
        try {
            return await this.transforms.request(jobs, { current });
        } catch (error) {
            if (error instanceof SnippetTransformError && ['timeout', 'unavailable', 'superseded', 'disposed'].includes(error.kind)) {
                return null;
            }
            throw error;
        }
    }

    get hasPendingTransforms(): boolean {
        return this.fieldTransforms.pending;
    }

    async settleTransforms(
        current: () => boolean,
        edited?: (changes: readonly EditorContentChange[], map: (range: EditorRange) => EditorRange) => void
    ): Promise<boolean> {
        let selections = this.language.editor.getSelections(),
            valid = true;
        const off = this.language.editor.onTextChange((change) => {
            if (this.detached === null) {
                valid = false;
            } else {
                selections = selections.map((range) => this.detached!.map(range));
                edited?.(change.changes, this.detached.map);
            }
        });
        try {
            await this.fieldTransforms.settle();
        } finally {
            off();
        }
        const now = this.language.editor.getSelections();
        return (
            valid &&
            current() &&
            now.length === selections.length &&
            now.every(
                (range, index) => comparePositions(range.start, selections[index]!.start) === 0 && comparePositions(range.end, selections[index]!.end) === 0
            )
        );
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
        if (nested && parent !== undefined) {
            const selectedParents = new Set(this.frames.flatMap((frame) => frame.instances.flatMap((parent) => parent.selected.map((range) => range.id))));
            for (const instance of frame.instances) {
                const enclosing = parent.instances
                    .flatMap((parent) => parent.selected)
                    .find((range) => rangeHolds(range, instance.hull.start) && rangeHolds(range, instance.hull.end));
                const emptyHull = comparePositions(instance.hull.start, instance.hull.end) === 0;
                const ancestors = this.frames
                    .flatMap((frame) => frame.instances.flatMap((parent) => parent.fields.flatMap((field) => field.ranges)))
                    .filter(
                        (range) =>
                            (comparePositions(range.start, range.end) < 0 || selectedParents.has(range.id)) &&
                            rangeHolds(range, instance.hull.start) &&
                            rangeHolds(range, instance.hull.end) &&
                            (!emptyHull ||
                                range.id === enclosing?.id ||
                                (comparePositions(range.start, instance.hull.start) < 0 && comparePositions(instance.hull.end, range.end) < 0))
                    )
                    .map((range) => range.id);
                for (const field of instance.fields) {
                    field.ranges = field.ranges.map((range) => ({ ...range, order: [...(enclosing?.order ?? []), ...range.order], ancestors }));
                }
            }
        }
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
        this.exitGeneration++;
        this.fieldTransforms.clear();
        this.closeChoices();
        this.generation++;
        this.frames = [];
        this.placed = [];
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
        frame.exits.set(stop, (frame.exits.get(stop) ?? 0) + 1);
        this.fieldTransforms.prune();
        const selections = selectedOf(frame);
        this.placed = selections;
        if (selections.length === 0) {
            this.end();
            return;
        }
        this.visiting = true;
        try {
            this.language.editor.setSelections(selections.map(({ start, end }) => ({ start, end })));
            frame.expectedSelections = this.language.editor.getSelections().length;
        } finally {
            this.visiting = false;
        }
        if (choices && stop !== 0) {
            this.announceField(frame, index);
        }
        if (stop === 0 || index === frame.order.length - 1) {
            this.pop();
        } else if (choices) {
            this.openChoices(frame);
        }
    }

    /* Says which field the caret moved to, with the number of choices when the field is a list. */
    private announceField(frame: Frame, index: number): void {
        const i18n = this.language.project?.i18n;
        if (i18n === undefined) {
            return;
        }
        const total = frame.order.filter((stop) => stop !== 0).length;
        const options = { current: index + 1, total };
        const choices = this.fieldOf(frame)?.choices?.length ?? 0;
        this.language.editor.announce(
            choices > 0 && index < frame.order.length - 1
                ? i18n.t('editor:language.announce.fieldChoices', { ...options, count: choices })
                : i18n.t('editor:language.announce.field', options)
        );
    }

    private fieldOf(frame: Frame): Frame['instances'][number]['fields'][number] | undefined {
        return frame.instances.at(-1)?.fields.find((field) => field.index === frame.order[frame.current]);
    }

    private openChoices(frame: Frame, activeChoice?: number): void {
        const field = this.fieldOf(frame);
        if (field?.choices === undefined || field.choices.length === 0 || this.language.pick === undefined) {
            return;
        }
        const token = this.generation;
        const prefix = `snippet-${token}-`;
        this.choicePrefix = prefix;
        this.language.pick.open({
            anchor: field.ranges[field.primary]!.start,
            title: this.language.project?.i18n.t('editor:language.snippet.choices'),
            active: prefix + (activeChoice ?? Math.max(0, field.choices.indexOf(this.language.editor.textInRange(field.ranges[field.primary]!)))),
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
        this.exitField(frame);
        if (backwards && frame.current === 0 && this.frames.length > 1) {
            this.pop();
            this.visit(this.frames.at(-1)!.current);
        } else {
            this.visit(backwards ? Math.max(0, frame.current - 1) : frame.current + 1);
        }
    }

    private key(event: KeyboardEvent): boolean {
        if ((!this.isActive && !this.fieldTransforms.pending) || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            return false;
        }
        if (event.key === 'Tab' && this.isActive) {
            this.step(event.shiftKey);
            return true;
        }
        if (event.key === 'Escape') {
            const popups = this.language.popups?.getState();
            if (popups !== undefined && [popups.completion, popups.signature, popups.hover, popups.pick, popups.peek].some((popup) => popup !== null)) {
                return false;
            }
            const active = this.isActive;
            const caret = this.language.editor.getCaret();
            this.end();
            if (active) {
                this.language.editor.setCaret(caret);
            }
            return true;
        }
        return false;
    }

    private exitField(frame: Frame): void {
        const index = frame.order[frame.current]!;
        const seq = (frame.exits.get(index) ?? 0) + 1;
        frame.exits.set(index, seq);
        const generation = this.exitGeneration;
        const targets: FieldTransformTarget[] = [];
        for (const instance of frame.instances) {
            const field = instance.fields.find((field) => field.index === index);
            for (const range of field?.ranges ?? []) {
                if (range.transform === undefined) {
                    continue;
                }
                targets.push({
                    id: range.id,
                    range,
                    value: this.language.editor.textInRange(range),
                    transform: range.transform,
                    parents: range.parents,
                    owner: instance,
                    frame,
                    order: range.order,
                    ancestors: range.ancestors
                });
            }
        }
        if (
            targets.length === 0 ||
            this.transforms === null ||
            this.fieldTransforms.ranges + this.frames.reduce((sum, frame) => sum + rangeCount(frame), targets.length) > MAX_RANGES
        ) {
            return;
        }
        for (const instance of frame.instances) {
            for (const field of instance.fields) {
                const primary = field.ranges[field.primary];
                field.ranges = field.ranges.filter(
                    (range) =>
                        !range.parents?.includes(index) ||
                        !targets.some((target) => target.owner === instance && rangeHolds(target.range, range.start) && rangeHolds(target.range, range.end))
                );
                field.primary = Math.max(0, field.ranges.indexOf(primary!));
            }
            instance.fields = instance.fields.filter((field) => field.ranges.length > 0);
        }
        frame.order = frame.order.filter((stop) => frame.instances.at(-1)?.fields.some((field) => field.index === stop));
        frame.current = frame.order.indexOf(index);
        this.fieldTransforms.enqueue(targets, () => generation === this.exitGeneration && frame.exits.get(index) === seq);
    }

    private applyFieldTransforms(targets: readonly FieldTransformTarget[], values: readonly string[]): void {
        const { editor } = this.language;
        const activeFrame = this.frames.at(-1);
        const active = activeFrame?.instances.flatMap((instance) => instance.selected) ?? [];
        if (
            targets.some(
                (target) =>
                    target.frame === activeFrame &&
                    active.some((range) => comparePositions(range.start, target.range.end) < 0 && comparePositions(target.range.start, range.end) < 0)
            )
        ) {
            return;
        }
        const groups: { change: EditorContentChange; targets: { target: FieldTransformTarget; text: string }[] }[] = [];
        let characters = 0;
        for (const [index, target] of targets.entries()) {
            const before = editor.textInRange({ start: { line: target.range.start.line, character: 0 }, end: target.range.start });
            const prefix = /^[\t ]*/.exec(before)?.[0] ?? '';
            const value = values[index]!;
            let newlines = 0;
            for (let at = value.indexOf('\n'); at !== -1; at = value.indexOf('\n', at + 1)) {
                newlines++;
            }
            characters += value.length + newlines * prefix.length;
            if (characters > MAX_TRANSFORM_CHARACTERS) {
                return;
            }
            const text = value.replace(/\n/g, '\n' + prefix);
            if (text === editor.textInRange(target.range)) {
                continue;
            }
            const empty = comparePositions(target.range.start, target.range.end) === 0;
            const group = empty
                ? groups.find(
                      (group) =>
                          comparePositions(group.change.range.start, group.change.range.end) === 0 &&
                          comparePositions(group.change.range.start, target.range.start) === 0
                  )
                : undefined;
            if (group === undefined) {
                groups.push({ change: { range: target.range, text }, targets: [{ target, text }] });
            } else {
                group.change = { range: group.change.range, text: group.change.text + text };
                group.targets.push({ target, text });
            }
        }
        if (groups.length === 0) {
            return;
        }
        for (const group of groups) {
            group.targets.sort((left, right) => compareSnippetOrder(left.target.order, right.target.order));
            group.change = { range: group.change.range, text: group.targets.map(({ text }) => text).join('') };
        }
        const changes = groups.map((group) => group.change).sort((left, right) => comparePositions(right.range.start, left.range.start));
        const peersOf = new Map(groups.map((group) => [group.change, group.targets.map(({ target }) => target)]));
        const ranges = new Map<symbol, EditorRange>();
        const steps = new Map<symbol, EditorRange>();
        for (const group of groups) {
            let start = group.change.range.start;
            for (const edit of changes) {
                if (comparePositions(edit.range.start, group.change.range.start) < 0) {
                    start = shiftPosition(start, edit);
                }
            }
            let local = group.change.range.start;
            for (const { target, text } of group.targets) {
                const localEnd = positionInInsertion(local, text, text.length);
                steps.set(target.id, { start: local, end: localEnd });
                local = localEnd;
                const end = positionInInsertion(start, text, text.length);
                ranges.set(target.id, { start, end });
                start = end;
            }
        }
        const frame = this.frames.at(-1);
        const pick = this.language.popups?.getState().pick;
        const activeChoice =
            this.choicePrefix !== null && pick?.active.startsWith(this.choicePrefix) ? Number(pick.active.slice(this.choicePrefix.length)) : undefined;
        const trackedFrames = [...new Set([...this.frames, ...targets.map((target) => target.frame as Frame)])];
        const transformIds = new Set(targets.map((target) => target.id));
        const captured = [
            ...this.placed,
            ...active,
            ...trackedFrames.flatMap((frame) =>
                frame.instances.flatMap((instance) =>
                    instance.fields.flatMap((field) =>
                        field.ranges.filter((range) => !transformIds.has(range.id) || comparePositions(range.start, range.end) < 0)
                    )
                )
            )
        ];
        const ancestorsOf = new Map(
            targets.map((target) => [
                target,
                new Set([
                    ...(target.ancestors ?? []),
                    ...(target.frame as Frame).instances.flatMap((instance) =>
                        instance.fields.flatMap((field) =>
                            target.owner === instance && target.parents?.includes(field.index) === true
                                ? field.ranges
                                      .filter((range) => rangeHolds(range, target.range.start) && rangeHolds(range, target.range.end))
                                      .map((range) => range.id)
                                : []
                        )
                    )
                ])
            ])
        );
        const map = <Range extends EditorRange>(range: Range, parent?: (target: FieldTransformTarget) => boolean): Range => {
            const tracked =
                'order' in range
                    ? (range as Range & SessionRange)
                    : captured.find((candidate) => comparePositions(candidate.start, range.start) === 0 && comparePositions(candidate.end, range.end) === 0);
            let { start, end } = range;
            for (const change of changes) {
                const peers = peersOf.get(change)!;
                const descendants = peers.filter((peer) => parent?.(peer) ?? (tracked !== undefined && ancestorsOf.get(peer)!.has(tracked.id)));
                const grows = descendants.length > 0;
                const empty = comparePositions(start, end) === 0;
                const boundary = (position: EditorPosition): EditorPosition => {
                    if (comparePositions(position, change.range.start) !== 0 || peers.length === 0) {
                        return shiftPosition(position, change);
                    }
                    let low = 0,
                        high = peers.length;
                    while (low < high) {
                        const middle = (low + high) >>> 1;
                        if (compareSnippetOrder(peers[middle]!.order, tracked?.order ?? [Infinity]) < 0) {
                            low = middle + 1;
                        } else {
                            high = middle;
                        }
                    }
                    return low === 0 ? steps.get(peers[0]!.id)!.start : steps.get(peers[low - 1]!.id)!.end;
                };
                // A grown range takes in only its own descendants' output; a sibling's output at the same point stays outside.
                const atChange = (position: EditorPosition): boolean => comparePositions(position, change.range.start) === 0;
                start = grows && atChange(start) ? steps.get(descendants[0]!.id)!.start : grows ? shiftPosition(start, change) : boundary(start);
                end = grows
                    ? atChange(end)
                        ? steps.get(descendants.at(-1)!.id)!.end
                        : shiftPosition(end, change)
                    : !empty && atChange(end)
                      ? end
                      : boundary(end);
            }
            return { ...range, start, end };
        };
        this.detached = { targets, ranges, map };
        this.applying = true;
        try {
            editor.applyEdits(changes, { mapSelections: (range) => map(range) });
        } finally {
            this.applying = false;
            this.detached = null;
        }
        // The generic picker closes on any text edit, including an exit elsewhere in the snippet.
        if (frame !== undefined && frame === this.frames.at(-1) && activeChoice !== undefined && this.language.popups?.getState().pick === null) {
            this.openChoices(frame, activeChoice);
        }
    }

    private mapFrame(frame: Frame, changes: readonly EditorContentChange[], extras: ReadonlySet<EditorContentChange>): boolean {
        const index = frame.order[frame.current]!;
        const owned = this.detached === null ? changes.filter((edit) => !extras.has(edit)) : [];
        for (const instance of frame.instances) {
            const active = instance.fields.find((field) => field.index === index)?.ranges ?? [];
            const owners = activeOwners(active, owned);
            instance.selected = instance.selected.map((range) =>
                this.detached === null ? mapRange(range, changes, (edit) => !extras.has(edit)) : this.detached.map(range)
            );
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
            const rangeIds = new Set(instance.fields.flatMap((field) => field.ranges.map((range) => range.id)));
            instance.hull = mapRange(instance.hull, changes, (edit) =>
                this.detached === null
                    ? !extras.has(edit)
                    : this.detached.targets.some(
                          (target) =>
                              (target.owner === instance || target.ancestors?.some((id) => rangeIds.has(id))) &&
                              comparePositions(target.range.start, edit.range.start) === 0
                      )
            );
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
                field.ranges = field.ranges.map((range) => {
                    const replacement = this.detached?.ranges.get(range.id);
                    if (replacement !== undefined) {
                        field.divergent = true;
                        return { ...range, ...replacement };
                    }
                    if (this.detached !== null) {
                        return this.detached.map(
                            range,
                            (target) =>
                                target.ancestors?.includes(range.id) === true ||
                                (target.frame === frame &&
                                    target.owner === instance &&
                                    target.parents?.includes(field.index) === true &&
                                    rangeHolds(range, target.range.start) &&
                                    rangeHolds(range, target.range.end))
                        );
                    }
                    return mapRange(range, changes, (edit) => {
                        const owner = owners.get(edit);
                        return (
                            owner !== undefined &&
                            (field.index === index
                                ? owner === range
                                : owner.parents?.includes(field.index) === true && rangeHolds(range, owner.start) && rangeHolds(range, owner.end))
                        );
                    });
                });
            }
            instance.fields = instance.fields.filter((field) => field.ranges.length > 0);
            if (!instance.fields.some((field) => field.index === 0)) {
                instance.fields.push({
                    index: 0,
                    primary: 0,
                    ranges: [{ id: Symbol('snippet-final'), order: [Infinity], start: instance.hull.end, end: instance.hull.end }]
                });
            }
        }
        frame.order = frame.order.filter((index) => frame.instances.at(-1)?.fields.some((field) => field.index === index));
        frame.current = frame.order.indexOf(index);
        return frame.current !== -1;
    }

    private edited(change: EditorTextChange): void {
        if (change.source !== 'input' && !this.applying) {
            this.end();
            return;
        }
        this.fieldTransforms.edited(change.changes, this.detached?.map);
        this.placed = this.placed.map((range) => (this.detached === null ? mapRange(range, change.changes, true) : this.detached.map(range)));
        if (!this.isActive) {
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
