import { useTranslation } from 'react-i18next';
import { Markdown } from '../Markdown';

/* Why a part is drawn as its text: a component this version does not know, or one it could not draw. */
export type UiFallbackProblem = { kind: 'unknown'; component: string } | { kind: 'failed' };

/*
 * One part of a block as the markdown it stands for, in a quiet surface with a line that says why.
 * A person sees it as a repair, never as an error, so nothing here is red.
 */
export function UiFallbackPart({ fallback, problem }: { fallback: string; problem: UiFallbackProblem }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div className="flex flex-col gap-1 rounded-md bg-surface-hover p-2">
            <span className="text-xs text-text-faint">
                {problem.kind === 'unknown' ? t('blocks.unknownComponent', { component: problem.component }) : t('blocks.renderFailed')}
            </span>
            {fallback !== '' && (
                // A fallback is often data without a space in it, such as the JSON of a chart.
                <div className="min-w-0 wrap-anywhere">
                    <Markdown text={fallback} fileLinks={false} />
                </div>
            )}
        </div>
    );
}
