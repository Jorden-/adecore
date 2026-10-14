import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { AGENTS_LOCALES } from '../packages/agents-react/src/locales.ts';
import ui from '../packages/ui/src/locales/en.ts';

// A demo imports a Web Worker the way Vite bundles one; a test renders it without ever starting the worker.
Bun.plugin({
    name: 'vite-worker',
    setup(build) {
        build.onResolve({ filter: /\?worker$/ }, (args) => ({ path: args.path, namespace: 'vite-worker' }));
        build.onLoad({ filter: /.*/, namespace: 'vite-worker' }, () => ({ contents: 'export default class {}', loader: 'js' }));
    }
});

const resources: Record<string, object> = { ui, ...(await AGENTS_LOCALES.en!()) };

// Pure label helpers share the same initialized English instance as React render tests.
await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'ui',
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: { en: resources }
});
