import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor, EditorChangeMark, EditorLineHighlight } from '@adecore/editor';
import { patchLayoutOf, type PatchLayout, type PatchLayoutLine, type PatchLimits } from './patch-layout.ts';

/* The sentences a screen reader reads with a line of the patch, in the host's words. */
export interface PatchLineLabels {
    added(number: number): string;
    removed(number: number): string;
    unchanged(old: number, fresh: number): string;
}

export interface PatchDecorationOptions {
    /* One number per line, the old one for a removed line and the new one otherwise, or both side by side. Defaults to `single`. */
    numbers?: 'single' | 'both';
    labels?: PatchLineLabels;
    limits?: PatchLimits;
    /* Called with the layout after each read, the first one included, once per run of edits. */
    onLayout?(layout: PatchLayout): void;
}

export interface PatchDecoration {
    readonly layout: PatchLayout;
    /* Reads the text again, such as after the options changed. */
    refresh(): void;
    /* Takes the decorations off the editor and stops following it. */
    dispose(): void;
}

function numberOf(line: PatchLayoutLine, numbers: 'single' | 'both', width: number): string | null {
    if (line.old === null && line.new === null) {
        return null;
    }
    if (numbers === 'single') {
        return String(line.new ?? line.old);
    }
    const pad = (value: number | null): string => (value === null ? '' : String(value)).padStart(width, ' ');
    return `${pad(line.old)} ${pad(line.new)}`;
}

/* Runs of one role become one highlight, so the bar of consecutive changed lines is one stripe. */
function highlightsOf(layout: PatchLayout): { highlights: EditorLineHighlight[]; marks: EditorChangeMark[] } {
    const highlights: EditorLineHighlight[] = [];
    const marks: EditorChangeMark[] = [];
    const lines = layout.lines;
    for (let index = 0; index < lines.length; index++) {
        const role = lines[index]!.role;
        if (role === 'file-header') {
            highlights.push({ startLine: index + 1, endLine: index + 1, color: '--text-muted', fill: '--surface-raised' });
        } else if (role === 'hunk-header') {
            highlights.push({ startLine: index + 1, endLine: index + 1, color: '--accent' });
        } else if (role === 'added' || role === 'removed') {
            let end = index;
            while (end + 1 < lines.length && lines[end + 1]!.role === role) {
                end++;
            }
            const removed = role === 'removed';
            highlights.push({
                startLine: index + 1,
                endLine: end + 1,
                color: removed ? '--editor-deleted' : '--editor-added',
                bar: removed ? 'hatched' : 'solid'
            });
            marks.push({ startLine: index + 1, endLine: end + 1, kind: removed ? 'deleted' : 'added' });
            index = end;
        }
    }
    return { highlights, marks };
}

/*
 * Draws a patch in the editor the way the diff views draw a change: tinted lines, numbers from the hunk
 * headers in the gutter and styled file and hunk headers. The editor stays editable, and the layout is
 * read again after the edits of one turn, so typing costs one pass over the text (bounded by the limits).
 */
export function decoratePatch(editor: Editor, options: PatchDecorationOptions = {}): PatchDecoration {
    let layout = patchLayoutOf('', options.limits);
    let pending = false;
    let disposed = false;
    const apply = (): void => {
        const numbers = options.numbers ?? 'single';
        const lines = layout.lines;
        const width = lines.reduce((digits, line) => Math.max(digits, String(Math.max(line.old ?? 0, line.new ?? 0)).length), 1);
        editor.setLineNumbers((line) => {
            const entry = lines[line];
            return entry === undefined ? null : numberOf(entry, numbers, width);
        });
        const labels = options.labels;
        editor.setLineLabels(
            labels === undefined
                ? null
                : (line) => {
                      const entry = lines[line];
                      if (entry?.role === 'removed') {
                          return labels.removed(entry.old!);
                      }
                      if (entry?.role === 'added') {
                          return labels.added(entry.new!);
                      }
                      return entry?.role === 'context' ? labels.unchanged(entry.old!, entry.new!) : null;
                  }
        );
        const { highlights, marks } = highlightsOf(layout);
        editor.setLineHighlights(highlights);
        editor.setChangeMarks(marks);
    };
    const read = (): void => {
        pending = false;
        if (disposed) {
            return;
        }
        layout = patchLayoutOf(editor.getText(), options.limits);
        apply();
        options.onLayout?.(layout);
    };
    const schedule = (): void => {
        if (!pending) {
            pending = true;
            queueMicrotask(read);
        }
    };
    const stop = editor.onTextChange(schedule);
    read();
    return {
        get layout() {
            return layout;
        },
        refresh: read,
        dispose() {
            disposed = true;
            stop();
            editor.setLineNumbers(null);
            editor.setLineLabels(null);
            editor.setLineHighlights([]);
            editor.setChangeMarks([]);
        }
    };
}

/* Decorates a mounted editor as a patch for as long as it stands, in the editor namespace's words, and returns the layout for a file tree. */
export function usePatchDecorations(editor: Editor | null, options: Omit<PatchDecorationOptions, 'labels' | 'onLayout'> = {}): PatchLayout | null {
    const { t } = useTranslation('editor');
    const [state, setState] = useState<{ editor: Editor; layout: PatchLayout } | null>(null);
    const { numbers } = options;
    const { maxLines, maxCharacters } = options.limits ?? {};
    useEffect(() => {
        if (editor === null) {
            return;
        }
        const decoration = decoratePatch(editor, {
            ...(numbers === undefined ? {} : { numbers }),
            limits: { ...(maxLines === undefined ? {} : { maxLines }), ...(maxCharacters === undefined ? {} : { maxCharacters }) },
            labels: {
                added: (number) => t('diff.added', { number }),
                removed: (number) => t('diff.removed', { number }),
                unchanged: (old, fresh) => t('diff.unchanged', { old, new: fresh })
            },
            onLayout: (layout) => setState({ editor, layout })
        });
        return () => decoration.dispose();
    }, [editor, numbers, maxLines, maxCharacters, t]);
    return state !== null && state.editor === editor ? state.layout : null;
}
