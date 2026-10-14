import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

/*
 * Both helpers reach into xterm's private core, which the peer range of `@xterm/xterm` pins. A major
 * version of xterm that moves these fields needs a look here before the range widens.
 */

/*
 * FitAddon measures the host's border box, so a vertical padding on the host would count as room for a
 * row that is cut off. The host has none; what a whole row does not fill is split above and below, as an
 * offset rather than a padding, since FitAddon subtracts the terminal element's own padding too.
 * False, without a fit, for a host the layout has given no room yet: FitAddon would make two columns
 * of it, a grid nobody sees that a shell still redraws its prompt for.
 */
export const fitToHost = (term: Terminal, fit: FitAddon): boolean => {
    const host = term.element?.parentElement;
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) {
        return false;
    }
    fit.fit();
    // The same private dimensions FitAddon itself divides by.
    const cellHeight: number = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { height: number } } } } } })._core._renderService
        .dimensions.css.cell.height;
    if (cellHeight !== 0) {
        const slack = host.clientHeight - term.rows * cellHeight;
        host.style.setProperty('--term-offset', `${Math.max(0, Math.floor(slack / 2))}px`);
    }
    return true;
};

interface Pointer {
    clientX: number;
    clientY: number;
}

interface MouseService {
    getCoords(event: Pointer, element: HTMLElement, ...rest: unknown[]): unknown;
    getMouseReportCoords(event: Pointer, element: HTMLElement): unknown;
}

/** Where a pointer would stand on an element whose ancestors scale it from its layout size to `rect`. */
export const unscaledPointer = (
    pointer: Pointer,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    layout: { width: number; height: number }
): Pointer => {
    const scaleX = layout.width > 0 && rect.width > 0 ? rect.width / layout.width : 1;
    const scaleY = layout.height > 0 && rect.height > 0 ? rect.height / layout.height : 1;
    return {
        clientX: rect.left + (pointer.clientX - rect.left) / scaleX,
        clientY: rect.top + (pointer.clientY - rect.top) / scaleY
    };
};

/*
 * xterm measures a pointer against the screen's scaled bounding box but divides by unscaled cells, so
 * under an ancestor's scale() a selection or a click lands rows off, more so further down. Its one mouse
 * service (private, shared by selection, links and mouse reporting) gets the pointer as it would stand
 * without the transform. Call after `open`, which creates that service.
 */
export const followAncestorScale = (term: Terminal): void => {
    const mouse = (term as unknown as { _core: { _mouseService?: MouseService } })._core._mouseService;
    if (!mouse) {
        return;
    }
    const unscaled = (pointer: Pointer, element: HTMLElement): Pointer =>
        unscaledPointer(pointer, element.getBoundingClientRect(), { width: element.offsetWidth, height: element.offsetHeight });
    const getCoords = mouse.getCoords.bind(mouse);
    const getMouseReportCoords = mouse.getMouseReportCoords.bind(mouse);
    mouse.getCoords = (event, element, ...rest) => getCoords(unscaled(event, element), element, ...rest);
    mouse.getMouseReportCoords = (event, element) => getMouseReportCoords(unscaled(event, element), element);
};
