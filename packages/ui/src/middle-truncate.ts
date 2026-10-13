export interface MiddleCut {
    head: string;
    /* What the ellipsis stands for; still in the text, so a copy or a find reads it. */
    middle: string;
    tail: string;
}

export const MIDDLE_ELLIPSIS = '…';

/*
 * The head and tail of `text` that keep the most of it around an ellipsis within `width`, or null
 * when the whole text fits. The tail gets the odd character, since the end of a path or a branch is
 * what tells two of them apart. Code points, never UTF-16 units, so a cut never halves a character.
 */
export function fitMiddle(text: string, width: number, measure: (text: string) => number): MiddleCut | null {
    if (measure(text) <= width) {
        return null;
    }
    const characters = Array.from(text);
    const cutAt = (kept: number): MiddleCut => {
        const headLength = Math.floor(kept / 2);
        const tailStart = characters.length - (kept - headLength);
        return {
            head: characters.slice(0, headLength).join(''),
            middle: characters.slice(headLength, tailStart).join(''),
            tail: characters.slice(tailStart).join('')
        };
    };
    const fits = (cut: MiddleCut): boolean => measure(cut.head + MIDDLE_ELLIPSIS + cut.tail) <= width;
    let low = 0;
    let high = characters.length - 1;
    while (low < high) {
        const kept = Math.ceil((low + high) / 2);
        if (fits(cutAt(kept))) {
            low = kept;
        } else {
            high = kept - 1;
        }
    }
    return cutAt(low);
}
