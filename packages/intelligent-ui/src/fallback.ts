export function uiPlainText(value: unknown): string {
    return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function given(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

/*
 * The readable text a node leaves behind where it cannot be drawn, from its props and its children's text.
 * Another agent reads a reply through it too, so every prop that says something (a state, a detail, a
 * badge, a unit) is in it; only props that style a node or drive local state are left out.
 */
export function uiNodeFallback(type: string, props: Readonly<Record<string, unknown>>, children: string): string {
    const label = props.label ?? props.title;
    switch (type) {
        case '$text':
            return uiPlainText(props.text);
        case 'Summary':
            return `${children.trimEnd()}${given(props.badge) ? ` (${uiPlainText(props.badge)})` : ''}\n`;
        case 'Step':
            return `${children.trimEnd()}${given(props.state) ? ` (${uiPlainText(props.state)})` : ''}${given(props.detail) ? `: ${uiPlainText(props.detail)}` : ''}\n`;
        case 'Progress':
            return given(props.value) ? `${children.trimEnd()}: ${uiPlainText(props.value)} of ${uiPlainText(props.max ?? 100)}\n` : `${children.trimEnd()}\n`;
        case 'Stat': {
            const unit = given(props.unit) ? ` ${uiPlainText(props.unit)}` : '';
            const previous = given(props.previous) ? ` (was ${uiPlainText(props.previous)}${unit})` : '';
            return `${uiPlainText(label)}: ${uiPlainText(props.value)}${unit}${previous}\n`;
        }
        case 'Source':
            return `${uiPlainText(label)}: ${uiPlainText(props.url)}\n`;
        case 'Column':
            return `${uiPlainText(props.title ?? props.key)}${given(props.unit) ? ` (${uiPlainText(props.unit)})` : ''}\n`;
        case 'Table': {
            const columns = children
                .split('\n')
                .map((column) => column.trim())
                .filter(Boolean);
            return `${columns.length > 0 ? `Columns: ${columns.join(', ')}\n` : ''}${uiPlainText(props.rows ?? [])}\n`;
        }
        case 'Chart':
            return `${uiPlainText(props.data ?? [])}${given(props.unit) ? ` (${uiPlainText(props.unit)})` : ''}\n`;
        case 'Image':
            return `[Image: ${uiPlainText(props.alt ?? props.attachment ?? props.generated ?? 'unavailable')}]${children}\n`;
    }
    const path = given(props.path) && given(props.line) ? `${uiPlainText(props.path)}:${uiPlainText(props.line)}` : props.path;
    const target = path ?? props.sha ?? (type === 'Node' ? props.id : undefined);
    const context = props.context ? `\n${uiPlainText(props.context)}` : '';
    const text = `${label !== undefined ? `${uiPlainText(label)}: ` : ''}${target !== undefined ? `${uiPlainText(target)} ` : ''}${children}${context}`;
    return type === 'Tag' || text.endsWith('\n') ? text : `${text}\n`;
}
