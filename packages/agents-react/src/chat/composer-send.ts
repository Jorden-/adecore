/* `alternate` sends with the delivery a running turn does not get by default; `and-new` also opens a new chat once it went. */
export type ComposerSend = 'default' | 'alternate' | 'and-new';

/*
 * A command outside the composer, such as a menu row, sends what a composer on screen holds the way its
 * keys do. Keyed with the scope's `keyOf`, the way the app's shortcuts name the chat that has the focus.
 */
const senders = new Map<string, (how: ComposerSend) => void>();

export function registerComposerSender(key: string, send: (how: ComposerSend) => void): () => void {
    senders.set(key, send);
    return () => {
        if (senders.get(key) === send) {
            senders.delete(key);
        }
    };
}

/* False when that chat has no composer on screen. An empty or unsendable draft sends nothing, as with the keys. */
export function sendFromComposer(key: string, how: ComposerSend = 'default'): boolean {
    const send = senders.get(key);
    if (send === undefined) {
        return false;
    }
    send(how);
    return true;
}
