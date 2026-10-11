import { diffRows, type DiffDocument } from '@adecore/merge';

// Larger rendering tiers need native production measurements before this gate expands.
export const EDITOR_DIFF_WORK = 4_000_000;
export const EDITOR_DIFF_LIMITS = { rows: 2000, characters: 2000000, lineLength: 10000 };

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
