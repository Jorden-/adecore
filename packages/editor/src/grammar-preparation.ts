import type { DocumentChange, DocumentModel } from '@adecore/editor-core';
import type { LineTokenizer } from './types.ts';

type Schedule = (callback: () => void, delay: number) => () => void;
const scheduleTimer: Schedule = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
};
const MAX_BUFFER = 64 * 1024;

/* Edits collect language declarations without making every key wait for grammar loading. */
export class GrammarPreparation {
    private tokenizer: LineTokenizer | null = null;
    private generation = 0;
    private pending: string[] = [];
    private size = 0;
    private full = false;
    private running = false;
    private due = false;
    private paused = false;
    private disposed = false;
    private cancelTimer: (() => void) | null = null;

    private readonly model: Pick<DocumentModel, 'getText' | 'getLine' | 'positionAt'>;
    private readonly changed: () => void;
    private readonly schedule: Schedule;

    constructor(model: Pick<DocumentModel, 'getText' | 'getLine' | 'positionAt'>, changed: () => void, schedule: Schedule = scheduleTimer) {
        this.model = model;
        this.changed = changed;
        this.schedule = schedule;
    }

    begin(): void {
        this.generation++;
        this.tokenizer = null;
        this.clear();
    }

    ready(tokenizer: LineTokenizer | null): void {
        this.tokenizer = tokenizer;
        this.scheduleFlush();
    }

    edited(batches: readonly (readonly DocumentChange[])[]): void {
        if (this.disposed || this.paused) {
            return;
        }
        if (this.tokenizer === null || batches.length !== 1) {
            this.full = true;
        } else if (this.tokenizer.prepare === undefined) {
            return;
        } else if (!this.full) {
            let shift = 0;
            let through = -1;
            for (const change of batches[0]!) {
                const first = this.model.positionAt(change.from + shift).line;
                const last = this.model.positionAt(change.from + shift + change.insertedLength).line;
                shift += change.insertedLength - (change.to - change.from);
                for (let line = Math.max(first, through + 1); line <= last; line++) {
                    const text = this.model.getLine(line).text;
                    this.size += text.length + 1;
                    if (this.size > MAX_BUFFER) {
                        this.full = true;
                        this.pending = [];
                        break;
                    }
                    this.pending.push(text);
                }
                through = last;
                if (this.full) {
                    break;
                }
            }
        }
        this.scheduleFlush();
    }

    pause(paused: boolean): void {
        if (this.paused === paused) {
            return;
        }
        this.paused = paused;
        this.generation++;
        this.clear();
        if (!paused) {
            this.full = true;
            this.scheduleFlush();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
        this.clear();
        this.tokenizer = null;
    }

    private clear(): void {
        this.cancelTimer?.();
        this.cancelTimer = null;
        this.pending = [];
        this.size = 0;
        this.full = false;
        this.due = false;
    }

    private scheduleFlush(): void {
        if (this.disposed || this.paused || this.tokenizer?.prepare === undefined || (!this.full && this.pending.length === 0)) {
            return;
        }
        this.cancelTimer?.();
        this.due = false;
        this.cancelTimer = this.schedule(() => {
            this.cancelTimer = null;
            this.due = true;
            void this.flush();
        }, 200);
    }

    private async flush(): Promise<void> {
        const tokenizer = this.tokenizer;
        if (this.running || this.disposed || this.paused || tokenizer?.prepare === undefined || !this.due) {
            return;
        }
        const generation = this.generation;
        const text = this.full ? this.model.getText() : this.pending.join('\n');
        this.pending = [];
        this.size = 0;
        this.full = false;
        this.due = false;
        this.running = true;
        try {
            await tokenizer.prepare(text);
            if (!this.disposed && !this.paused && generation === this.generation && tokenizer === this.tokenizer) {
                // A load completed while paused may already have rebuilt this grammar.
                this.changed();
            }
        } catch {
            // Keep the current colors; a later edit may retry the failed load.
        } finally {
            this.running = false;
            if (this.due) {
                void this.flush();
            }
        }
    }
}
