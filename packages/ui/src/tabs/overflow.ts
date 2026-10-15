/*
 * The tabs a strip shows, by index, given the width of every tab, the room the strip has, the gap
 * between two tabs and the width of the button that opens the rest. Everything fits, or the tabs fit
 * from the start up to the button. The kept tabs (the picked one, the pinned ones) are never left to
 * the menu: they take the place of the last ones that no longer fit beside them.
 */
export const shownTabs = (widths: readonly number[], room: number, gap: number, more: number, kept: readonly number[]): number[] => {
    const span = (indices: readonly number[]): number => indices.reduce((sum, index) => sum + widths[index]!, 0) + gap * Math.max(0, indices.length - 1);
    const all = widths.map((_, index) => index);
    // Half a pixel of slack, since a measured width is fractional and the room is not.
    if (span(all) <= room + 0.5) {
        return all;
    }
    const limit = room - more - gap + 0.5;
    const held = all.filter((index) => kept.includes(index));
    const shown: number[] = [];
    for (const index of all) {
        if (held.includes(index)) {
            continue;
        }
        if (span([...held, ...shown, index]) > limit) {
            break;
        }
        shown.push(index);
    }
    return [...held, ...shown].sort((left, right) => left - right);
};
