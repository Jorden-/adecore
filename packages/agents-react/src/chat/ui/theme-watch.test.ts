import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createPage } from '@adecore/editor/testing';
import { watchTheme } from './theme-watch';

/* Frames that run only when a test says so; the page's window falls through to these globals. */
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const NAMES = ['requestAnimationFrame', 'cancelAnimationFrame'] as const;
let previous: (PropertyDescriptor | undefined)[];

beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    previous = NAMES.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const request = (callback: FrameRequestCallback): number => {
        frames.set(nextFrame, callback);
        return nextFrame++;
    };
    const cancel = (handle: number): void => {
        frames.delete(handle);
    };
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: request, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: cancel, configurable: true, writable: true });
});

afterEach(() => {
    NAMES.forEach((name, index) => {
        const descriptor = previous[index];
        if (descriptor === undefined) {
            Reflect.deleteProperty(globalThis, name);
        } else {
            Object.defineProperty(globalThis, name, descriptor);
        }
    });
});

/* Lets the observer deliver its records, then runs the frames that were asked for by then. */
async function nextPaint(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) {
        callback(0);
    }
}

test("a change of the root's style within the same side is told once a frame, however many changes it holds", async () => {
    const { document } = createPage();
    let told = 0;
    const stop = watchTheme(document, () => told++);
    document.documentElement.style.setProperty('--palette-revision', '1');
    document.documentElement.style.setProperty('--palette-revision', '2');
    document.body.className = 'accented';
    await Promise.resolve();
    expect(told).toBe(0);
    expect(frames.size).toBe(1);
    await nextPaint();
    expect(told).toBe(1);
    document.documentElement.setAttribute('data-theme', 'light');
    await nextPaint();
    expect(told).toBe(2);
    stop();
});

test('an attribute that carries no theme is not told', async () => {
    const { document } = createPage();
    let told = 0;
    const stop = watchTheme(document, () => told++);
    document.documentElement.setAttribute('data-panel-layout', 'wide');
    document.body.setAttribute('aria-hidden', 'true');
    await nextPaint();
    expect(frames.size).toBe(0);
    expect(told).toBe(0);
    stop();
});

test('nothing loops: what is told reads the theme and asks for no frame of its own', async () => {
    const { document } = createPage();
    let told = 0;
    const stop = watchTheme(document, () => {
        told++;
        // What a drawing does with the news: it reads the root and writes into its own element, never the root.
        document.documentElement.getAttribute('style');
        document.getElementById('host')!.setAttribute('style', `--drawn: ${told}`);
    });
    document.documentElement.style.setProperty('--palette-revision', '1');
    await nextPaint();
    await nextPaint();
    await nextPaint();
    expect(told).toBe(1);
    expect(frames.size).toBe(0);
    stop();
});

test('a stop drops the frame on its way and every later change', async () => {
    const { document } = createPage();
    let told = 0;
    const stop = watchTheme(document, () => told++);
    document.documentElement.style.setProperty('--palette-revision', '1');
    await Promise.resolve();
    expect(frames.size).toBe(1);
    stop();
    expect(frames.size).toBe(0);
    document.documentElement.style.setProperty('--palette-revision', '2');
    await nextPaint();
    expect(told).toBe(0);
});
