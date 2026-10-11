import { diffRows, type DiffDocument } from '@adecore/merge';

/* Keep the rollout below the displayed sizes that still need native input and scroll measurements. */
export const EDITOR_DIFF_LIMITS = { rows: 400, characters: 100000, lineLength: 10000 };

export function canRenderEditorDiff(document: DiffDocument): boolean {
    let rows = 0;
    let characters = 0;
    for (const row of diffRows(document, 'unified')) {
        if (row.kind === 'gap') {
            continue;
        }
        const text = row.new === undefined ? document.sides.old[row.old!.index]! : document.sides.new[row.new.index]!;
        characters += text.length + (rows > 0 ? 1 : 0);
        if (++rows > EDITOR_DIFF_LIMITS.rows || characters > EDITOR_DIFF_LIMITS.characters || text.length > EDITOR_DIFF_LIMITS.lineLength) {
            return false;
        }
    }
    return true;
}
