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
    /* Called with the layout after the first read and after `refresh()`, and once the edits have rested for `delay` ms, so a file list is not rebuilt per keystroke. */
    onLayout?(layout: PatchLayout): void;
    /* Milliseconds of rest before `onLayout` follows edits, and before a patch of `immediateBelow` characters or more is decorated again. Defaults to 150. */
    delay?: number;
    /* Up to this many characters (of the last read) the decorations follow an edit on the same microtask. Defaults to 100000. */
    immediateBelow?: number;
    /* Replaces `setTimeout` and `clearTimeout`, for a test that drives the clock. */
    timer?: PatchTimer;
}

export interface PatchTimer {
    set(callback: () => void, delay: number): unknown;
    clear(handle: unknown): void;
}

const DEFAULT_TIMER: PatchTimer = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface PatchDecoration {
    readonly layout: PatchLayout;
    /* Reads the text again, such as after the options changed. */
    refresh(): void;
    /* Takes the decorations off the editor and stops following it. */
    dispose(): void;
}

const CHANGE_LAYER = 'patch';

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
 * headers in the gutter and styled file and hunk headers. The editor stays editable. A small patch is read
 * again on the microtask after an edit, so its decorations are right within a frame; a large one waits for
 * the edits to rest, and `onLayout` always does. Typing costs one pass over the text (bounded by the limits).
 */
export function decoratePatch(editor: Editor, options: PatchDecorationOptions = {}): PatchDecoration {
    let layout = patchLayoutOf('', options.limits);
    let pending = false;
    let disposed = false;
    let length = 0;
    let wait: unknown = null;
    const timer = options.timer ?? DEFAULT_TIMER;
    const delay = options.delay ?? 150;
    const immediateBelow = options.immediateBelow ?? 100_000;
    const clearWait = (): void => {
        if (wait !== null) {
            timer.clear(wait);
            wait = null;
        }
    };
    const after = (callback: () => void): void => {
        clearWait();
        wait = timer.set(() => {
            wait = null;
            callback();
        }, delay);
    };
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
        editor.setChangeMarks(marks, CHANGE_LAYER);
    };
    const decorate = (): void => {
        pending = false;
        if (disposed) {
            return;
        }
        const text = editor.getText();
        length = text.length;
        layout = patchLayoutOf(text, options.limits);
        apply();
    };
    const announce = (): void => {
        if (!disposed) {
            options.onLayout?.(layout);
        }
    };
    const read = (): void => {
        clearWait();
        decorate();
        announce();
    };
    const schedule = (): void => {
        if (pending) {
            return;
        }
        pending = true;
        if (length < immediateBelow) {
            queueMicrotask(() => {
                decorate();
                after(announce);
            });
        } else {
            after(() => {
                decorate();
                announce();
            });
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
            clearWait();
            stop();
            editor.setLineNumbers(null);
            editor.setLineLabels(null);
            editor.setLineHighlights([]);
            editor.setChangeMarks([], CHANGE_LAYER);
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
