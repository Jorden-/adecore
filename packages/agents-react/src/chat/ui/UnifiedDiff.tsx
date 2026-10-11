import { Suspense, useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { canRenderEditorEdit } from './diff/editor-edit-model';
import { FileDiff, PatchDiff } from '@pierre/diffs/react';
import type { ChatFileChange } from '@adecore/agent-contracts';
import { chatHost } from '../../host';
import { useDiffTheme } from './diff-theme';
import { fullFileDiff, type DiffContents } from './full-diff';

/*
 * A patch the CLI reported itself. The renderer needs a file header, which a CLI that only sends hunks
 * gets from the path we know; a diff without hunks is shown as its own lines, so nothing is swallowed.
 */
function asPatch(change: ChatFileChange): string | null {
    if (!/^@@/m.test(change.diff)) {
        return null;
    }
    if (/^\+\+\+ /m.test(change.diff)) {
        return change.diff;
    }
    const from = change.kind === 'add' ? '/dev/null' : `a/${change.path}`;
    const to = change.kind === 'delete' ? '/dev/null' : `b/${change.path}`;
    return `--- ${from}\n+++ ${to}\n${change.diff}`;
}

/* Lets a diff with a view of its own run to its bottom, so a short one's scrollbar sits there and not under its last line. */
const FILL_CSS = `
:host { display: flex; flex-direction: column; flex-grow: 1; }
pre { flex-grow: 1; align-content: start; }
pre[data-diff-type="single"] { display: flex; flex-direction: column; }
pre[data-diff-type="split"][data-overflow="scroll"]:not([data-dehydrated]) { align-content: stretch; }
pre > [data-code] { flex-grow: 1; align-self: stretch; align-content: start; }
`;

function lineClass(line: string): string {
    if (line.startsWith('+')) {
        return 'text-chat-added';
    }
    if (line.startsWith('-')) {
        return 'text-chat-removed';
    }
    return 'text-text-muted';
}

interface UnifiedDiffProps {
    allowEditor?: boolean;
    ignoreWhitespace?: boolean;
    change: ChatFileChange;
    overflow?: 'wrap' | 'scroll';
    /* `split` puts the old and the new side by side; the chat always stacks. */
    diffStyle?: 'unified' | 'split';
    /* Grow to the height of a flex column around it. */
    fill?: boolean;
    /* Both whole texts the patch was made between, with which a person can unfold the lines between hunks. */
    contents?: DiffContents;
}

function LegacyUnifiedDiff({ change, overflow = 'wrap', diffStyle = 'unified', fill = false, contents }: UnifiedDiffProps) {
    const resolved = chatHost().code.useMode();
    const theme = useDiffTheme();
    const patch = useMemo(() => asPatch(change), [change]);
    const oldText = contents?.old;
    const newText = contents?.new;
    const full = useMemo(
        () => (patch === null || oldText === undefined || newText === undefined ? null : fullFileDiff(patch, change.path, { old: oldText, new: newText })),
        [patch, change.path, oldText, newText]
    );
    const unfolds = full !== null;
    const options = useMemo(
        () => ({
            theme,
            themeType: resolved,
            disableFileHeader: true,
            diffStyle,
            overflow,
            hunkSeparators: unfolds ? ('line-info' as const) : ('simple' as const),
            unsafeCSS: fill ? FILL_CSS : undefined
        }),
        [diffStyle, overflow, theme, resolved, fill, unfolds]
    );
    if (patch === null) {
        return (
            <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-code select-text">
                {change.diff
                    .replace(/\n$/, '')
                    .split('\n')
                    .map((line, index) => (
                        <div key={index} className={clsx(lineClass(line), 'whitespace-pre-wrap')}>
                            {line}
                        </div>
                    ))}
            </pre>
        );
    }
    return (
        <div className={clsx('chat-diff select-text', fill && 'flex grow flex-col')}>
            {full === null ? <PatchDiff patch={patch} options={options} /> : <FileDiff fileDiff={full} options={options} />}
        </div>
    );
}

const EditorPatchDiff = lazyNamed(() => import('./diff/EditorPatchDiff'), 'default');

export default function UnifiedDiff(props: UnifiedDiffProps) {
    const { t } = useTranslation('agent-chat');
    const { change, contents, allowEditor = true, ignoreWhitespace = false, overflow = 'wrap', diffStyle = 'unified', fill = false } = props;
    const loadEngine = chatHost().code.editor;
    const oldText = contents?.old ?? '';
    const newText = contents?.new ?? change.diff;
    const withinLimits = useMemo(() => canRenderEditorEdit({ before: oldText, after: newText }) && /^@@/m.test(change.diff), [oldText, newText, change.diff]);
    const fallback = <LegacyUnifiedDiff {...props} />;
    if (!allowEditor || loadEngine === undefined || diffStyle === 'split' || !withinLimits) {
        return fallback;
    }
    return (
        <DiffFallbackBoundary fallback={fallback} resetKeys={[change.path, change.diff, oldText, newText, ignoreWhitespace, loadEngine]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorPatchDiff
                    change={change}
                    contents={contents}
                    ignoreWhitespace={ignoreWhitespace}
                    wrap={overflow === 'wrap'}
                    fill={fill}
                    loadEngine={loadEngine}
                    fallback={fallback}
                />
            </Suspense>
        </DiffFallbackBoundary>
    );
}
