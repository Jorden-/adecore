/* How many terminals may hold a WebGL renderer at the same time. A browser keeps about 16 live
   contexts per page and silently drops the oldest, so the budget stays well under that and leaves
   room for whatever else on the page draws with WebGL. */
export const DEFAULT_WEBGL_CONTEXTS = 10;

/* Output moves a context at most once in this window, and only away from a holder that was quiet
   for as long. Without it, more writing terminals than slots trade contexts on every chunk, and
   each switch rebuilds an atlas and can resize the pty, which makes the program write again. */
export const OUTPUT_SWITCH_INTERVAL_MS = 1000;

export interface SlotChange {
    granted: string[];
    revoked: string[];
}

interface Member {
    /* Stamp of the last focus, write or request; the ranking is this number, high to low. */
    seq: number;
    /* When the terminal last asked, was focused or was written to, on the clock of the slots. */
    activeAt: number;
    holding: boolean;
    /* The browser took this terminal's context away, so it stays out of the running until a focus. */
    blocked: boolean;
}

const nothing = (): SlotChange => ({ granted: [], revoked: [] });

/**
 * Hands a fixed number of WebGL contexts to the terminals that deserve them most, the focused one
 * first, then the ones most recently focused or written to. Knows nothing about xterm or the DOM;
 * the budget turns a `SlotChange` into addons that are loaded and disposed.
 */
export class WebglSlots {
    private readonly members = new Map<string, Member>();
    private cap: number;
    private focusedId: string | null = null;
    private stamp = 0;
    private outputSwitchedAt = Number.NEGATIVE_INFINITY;
    private readonly now: () => number;

    /* `now` is a clock in milliseconds. */
    constructor(cap: number = DEFAULT_WEBGL_CONTEXTS, now: () => number = () => performance.now()) {
        this.cap = Math.max(1, cap);
        this.now = now;
    }

    /* The terminals holding a context, highest ranked first. */
    holders(): string[] {
        return this.ranked().filter((id) => this.holds(id));
    }

    holds(id: string): boolean {
        return this.members.get(id)?.holding === true;
    }

    /* The terminals that want a context and do not have one, highest ranked first. */
    waiting(): string[] {
        return this.ranked().filter((id) => !this.holds(id));
    }

    /* A terminal that just became visible asks for a context. */
    request(id: string): SlotChange {
        const member = this.members.get(id);
        if (member) {
            member.seq = ++this.stamp;
            member.activeAt = this.now();
        } else {
            this.members.set(id, { seq: ++this.stamp, activeAt: this.now(), holding: false, blocked: false });
        }
        return this.reconcile();
    }

    /* A terminal that unmounts or stops drawing with WebGL leaves the running for good. */
    release(id: string): SlotChange {
        if (!this.members.delete(id)) {
            return nothing();
        }
        if (this.focusedId === id) {
            this.focusedId = null;
        }
        return this.reconcile();
    }

    focus(id: string): SlotChange {
        this.focusedId = id;
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        member.seq = ++this.stamp;
        member.activeAt = this.now();
        // Focusing is how a terminal that lost its context asks for a new one.
        member.blocked = false;
        return this.reconcile();
    }

    blur(id: string): SlotChange {
        if (this.focusedId !== id) {
            return nothing();
        }
        this.focusedId = null;
        return this.reconcile();
    }

    /* Output arrived, so this terminal is worth more than an idle one. */
    touch(id: string): SlotChange {
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        const now = this.now();
        member.seq = ++this.stamp;
        member.activeAt = now;
        // A holder that climbs stays a holder; only a waiter can change who holds what.
        if (member.holding || now - this.outputSwitchedAt < OUTPUT_SWITCH_INTERVAL_MS) {
            return nothing();
        }
        const target = this.target();
        const evictsBusyHolder = [...this.members].some(
            ([other, entry]) => entry.holding && !target.has(other) && now - entry.activeAt < OUTPUT_SWITCH_INTERVAL_MS
        );
        // The waiter keeps its new rank; its next write tries again, and so does any request, focus or release.
        if (evictsBusyHolder) {
            return nothing();
        }
        const change = this.reconcile(target);
        if (change.granted.length > 0 || change.revoked.length > 0) {
            this.outputSwitchedAt = now;
        }
        return change;
    }

    /* The browser reported a context loss, free the slot and wait for a focus before asking again. */
    lost(id: string): SlotChange {
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        member.holding = false;
        member.blocked = true;
        return this.reconcile();
    }

    setCap(cap: number): SlotChange {
        this.cap = Math.max(1, cap);
        return this.reconcile();
    }

    private ranked(): string[] {
        return [...this.members.keys()].sort((a, b) => this.rankOf(b) - this.rankOf(a));
    }

    private rankOf(id: string): number {
        // The focused terminal is the one the person is looking at, whatever its last write says.
        if (id === this.focusedId) {
            return Number.MAX_SAFE_INTEGER;
        }
        return this.members.get(id)?.seq ?? -1;
    }

    private target(): Set<string> {
        const eligible = this.ranked().filter((id) => this.members.get(id)?.blocked !== true);
        return new Set(eligible.slice(0, this.cap));
    }

    private reconcile(target: Set<string> = this.target()): SlotChange {
        const granted: string[] = [];
        const revoked: string[] = [];
        for (const [id, member] of this.members) {
            if (target.has(id) && !member.holding) {
                member.holding = true;
                granted.push(id);
            } else if (!target.has(id) && member.holding) {
                member.holding = false;
                revoked.push(id);
            }
        }
        return { granted, revoked };
    }
}
