import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fileUriToPath } from '@adecore/lsp';
import { Icon, IconButton, Segmented, Spinner, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { CALL_HIERARCHY_HEIGHT } from './call-hierarchy.ts';
import { CALL_LEVEL_LIMIT, type CallDirection, type CallRow } from './call-hierarchy-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import { basenameOf, relativeTo } from './paths.ts';
import { PathText } from './PathText.tsx';
import { Preview } from './PeekPanel.tsx';
import type { CallHierarchyView } from './popups.ts';
import { SymbolBadge } from './SymbolPicker.tsx';

const INDENT = 14;
const BASE_INDENT = 8;

type NodeRow = Extract<CallRow, { kind: 'node' }>;

function folderOf(path: string): string {
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

interface LineProps {
    row: CallRow;
    id: string;
    active: boolean;
    expanded?: boolean;
    position?: number;
    size?: number;
    ref?: Ref<HTMLDivElement>;
    children: ReactNode;
    onClick(): void;
    onDoubleClick?(): void;
}

/* One line of the tree. Status lines are treeitems too, so the level of a symbol's calls is read the same way, but nothing selects them. */
function Line({ row, id, active, expanded, position, size, ref, children, onClick, onDoubleClick }: LineProps) {
    return (
        <div
            ref={ref}
            id={id}
            role="treeitem"
            aria-level={row.level}
            aria-selected={active}
            aria-expanded={expanded}
            aria-posinset={position}
            aria-setsize={size}
            aria-disabled={row.kind === 'status' ? true : undefined}
            data-active={active}
            className="flex h-[22px] w-full cursor-default items-center gap-1.5 pr-3 text-left font-mono text-code hover:bg-surface-hover data-[active=true]:bg-accent-soft"
            style={{ paddingLeft: BASE_INDENT + (row.level - 1) * INDENT }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
        >
            {children}
        </div>
    );
}

function Symbol({ language, row, active, id, ref }: { language: EditorLanguage; row: NodeRow; active: boolean; id: string; ref?: Ref<HTMLDivElement> }) {
    const { t } = useTranslation('editor');
    const { item } = row;
    const path = relativeTo(fileUriToPath(item.uri) ?? item.uri, language.project.folder);
    const tool = language.callHierarchy;
    return (
        <Line
            ref={ref}
            row={row}
            id={id}
            active={active}
            expanded={row.leaf ? undefined : row.expanded}
            position={row.position}
            size={row.size}
            onClick={() => (active ? tool.go(row.id) : tool.select(row.id))}
            onDoubleClick={() => tool.go(row.id)}
        >
            <span
                aria-hidden
                className="grid size-3.5 shrink-0 place-items-center text-text-muted"
                onClick={(event) => {
                    event.stopPropagation();
                    tool.toggle(row.id);
                }}
            >
                {row.leaf ? null : <Icon icon={row.expanded ? ChevronDown : ChevronRight} size={14} />}
            </span>
            <SymbolBadge kind={item.kind} />
            <span className={`shrink-0 text-text ${item.tags?.includes(1) ? 'line-through' : ''}`}>{item.name}</span>
            {item.detail !== undefined && item.detail !== '' && <span className="min-w-0 flex-1 truncate text-text-muted">{item.detail}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 font-sans text-xs text-text-faint">
                {row.sites > 1 && (
                    <Tooltip label={t('language.callHierarchy.sites', { count: row.sites, formatted: formatNumber(row.sites) })}>
                        <span className="text-text-muted">{`×${formatNumber(row.sites)}`}</span>
                    </Tooltip>
                )}
                <Tooltip label={path}>
                    <span className="max-w-40 truncate">{`${basenameOf(path)}:${formatNumber(item.selectionRange.start.line + 1)}`}</span>
                </Tooltip>
            </span>
        </Line>
    );
}

function Tree({ language, view }: { language: EditorLanguage; view: CallHierarchyView }) {
    const { t } = useTranslation('editor');
    const treeId = useId();
    const activeRow = useRef<HTMLDivElement>(null);
    const idOf = (row: CallRow): string => `${treeId}-${row.id}`;
    const activeId = view.rows.some((row) => row.id === view.active) ? `${treeId}-${view.active}` : undefined;

    useEffect(() => {
        activeRow.current?.scrollIntoView({ block: 'nearest' });
    }, [view.active]);

    // The focus stays in the text, so the input is what names the tree and its active row.
    useLayoutEffect(() => {
        language.editor.setInputPopup({ controls: treeId, activeDescendant: activeId });
        return () => language.editor.setInputPopup(null);
    }, [language, treeId, activeId]);

    return (
        <div id={treeId} role="tree" aria-label={t('language.callHierarchy.label')} className="w-1/2 shrink-0 overflow-y-auto border-r border-border py-1">
            {view.rows.map((row) => {
                const active = row.id === view.active;
                const ref = active ? activeRow : undefined;
                if (row.kind === 'node') {
                    return <Symbol key={row.id} ref={ref} language={language} row={row} active={active} id={idOf(row)} />;
                }
                if (row.kind === 'more') {
                    const next = Math.min(row.hidden, CALL_LEVEL_LIMIT);
                    return (
                        <Line key={row.id} ref={ref} row={row} id={idOf(row)} active={active} onClick={() => language.callHierarchy.showMore(row.parent)}>
                            <span className="font-sans text-xs text-accent">
                                {t('language.callHierarchy.more', { count: next, formatted: formatNumber(next), hidden: formatNumber(row.hidden) })}
                            </span>
                        </Line>
                    );
                }
                return (
                    <Line key={row.id} row={row} id={idOf(row)} active={false} onClick={() => language.callHierarchy.retry(row.parent)}>
                        <StatusText row={row} direction={view.direction} />
                    </Line>
                );
            })}
        </div>
    );
}

function StatusText({ row, direction }: { row: Extract<CallRow, { kind: 'status' }>; direction: CallDirection }) {
    const { t } = useTranslation('editor');
    if (row.status === 'loading') {
        return (
            <span className="flex items-center gap-2 font-sans text-xs text-text-muted">
                <Spinner size={12} />
                {t('language.callHierarchy.loading')}
            </span>
        );
    }
    if (row.status === 'failed') {
        return (
            <span className="min-w-0 truncate font-sans text-xs text-status-error">{t('language.callHierarchy.retry', { message: row.message ?? '' })}</span>
        );
    }
    return (
        <span className="font-sans text-xs text-text-muted">
            {t(direction === 'incoming' ? 'language.callHierarchy.noIncoming' : 'language.callHierarchy.noOutgoing')}
        </span>
    );
}

/*
 * The call hierarchy of a symbol in the row the editor leaves under the line: the tree of callers or callees on
 * the left and the code of the active call on the right. Like the peek it portals into that row, which the
 * editor makes again when it scrolls back into view.
 */
export function CallHierarchyPanel({ language, view }: { language: EditorLanguage; view: CallHierarchyView }) {
    const { t } = useTranslation('editor');
    if (view.container === null) {
        return null;
    }
    const folder = language.project.folder;
    const path = view.preview === null ? null : fileUriToPath(view.preview.uri);
    const shown = path === null ? '' : folderOf(relativeTo(path, folder));
    return createPortal(
        <div
            className="flex flex-col bg-surface pt-[2px] font-sans text-xs text-text"
            style={{ height: CALL_HIERARCHY_HEIGHT }}
            onPointerDown={(event) => event.preventDefault()}
        >
            <div className="peek-hatch h-[14px]" />
            <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-border pr-2 pl-3 text-sm">
                <Segmented
                    value={view.direction}
                    onValueChange={(direction) => language.callHierarchy.setDirection(direction)}
                    label={t('language.callHierarchy.direction')}
                    options={[
                        { id: 'incoming', label: t('language.callHierarchy.incoming') },
                        { id: 'outgoing', label: t('language.callHierarchy.outgoing') }
                    ]}
                />
                <span className="shrink-0 font-medium">{view.name}</span>
                <span className="shrink-0 font-medium text-text-muted">{path === null ? '' : basenameOf(path)}</span>
                <PathText path={shown} className="text-text-muted" />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {view.sites > 1 && (
                        <>
                            <IconButton
                                icon={ChevronLeft}
                                size="xs"
                                label={t('language.callHierarchy.previousSite')}
                                onClick={() => language.callHierarchy.stepSite(-1)}
                            />
                            <span className="text-text-muted">
                                {t('language.callHierarchy.site', { current: formatNumber(view.site + 1), total: formatNumber(view.sites) })}
                            </span>
                            <IconButton
                                icon={ChevronRight}
                                size="xs"
                                label={t('language.callHierarchy.nextSite')}
                                onClick={() => language.callHierarchy.stepSite(1)}
                            />
                        </>
                    )}
                    <IconButton icon={X} size="xs" label={t('language.callHierarchy.close')} onClick={() => language.callHierarchy.close()} />
                </div>
            </div>
            <div className="flex h-[180px] shrink-0">
                <Tree language={language} view={view} />
                <Preview preview={view.preview} />
            </div>
            <div className="peek-hatch h-[14px]" />
        </div>,
        view.container
    );
}
