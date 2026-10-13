import type { EditorLanguage } from './editor-language.ts';
import { KEY_PRIORITY } from './key-priority.ts';
import type { Place } from './navigation-history.ts';
import { isShortcut } from './shortcut-keys.ts';

/* Back, Forward and the list of recent locations over the history the whole project shares. */
export class HistoryFeature {
    private readonly language: EditorLanguage;

    constructor(language: EditorLanguage) {
        this.language = language;
        const off = language.onKey((event) => {
            if (isShortcut(this.language.shortcuts.historyBack, event)) {
                this.back();
                return true;
            }
            if (isShortcut(this.language.shortcuts.historyForward, event)) {
                this.forward();
                return true;
            }
            if (isShortcut(this.language.shortcuts.recentLocations, event)) {
                this.recent();
                return true;
            }
            return false;
        }, KEY_PRIORITY.history);
        language.onDispose(off);
    }

    /* Returns to where the caret was before the last jump; false when there is no such place. */
    back(): boolean {
        return this.visit(this.language.project.history.back(this.language.place));
    }

    forward(): boolean {
        return this.visit(this.language.project.history.forward(this.language.place));
    }

    /* Lists the places of the history under the caret; choosing one jumps there like any other jump. */
    recent(): void {
        const places = this.language.project.history.recent(this.language.place);
        this.language.locations(
            places.map((place) => ({ uri: place.uri, range: { start: place.position, end: place.position } })),
            this.language.editor.getCaret(),
            this.language.project.i18n.t('editor:language.history.recent')
        );
    }

    private visit(place: Place | null): boolean {
        if (place === null) {
            return false;
        }
        this.language.visit(place);
        return true;
    }
}
