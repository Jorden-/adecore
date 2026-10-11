import { DocumentModel } from '@adecore/editor-core';
import { DEFAULT_SMART_KEYS } from './smart-keys.ts';
import { createPage } from './testing.ts';
import { EditorView, type ViewSettings } from './view.ts';

const SETTINGS: ViewSettings = {
    language: 'typescript',
    tabSize: 4,
    insertSpaces: true,
    readOnly: false,
    readOnlyReason: undefined,
    wrap: false,
    smartKeys: DEFAULT_SMART_KEYS,
    messages: {},
    label: 'Code editor',
    guides: true,
    whitespace: false,
    rightMargin: null,
    foldOutline: 'hover'
};

function mount(text: string, settings: Partial<ViewSettings> = {}) {
    const page = createPage();
    const model = new DocumentModel(text);
    const view = new EditorView(page.host, model, { ...SETTINGS, ...settings });
    return { ...page, model, view };
}

const rendered = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('.se-line')].map((line) => (line as HTMLElement).dataset.line!).sort((left, right) => Number(left) - Number(right));

export { SETTINGS, mount, rendered };
