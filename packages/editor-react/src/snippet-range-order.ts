/* Source order disambiguates empty stops without changing the public parsed range shape. */
const orders = new WeakMap<object, number>();
export function snippetOrderOf(range: object): number | undefined {
    return orders.get(range);
}
export function withSnippetOrder<Range extends object>(range: Range, order: number | undefined): Range {
    if (order !== undefined) {
        orders.set(range, order);
    }
    return range;
}
export function compareSnippetOrder(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) {
            return left[index]! - right[index]!;
        }
    }
    return left.length - right.length;
}
