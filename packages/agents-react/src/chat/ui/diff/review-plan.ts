import type { ChatFileChange } from '@adecore/agent-contracts';
import type { FileChange } from '../../logic/tools';
import type { DiffContents } from '../full-diff';

export interface ReviewEntry {
    readonly key: string;
    readonly path: string;
    readonly change:
        | { readonly kind: 'edit'; readonly edit: FileChange }
        | { readonly kind: 'patch'; readonly patch: ChatFileChange; readonly contents?: DiffContents };
}

export interface ReviewBudget {
    readonly editors: number;
    readonly rows: number;
    readonly characters: number;
}

export const REVIEW_BUDGET: ReviewBudget = { editors: 3, rows: 2000, characters: 2000000 };
export type ReviewSlot = 'editor' | 'deferred';

export function reviewEntries(patches: readonly ChatFileChange[], edits: readonly FileChange[]): readonly ReviewEntry[] {
    return [
        ...patches.map((patch, index): ReviewEntry => ({ key: `patch:${index}:${patch.path}`, path: patch.path, change: { kind: 'patch', patch } })),
        ...edits.map((edit, index): ReviewEntry => ({ key: `edit:${index}:${edit.path}`, path: edit.path, change: { kind: 'edit', edit } }))
    ];
}

export function reviewSize(entry: ReviewEntry, budget: ReviewBudget = REVIEW_BUDGET): { rows: number; characters: number } {
    const texts = entry.change.kind === 'edit' ? [entry.change.edit.before, entry.change.edit.after] : [entry.change.patch.diff];
    const characters = texts.reduce((sum, text) => sum + text.length, 0);
    if (characters > budget.characters) {
        return { rows: budget.rows + 1, characters };
    }
    let rows = 0;
    for (const text of texts) {
        if (text.length > 0) {
            rows++;
        }
        for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) {
            if (++rows > budget.rows) {
                return { rows, characters };
            }
        }
    }
    return { rows, characters };
}

export function planReview(entries: readonly ReviewEntry[], promoted: string | null, budget: ReviewBudget = REVIEW_BUDGET): ReadonlyMap<string, ReviewSlot> {
    const priority = entries.find((entry) => entry.key === promoted);
    const ordered = priority === undefined ? entries : [priority, ...entries.filter((entry) => entry !== priority)];
    const slots = new Map<string, ReviewSlot>();
    let editors = 0;
    let rows = 0;
    let characters = 0;
    for (const entry of ordered) {
        const size = reviewSize(entry, budget);
        // The first review keeps its own omission and error handling, even when the group estimate exceeds the budget.
        if (editors === 0 || (editors < budget.editors && rows + size.rows <= budget.rows && characters + size.characters <= budget.characters)) {
            slots.set(entry.key, 'editor');
            editors++;
            rows += size.rows;
            characters += size.characters;
        } else {
            slots.set(entry.key, 'deferred');
        }
    }
    return slots;
}
