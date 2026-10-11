import { z } from 'zod';
import { uiPropList } from './prop-list.ts';

export const UI_CATALOG_VERSION = 1;
export const UiToneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
export type UiTone = z.infer<typeof UiToneSchema>;

const text = z.string().max(16384);
const name = z.string().min(1).max(256);
const number = z.number().finite();
const scalar = z.union([text, number, z.boolean(), z.null()]);
const rows = z.array(z.record(z.string(), z.unknown())).max(1000);
const empty = z.strictObject({});
const tone = UiToneSchema.optional();

export const UI_GROUPS = {
    status: { description: 'Summarize a result or show progress.', rules: 'Use one leading Summary. Children are inline prose, not headings or tables.' },
    data: { description: 'Compare values and records.', rules: 'Give numbers as numbers. Tone expresses meaning, never infer it from an increase.' },
    structure: { description: 'Organize distinct topics.', rules: 'Use Tabs for alternatives and Sections for independent topics.' },
    content: {
        description: 'Include code, attachments and sources.',
        rules: 'Image accepts a chat attachment or generated="latest", never a URL or a local path.'
    },
    links: { description: 'Refer to a host-owned resource.', rules: 'Targets are checked by the host. No arbitrary navigation or file reads.' },
    inputs: {
        description: 'Change local block state.',
        rules: 'Bind value={$name}. A Button sets a literal with action={@Set($name, value)} or restores a default with {@Reset($name)} or {@Reset()}. State stays local until a Choice sends visible context.'
    },
    choices: {
        description: 'Offer optional next steps after a finished answer.',
        rules: 'Never ask for information or a decision needed before acting: use your own question tool if you have one, otherwise ask in prose. Give a short label and precise visible context. A Choice sends once after streaming ends.'
    }
} as const;

export const UI_CATALOG = {
    Summary: { group: 'status', description: 'The result in one sentence.', schema: z.strictObject({ tone, badge: text.optional() }) },
    Callout: { group: 'status', description: 'A note that needs attention.', schema: z.strictObject({ tone: UiToneSchema, title: text.optional() }) },
    Tag: { group: 'status', description: 'A short status label.', schema: z.strictObject({ tone }) },
    Progress: {
        group: 'status',
        description: 'Progress with a label; omit value for indeterminate progress.',
        schema: z.strictObject({ value: number.nonnegative().optional(), max: number.positive().optional() })
    },
    Steps: { group: 'status', description: 'An ordered sequence of steps.', schema: empty, children: ['Step'] },
    Step: {
        group: 'status',
        description: 'One step in a sequence.',
        schema: z.strictObject({ state: z.enum(['done', 'running', 'pending', 'failed', 'skipped']), detail: text.optional() }),
        parent: 'Steps'
    },
    Stats: { group: 'data', description: 'A small set of key numbers.', schema: empty, children: ['Stat'] },
    Stat: {
        group: 'data',
        description: 'A labeled value and optional previous value.',
        schema: z.strictObject({ label: text, value: number, previous: number.optional(), unit: text.optional(), tone }),
        parent: 'Stats'
    },
    EntityList: { group: 'data', description: 'Labeled facts about an entity.', schema: empty, children: ['Entry'] },
    Entry: { group: 'data', description: 'One labeled fact.', schema: z.strictObject({ label: text }), parent: 'EntityList' },
    Table: { group: 'data', description: 'Rows with named columns.', schema: z.strictObject({ rows }), children: ['Column'] },
    Column: {
        group: 'data',
        description: 'A field of each table row.',
        schema: z.strictObject({
            key: name,
            title: text.optional(),
            unit: text.optional(),
            as: z.enum(['text', 'number', 'bytes', 'duration', 'date', 'file', 'tag']).optional()
        }),
        parent: 'Table'
    },
    Chart: {
        group: 'data',
        description: 'Compare labeled numeric series. Data rows have label and up to six numeric series.',
        schema: z.strictObject({
            kind: z.enum(['bar', 'hbar', 'stacked', 'line']),
            data: z.array(z.record(z.string(), scalar)).max(1000),
            unit: text.optional()
        })
    },
    Tabs: { group: 'structure', description: 'Switch between alternative topics.', schema: empty, children: ['Tab'] },
    Tab: { group: 'structure', description: 'A named tab.', schema: z.strictObject({ title: text }), parent: 'Tabs' },
    Sections: { group: 'structure', description: 'Independent collapsible topics.', schema: empty, children: ['Section'] },
    Section: { group: 'structure', description: 'A named section.', schema: z.strictObject({ title: text }), parent: 'Sections' },
    CodeBlock: { group: 'content', description: 'Code as text, without execution.', schema: z.strictObject({ language: name.optional() }) },
    Image: {
        group: 'content',
        description: 'A chat attachment with an optional caption.',
        schema: z
            .strictObject({ attachment: name.optional(), generated: z.literal('latest').optional(), alt: text.optional() })
            .refine((props) => Boolean(props.attachment) !== Boolean(props.generated), 'Choose attachment or generated, exclusively.')
    },
    Sources: { group: 'content', description: 'Numbered sources without preloading.', schema: empty, children: ['Source'] },
    Source: {
        group: 'content',
        description: 'An HTTP or HTTPS source.',
        schema: z.strictObject({ title: text, url: text.regex(/^https?:\/\//i) }),
        parent: 'Sources'
    },
    File: {
        group: 'links',
        description: 'A file in the project or a worktree.',
        schema: z.strictObject({ path: text, line: z.coerce.number().int().positive().max(10000000).optional() })
    },
    Diff: { group: 'links', description: 'A changed project file.', schema: z.strictObject({ path: text }) },
    Commit: { group: 'links', description: 'A repository commit.', schema: z.strictObject({ sha: z.string().regex(/^[a-f\d]{7,64}$/i) }) },
    Node: { group: 'links', description: 'A host node.', schema: z.strictObject({ id: name }) },
    Checklist: {
        group: 'inputs',
        description: 'Select values in a local list.',
        schema: z.strictObject({ value: z.array(scalar).max(1000) }),
        children: ['Item'],
        binding: 'value'
    },
    Item: { group: 'inputs', description: 'One selectable value.', schema: z.strictObject({ value: scalar }), parent: 'Checklist' },
    Switch: { group: 'inputs', description: 'A local boolean.', schema: z.strictObject({ value: z.boolean() }), binding: 'value' },
    Slider: {
        group: 'inputs',
        description: 'A local number in a range.',
        schema: z
            .strictObject({ value: number, min: number, max: number, step: number.positive().optional(), unit: text.optional() })
            .refine((props) => props.min < props.max && props.value >= props.min && props.value <= props.max, 'Value must lie within an increasing range.'),
        binding: 'value'
    },
    Segmented: { group: 'inputs', description: 'Choose one local value.', schema: z.strictObject({ value: scalar }), children: ['Option'], binding: 'value' },
    Option: { group: 'inputs', description: 'One local alternative.', schema: z.strictObject({ value: scalar }), parent: 'Segmented' },
    Button: {
        group: 'inputs',
        description: 'Run one local state action when pressed; children are the label.',
        schema: z.strictObject({ disabled: z.boolean().optional() }),
        action: 'action'
    },
    Show: { group: 'inputs', description: 'Show children when the condition is true.', schema: z.strictObject({ when: z.boolean() }) },
    Each: {
        group: 'inputs',
        description: 'Repeat children over local data.',
        schema: z.strictObject({ items: z.array(z.unknown()).max(1000), as: name.regex(/^[A-Za-z_][A-Za-z_\d]*$/) })
    },
    Choices: { group: 'choices', description: 'Optional next steps after a finished answer.', schema: empty, children: ['Choice'] },
    Choice: {
        group: 'choices',
        description: 'Send its label and visible context once.',
        schema: z.strictObject({ context: text.optional(), primary: z.boolean().optional(), disabled: z.boolean().optional() }),
        parent: 'Choices'
    }
} as const;

export type UiComponentName = keyof typeof UI_CATALOG;
export type UiProps<Name extends UiComponentName> = z.infer<(typeof UI_CATALOG)[Name]['schema']>;

export function isUiComponent(name: string): name is UiComponentName {
    return Object.hasOwn(UI_CATALOG, name);
}

export function uiCatalogText(): string {
    return Object.entries(UI_CATALOG)
        .map(([name, entry]) => `${name}(${uiPropList(entry).join(', ')}): ${entry.description}`)
        .join('\n');
}
