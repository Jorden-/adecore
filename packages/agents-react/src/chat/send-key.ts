import i18next from 'i18next';
import { KEY_SHORTCUTS, type Shortcut } from '@adecore/ui';

/*
 * Which key sends a message: Enter, Enter until the message runs over more than one line and Mod+Enter
 * after that, or Mod+Enter always. Where Enter does not send, it adds a line.
 */
export type ChatSendKey = 'enter' | 'mod-enter-multiline' | 'mod-enter';

export const CHAT_SEND_KEYS: readonly ChatSendKey[] = ['enter', 'mod-enter-multiline', 'mod-enter'];

export const DEFAULT_SEND_KEY: ChatSendKey = 'enter';

export function isChatSendKey(value: unknown): value is ChatSendKey {
    return typeof value === 'string' && (CHAT_SEND_KEYS as readonly string[]).includes(value);
}

/* Whether Enter alone adds a line to a message, so only Mod+Enter sends it. */
export function modSends(sendKey: ChatSendKey, multiline: boolean): boolean {
    return sendKey === 'mod-enter' || (sendKey === 'mod-enter-multiline' && multiline);
}

/* The key that sends a message, as a hint prints it. */
export function sendShortcut(sendKey: ChatSendKey, multiline: boolean): Shortcut {
    return modSends(sendKey, multiline) ? KEY_SHORTCUTS.modEnter : KEY_SHORTCUTS.enter;
}

/* `apple` writes Mod as the Command sign, and as Ctrl elsewhere. */
export function sendKeyLabel(sendKey: ChatSendKey, apple: boolean): string {
    return i18next.t(`agent-chat:sendKey.${sendKey}.label`, { mod: apple ? '⌘' : 'Ctrl' });
}

export function sendKeyHint(sendKey: ChatSendKey, apple: boolean): string {
    return i18next.t(`agent-chat:sendKey.${sendKey}.hint`, { mod: apple ? '⌘' : 'Ctrl' });
}
