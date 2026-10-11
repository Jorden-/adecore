import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { Editor, EditorEngine } from '@adecore/editor';
import type { DiffDisplay } from '@adecore/merge';
import { RowHost, LineActionHost } from './row-host.ts';

export interface MountedDiff {
    engine: EditorEngine;
    editor: Editor;
    rows: RowHost;
    actions: LineActionHost;
}

export function DiffOverlays({ mounted, display, unfold }: { mounted: MountedDiff; display: DiffDisplay; unfold(id: number): void }) {
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
