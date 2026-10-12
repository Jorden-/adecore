import type { DocumentModel } from '@adecore/editor-core';

export interface TouchHost {
    readonly model: DocumentModel;
    offsetAt(clientX: number, clientY: number): number;
    camelHumps(): boolean;
    /* The lines a tap on a line number selects, whole. */
    lineAt(offset: number): { from: number; to: number };
    focus(): void;
}

/* A finger that moves further than this, in pixels, is scrolling and not tapping. */
const TAP_SLOP = 10;
/* A finger held still this long selects the word under it. */
const LONG_PRESS_MS = 500;
/* A second tap this soon after the first, this close to it, is a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;

interface Contact {
    id: number;
    x: number;
    y: number;
    area: 'text' | 'gutter';
    moved: boolean;
    pressed: boolean;
    /* Asked when the finger lifts as a tap, so a scroll never reaches a handler of the host. */
    taken?: () => boolean;
}

/*
 * A finger on the text. The viewport scrolls natively, so a drag is left to the browser and makes no
 * selection; a tap places the caret, a double tap or a long press selects a word.
 */
export class TouchSelection {
    private contact: Contact | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private lastTap: { time: number; x: number; y: number } | undefined;
    private readonly host: TouchHost;

    constructor(host: TouchHost) {
        this.host = host;
    }

    /* Whether the finger that is down held still long enough to select a word. */
    get pressed(): boolean {
        return this.contact?.pressed === true;
    }

    start(event: PointerEvent, area: 'text' | 'gutter' = 'text', taken?: () => boolean): void {
        this.cancel();
        this.contact = { id: event.pointerId, x: event.clientX, y: event.clientY, area, moved: false, pressed: false, taken };
        if (area === 'text') {
            this.timer = setTimeout(() => this.press(), LONG_PRESS_MS);
        }
    }

    move(event: PointerEvent): void {
        const contact = this.contact;
        if (contact === undefined || event.pointerId !== contact.id || contact.moved) {
            return;
        }
        if (Math.abs(event.clientX - contact.x) > TAP_SLOP || Math.abs(event.clientY - contact.y) > TAP_SLOP) {
            contact.moved = true;
            this.clearTimer();
        }
    }

    /* The finger lifted: a tap that did not scroll and was not a long press lands here. */
    end(event: PointerEvent): void {
        const contact = this.contact;
        if (contact === undefined || event.pointerId !== contact.id) {
            return;
        }
        this.cancel();
        if (event.type === 'pointercancel' || contact.moved || contact.pressed) {
            return;
        }
        this.tap(contact, event);
    }

    dispose(): void {
        this.cancel();
    }

    private tap(contact: Contact, event: PointerEvent): void {
        const { model } = this.host;
        const offset = this.host.offsetAt(contact.x, contact.y);
        this.host.focus();
        if (contact.area === 'gutter') {
            const line = this.host.lineAt(offset);
            model.setSelections([{ anchor: line.from, head: line.to }]);
            return;
        }
        if (contact.taken?.()) {
            return;
        }
        const last = this.lastTap;
        const double =
            last !== undefined &&
            event.timeStamp - last.time <= DOUBLE_TAP_MS &&
            Math.abs(contact.x - last.x) <= DOUBLE_TAP_DISTANCE &&
            Math.abs(contact.y - last.y) <= DOUBLE_TAP_DISTANCE;
        this.lastTap = double ? undefined : { time: event.timeStamp, x: contact.x, y: contact.y };
        const word = double ? model.wordSelectionAt(offset, this.host.camelHumps()) : null;
        model.setSelections([word === null ? { anchor: offset, head: offset } : { anchor: word.from, head: word.to }]);
    }

    private press(): void {
        const contact = this.contact;
        this.timer = undefined;
        if (contact === undefined || contact.moved) {
            return;
        }
        contact.pressed = true;
        this.lastTap = undefined;
        const offset = this.host.offsetAt(contact.x, contact.y);
        const word = this.host.model.wordSelectionAt(offset, this.host.camelHumps());
        this.host.focus();
        this.host.model.setSelections([word === null ? { anchor: offset, head: offset } : { anchor: word.from, head: word.to }]);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = undefined;
    }

    private cancel(): void {
        this.clearTimer();
        this.contact = undefined;
    }
}
