import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Copy, Ellipsis, ExternalLink, FolderDown, ImageIcon, Maximize2 } from 'lucide-react';
import type { ChatAttachment, ChatToolItem } from '@adecore/agent-contracts';
import { Button, ButtonGroup, copyText, ErrorBoundary, FileIcon, Icon, IconButton, Menu, Surface } from '@adecore/ui';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { useCurrentItem } from '../../../state/chats';
import { formatBytes } from '../../attachments';
import { attachmentAspect, generatedImageView, type GeneratedImageFailure } from '../../logic/generated-image';
import { toolStartedAt } from '../../logic/tools';
import { CHIP_IN_MESSAGE, MENTION_TONE } from '../chips';
import { useFileLinkCwd, useOpenFileLink } from '../file-links';
import { ImageThumb } from '../ImageView';
import { ROW_GUTTER } from '../icons';
import { RunningFor, WorkRow } from './WorkRows';

const SAVED_FLASH_MS = 2000;

// Where each image went, so a row the thread unmounts while scrolling still says so when it comes back.
const savedPaths = new Map<string, string>();

/* True for `ms` after `start()`, for a check mark that says an action landed. */
function useFlash(ms: number): [boolean, () => void] {
    const [on, setOn] = useState(false);
    useEffect(() => {
        if (!on) {
            return;
        }
        const timer = setTimeout(() => setOn(false), ms);
        return () => clearTimeout(timer);
    }, [on, ms]);
    return [on, () => setOn(true)];
}

function failureText(failure: GeneratedImageFailure, t: TFunction<'agent-chat'>): string | undefined {
    switch (failure.kind) {
        case 'provider':
            return failure.message ?? undefined;
        case 'empty':
            return t('generatedImage.empty');
        case 'not-image':
            return t('generatedImage.notImage');
        case 'too-large':
            return t('generatedImage.tooLarge', { size: formatBytes(failure.limit) });
    }
}

/* The line over the image, in the measures of a tool line but nothing to fold. */
function HeadLine({ label, detail, live, startedAt }: { label: string; detail?: string; live?: boolean; startedAt?: number }) {
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-muted">
            <span className={clsx(ROW_GUTTER, live && 'text-accent')}>
                <Icon icon={ImageIcon} size={12} />
            </span>
            <span className={clsx('shrink-0', live && 'chat-live-text')}>{label}</span>
            {detail && <span className="min-w-0 truncate text-text-faint">{detail}</span>}
            <span className="grow" />
            {startedAt !== undefined && <RunningFor startedAt={startedAt} />}
        </div>
    );
}

/* The file a saved image became, which opens where the app opens a file link. */
function SavedFile({ path }: { path: string }) {
    const cwd = useFileLinkCwd();
    const { id } = useChatScope();
    const { fileLinks } = useChatHost();
    const openFileLink = useOpenFileLink();
    const chip = (
        <>
            <FileIcon path={path} size={14} />
            <span className="truncate">{path}</span>
        </>
    );
    if (fileLinks === null) {
        return <span className={clsx(CHIP_IN_MESSAGE, MENTION_TONE)}>{chip}</span>;
    }
    return (
        <button
            type="button"
            className={clsx(CHIP_IN_MESSAGE, MENTION_TONE, 'hover:brightness-95')}
            data-file-path={path}
            onClick={() => openFileLink(cwd, { path, directory: false }, id)}
        >
            {chip}
        </button>
    );
}

function ReadyImage({ chatId, attachment, prompt, transparent }: { chatId: string; attachment: ChatAttachment; prompt: string | null; transparent: boolean }) {
    const { t } = useTranslation('agent-chat');
    const { id: scopeId } = useChatScope();
    const { attachments } = useChatHost();
    const source = attachments.useUrl(scopeId, chatId, attachment.id);
    const savedKey = `${scopeId}\n${chatId}\n${attachment.id}`;
    const [lightbox, setLightbox] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedPath, setSavedPath] = useState(() => savedPaths.get(savedKey) ?? null);
    const [savedFlash, flashSaved] = useFlash(SAVED_FLASH_MS);
    const missing = source.failure !== null;
    const aspect = attachmentAspect(attachment);
    const { open, saveToProject } = attachments;

    const detail = [
        attachment.width !== undefined && attachment.height !== undefined
            ? t('generatedImage.dimensions', { width: attachment.width, height: attachment.height })
            : null,
        formatBytes(attachment.size),
        transparent ? t('generatedImage.transparent') : null
    ]
        .filter((part) => part !== null)
        .join(' · ');

    const openFile = open === undefined ? undefined : () => open(scopeId, chatId, attachment.id, attachment.name);

    const save =
        saveToProject === undefined
            ? undefined
            : async (): Promise<void> => {
                  setSaving(true);
                  try {
                      const path = await saveToProject(scopeId, chatId, attachment.id, attachment.name);
                      if (path !== null) {
                          savedPaths.set(savedKey, path);
                          setSavedPath(path);
                          flashSaved();
                      }
                  } catch {
                      // The host's dialog shows why; the row stays as it was.
                  } finally {
                      setSaving(false);
                  }
              };

    const lightboxActions = (
        <>
            {openFile !== undefined && <IconButton icon={ExternalLink} size="sm" label={t('generatedImage.open')} onClick={openFile} />}
            {save !== undefined && <IconButton icon={FolderDown} size="sm" label={t('generatedImage.save')} disabled={saving} onClick={() => void save()} />}
        </>
    );

    return (
        <div>
            <HeadLine label={t('generatedImage.label')} detail={detail} />
            <div className="flex max-w-90 flex-col gap-1.5">
                <div
                    className={clsx(
                        'group/image relative',
                        aspect === undefined && 'w-fit',
                        transparent && source.url !== null && 'chat-checkerboard rounded-lg'
                    )}
                >
                    <ImageThumb
                        source={source}
                        alt={attachment.name}
                        aspect={aspect}
                        className={aspect === undefined ? 'max-h-90 max-w-full object-contain' : undefined}
                        actions={lightboxActions}
                        open={lightbox}
                        onOpenChange={setLightbox}
                    />
                    {source.url !== null && (
                        <Surface
                            role="toolbar"
                            aria-label={t('generatedImage.actions')}
                            className="absolute top-2 right-2 rounded-lg p-0.5 opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
                        >
                            <ButtonGroup>
                                <IconButton icon={Maximize2} size="sm" label={t('generatedImage.openLarge')} onClick={() => setLightbox(true)} />
                                {prompt !== null && (
                                    <Menu.Root>
                                        <IconButton icon={Ellipsis} size="sm" label={t('generatedImage.more')} render={<Menu.Trigger />} />
                                        <Menu.Popup align="end">
                                            <Menu.Item onClick={() => copyText(prompt)}>
                                                <Icon icon={Copy} size={14} /> {t('generatedImage.copyPrompt')}
                                            </Menu.Item>
                                        </Menu.Popup>
                                    </Menu.Root>
                                )}
                            </ButtonGroup>
                        </Surface>
                    )}
                </div>
                {(openFile !== undefined || save !== undefined) && (
                    <div className="flex items-center gap-1.5">
                        {openFile !== undefined && (
                            <Button size="xs" variant="secondary" disabled={missing} onClick={openFile}>
                                {t('generatedImage.open')}
                            </Button>
                        )}
                        {save !== undefined && (
                            <Button size="xs" variant="secondary" disabled={missing || saving || savedFlash} onClick={() => void save()}>
                                {savedFlash ? (
                                    <>
                                        <Icon icon={Check} size={12} /> {t('generatedImage.saved')}
                                    </>
                                ) : (
                                    t('generatedImage.save')
                                )}
                            </Button>
                        )}
                    </div>
                )}
                {savedPath !== null && !savedFlash && (
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                        <Trans t={t} i18nKey="generatedImage.savedTo" values={{ path: savedPath }} components={{ file: <SavedFile path={savedPath} /> }} />
                    </div>
                )}
            </div>
        </div>
    );
}

/*
 * The row of an image generation. Not a fold like other tool calls: the image is the result a person
 * came for, so it stays open, opens large in the lightbox and offers what the host lets a person do
 * with it. A failure is an ordinary failed tool line, with the reason as its detail.
 */
export function GeneratedImageRow({ chatId, tool: derived }: { chatId: string; tool: ChatToolItem }) {
    const { t } = useTranslation('agent-chat');
    const tool = useCurrentItem(chatId, derived);
    const view = generatedImageView(tool);
    switch (view.state) {
        case 'generating':
            return <HeadLine label={t('generatedImage.generating')} live startedAt={toolStartedAt(tool)} />;
        case 'failed':
            return (
                <WorkRow
                    tool={tool}
                    icon={<Icon icon={ImageIcon} size={12} />}
                    label={t('generatedImage.failed')}
                    detail={failureText(view.failure, t) ?? ''}
                    failed
                />
            );
        case 'ready':
            return (
                <ErrorBoundary label={t('generatedImage.renderFailed')} resetKeys={[view.attachment]} compact className="relative rounded-lg">
                    <ReadyImage chatId={chatId} attachment={view.attachment} prompt={view.prompt} transparent={view.transparent} />
                </ErrorBoundary>
            );
    }
}
