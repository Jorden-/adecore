/* The prop a written one stands for: its alias in the catalog, unless the real prop is written too, which then wins. */
export function aliasedProp(entry: object, written: string, props: Readonly<Record<string, unknown>>): string {
    const aliases = 'aliases' in entry ? (entry.aliases as Readonly<Record<string, string>>) : {};
    const target = Object.hasOwn(aliases, written) ? aliases[written] : undefined;
    return target === undefined || Object.hasOwn(props, target) ? written : target;
}
