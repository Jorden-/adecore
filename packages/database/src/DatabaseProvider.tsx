import { use, useMemo, type ReactNode } from 'react';
import type { DatabaseAction, DatabaseFiles, DatabaseNotice, DatabaseStorage } from './actions.ts';
import type { DatabaseClient } from './client/types.ts';
import { DatabaseContext } from './client-context.ts';
import type { NumberNotation } from './grid/display.ts';
import { useDatabaseResources } from './use-database-resources.ts';

export interface DatabaseProviderProps {
    /* Required on the outermost provider. A provider inside another takes every prop it leaves out from the one above. */
    client?: DatabaseClient;
    /* Where a table, a console or the designer a view asks for opens. Without it the views offer none of those. */
    onAction?(action: DatabaseAction): void;
    /* Where a view's passing news goes, such as an export that finished. Without it each view shows its own above its content. */
    onNotice?(notice: DatabaseNotice): void;
    storage?: DatabaseStorage;
    files?: DatabaseFiles;
    /*
     * How cells show integers, decimals and floats. `'database'` draws them as the server wrote them, which is what a
     * database tool is read for; `'region'` draws them in the number format of `@adecore/ui`'s format source.
     * Editing, copying, filters, export and everything sent to the server keep the server's text either way.
     */
    numberNotation?: NumberNotation;
    children: ReactNode;
}

/* Hands every view below it the client and the app's hooks, and adds the package's words to the i18next the app's `UIProvider` was given. Mount it inside that provider. */
export function DatabaseProvider({ client, onAction, onNotice, storage, files, numberNotation, children }: DatabaseProviderProps) {
    useDatabaseResources();
    const outer = use(DatabaseContext);

    const ownClient = client ?? outer?.client;
    const ownAction = onAction ?? outer?.onAction;
    const ownNotice = onNotice ?? outer?.onNotice;
    const ownStorage = storage ?? outer?.storage;
    const ownFiles = files ?? outer?.files;
    const ownNotation = numberNotation ?? outer?.numberNotation ?? 'database';
    const value = useMemo(
        () =>
            ownClient === undefined
                ? null
                : { client: ownClient, onAction: ownAction, onNotice: ownNotice, storage: ownStorage, files: ownFiles, numberNotation: ownNotation },
        [ownClient, ownAction, ownNotice, ownStorage, ownFiles, ownNotation]
    );
    if (value === null) {
        throw new Error('A DatabaseProvider needs a client, or a DatabaseProvider above it to take one from.');
    }

    return <DatabaseContext value={value}>{children}</DatabaseContext>;
}
