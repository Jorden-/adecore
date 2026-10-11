import type { FileChange } from '../../logic/tools';

/* Keep the first rollout below the sizes that still need native input and scroll measurements. */
export function canRenderEditorEdit(change: FileChange): boolean {
    return change.before.length + change.after.length <= 100000 && change.before.split('\n').length + change.after.split('\n').length <= 400;
}
