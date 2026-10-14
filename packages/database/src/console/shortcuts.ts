import { matchesShortcut, shortcut, type KeyLike } from '@adecore/ui';
import type { QueryConsoleRunScope } from './editor-slot.ts';

/* The keys the toolbar's tooltips name, which an editor binds to its two runs. */
export const RUN_SHORTCUT = /* @__PURE__ */ shortcut('Mod+Enter');
export const RUN_ALL_SHORTCUT = /* @__PURE__ */ shortcut('Mod+Shift+Enter');

/* The run a key event asks for, or null when it is neither run key. `apple` is the one `matchesShortcut` takes. */
export const runScopeOf = (event: KeyLike, apple: boolean): QueryConsoleRunScope | null => {
    if (matchesShortcut(RUN_ALL_SHORTCUT, event, apple)) {
        return 'all';
    }
    if (matchesShortcut(RUN_SHORTCUT, event, apple)) {
        return 'selection-or-statement';
    }
    return null;
};
