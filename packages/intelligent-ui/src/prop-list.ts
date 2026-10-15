import type { z } from 'zod';

/* The props a catalog entry accepts, its action first and an optional one marked with `?`. */
export function uiPropList(entry: { readonly schema: { readonly shape: Readonly<Record<string, z.ZodType>> }; readonly action?: string }): string[] {
    const props = Object.entries(entry.schema.shape).map(([key, schema]) => `${key}${schema.isOptional() ? '?' : ''}`);
    return entry.action ? [entry.action, ...props] : props;
}

/* What a component needs in the compact note: the props it cannot do without and, when its text is not the plain content, what that text is. */
export function uiRequirement(
    name: string,
    entry: {
        readonly schema: { readonly shape: Readonly<Record<string, z.ZodType>> };
        readonly action?: string;
        readonly needs?: string;
        readonly text?: string;
    }
): string {
    const required =
        entry.needs ??
        uiPropList(entry)
            .filter((prop) => !prop.endsWith('?'))
            .join(' ');
    return `${name}${required ? ` ${required}` : ''}${entry.text ? ` (text: ${entry.text})` : ''}`;
}
