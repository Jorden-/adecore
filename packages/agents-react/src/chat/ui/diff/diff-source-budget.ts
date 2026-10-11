interface TextBudget {
    readonly rows: number;
    readonly characters: number;
    readonly lineLength: number;
}

// Diff preparation is synchronous; cap source work before creating lines or hunks.
const SOURCE_BUDGET: TextBudget = { rows: 20000, characters: 2000000, lineLength: 1000000 };
const PATCH_BUDGET: TextBudget = { rows: 50000, characters: 4000000, lineLength: 1000001 };
const LEGACY_BUDGET: TextBudget = { rows: 400, characters: 100000, lineLength: 10000 };

export function textFitsBudget(text: string, budget: TextBudget): boolean {
    if (text.length > budget.characters) {
        return false;
    }
    let rows = text.length === 0 ? 0 : 1;
    let length = 0;
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) === 10) {
            if (index < text.length - 1 && ++rows > budget.rows) {
                return false;
            }
            length = 0;
        } else if (++length > budget.lineLength) {
            return false;
        }
    }
    return rows <= budget.rows;
}

export function diffSourceBudget(before: string, after: string): boolean {
    return textFitsBudget(before, SOURCE_BUDGET) && textFitsBudget(after, SOURCE_BUDGET);
}

export function patchSourceBudget(patch: string): boolean {
    return textFitsBudget(patch, PATCH_BUDGET);
}

export function legacyDiffBudget(before: string, after: string, patch = ''): boolean {
    // Combined sources and patch must fit one small legacy render, including trailing blank lines.
    if (before.length + after.length + patch.length > LEGACY_BUDGET.characters) {
        return false;
    }
    let rows = 2;
    for (const text of [before, after, patch]) {
        if (!textFitsBudget(text, LEGACY_BUDGET)) {
            return false;
        }
        for (let index = 0; index < text.length; index++) {
            if (text.charCodeAt(index) === 10 && ++rows > LEGACY_BUDGET.rows) {
                return false;
            }
        }
    }
    return true;
}
