import { z } from 'zod';
import type { UiBlock, UiNode } from './compiler.ts';

const position = z.number().int().nonnegative();
const values = z.record(z.string(), z.unknown());

// Expressions and props stay open on the wire; the bounded interpreter validates their use.
export const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
    z.object({
        id: z.string(),
        type: z.string(),
        props: values,
        expressions: values,
        bindings: z.record(z.string(), z.string()),
        children: z.array(UiNodeSchema),
        complete: z.boolean(),
        fallback: z.string(),
        error: z.string().optional(),
        start: position,
        end: position
    })
) as z.ZodType<UiNode>;

export const UiDiagnosticSchema = z.object({
    code: z.string(),
    message: z.string(),
    start: position,
    end: position,
    nodeId: z.string().optional(),
    severity: z.literal('warning').optional()
});

export const UiBlockSchema: z.ZodType<UiBlock> = z.object({
    id: z.string(),
    catalogVersion: position,
    revision: z.string().min(1).optional(),
    start: position,
    end: position,
    complete: z.boolean(),
    defaults: values,
    queries: z.record(z.string(), z.object({ source: z.string(), args: values, expression: z.unknown().optional() })),
    nodes: z.array(UiNodeSchema),
    diagnostics: z.array(UiDiagnosticSchema),
    fallback: z.string()
}) as z.ZodType<UiBlock>;

export const UiBlocksSchema = z.array(UiBlockSchema);
