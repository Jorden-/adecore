import { describe, expect, mock, test } from 'bun:test';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { fitToHost, unscaledPointer } from './xterm-internals.ts';

describe('a pointer under a scaled ancestor', () => {
    test('maps back to layout units on a zoomed-out element', () => {
        const rect = { left: 100, top: 50, width: 400, height: 200 };
        expect(unscaledPointer({ clientX: 300, clientY: 150 }, rect, { width: 800, height: 400 })).toEqual({ clientX: 500, clientY: 250 });
    });

    test('stays where it is without a transform', () => {
        const rect = { left: 10, top: 20, width: 300, height: 100 };
        expect(unscaledPointer({ clientX: 42, clientY: 64 }, rect, { width: 300, height: 100 })).toEqual({ clientX: 42, clientY: 64 });
    });

    test('stays where it is on an element without a layout size', () => {
        const rect = { left: 10, top: 20, width: 0, height: 0 };
        expect(unscaledPointer({ clientX: 42, clientY: 64 }, rect, { width: 0, height: 0 })).toEqual({ clientX: 42, clientY: 64 });
    });
});

describe('a fit to the host', () => {
    const terminalIn = (width: number, height: number) => {
        const host = { clientWidth: width, clientHeight: height, style: { setProperty: mock() } };
        return {
            element: { parentElement: host },
            rows: 10,
            _core: { _renderService: { dimensions: { css: { cell: { height: 17 } } } } }
        } as unknown as Terminal;
    };

    test('leaves the grid alone while the layout has given the host no room', () => {
        const fit = { fit: mock() };
        expect(fitToHost(terminalIn(0, 336), fit as unknown as FitAddon)).toBe(false);
        expect(fitToHost(terminalIn(480, 0), fit as unknown as FitAddon)).toBe(false);
        expect(fit.fit).not.toHaveBeenCalled();
    });

    test('fits a host with room and centers the rows a whole row does not fill', () => {
        const fit = { fit: mock() };
        const term = terminalIn(480, 180);
        expect(fitToHost(term, fit as unknown as FitAddon)).toBe(true);
        expect(fit.fit).toHaveBeenCalledTimes(1);
        expect((term.element!.parentElement as unknown as { style: { setProperty: ReturnType<typeof mock> } }).style.setProperty).toHaveBeenCalledWith(
            '--term-offset',
            '5px'
        );
    });
});
