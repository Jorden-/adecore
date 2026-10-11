import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { Editor, EditorEngine, EditorLineHighlight, EditorTheme } from '@adecore/editor';
import { parseChord } from '@adecore/editor/keymap';
import { diffDisplay, diffRows, wordChanges, type DiffDocument, type DiffWordRange } from '@adecore/merge';
import type { DiffSourceTokens } from './diff-syntax.ts';
import { LineActionHost, RowHost } from './row-host.ts';

export interface DiffViewProps {
    engine: EditorEngine;
    document: DiffDocument;
    theme: EditorTheme;
    tokens?: DiffSourceTokens;
    wrap?: boolean;
    /* A fixed-height host supplies the height; otherwise the view grows with its rows. */
    fill?: boolean;
    /* Positive pixels; taller content scrolls inside the editor. Ignored with fill. */
    maxHeight?: number;
    label: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
    onMount?(editor: Editor): void | (() => void);
}

function wordMarks(document: DiffDocument): {
    old: Map<number, readonly (readonly [number, number])[]>;
    new: Map<number, readonly (readonly [number, number])[]>;
} {
    const marks = { old: new Map<number, readonly (readonly [number, number])[]>(), new: new Map<number, readonly (readonly [number, number])[]>() };
    for (const row of diffRows(document, 'split')) {
        if (row.kind !== 'line' || row.change !== 'pair' || document.hunks[row.hunk!]!.coarse) {
            continue;
        }
        const old = document.sides.old[row.old!.index]!;
        const fresh = document.sides.new[row.new!.index]!;
        const words = wordChanges(old, fresh);
        if (words === null) {
            continue;
        }
        const ranges = (text: string, ranges: readonly DiffWordRange[]): Array<readonly [number, number]> =>
            ranges.filter((range) => !document.ignoreWhitespace || /\S/.test(text.slice(range.from, range.to))).map((range) => [range.from, range.to]);
        marks.old.set(row.old!.index, ranges(old, words.old));
        marks.new.set(row.new!.index, ranges(fresh, words.new));
    }
    return marks;
}

interface MountedDiff {
    engine: EditorEngine;
    editor: Editor;
    rows: RowHost;
    actions: LineActionHost;
}

function DiffOverlays({ mounted, display, unfold }: { mounted: MountedDiff; display: ReturnType<typeof diffDisplay>; unfold(id: number): void }) {
    const { t } = useTranslation('editor');
    useSyncExternalStore(mounted.rows.subscribe, mounted.rows.getVersion, mounted.rows.getVersion);
    useSyncExternalStore(mounted.actions.subscribe, mounted.actions.getVersion, mounted.actions.getVersion);
    return (
        <>
            {display.gaps.map(({ row }) => {
                const container = mounted.rows.container(`gap-${row.id}`);
                if (container === undefined) {
                    return null;
                }
                const text = t('diff.hidden', { count: formatNumber(Math.max(row.oldCount, row.newCount)) });
                return createPortal(
                    <div className="adecore-editor-diff-gap">
                        {row.unfoldable ? (
                            <Button size="xs" onClick={() => unfold(row.id)}>
                                {text}
                            </Button>
                        ) : (
                            <span>{text}</span>
                        )}
                    </div>,
                    container,
                    `gap-${row.id}`
                );
            })}
            {display.rows.map((row, index) => {
                if (row.noNewline === undefined) {
                    return null;
                }
                const container = mounted.actions.container(`no-newline-${index}`);
                return container === undefined
                    ? null
                    : createPortal(<span className="adecore-editor-diff-no-newline">{t('diff.noNewline')}</span>, container, `no-newline-${index}`);
            })}
        </>
    );
}

export function DiffView({ engine, document, theme, tokens, wrap = true, fill = false, maxHeight, label, className, ref, onMount }: DiffViewProps) {
    const [expanded, setExpanded] = useState<{ document: DiffDocument; gaps: ReadonlyMap<number, number> }>(() => ({ document, gaps: new Map() }));
    const display = useMemo(() => diffDisplay(document, expanded.document === document ? expanded.gaps : undefined), [document, expanded]);
    const emphasis = useMemo(() => wordMarks(document), [document]);
    const element = useRef<HTMLDivElement>(null);
    const current = useRef({ display, tokens, theme, wrap, label });
    const [mounted, setMounted] = useState<MountedDiff | null>(null);
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        current.current = { display, tokens, theme, wrap, label };
    });
    useLayoutEffect(() => {
        const host = element.current;
        if (host === null) {
            return;
        }
        const initial = current.current;
        const editor = engine.mount(host, {
            text: initial.display.text,
            theme: initial.theme,
            wrap: initial.wrap,
            label: initial.label,
            readOnly: true,
            guides: false,
            foldOutline: 'off',
            // Prompt cards use this chord for their primary action; a read-only review has no split-line action.
            handBack: [parseChord('Mod+Enter')]
        });
        editor.setBlocks([]);
        editor.setLineTokens((line) => {
            const { display, tokens } = current.current;
            const row = display.rows[line];
            return row === undefined ? null : tokens?.get(row.new === undefined ? 'old' : 'new', (row.new ?? row.old)!.index);
        });
        setMounted({ engine, editor, rows: new RowHost(editor, 'diff-gaps'), actions: new LineActionHost(editor, 'diff-status') });
        const measure = (): void => setHeight(editor.getContentHeight());
        const stop = editor.onViewChange(measure);
        measure();
        return () => {
            stop();
            editor.dispose();
        };
    }, [engine]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.engine !== engine) {
            return;
        }
        const { editor, rows, actions } = mounted;
        editor.setText(display.text);
        editor.setLineNumbers((line) => {
            const row = current.current.display.rows[line];
            return row === undefined ? null : String((row.new ?? row.old)!.number);
        });
        const highlights: EditorLineHighlight[] = [];
        for (const [index, row] of display.rows.entries()) {
            if (row.change !== 'delete' && row.change !== 'insert') {
                continue;
            }
            const removed = row.change === 'delete';
            highlights.push({
                startLine: index + 1,
                endLine: index + 1,
                color: removed ? '--editor-deleted' : '--editor-added',
                sign: removed ? '-' : '+',
                emphasis: [(removed ? emphasis.old.get(row.old!.index) : emphasis.new.get(row.new!.index)) ?? []]
            });
        }
        editor.setLineHighlights(highlights);
        editor.setChangeMarks(
            highlights.map((highlight) => ({ startLine: highlight.startLine, endLine: highlight.endLine, kind: highlight.sign === '-' ? 'deleted' : 'added' }))
        );
        rows.set(
            display.gaps.map(({ before, row }) => ({
                id: `gap-${row.id}`,
                line: Math.min(before, Math.max(0, display.rows.length - 1)),
                placement: before < display.rows.length ? 'above' : 'below',
                height: 32
            }))
        );
        actions.set(display.rows.flatMap((row, line) => (row.noNewline === undefined ? [] : [{ id: `no-newline-${line}`, line }])));
    }, [mounted, engine, display, emphasis]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.engine !== engine) {
            return;
        }
        mounted.editor.setTheme(theme);
        mounted.editor.setWrap(wrap);
        mounted.editor.setLabel(label);
    }, [mounted, engine, theme, wrap, label]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.engine !== engine) {
            return;
        }
        const refresh = (): void => {
            mounted.editor.setLineTokens((line) => {
                const row = current.current.display.rows[line];
                return row === undefined ? null : current.current.tokens?.get(row.new === undefined ? 'old' : 'new', (row.new ?? row.old)!.index);
            });
        };
        refresh();
        const ownerWindow = element.current?.ownerDocument.defaultView;
        let pending = false;
        let stopped = false;
        let frame: number | undefined;
        const schedule = (): void => {
            if (pending) {
                return;
            }
            pending = true;
            const paint = (): void => {
                pending = false;
                if (!stopped) {
                    refresh();
                }
            };
            if (ownerWindow?.requestAnimationFrame !== undefined) {
                frame = ownerWindow.requestAnimationFrame(paint);
            } else {
                queueMicrotask(paint);
            }
        };
        const stop = tokens?.subscribe(schedule);
        return () => {
            stopped = true;
            stop?.();
            if (frame !== undefined) {
                ownerWindow?.cancelAnimationFrame?.(frame);
            }
        };
    }, [mounted, engine, tokens, display]);
    useLayoutEffect(() => {
        if (mounted !== null && mounted.engine === engine) {
            return onMount?.(mounted.editor);
        }
    }, [mounted, engine, onMount]);
    const limit = maxHeight !== undefined && Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : Infinity;
    return (
        <div
            className={`adecore-editor-diff ${className ?? ''}`}
            ref={ref}
            data-scroll={fill || height > limit}
            style={{ position: 'relative', minHeight: 0, height: fill ? '100%' : Math.min(height, limit) }}
        >
            <div ref={element} style={{ position: 'absolute', inset: 0 }} />
            {mounted !== null && mounted.engine === engine && (
                <DiffOverlays
                    mounted={mounted}
                    display={display}
                    unfold={(id) =>
                        setExpanded((previous) => ({ document, gaps: new Map([...(previous.document === document ? previous.gaps : []), [id, Infinity]]) }))
                    }
                />
            )}
        </div>
    );
}
