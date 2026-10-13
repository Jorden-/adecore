import { describe, expect, test } from 'bun:test';
import { DocumentModel, type Selection } from '@adecore/editor-core';
import { PointerSelection, type PointerHost } from './pointer.ts';

/* A grid of 10 by 20 pixels a character, in a view of 200 by 100 pixels at the top left of the screen. */
const CELL = { width: 10, height: 20 };
const VIEW = { left: 0, top: 0, right: 200, bottom: 100 };

interface Press {
    x: number;
    y: number;
    time?: number;
    id?: number;
    alt?: boolean;
    shift?: boolean;
    type?: string;
}

function event({ x, y, time = 0, id = 1, alt = false, shift = false, type = 'pointerdown' }: Press): PointerEvent {
    return { clientX: x, clientY: y, timeStamp: time, pointerId: id, altKey: alt, shiftKey: shift, type } as PointerEvent;
}

function setup(text: string, options: { columnMode?: boolean; selected?: Selection | null } = {}) {
    const frames: (() => void)[] = [];
    // A stand-in for the view's element, so the frames it asks for are this test's: a LinkeDOM window writes through to the global one.
    const viewport = {
        scrollTop: 0,
        scrollLeft: 0,
        ownerDocument: {
            defaultView: {
                requestAnimationFrame: (callback: () => void) => frames.push(callback),
                cancelAnimationFrame: (id: number) => {
                    frames[id - 1] = () => {};
                }
            }
        },
        getBoundingClientRect: () => VIEW
    } as unknown as HTMLElement;
    const model = new DocumentModel(text);
    const calls = { scrolled: 0, drops: [] as { from: number; to: number; offset: number; copy: boolean }[], dropCarets: [] as (number | null)[] };
    const offsetAt = (x: number, y: number): number =>
        model.offsetAt({ line: Math.max(0, Math.floor((y + viewport.scrollTop) / CELL.height)), column: Math.max(0, Math.round(x / CELL.width)) });
    const host: PointerHost = {
        model,
        viewport,
        offsetAt,
        contentPoint: (x, y) => ({ x, y: y + viewport.scrollTop }),
        columnSelections: (from, to) => {
            if (Math.round(from.x / CELL.width) === Math.round(to.x / CELL.width)) {
                return null;
            }
            const first = Math.floor(Math.min(from.y, to.y) / CELL.height);
            const last = Math.floor(Math.max(from.y, to.y) / CELL.height);
            return Array.from({ length: last - first + 1 }, (_, index) => ({
                anchor: model.offsetAt({ line: first + index, column: Math.round(from.x / CELL.width) }),
                head: model.offsetAt({ line: first + index, column: Math.round(to.x / CELL.width) })
            }));
        },
        visualLine: (offset) => {
            const line = model.getLine(model.positionAt(offset).line);
            return { start: line.start, end: line.end, next: line.next, y: model.positionAt(offset).line * CELL.height };
        },
        lineAt: (offset) => {
            const line = model.getLine(model.positionAt(offset).line);
            return { from: line.start, to: line.next };
        },
        camelHumps: () => false,
        columnMode: () => options.columnMode === true,
        selectionAt: () => options.selected ?? null,
        setDropCaret: (offset) => calls.dropCarets.push(offset),
        drop: (from, to, offset, copy) => calls.drops.push({ from, to, offset, copy }),
        copyHeld: () => false,
        focus: () => {},
        scrolled: () => calls.scrolled++
    };
    const pointer = new PointerSelection(host);
    const runFrame = (): void => {
        const pending = frames.splice(0);
        pending.forEach((frame) => frame());
    };
    return { model, pointer, viewport, calls, frames, runFrame };
}

const selections = (model: DocumentModel): readonly Selection[] => model.getSelections();

describe('clicks', () => {
    test('a second press soon after and close by is a double click, a third a triple, and a fourth stays a triple', () => {
        const { model, pointer } = setup('alpha beta\ngamma');
        const click = (time: number, x = 70): void => {
            pointer.start(event({ x, y: 5, time }));
            pointer.end(event({ x, y: 5, time, type: 'pointerup' }));
        };
        click(0);
        expect(selections(model)).toEqual([{ anchor: 7, head: 7 }]);
        click(100);
        expect(selections(model)).toEqual([{ anchor: 6, head: 10 }]);
        click(200);
        expect(selections(model)).toEqual([{ anchor: 0, head: 11 }]);
        click(300);
        expect(selections(model)).toEqual([{ anchor: 0, head: 11 }]);
    });

    test('a press too late or too far from the last starts counting again', () => {
        const { model, pointer } = setup('alpha beta');
        pointer.start(event({ x: 70, y: 5, time: 0 }));
        pointer.end();
        pointer.start(event({ x: 70, y: 5, time: 501 }));
        pointer.end();
        expect(selections(model)).toEqual([{ anchor: 7, head: 7 }]);
        pointer.start(event({ x: 75, y: 5, time: 600 }));
        pointer.end();
        expect(selections(model)).toEqual([{ anchor: 8, head: 8 }]);
    });
});

describe('dragging', () => {
    test('selects from the press to the pointer and stops when it goes up', () => {
        const { model, pointer } = setup('alpha beta\ngamma');
        pointer.start(event({ x: 20, y: 5 }));
        expect(pointer.dragging).toBe(true);
        pointer.move(event({ x: 30, y: 25, type: 'pointermove' }));
        expect(selections(model)).toEqual([{ anchor: 2, head: 14 }]);
        pointer.end(event({ x: 30, y: 25, type: 'pointerup' }));
        expect(pointer.dragging).toBe(false);
        pointer.move(event({ x: 0, y: 5, type: 'pointermove' }));
        expect(selections(model)).toEqual([{ anchor: 2, head: 14 }]);
    });

    test('follows only the pointer that pressed', () => {
        const { model, pointer } = setup('alpha beta');
        pointer.start(event({ x: 20, y: 5 }));
        pointer.move(event({ x: 80, y: 5, id: 2, type: 'pointermove' }));
        expect(selections(model)).toEqual([{ anchor: 2, head: 2 }]);
    });

    test('drags a box of columns without alt when the column mode is on', () => {
        const { model, pointer } = setup('alpha\nbravo\ncharlie', { columnMode: true });
        pointer.start(event({ x: 10, y: 5 }));
        pointer.move(event({ x: 30, y: 45, type: 'pointermove' }));
        expect(selections(model)).toEqual([
            { anchor: 1, head: 3 },
            { anchor: 7, head: 9 },
            { anchor: 13, head: 15 }
        ]);
    });

    test('keeps scrolling while the pointer is held past the bottom edge, a step at most each frame, and stops when it goes up', () => {
        const { model, pointer, viewport, calls, frames, runFrame } = setup(Array.from({ length: 40 }, (_, line) => `line ${line}`).join('\n'));
        pointer.start(event({ x: 0, y: 5 }));
        pointer.move(event({ x: 0, y: 300, type: 'pointermove' }));
        runFrame();
        expect(viewport.scrollTop).toBe(40);
        runFrame();
        expect(viewport.scrollTop).toBe(80);
        expect(calls.scrolled).toBe(2);
        expect(model.positionAt(model.getPrimary().head).line).toBe(19);
        pointer.end(event({ x: 0, y: 300, type: 'pointerup' }));
        runFrame();
        expect(viewport.scrollTop).toBe(80);
        expect(frames).toHaveLength(0);
    });

    test('lets go of a drag when disposed', () => {
        const { pointer } = setup('alpha');
        pointer.start(event({ x: 20, y: 5 }));
        pointer.dispose();
        expect(pointer.dragging).toBe(false);
    });
});

describe('carrying a selection', () => {
    const selected = { anchor: 0, head: 5 };

    test('waits for the pointer to move a few pixels before it carries the text', () => {
        const { model, pointer, calls } = setup('alpha beta', { selected });
        model.setSelections([selected]);
        pointer.start(event({ x: 20, y: 5 }));
        pointer.move(event({ x: 24, y: 5, type: 'pointermove' }));
        expect(calls.dropCarets).toEqual([]);
        pointer.move(event({ x: 90, y: 5, type: 'pointermove' }));
        expect(calls.dropCarets).toEqual([9]);
        pointer.end(event({ x: 90, y: 5, type: 'pointerup' }));
        expect(calls.drops).toEqual([{ from: 0, to: 5, offset: 9, copy: false }]);
    });

    test('drops nothing when the pointer is taken away', () => {
        const { model, pointer, calls } = setup('alpha beta', { selected });
        model.setSelections([selected]);
        pointer.start(event({ x: 20, y: 5 }));
        pointer.move(event({ x: 90, y: 5, type: 'pointermove' }));
        pointer.end(event({ x: 90, y: 5, type: 'pointercancel' }));
        expect(calls.drops).toEqual([]);
        expect(calls.dropCarets.at(-1)).toBeNull();
        expect(selections(model)).toEqual([selected]);
    });
});
