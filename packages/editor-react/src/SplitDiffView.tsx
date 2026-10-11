import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseChord } from '@adecore/editor/keymap';
import type { EditorLineHighlight } from '@adecore/editor';
import { diffSplit, type DiffDocument } from '@adecore/merge';
import type { DiffViewProps } from './DiffView.tsx';
import type { DiffSourceSide } from './diff-syntax.ts';
import { DiffOverlays, type MountedDiff } from './diff-overlays.tsx';
import { wordMarks } from './diff-wordmarks.ts';
import { RowHost, LineActionHost } from './row-host.ts';
import { splitAlignment } from './split-alignment.ts';

const SIDES = ['old', 'new'] as const;

interface MountedSplit {
    old: MountedDiff;
    new: MountedDiff;
    align(): void;
    update(run: () => void): void;
}

export function SplitDiffView({ engine, document, theme, tokens, wrap = true, fill = false, maxHeight, label, className, ref, onMount }: DiffViewProps) {
    const { t } = useTranslation('editor');
    const [expanded, setExpanded] = useState<{ document: DiffDocument; gaps: ReadonlyMap<number, number> }>(() => ({ document, gaps: new Map() }));
    const display = useMemo(() => diffSplit(document, expanded.document === document ? expanded.gaps : undefined), [document, expanded]);
    const emphasis = useMemo(() => wordMarks(document), [document]);
    const oldElement = useRef<HTMLDivElement>(null);
    const newElement = useRef<HTMLDivElement>(null);
    const labels = { old: `${label}: ${t('diff.oldSide')}`, new: `${label}: ${t('diff.newSide')}` };
    const current = useRef({ display, tokens, theme, wrap, label, labels });
    const leader = useRef<DiffSourceSide>('new');
    const [mounted, setMounted] = useState<MountedSplit | null>(null);
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        current.current = { display, tokens, theme, wrap, label, labels };
    });
    useLayoutEffect(() => {
        const oldHost = oldElement.current;
        const newHost = newElement.current;
        if (oldHost === null || newHost === null) {
            return;
        }
        const mount = (side: DiffSourceSide, host: HTMLElement): MountedDiff => {
            const initial = current.current;
            const editor = engine.mount(host, {
                text: initial.display[side].text,
                theme: initial.theme,
                wrap: initial.wrap,
                label: initial.labels[side],
                readOnly: true,
                guides: false,
                folding: false,
                foldOutline: 'off',
                handBack: [parseChord('Mod+Enter')]
            });
            editor.setBlocks([]);
            editor.setLineTokens((line) => {
                const row = current.current.display[side].rows[line];
                return row === undefined ? null : current.current.tokens?.get(side, row[side]!.index);
            });
            return { engine, editor, rows: new RowHost(editor, 'diff-alignment'), actions: new LineActionHost(editor, 'diff-status') };
        };
        const old = mount('old', oldHost);
        let fresh: MountedDiff;
        try {
            fresh = mount('new', newHost);
        } catch (error) {
            old.editor.dispose();
            throw error;
        }
        const sides = { old, new: fresh };
        let stopped = false;
        let pending = false;
        let syncing = false;
        let aligning = false;
        let updating = false;
        const sync = (side: DiffSourceSide): void => {
            if (syncing || aligning || updating) {
                return;
            }
            const other = side === 'old' ? sides.new.editor : sides.old.editor;
            const top = sides[side].editor.getScrollTop();
            if (Math.abs(other.getScrollTop() - top) < 1) {
                return;
            }
            syncing = true;
            try {
                other.setScrollTop(top);
            } finally {
                syncing = false;
            }
        };
        const measure = (): void => setHeight(Math.max(sides.old.editor.getContentHeight(), sides.new.editor.getContentHeight()));
        const align = (): void => {
            if (pending || stopped) {
                return;
            }
            pending = true;
            // Intrinsic measurements arrive after each render; align both editors before the next paint.
            queueMicrotask(() => {
                pending = false;
                if (stopped) {
                    return;
                }
                aligning = true;
                try {
                    const rows = splitAlignment(
                        current.current.display.aligned,
                        (line) => sides.old.editor.getLineHeight(line),
                        (line) => sides.new.editor.getLineHeight(line)
                    );
                    sides.old.rows.set(rows.old);
                    sides.new.rows.set(rows.new);
                } finally {
                    aligning = false;
                }
                measure();
                sync(leader.current);
            });
        };
        const update = (run: () => void): void => {
            updating = true;
            try {
                run();
            } finally {
                updating = false;
            }
            align();
        };
        const stops = SIDES.flatMap((side) => [
            sides[side].editor.onLineHeights(align),
            sides[side].editor.onViewChange(() => {
                measure();
                sync(side);
            })
        ]);
        setMounted({ old: sides.old, new: sides.new, align, update });
        measure();
        return () => {
            stopped = true;
            for (const stop of stops) {
                stop();
            }
            for (const side of SIDES) {
                sides[side].editor.dispose();
            }
        };
    }, [engine]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.old.engine !== engine) {
            return;
        }
        mounted.update(() => {
            for (const side of SIDES) {
                const { editor, actions } = mounted[side];
                editor.setText(display[side].text);
                editor.setLineNumbers((line) => {
                    const row = current.current.display[side].rows[line];
                    return row === undefined ? null : String(row[side]!.number);
                });
                const highlights: EditorLineHighlight[] = [];
                for (const [index, row] of display[side].rows.entries()) {
                    if (row.change === 'context') {
                        continue;
                    }
                    highlights.push({
                        startLine: index + 1,
                        endLine: index + 1,
                        color: side === 'old' ? '--editor-deleted' : '--editor-added',
                        sign: side === 'old' ? '-' : '+',
                        emphasis: [emphasis[side].get(row[side]!.index) ?? []]
                    });
                }
                editor.setLineHighlights(highlights);
                editor.setChangeMarks(
                    highlights.map((highlight) => ({ startLine: highlight.startLine, endLine: highlight.endLine, kind: side === 'old' ? 'deleted' : 'added' }))
                );
                actions.set(display[side].rows.flatMap((row, line) => (row.noNewline === undefined ? [] : [{ id: `no-newline-${line}`, line }])));
            }
        });
    }, [mounted, engine, display, emphasis]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.old.engine !== engine) {
            return;
        }
        for (const side of SIDES) {
            mounted[side].editor.setTheme(theme);
            mounted[side].editor.setWrap(wrap);
            mounted[side].editor.setLabel(`${label}: ${t(`diff.${side}Side`)}`);
        }
        mounted.align();
    }, [mounted, engine, theme, wrap, label, t]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.old.engine !== engine) {
            return;
        }
        const refresh = (): void => {
            for (const side of SIDES) {
                mounted[side].editor.setLineTokens((line) => {
                    const row = current.current.display[side].rows[line];
                    return row === undefined ? null : current.current.tokens?.get(side, row[side]!.index);
                });
            }
        };
        refresh();
        const ownerWindow = oldElement.current?.ownerDocument.defaultView;
        let frame: number | undefined;
        let pending = false;
        let stopped = false;
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
    }, [mounted, engine, display, tokens]);
    useLayoutEffect(() => {
        if (mounted === null || mounted.old.engine !== engine) {
            return;
        }
        const stops = SIDES.map((side) => onMount?.(mounted[side].editor, side));
        return () => {
            for (const stop of stops) {
                stop?.();
            }
        };
    }, [mounted, engine, onMount]);
    const limit = maxHeight !== undefined && Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : Infinity;
    const unfold = (id: number): void =>
        setExpanded((previous) => ({ document, gaps: new Map([...(previous.document === document ? previous.gaps : []), [id, Infinity]]) }));
    return (
        <div
            className={`adecore-editor-diff adecore-editor-diff-split ${className ?? ''}`}
            ref={ref}
            data-scroll={fill || height > limit}
            style={{ height: fill ? '100%' : Math.min(height, limit) }}
        >
            {SIDES.map((side) => (
                <div
                    key={side}
                    className="adecore-editor-diff-side"
                    data-side={side}
                    onWheelCapture={() => {
                        leader.current = side;
                    }}
                    onFocusCapture={() => {
                        leader.current = side;
                    }}
                >
                    <div ref={side === 'old' ? oldElement : newElement} className="adecore-editor-diff-surface" />
                    {mounted !== null && mounted[side].engine === engine && <DiffOverlays mounted={mounted[side]} display={display[side]} unfold={unfold} />}
                </div>
            ))}
        </div>
    );
}
