import { useTranslation } from 'react-i18next';
import { Ellipsis, Maximize2, Trash2 } from 'lucide-react';
import type { ChatVisual } from '@adecore/agent-contracts';
import { ButtonGroup, ErrorBoundary, Icon, IconButton, Menu, Surface } from '@adecore/ui';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { useVisualDialog } from '../../visuals';
import { VisualFrame } from '../VisualFrame';

/*
 * A page an agent published, borderless on the thread's ground, with its width set by the row. Its few
 * controls float over the page's top corner while the pointer or the focus is on it, and always on a
 * touch screen, which has no hover. A click inside the page never reaches the thread's menu, so they
 * sit here.
 */
export function VisualRow({ chatId, visual }: { chatId: string; visual: ChatVisual }) {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    const { keyOf } = useChatScope();
    if (host.visuals === null) {
        return null;
    }
    const open = (kind: 'expand' | 'remove'): void => useVisualDialog.getState().open(keyOf(chatId), visual.id, kind);
    return (
        <ErrorBoundary label={t('visuals.renderFailed')} resetKeys={[visual]} compact className="relative rounded-lg">
            <div className="group/visual relative">
                <VisualFrame chatId={chatId} visual={visual} />
                <Surface
                    role="toolbar"
                    aria-label={t('visuals.actions', { title: visual.title })}
                    className="absolute top-2 right-2 rounded-lg p-0.5 opacity-0 transition-opacity group-focus-within/visual:opacity-100 group-hover/visual:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
                >
                    <ButtonGroup>
                        <IconButton icon={Maximize2} size="sm" label={t('visuals.expand')} onClick={() => open('expand')} />
                        <Menu.Root>
                            <IconButton icon={Ellipsis} size="sm" label={t('visuals.more')} render={<Menu.Trigger />} />
                            <Menu.Popup align="end">
                                <Menu.Item onClick={() => open('remove')}>
                                    <Icon icon={Trash2} size={14} /> {t('visuals.remove')}
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Root>
                    </ButtonGroup>
                </Surface>
            </div>
        </ErrorBoundary>
    );
}
