import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { FileDiff, GitCommitHorizontal, SquareDashed } from 'lucide-react';
import type { UiProps } from '@adecore/intelligent-ui';
import { FileIcon, Icon, Tooltip } from '@adecore/ui';
import { CHIP_IN_MESSAGE, MENTION_TONE } from '../../chips';
import { uiReasonText } from '../node-text';
import type { UiLink, UiLinkTarget, UiRenderContext, UiRendererProps } from '../render-context';

const PLAIN: UiLink = { state: 'plain' };

function baseName(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    return trimmed.slice(trimmed.lastIndexOf('/') + 1) || path;
}

function plainText(target: UiLinkTarget, link: UiLink): string {
    switch (target.type) {
        case 'File':
            return target.line === undefined ? target.path : `${target.path}:${target.line}`;
        case 'Diff':
            return target.path;
        case 'Commit':
            return target.sha.slice(0, 7);
        case 'Node':
            return link.label ?? target.id;
    }
}

function chipFace(target: UiLinkTarget, link: UiLink): { face: ReactNode; hint: string | null } {
    switch (target.type) {
        case 'File':
            return {
                face: (
                    <>
                        <FileIcon path={target.path} size={14} />
                        <span className="truncate">{baseName(target.path)}</span>
                        {target.line !== undefined && <span className="opacity-70">:{target.line}</span>}
                    </>
                ),
                hint: target.line === undefined ? target.path : `${target.path}:${target.line}`
            };
        case 'Diff':
            return {
                face: (
                    <>
                        <Icon icon={FileDiff} size={12} />
                        <span className="truncate">{baseName(target.path)}</span>
                    </>
                ),
                hint: target.path
            };
        case 'Commit':
            return {
                face: (
                    <>
                        <Icon icon={GitCommitHorizontal} size={12} />
                        <span className="font-mono">{target.sha.slice(0, 7)}</span>
                    </>
                ),
                hint: link.label ?? target.sha
            };
        case 'Node':
            return {
                face: (
                    <>
                        <Icon icon={SquareDashed} size={12} />
                        <span className="truncate">{link.label ?? target.id}</span>
                    </>
                ),
                hint: null
            };
    }
}

/*
 * A resource of the host as a chip, the shape a mention has in a message. The host says whether it
 * can open the target; one it cannot, outside the project or gone, stays mono text with the reason
 * in a tooltip. A chip fades in, since a link reads as text until the host checked it.
 */
export function UiLinkChip({ target, context }: { target: UiLinkTarget; context: UiRenderContext }) {
    const { t } = useTranslation('agent-chat');
    const link = context.link?.(target) ?? PLAIN;
    if (link.state === 'plain') {
        const reason = uiReasonText(t, link.code, link.reason) ?? (context.link === undefined ? null : t('blocks.outsideProject'));
        // Focusable only with a reason, so a keyboard reaches the tooltip.
        const text = (
            <span tabIndex={reason === null ? undefined : 0} className="font-mono text-code break-all text-text-muted">
                {plainText(target, link)}
            </span>
        );
        return reason === null ? text : <Tooltip label={reason}>{text}</Tooltip>;
    }
    const { face, hint } = chipFace(target, link);
    const { openLink } = context;
    const chip =
        openLink === undefined ? (
            <span className={clsx(CHIP_IN_MESSAGE, MENTION_TONE, 'transition-opacity duration-120 starting:opacity-0')}>{face}</span>
        ) : (
            <button
                type="button"
                className={clsx(CHIP_IN_MESSAGE, MENTION_TONE, 'transition-opacity duration-120 hover:brightness-95 starting:opacity-0')}
                onClick={() => openLink(target)}
            >
                {face}
            </button>
        );
    return hint === null ? chip : <Tooltip label={hint}>{chip}</Tooltip>;
}

/* A link with children is a row: the chip and what the agent says about it. */
function LinkRow({ target, context, described, children }: { target: UiLinkTarget; context: UiRenderContext; described: boolean; children: ReactNode }) {
    if (!described) {
        return <UiLinkChip target={target} context={context} />;
    }
    return (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-2 text-sm">
            <span className="max-w-full min-w-0">
                <UiLinkChip target={target} context={context} />
            </span>
            <span className="min-w-0 wrap-break-word text-text-muted">{children}</span>
        </div>
    );
}

export function FileRenderer({ node, children, context }: UiRendererProps<UiProps<'File'>>) {
    const { path, line } = node.props;
    return (
        <LinkRow target={{ type: 'File', path, line }} context={context} described={node.children.length > 0}>
            {children}
        </LinkRow>
    );
}

export function DiffRenderer({ node, children, context }: UiRendererProps<UiProps<'Diff'>>) {
    return (
        <LinkRow target={{ type: 'Diff', path: node.props.path }} context={context} described={node.children.length > 0}>
            {children}
        </LinkRow>
    );
}

export function CommitRenderer({ node, children, context }: UiRendererProps<UiProps<'Commit'>>) {
    return (
        <LinkRow target={{ type: 'Commit', sha: node.props.sha }} context={context} described={node.children.length > 0}>
            {children}
        </LinkRow>
    );
}

export function NodeRenderer({ node, children, context }: UiRendererProps<UiProps<'Node'>>) {
    return (
        <LinkRow target={{ type: 'Node', id: node.props.id }} context={context} described={node.children.length > 0}>
            {children}
        </LinkRow>
    );
}
