import type { WorkerRequestPort } from '@adecore/editor/worker-client';
import type { EditorPosition, EditorRange } from '@adecore/editor';
import type { i18n } from 'i18next';
import type { Keymap } from '@adecore/editor/keymap';
import type { ProjectFiles } from './workspace-edit.ts';
import type { Place } from './navigation-history.ts';
import type { ProblemSource } from './project-problems.ts';

export interface DiskText {
    text: string;
    mtime: number;
}

export interface GitBlameCommit {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    at: number;
    summary: string;
}

export interface GitBlameResult {
    commits: GitBlameCommit[];
    lines: number[];
    omitted?: 'untracked' | 'too-large';
}

export interface EditorNotification {
    id: string;
    kind: 'success' | 'error';
    title: string;
}

export interface RenameSuggestionsRequest {
    uri: string;
    languageId: string;
    name: string;
    context: string;
    uses: readonly string[];
}

export interface SnippetVariableContext {
    readonly uri: string;
    readonly languageId: string;
    readonly position: EditorPosition;
    readonly selection: EditorRange;
    readonly selectedText: string;
    readonly currentLine: string;
    readonly currentWord: string;
    readonly cursorIndex: number;
    readonly cursorCount: number;
    readonly folder?: string;
    readonly path?: string;
}

export interface LanguageHost {
    readonly snippetTransformWorker?: () => WorkerRequestPort;
    /* The instance the app hands `UIProvider`, which the features read their words from too; the default instance without one. */
    readonly i18n?: i18n;
    readonly folder?: string;
    readonly files?: ProjectFiles;
    readonly apple?: boolean;
    readonly keymap?: Keymap;
    /* The height in pixels of the list-and-preview area of the peek and the call hierarchy, so a person's drag outlives the panel; 180 without one. */
    readonly panelBodyHeight?: number;
    /* A person finished resizing a peek or call hierarchy panel; the height is already within what the editor allows. */
    onPanelResize?(height: number): void;
    /* Where `project.problems` reads its reports, such as a machine that also reports files no editor here holds; the service's diagnostics without one. */
    readonly problemSource?: ProblemSource;
    openPlace?(place: Place): void;
    pathOfUri?(uri: string): string | null;
    serverNames?(uri: string): readonly string[];
    notify?(notification: EditorNotification): void;
    /* Synchronous overrides; undefined delegates to built-ins or an editable unknown-variable placeholder. */
    resolveSnippetVariable?(name: string, context: SnippetVariableContext): string | undefined;
    suggestNames?(request: RenameSuggestionsRequest, signal: AbortSignal): Promise<readonly string[]>;
}
