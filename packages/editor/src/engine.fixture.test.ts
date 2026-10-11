import { mountEditor } from './testing.ts';
import type { EditorOptions, SmartEditorEngineOptions } from './types.ts';

function setup(options: Partial<EditorOptions> = {}, engineOptions: Partial<SmartEditorEngineOptions> = {}) {
    const mounted = mountEditor(options, engineOptions);
    return { ...mounted.page, ...mounted, host: mounted.page.host };
}

// Fake tokenizers resolve through promises without I/O.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export { setup, settle };
