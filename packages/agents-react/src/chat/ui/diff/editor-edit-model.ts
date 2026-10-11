import type { FileChange } from '../../logic/tools';

/* Keep the first rollout below the sizes that still need native input and scroll measurements. */
export function canRenderEditorEdit(change: Pick<FileChange, 'before' | 'after'>): boolean {
    if (change.before.length + change.after.length > 100000) {
        return false;
    }
    let lines = 2;
    for (const text of [change.before, change.after]) {
        let length = 0;
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                lines++;
                length = 0;
                if (lines > 400) {
                    return false;
                }
            } else if (++length > 10000) {
                return false;
            }
        }
    }
    return true;
}
