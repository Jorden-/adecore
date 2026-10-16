import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { i18n as I18n } from 'i18next';
import { addDatabaseResources } from './locales.ts';

/* Adds the package's words to the i18next the app's `UIProvider` was given. In render, as `UIProvider` does, so the first view already reads them. */
export function useDatabaseResources(): void {
    const { i18n } = useTranslation();
    const [added, setAdded] = useState<I18n | null>(null);
    if (added !== i18n) {
        addDatabaseResources(i18n);
        setAdded(i18n);
    }
}
