import clsx from 'clsx';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UiProps } from '@adecore/intelligent-ui';
import { Pill, PreviewCard, Tooltip, Wipe } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { useChatHost } from '../../../../host';
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

// Set by a Gallery, so the images inside it draw as cells of its grid.
const GalleryContext = createContext(false);

/*
 * Its own component, so the host's hook is only called for an image that names an attachment. In a
 * gallery a cell that cannot show its picture says what it was, since the square alone tells nothing.
 */
function AttachedImage({
    scopeId,
    chatId,
    attachmentId,
    alt,
    cell,
    unnamed
}: {
    scopeId: string;
    chatId: string;
    attachmentId: string;
    alt: string;
    cell: boolean;
    unnamed: boolean;
}) {
    const host = useChatHost();
    const source = host.attachments.useUrl(scopeId, chatId, attachmentId);
    if (!cell) {
        return <ImageThumb source={source} alt={alt} className="max-h-70 max-w-full object-contain" />;
    }
    return (
        <>
            <ImageThumb source={source} alt={alt} aspect={1} />
            {unnamed && source.failure !== null && <figcaption className="text-xs wrap-anywhere text-text-faint">{alt}</figcaption>}
        </>
    );
}

/*
 * An attachment of the chat, never a path or an address the model wrote. An image of the latest
 * generation stays a quiet square until the daemon resolved it to an attachment.
 */
export function ImageRenderer({ node, children, context }: UiRendererProps<UiProps<'Image'>>) {
    const { t } = useTranslation('agent-chat');
    const cell = useContext(GalleryContext);
    const { attachment, alt } = node.props;
    const caption = uiNodeLabel(node);
    const name = alt ?? (caption === '' ? t('blocks.image.label') : caption);
    return (
        <figure className={cell ? 'flex min-w-0 flex-col gap-1' : 'flex flex-col items-start gap-1.5'}>
            {attachment === undefined ? (
                <ImageThumb source={{ url: null, failure: t('blocks.image.unavailable') }} alt={name} aspect={cell ? 1 : undefined} />
            ) : (
                <AttachedImage scopeId={context.scopeId} chatId={context.chatId} attachmentId={attachment} alt={name} cell={cell} unnamed={caption === ''} />
            )}
            {caption !== '' && <figcaption className={cell ? 'text-xs wrap-anywhere text-text-muted' : 'px-2 text-xs text-text-muted'}>{children}</figcaption>}
            {cell && caption === '' && attachment === undefined && (
                <figcaption className="text-xs wrap-anywhere text-text-faint">{alt ?? t('blocks.image.unavailable')}</figcaption>
            )}
        </figure>
    );
}

/* Three columns, two in a narrow block; the container decides, not the window, since a chat can be any width. */
export function GalleryRenderer({ node, children }: UiRendererProps<UiProps<'Gallery'>>) {
    const { t } = useTranslation('agent-chat');
    return (
        <GalleryContext value>
            <div role="group" aria-label={t('blocks.gallery.label', { count: uiChildrenOf(node, 'Image').length })} className="@container px-2">
                <div className="chat-ui-nodes grid grid-cols-2 gap-2 @min-[420px]:grid-cols-3">{children}</div>
            </div>
        </GalleryContext>
    );
}

// The shape of the frame until the first picture reports its own.
const COMPARE_ASPECT = 4 / 3;

/*
 * Two attachments in one frame, shaped like the first. The split is only this renderer's state. With one
 * attachment gone the other stands alone with the reason; with both gone the thumbnail says why.
 */
export function CompareRenderer({ node, children, context }: UiRendererProps<UiProps<'Compare'>>) {
    const { t } = useTranslation('agent-chat');
    const host = useChatHost();
    const { before, after } = node.props;
    const beforeLabel = node.props.beforeLabel || t('blocks.compare.before');
    const afterLabel = node.props.afterLabel || t('blocks.compare.after');
    const first = host.attachments.useUrl(context.scopeId, context.chatId, before);
    const second = host.attachments.useUrl(context.scopeId, context.chatId, after);
    const [split, setSplit] = useState(0.5);
    const [aspect, setAspect] = useState(COMPARE_ASPECT);
    const caption = uiNodeLabel(node);
    const loading = (source: typeof first) => source.url === null && source.failure === null;
    const label = t('blocks.compare.label', { before: beforeLabel, after: afterLabel });
    let body: ReactNode;
    if (loading(first) || loading(second)) {
        body = <ImageThumb source={{ url: null, failure: null }} alt={label} aspect={COMPARE_ASPECT} />;
    } else if (first.url !== null && second.url !== null) {
        body = (
            <div className="relative w-full max-h-96 overflow-hidden rounded-lg border border-border bg-surface-sunken" style={{ aspectRatio: aspect }}>
                <Wipe
                    value={split}
                    onValueChange={setSplit}
                    label={label}
                    before={
                        <img
                            src={first.url}
                            alt={beforeLabel}
                            draggable={false}
                            className="size-full object-contain select-none"
                            onLoad={(event) => {
                                const { naturalWidth, naturalHeight } = event.currentTarget;
                                if (naturalWidth > 0 && naturalHeight > 0) {
                                    setAspect(naturalWidth / naturalHeight);
                                }
                            }}
                        />
                    }
                    after={<img src={second.url} alt={afterLabel} draggable={false} className="size-full object-contain select-none" />}
                />
                <CompareChip side="left" label={beforeLabel} />
                <CompareChip side="right" label={afterLabel} />
            </div>
        );
    } else if (first.url === null && second.url === null) {
        body = <ImageThumb source={first} alt={label} aspect={COMPARE_ASPECT} />;
    } else {
        const shown = first.url !== null ? { source: first, name: beforeLabel } : { source: second, name: afterLabel };
        body = (
            <>
                <ImageThumb source={shown.source} alt={shown.name} className="max-h-70 max-w-full object-contain" />
                <span className="px-2 text-xs text-text-faint">{t('blocks.compare.missing')}</span>
            </>
        );
    }
    return (
        <figure className="flex flex-col items-start gap-1.5 px-2">
            {body}
            {caption !== '' && <figcaption className="text-xs text-text-muted">{children}</figcaption>}
        </figure>
    );
}

/* A chip on the picture gets a ground of its own, since a pill's alpha ground would vanish over an image. */
function CompareChip({ side, label }: { side: 'left' | 'right'; label: string }) {
    return (
        <span
            className={clsx('pointer-events-none absolute top-2 z-20 max-w-2/5 truncate rounded-md bg-surface-raised', side === 'left' ? 'left-2' : 'right-2')}
        >
            <Pill shape="tag" size="sm" tone="muted">
                {label}
            </Pill>
        </span>
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
