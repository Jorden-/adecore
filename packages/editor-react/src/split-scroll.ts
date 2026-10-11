import type { Editor } from '@adecore/editor';
import type { DiffSourceSide } from './diff-syntax.ts';

type ScrollEditor = Pick<Editor, 'getScrollTop' | 'setScrollTop'>;

export class SplitScroll {
    private leader: DiffSourceSide = 'new';
    private syncing = false;
    private readonly expected: Record<DiffSourceSide, number>;

    private readonly editors: Record<DiffSourceSide, ScrollEditor>;

    constructor(editors: Record<DiffSourceSide, ScrollEditor>) {
        this.editors = editors;
        this.expected = { old: editors.old.getScrollTop(), new: editors.new.getScrollTop() };
    }

    drive(side: DiffSourceSide): void {
        this.leader = side;
    }

    changed(side: DiffSourceSide): void {
        if (this.syncing) {
            return;
        }
        const top = this.editors[side].getScrollTop();
        if (side !== this.leader) {
            // Native scroll echoes arrive after setScrollTop returns, including a clamped follower position.
            if (Math.abs(top - this.expected[side]) < 1) {
                return;
            }
            this.leader = side;
        }
        this.sync();
    }

    sync(): void {
        const side = this.leader;
        const other = side === 'old' ? 'new' : 'old';
        const top = this.editors[side].getScrollTop();
        this.expected[side] = top;
        if (Math.abs(this.editors[other].getScrollTop() - top) < 1) {
            this.expected[other] = this.editors[other].getScrollTop();
            return;
        }
        this.syncing = true;
        try {
            this.editors[other].setScrollTop(top);
        } finally {
            this.expected[other] = this.editors[other].getScrollTop();
            this.syncing = false;
        }
    }
}
