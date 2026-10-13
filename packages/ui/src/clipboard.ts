/*
 * The clipboard, as the app uses it. A browser hands text over only to a document that is focused
 * and allowed, and there is nothing a person can do about a refusal, so both sides stay quiet.
 */

/* Resolves to whether the text got there, for a caller that tells the person; it never rejects. */
export const copyText = async (text: string): Promise<boolean> => {
    try {
        if (!navigator.clipboard) {
            return false;
        }
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

/* What is on the clipboard, or nothing at all when the browser will not say. */
export const readClipboardText = async (): Promise<string> => {
    try {
        return (await navigator.clipboard?.readText()) ?? '';
    } catch {
        return '';
    }
};
