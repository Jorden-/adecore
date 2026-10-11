import clsx from 'clsx';
import { createContext, useContext, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { UiProps } from '@adecore/intelligent-ui';
import { PreviewCard, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { chatHost } from '../../../../host';
import { CodeBlock } from '../../CodeBlock';
import { CodeStreamingContext } from '../../code-streaming';
import { ImageThumb } from '../../ImageView';
import { uiChildrenOf, uiNodeLabel, uiNodeText, uiUrlDomain } from '../node-text';
import type { UiRendererProps } from '../render-context';
import { useTruncated } from '../use-truncated';

// The number of every source by its node id, which the list counts in its own order.
const SourceNumbers = createContext<ReadonlyMap<string, number>>(new Map());

/* Plain text in the same measure until the node closes, so highlighting never makes it jump. */
export function CodeBlockRenderer({ node }: UiRendererProps<UiProps<'CodeBlock'>>) {
    return (
        <CodeStreamingContext.Provider value={!node.complete}>
            <CodeBlock code={uiNodeText(node).replace(/^\n|\n$/g, '')} lang={node.props.language ?? 'text'} />
        </CodeStreamingContext.Provider>
    );
}

/* Its own component, so the host's hook is only called for an image that names an attachment. */
function AttachedImage({ scopeId, chatId, attachmentId, alt }: { scopeId: string; chatId: string; attachmentId: string; alt: string }) {
    const source = chatHost().attachments.useUrl(scopeId, chatId, attachmentId);
    return <ImageThumb source={source} alt={alt} className="max-h-70 max-w-full object-contain" />;
}

/*
 * An attachment of the chat, never a path or an address the model wrote. An image of the latest
 * generation stays a quiet square until the daemon resolved it to an attachment.
 */
export function ImageRenderer({ node, children, context }: UiRendererProps<UiProps<'Image'>>) {
    const { t } = useTranslation('agent-chat');
    const { attachment, alt } = node.props;
    const caption = uiNodeLabel(node);
    const name = alt ?? (caption === '' ? t('blocks.image.label') : caption);
    return (
        <figure className="flex flex-col items-start gap-1.5">
            {attachment === undefined ? (
                <ImageThumb source={{ url: null, failure: t('blocks.image.unavailable') }} alt={name} />
            ) : (
                <AttachedImage scopeId={context.scopeId} chatId={context.chatId} attachmentId={attachment} alt={name} />
            )}
            {caption !== '' && <figcaption className="px-2 text-xs text-text-muted">{children}</figcaption>}
        </figure>
    );
}

export function SourcesRenderer({ node, children }: UiRendererProps<UiProps<'Sources'>>) {
    const { t } = useTranslation('agent-chat');
    const headingId = useId();
    const numbers = new Map(uiChildrenOf(node, 'Source').map((source, index) => [source.id, index + 1]));
    return (
        <SourceNumbers value={numbers}>
            <section aria-labelledby={headingId} className="flex flex-col">
                <span id={headingId} className="px-2 pb-1 text-xs font-medium text-text-muted">
                    {t('blocks.sources')}
                </span>
                <ol className="chat-ui-nodes flex flex-col">{children}</ol>
            </section>
        </SourceNumbers>
    );
}

export interface UiSourceCitationProps {
    /* The number of the Source, as its row in the list counts it. */
    number: number;
    title: string;
    url: string;
    /* Shows the Source row the number stands for. Without it the number is no button. */
    onReveal?: () => void;
    className?: string;
}

/*
 * A source number in running text. Resting on it or focusing it shows the title and the domain, and
 * a tap reveals the row in the list of sources; only that row opens the address, so nothing loads
 * before a person asks for it.
 */
export function UiSourceCitation({ number, title, url, onReveal, className }: UiSourceCitationProps) {
    const { t } = useTranslation('agent-chat');
    return (
        <PreviewCard.Root>
            <PreviewCard.Trigger
                delay={300}
                closeDelay={150}
                render={onReveal === undefined ? <span /> : <button type="button" />}
                aria-label={onReveal === undefined ? undefined : t('blocks.citation', { number: formatNumber(number), title })}
                className={clsx(
                    'inline-flex h-4 min-w-4.5 items-center justify-center rounded-sm bg-text/7 px-1 align-[1px] text-2xs leading-4 text-text-muted tabular-nums',
                    onReveal !== undefined && 'cursor-pointer hover:bg-text/12 hover:text-text',
                    className
                )}
                onClick={onReveal}
            >
                {formatNumber(number)}
            </PreviewCard.Trigger>
            <PreviewCard.Popup side="top" align="center" sideOffset={4} className="flex max-w-72 flex-col px-2.5 py-1.5 text-xs">
                <span className="line-clamp-2 text-text">{title}</span>
                <span className="truncate text-text-faint">{uiUrlDomain(url)}</span>
            </PreviewCard.Popup>
        </PreviewCard.Root>
    );
}

/*
 * Opens through the host and loads nothing before, not even an icon. The row itself takes focus
 * when a citation reveals it, apart from the button that opens it.
 */
export function SourceRenderer({ node, context }: UiRendererProps<UiProps<'Source'>>) {
    const number = useContext(SourceNumbers).get(node.id);
    const { title, url } = node.props;
    const { openUrl } = context;
    const [measureDomain, domainCut] = useTruncated<HTMLSpanElement>();
    const face = (
        <>
            <span className="w-5 shrink-0 self-start text-right text-text-faint tabular-nums">{number}</span>
            <span className="min-w-0 grow wrap-anywhere text-text">{title}</span>
            <span ref={measureDomain} className="max-w-1/2 min-w-0 shrink-0 self-start truncate text-text-faint">
                {uiUrlDomain(url)}
            </span>
        </>
    );
    return (
        <li data-ui-source={node.id} tabIndex={-1} className="chat-ui-source scroll-my-2 rounded-md">
            {/* The title wraps and the domain may be cut short, so the tooltip says both whole; a row that opens nothing takes focus only while it cuts. */}
            <Tooltip
                label={
                    <>
                        <span className="block">{title}</span>
                        <span className="block text-text-muted">{url}</span>
                    </>
                }
            >
                {openUrl === undefined ? (
                    <span tabIndex={domainCut ? 0 : undefined} className="flex min-h-8 items-start gap-2 rounded-md px-2 py-2 text-xs">
                        {face}
                    </span>
                ) : (
                    <button
                        type="button"
                        className="flex min-h-8 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-surface-hover"
                        onClick={() => openUrl(url)}
                    >
                        {face}
                    </button>
                )}
            </Tooltip>
        </li>
    );
}
