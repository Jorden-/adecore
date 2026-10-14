import type { i18n as I18n } from 'i18next';
/* The words are modules, not JSON: Node needs `with { type: 'json' }` on a JSON import, and a browser refuses it on the JavaScript Vite serves. */
import en from './locales/en.ts';
import nl from './locales/nl.ts';

/* The words of this library live in a namespace of their own, which the app adds to its i18next beside its own namespaces. */
export const UI_NAMESPACE = 'ui';

/*
 * Every language the library speaks, by language code. Small enough to ship whole, which is what lets
 * `addUiResources` run synchronously before the first render, so no word ever shows as its key.
 */
export const UI_RESOURCES: Readonly<Record<string, Record<string, unknown>>> = { en, nl };

/* Adds the `ui` namespace in every language to an i18next instance. A language the app already filled keeps its words. */
export const addUiResources = (i18n: I18n): void => {
    for (const [language, words] of Object.entries(UI_RESOURCES)) {
        if (!i18n.hasResourceBundle(language, UI_NAMESPACE)) {
            i18n.addResourceBundle(language, UI_NAMESPACE, words, true, false);
        }
    }
};
