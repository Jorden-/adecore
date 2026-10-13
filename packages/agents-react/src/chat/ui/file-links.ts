import { createContext, useContext, useMemo } from 'react';
import { useChatHost, type FileRef } from '../../host';
import { ChatScopeContext } from '../../scope';

/*
 * The folder a relative reference in rendered text counts from: a chat's own cwd, which is a
 * worktree as often as it is the project, or the folder of the file an app is drawing. Null where
 * nobody said, and there only an absolute path is a link.
 */
export const FileLinkContext = createContext<string | null>(null);

export function useFileLinkCwd(): string | null {
    return useContext(FileLinkContext);
}

export function useFileLinkScopeId(): string | null {
    return useContext(ChatScopeContext)?.id ?? null;
}

/* The reference a piece of text names, only where this spot on screen could open it. */
export function useFileLinkTarget(text: string): FileRef | null {
    const cwd = useFileLinkCwd();
    const scopeId = useFileLinkScopeId();
    const { fileLinks } = useChatHost();
    return useMemo(() => fileLinks?.target(text, cwd, scopeId) ?? null, [fileLinks, text, cwd, scopeId]);
}

/* Follows a reference the way the app opens a file or a folder. */
export function useOpenFileLink(): (cwd: string | null, ref: FileRef, scopeId?: string | null) => void {
    const { fileLinks } = useChatHost();
    return (cwd, ref, scopeId = null) => fileLinks?.open(cwd, ref, scopeId);
}
