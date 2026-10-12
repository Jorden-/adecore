import type { Editor, EditorContentChange, EditorRange } from '@adecore/editor';
import { comparePositions, shiftPosition } from './diagnostics-model.ts';
import type { SnippetTransform } from './snippet.ts';
import type { SnippetTransformLease } from './snippet-transform-queue.ts';
import type { SnippetTransformJob } from './snippet-transform-protocol.ts';

export interface FieldTransformTarget {
    readonly id: symbol;
    range: EditorRange;
    readonly value: string;
    readonly transform: SnippetTransform;
    readonly parents?: readonly number[];
    readonly owner: object;
    readonly frame: object;
    readonly order: readonly number[];
    readonly ancestors?: readonly symbol[];
}
interface Entry {
    readonly targets: FieldTransformTarget[];
    readonly current: () => boolean;
    readonly done: Promise<void>;
    readonly finish: () => void;
    cancelled: boolean;
}

/* Navigation frames can pop before a worker replies; their tracked targets live independently. */
export class SnippetFieldTransforms {
    private readonly entries = new Set<Entry>();
    private applying: Entry | null = null;
    private readonly editor: Editor;
    private readonly lease: SnippetTransformLease | null;
    private readonly apply: (targets: readonly FieldTransformTarget[], values: readonly string[]) => void;
    constructor(editor: Editor, lease: SnippetTransformLease | null, apply: (targets: readonly FieldTransformTarget[], values: readonly string[]) => void) {
        this.editor = editor;
        this.lease = lease;
        this.apply = apply;
    }
    get pending(): boolean {
        return this.entries.size > 0;
    }
    get ranges(): number {
        return [...this.entries].reduce((sum, entry) => sum + entry.targets.length, 0);
    }
    async settle(): Promise<void> {
        await Promise.all([...this.entries].map((entry) => entry.done));
    }
    enqueue(targets: FieldTransformTarget[], current: () => boolean): void {
        if (targets.length === 0 || this.lease === null) {
            return;
        }
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const entry: Entry = { targets, current, done, finish, cancelled: false };
        this.entries.add(entry);
        const jobs: SnippetTransformJob[] = [],
            keys = new Map<string, number>();
        const slots = targets.map((target) => {
            const job = { ...target.transform, value: target.value },
                key = JSON.stringify(job);
            let slot = keys.get(key);
            if (slot === undefined) {
                slot = jobs.length;
                keys.set(key, slot);
                jobs.push(job);
            }
            return slot;
        });
        const valid = (): boolean => !entry.cancelled && entry.current() && targets.every((target) => this.editor.textInRange(target.range) === target.value);
        void this.lease
            .request(jobs, { kind: 'exit', current: valid })
            .then((values) => {
                if (!valid()) {
                    return;
                }
                this.applying = entry;
                try {
                    this.apply(
                        targets,
                        slots.map((slot) => values[slot]!)
                    );
                } finally {
                    this.applying = null;
                }
            })
            .catch(() => {
                /* Failed exits retain the raw field value without retrying. */
            })
            .finally(() => {
                this.entries.delete(entry);
                finish();
            });
    }
    prune(): void {
        for (const entry of this.entries) {
            if (!entry.current()) {
                this.cancel(entry);
            }
        }
    }
    clear(): void {
        for (const entry of this.entries) {
            this.cancel(entry);
        }
    }
    private cancel(entry: Entry): void {
        entry.cancelled = true;
        this.entries.delete(entry);
        entry.finish();
    }
    edited(changes: readonly EditorContentChange[], detached?: <Range extends EditorRange>(range: Range) => Range): void {
        for (const entry of this.entries) {
            if (entry === this.applying) {
                continue;
            }
            for (const target of entry.targets) {
                let { start, end } = target.range;
                for (const change of changes) {
                    const empty = comparePositions(start, end) === 0;
                    const insert = comparePositions(change.range.start, change.range.end) === 0;
                    const overlaps = insert
                        ? empty
                            ? comparePositions(start, change.range.start) === 0
                            : comparePositions(start, change.range.start) < 0 && comparePositions(change.range.start, end) < 0
                        : empty
                          ? comparePositions(change.range.start, start) <= 0 && comparePositions(start, change.range.end) < 0
                          : comparePositions(change.range.start, end) < 0 && comparePositions(start, change.range.end) < 0;
                    if (overlaps && !(detached !== undefined && empty && insert)) {
                        this.cancel(entry);
                        break;
                    }
                    const insertAtEnd = insert && !empty && comparePositions(end, change.range.start) === 0;
                    start = shiftPosition(start, change);
                    end = insertAtEnd ? end : shiftPosition(end, change);
                }
                target.range = detached === undefined ? { start, end } : detached({ ...target.range, order: target.order });
                if (entry.cancelled) {
                    break;
                }
            }
        }
    }
}
