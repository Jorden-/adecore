import { expect, test } from 'bun:test';
import { FakeEditor } from '@adecore/editor/fake';
import { SplitScroll } from './split-scroll.ts';

class ClampedEditor extends FakeEditor {
    readonly maximum: number;

    constructor(maximum: number) {
        super({} as HTMLElement, { text: 'line', theme: 'dark' });
        this.maximum = maximum;
    }

    override setScrollTop(top: number): void {
        super.setScrollTop(Math.min(top, this.maximum));
    }
}

test('a delayed, clamped follower scroll does not pull the driven side back', () => {
    const old = new ClampedEditor(1000);
    const fresh = new ClampedEditor(980);
    const scroll = new SplitScroll({ old, new: fresh });
    const stopOld = old.onViewChange(() => scroll.changed('old'));
    const stopNew = fresh.onViewChange(() => scroll.changed('new'));
    scroll.drive('old');
    old.setScrollTop(1000);
    expect(fresh.getScrollTop()).toBe(980);
    scroll.changed('new');
    scroll.sync();
    expect(old.getScrollTop()).toBe(1000);
    expect(fresh.getScrollTop()).toBe(980);
    scroll.drive('new');
    fresh.setScrollTop(900);
    expect(old.getScrollTop()).toBe(900);
    stopOld();
    stopNew();
});

test('a programmatic reveal on the other side becomes the leader and survives alignment', () => {
    const old = new ClampedEditor(1000);
    const fresh = new ClampedEditor(1000);
    const scroll = new SplitScroll({ old, new: fresh });
    old.onViewChange(() => scroll.changed('old'));
    fresh.onViewChange(() => scroll.changed('new'));
    fresh.setScrollTop(600);
    old.setScrollTop(200);
    scroll.sync();
    expect(old.getScrollTop()).toBe(200);
    expect(fresh.getScrollTop()).toBe(200);
});
