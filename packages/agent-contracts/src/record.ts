/* A plain object read off the wire or a file, whose fields are still unchecked; an array is not one. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
