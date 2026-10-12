import { globMatch } from './glob.ts';
import type { FileCreate, FileDelete, FileOperationFilter, FileRename } from './protocol.ts';

/* A file or folder that moves, which says what it is since a filter may take only one of the two. */
export interface RenamedFile extends FileRename {
    directory: boolean;
}

/* A file or folder that is made. */
export interface CreatedFile extends FileCreate {
    directory: boolean;
}

/* A file or folder that is deleted. */
export interface DeletedFile extends FileDelete {
    directory: boolean;
}

function filterTakes(filter: FileOperationFilter, uri: string, directory: boolean): boolean {
    const { matches, glob, options } = filter.pattern;
    if (matches !== undefined && (matches === 'folder') !== directory) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return false;
    }
    if (filter.scheme !== undefined && filter.scheme !== url.protocol.slice(0, -1)) {
        return false;
    }
    const path = decodeURIComponent(url.pathname);
    return options?.ignoreCase === true ? globMatch(path.toLowerCase(), glob.toLowerCase()) : globMatch(path, glob);
}

/* The renames a server asked to hear about, by the filters it registered. A rename is matched on the place it leaves. */
export function renamesTaken(filters: readonly FileOperationFilter[], files: readonly RenamedFile[]): FileRename[] {
    return files.filter((file) => filters.some((filter) => filterTakes(filter, file.oldUri, file.directory))).map(({ oldUri, newUri }) => ({ oldUri, newUri }));
}

/* The files made that a server asked to hear about, by the filters it registered. */
export function createsTaken(filters: readonly FileOperationFilter[], files: readonly CreatedFile[]): FileCreate[] {
    return files.filter((file) => filters.some((filter) => filterTakes(filter, file.uri, file.directory))).map(({ uri }) => ({ uri }));
}

/* The files deleted that a server asked to hear about, by the filters it registered. A folder is matched as one, not by what was in it. */
export function deletesTaken(filters: readonly FileOperationFilter[], files: readonly DeletedFile[]): FileDelete[] {
    return files.filter((file) => filters.some((filter) => filterTakes(filter, file.uri, file.directory))).map(({ uri }) => ({ uri }));
}
