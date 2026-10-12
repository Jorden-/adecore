import { useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor, EditorEngine, EditorLineHighlight, EditorTheme } from '@adecore/editor';
import { parseChord } from '@adecore/editor/keymap';
import { diffDisplay, diffSplit, type DiffDocument, type DiffDisplay } from '@adecore/merge';
import { wordMarks } from './diff-wordmarks.ts';
import { DiffOverlays, type MountedDiff } from './diff-overlays.tsx';
import { SplitDiffView } from './SplitDiffView.tsx';
import type { DiffSourceTokens } from './diff-syntax.ts';
import { LineActionHost, RowHost } from './row-host.ts';
import { DEFAULT_UNFOLD_LIMITS, expandDiff, type DiffLimits } from './diff-expansion.ts';

export interface DiffViewProps {
    engine: EditorEngine;
    document: DiffDocument;
    theme: EditorTheme;
    tokens?: DiffSourceTokens;
    wrap?: boolean;
    layout?: 'unified' | 'split';
    /* Above this many displayed unified rows, split uses fixed line heights. Defaults to 2000. */
    splitWrapLimit?: number;
    /* A fixed-height host supplies the height; otherwise the view grows with its rows. */
    fill?: boolean;
    /* Positive pixels; taller content scrolls inside the editor. Ignored with fill. */
    maxHeight?: number;
    /* Total visible source-text budgets after unfolding; changed rows are always retained. */
    unfoldLimits?: DiffLimits;
    label: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
    onMount?(editor: Editor, side?: 'old' | 'new'): void | (() => void);
}

interface UnifiedViewProps extends DiffViewProps {
    display: DiffDisplay;
    unfold(id: number): void;
    blocked: ReadonlySet<number>;
}

function UnifiedDiffView({
    engine,
    document,
    display,
    unfold,
    blocked,
    theme,
    tokens,
    wrap = true,
    fill = false,
    maxHeight,
    label,
    className,
    ref,
    onMount
}: UnifiedViewProps) {
    const { t } = useTranslation('editor');
    const emphasis = useMemo(() => wordMarks(document), [document]);
    const element = useRef<HTMLDivElement>(null);
    const current = useRef({ display, tokens, theme, wrap, label });
    const applied = useRef({ theme, wrap, label });
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
            folding: false,
            // Prompt cards use this chord for their primary action; a read-only review has no split-line action.
            handBack: [parseChord('Mod+Enter')]
        });
        applied.current = { theme: initial.theme, wrap: initial.wrap, label: initial.label };
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
        // The color of a changed line is not the only thing that says so: the gutter carries a sentence with the numbers it reads from.
        mounted.editor.setLineLabels((line) => {
            const row = display.rows[line];
            if (row?.change === 'delete') {
                return t('diff.removed', { number: row.old!.number });
            }
            if (row?.change === 'insert') {
                return t('diff.added', { number: row.new!.number });
            }
            return row?.old !== undefined && row.new !== undefined ? t('diff.unchanged', { old: row.old.number, new: row.new.number }) : null;
        });
    }, [mounted, engine, display, t]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.engine !== engine) {
            return;
        }
        const previous = applied.current;
        if (previous.theme !== theme) {
            mounted.editor.setTheme(theme);
        }
        if (previous.wrap !== wrap) {
            mounted.editor.setWrap(wrap);
        }
        if (previous.label !== label) {
            mounted.editor.setLabel(label);
        }
        applied.current = { theme, wrap, label };
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
            {mounted !== null && mounted.engine === engine && <DiffOverlays mounted={mounted} display={display} unfold={unfold} blocked={blocked} />}
        </div>
    );
}

export function DiffView(props: DiffViewProps) {
    const { document, unfoldLimits = DEFAULT_UNFOLD_LIMITS } = props;
    const [expanded, setExpanded] = useState<{ document: DiffDocument; gaps: ReadonlyMap<number, number>; blocked: ReadonlySet<number> }>(() => ({
        document,
        gaps: new Map(),
        blocked: new Set()
    }));
    const gaps = expanded.document === document ? expanded.gaps : undefined;
    const blocked = expanded.document === document ? expanded.blocked : new Set<number>();
    const projection = useMemo(() => (props.layout === 'split' ? diffSplit(document, gaps) : diffDisplay(document, gaps)), [props.layout, document, gaps]);
    const unfold = (id: number): void =>
        setExpanded((previous) => {
            const gaps = previous.document === document ? previous.gaps : new Map<number, number>();
            const next = expandDiff(document, gaps, id, unfoldLimits);
            return {
                document,
                gaps: next,
                blocked: new Set([...(previous.document === document ? previous.blocked : []), ...(next === gaps ? [id] : [])])
            };
        });
    if ('aligned' in projection && projection.old.lines.length > 0 && projection.new.lines.length > 0) {
        const visibleRows = projection.aligned.reduce((count, row) => count + (row.kind === 'gap' ? 0 : row.row.change === 'pair' ? 2 : 1), 0);
        const wrap = props.wrap !== false && visibleRows <= (props.splitWrapLimit ?? 2000);
        return <SplitDiffView {...props} wrap={wrap} display={projection} unfold={unfold} blocked={blocked} />;
    }
    // An absent side has no selectable text; keep additions and deletions in the unified editor.
    const display = 'aligned' in projection ? (projection.old.lines.length > 0 ? projection.old : projection.new) : projection;
    return <UnifiedDiffView {...props} display={display} unfold={unfold} blocked={blocked} />;
}
