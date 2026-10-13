import {
    type BracketMatch,
    type BracketRules,
    type BracketState,
    type BracketVisitor,
    bracketRules,
    initialBracketState,
    lexBrackets,
    sameBracketState
} from './brackets.ts';
import type { TextRope } from './rope.ts';
import type { DocumentChange } from './types.ts';

/* What the tracker reads of the document. */
export type BracketText = Pick<TextRope, 'length' | 'lineCount' | 'charAt' | 'lineAt' | 'lineBounds' | 'slice'>;

/* How much text one stretch between checkpoints holds, which is what an edit makes the tracker lex again. */
const STRETCH_LENGTH = 4096;

/* The lexer's state at the start of a line, and what it went through from there to the next checkpoint. */
interface Checkpoint {
    line: number;
    state: Readonly<BracketState>;
    /* The fewest brackets open anywhere from this line to the next checkpoint. */
    low: number;
    /* An edit, or a state that turned out different, left `low` and the state of the next checkpoint unproven. */
    stale: boolean;
}

/* The lines an edit replaced: `first` through `oldLast` before it, `first` through `newLast` after it. */
interface LineEdit {
    first: number;
    oldLast: number;
    newLast: number;
}

interface BracketEvent {
    kind: 'open' | 'close' | 'mismatch';
    depth: number;
    /* The mate, when the lexed stretch already holds it; null when it shows there is none. */
    mate?: number | null;
}

const IGNORE: BracketVisitor = {
    open() {},
    close() {},
    mismatch() {}
};

/*
 * Pairs the bracket at an offset without lexing the document for it. The lexer's state is kept at checkpoints a
 * few kilobytes apart, so an edit lexes only the stretch it is in, and the checkpoints after it count again as
 * soon as the state at one of them comes out the same. Each checkpoint also knows how few brackets were open
 * until the next, which lets a search for a far mate step over whole stretches.
 */
export class BracketTracker {
    private readonly text: () => BracketText;
    private readonly stretchLength: number;
    private language = '';
    private rules: BracketRules = bracketRules('');
    private checkpoints: Checkpoint[] = [];
    /* The first stale checkpoint: what comes before it is proven, and so is its state. */
    private proven = 0;
    /* How much more the current question may lex. */
    private budget = Number.POSITIVE_INFINITY;

    constructor(text: () => BracketText, stretchLength = STRETCH_LENGTH) {
        this.text = text;
        this.stretchLength = stretchLength;
    }

    /* Follows simultaneous changes that turned `before` into `after`, in the coordinates of `before`. */
    edited(before: BracketText, after: BracketText, changes: readonly DocumentChange[]): void {
        if (this.checkpoints.length === 0 || changes.length === 0) {
            return;
        }
        const edits: LineEdit[] = [];
        let delta = 0;
        for (const change of changes) {
            // The line above too, since an edit at the start of a line can turn the `\r` that ends it into a `\r\n`.
            const first = Math.max(0, before.lineAt(change.from) - 1);
            const oldLast = before.lineAt(change.to);
            const newLast = after.lineAt(change.from + delta + change.insertedLength);
            delta += change.insertedLength - (change.to - change.from);
            const previous = edits.at(-1);
            if (previous !== undefined && first <= previous.oldLast) {
                previous.oldLast = oldLast;
                previous.newLast = newLast;
            } else {
                edits.push({ first, oldLast, newLast });
            }
        }
        const kept: Checkpoint[] = [];
        let index = 0;
        let shift = 0;
        for (const checkpoint of this.checkpoints) {
            let dropped = false;
            while (index < edits.length && checkpoint.line > edits[index]!.first) {
                kept.at(-1)!.stale = true;
                if (checkpoint.line <= edits[index]!.oldLast) {
                    dropped = true;
                    break;
                }
                shift = edits[index]!.newLast - edits[index]!.oldLast;
                index++;
            }
            if (!dropped) {
                checkpoint.line += shift;
                kept.push(checkpoint);
            }
        }
        if (index < edits.length) {
            kept.at(-1)!.stale = true;
        }
        this.checkpoints = kept;
        this.proven = this.nextStale(0);
    }

    /*
     * The mate of the bracket at `offset`. Undefined where no bracket of the code stands, as in a string or a comment,
     * and null when answering takes lexing more than `limit` characters; the work is kept, so asking again goes on.
     */
    match(offset: number, language: string, limit = Number.POSITIVE_INFINITY): BracketMatch | null | undefined {
        const rope = this.text();
        if (!/^[()[\]{}]$/.test(rope.charAt(offset))) {
            return undefined;
        }
        this.use(language);
        this.budget = limit;
        const line = rope.lineAt(offset);
        if (!this.prove(line)) {
            return null;
        }
        const index = this.stretchOf(line);
        const event = this.eventAt(index, offset);
        if (event === undefined) {
            return undefined;
        }
        if (event.kind === 'mismatch' || event.mate === null) {
            return { mate: undefined };
        }
        if (event.mate !== undefined) {
            return { mate: event.mate };
        }
        const mate = event.kind === 'open' ? this.closerAfter(index, event.depth) : this.openerBefore(index, event.depth);
        return mate === null ? null : { mate };
    }

    private use(language: string): void {
        if (language === this.language && this.checkpoints.length > 0) {
            return;
        }
        this.language = language;
        this.rules = bracketRules(language);
        this.checkpoints = [{ line: 0, state: initialBracketState(), low: 0, stale: true }];
        this.proven = 0;
    }

    private nextStale(from: number): number {
        let index = from;
        while (index < this.checkpoints.length && !this.checkpoints[index]!.stale) {
            index++;
        }
        return index;
    }

    /* Lexes until the stretch that holds `line` is proven, or the budget is spent. */
    private prove(line: number): boolean {
        while (this.proven < this.checkpoints.length && this.checkpoints[this.proven]!.line <= line) {
            if (this.budget <= 0) {
                return false;
            }
            this.relex(this.proven, line);
        }
        return true;
    }

    /* Lexes the stale stretch at `index` again, cut into new ones, and stops early once it is past `until`. */
    private relex(index: number, until: number): void {
        const rope = this.text();
        const next = this.checkpoints[index + 1];
        const stop = next?.line ?? rope.lineCount;
        const state = { ...this.checkpoints[index]!.state };
        const added: Checkpoint[] = [];
        let current = this.checkpoints[index]!;
        let line = current.line;
        for (;;) {
            const from = rope.lineBounds(line).start;
            const end = Math.min(stop, from + this.stretchLength >= rope.length ? rope.lineCount : Math.max(line + 1, rope.lineAt(from + this.stretchLength)));
            const to = end >= rope.lineCount ? rope.length : rope.lineBounds(end).start;
            let low = state.stack?.depth ?? 0;
            this.budget -= to - from;
            lexBrackets(state, this.rules, rope.slice(from, to), 0, to - from, from, {
                open() {},
                close(_at, depth) {
                    low = Math.min(low, depth - 1);
                },
                mismatch() {
                    low = 0;
                }
            });
            current.low = low;
            current.stale = false;
            if (end === stop) {
                if (next !== undefined && !sameBracketState(state, next.state)) {
                    next.state = state;
                    next.stale = true;
                }
                break;
            }
            current = { line: end, state: { ...state }, low: 0, stale: true };
            added.push(current);
            line = end;
            if (end > until || this.budget <= 0) {
                break;
            }
        }
        this.checkpoints.splice(index + 1, 0, ...added);
        this.proven = this.nextStale(index + 1);
    }

    private stretchOf(line: number): number {
        let low = 0;
        let high = this.checkpoints.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (this.checkpoints[middle]!.line <= line) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return low;
    }

    private lexStretch(index: number, visitor: BracketVisitor): void {
        const rope = this.text();
        const from = rope.lineBounds(this.checkpoints[index]!.line).start;
        const next = this.checkpoints[index + 1];
        const to = next === undefined ? rope.length : rope.lineBounds(next.line).start;
        lexBrackets({ ...this.checkpoints[index]!.state }, this.rules, rope.slice(from, to), 0, to - from, from, visitor);
    }

    /* What the lexer made of the bracket at `offset`, with its mate when the stretch it is in holds that. */
    private eventAt(index: number, offset: number): BracketEvent | undefined {
        let found: BracketEvent | undefined;
        // The openers this stretch opened; the ones from before it are only counted.
        let opened: number[] = [];
        this.lexStretch(index, {
            open(at, depth) {
                opened.push(at);
                if (at === offset) {
                    found = { kind: 'open', depth };
                }
            },
            close(at, depth) {
                const opener = opened.pop();
                if (at === offset) {
                    found = { kind: 'close', depth, ...(opener === undefined ? {} : { mate: opener }) };
                } else if (found?.kind === 'open' && found.mate === undefined && depth === found.depth) {
                    found.mate = at;
                }
            },
            mismatch(at) {
                opened = [];
                if (at === offset) {
                    found = { kind: 'mismatch', depth: 0 };
                } else if (found?.kind === 'open' && found.mate === undefined) {
                    found.mate = null;
                }
            }
        });
        return found;
    }

    /* The closer of an opener at `depth` that the stretch at `index` leaves open, undefined when nothing closes it and null when the budget ran out. */
    private closerAfter(index: number, depth: number): number | null | undefined {
        for (let current = index + 1; current < this.checkpoints.length; current++) {
            if (!this.prove(this.checkpoints[current]!.line)) {
                return null;
            }
            if (this.checkpoints[current]!.low >= depth) {
                continue;
            }
            let result: number | false | undefined;
            this.lexStretch(current, {
                open() {},
                close(at, closed) {
                    if (result === undefined && closed === depth) {
                        result = at;
                    }
                },
                mismatch() {
                    result ??= false;
                }
            });
            return result === false ? undefined : result;
        }
        return undefined;
    }

    /* The opener at `depth` that is still open where the stretch at `index` starts. */
    private openerBefore(index: number, depth: number): number | undefined {
        for (let current = index - 1; current >= 0; current--) {
            if (this.checkpoints[current]!.low >= depth) {
                continue;
            }
            let result: number | undefined;
            this.lexStretch(current, {
                ...IGNORE,
                open(at, opened) {
                    if (opened === depth) {
                        result = at;
                    }
                }
            });
            return result;
        }
        return undefined;
    }
}
