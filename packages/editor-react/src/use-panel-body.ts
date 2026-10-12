import { useEffect, useState } from 'react';
import type { EditorLanguage } from './editor-language.ts';
import { clampPanelBody } from './panel-size.ts';

/* The body height of a panel, from the project that remembers it for the next one; `commit` hands it to the host. */
export function usePanelBody(language: EditorLanguage): { height: number; set(height: number): void; commit(height: number): void } {
    const { project } = language;
    const [height, set] = useState(() => clampPanelBody(project.panelBodyHeight));

    useEffect(() => project.onPanelBodyChange((value) => set(clampPanelBody(value))), [project]);

    return {
        height,
        set,
        commit: (value) => project.resizePanelBody(value)
    };
}
