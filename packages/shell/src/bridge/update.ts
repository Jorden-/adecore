/* Why updating failed, for the page to put in its own words: `no-feed` is a 404 on the release feed, which has no published release yet or is private. */
export type UpdateErrorCode = 'no-feed' | 'failed';

/* Where updating stands, as the shell keeps it and the page draws it. */
export interface UpdateState {
    /* `unsupported` is a checkout, which has no feed; `current` means a check found nothing newer. */
    status: 'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
    currentVersion: string;
    /* The version on the other side, once a check has seen one. */
    version?: string;
    percent?: number;
    /* The first line of what went wrong, as electron-updater said it, in English and untranslated; null when it said nothing. */
    error?: string | null;
    errorCode?: UpdateErrorCode | null;
}
