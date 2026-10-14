import { useCallback, useEffect, useState } from 'react';

const NOTICE_MS = 4000;

/* An error is what went wrong; info is something the composer did that the person should know. */
export type NoticeTone = 'error' | 'info';

export interface ComposerNotice {
    notice: string | null;
    tone: NoticeTone;
    setNotice(notice: string | null, tone?: NoticeTone): void;
    showError(error: unknown): void;
}

/* A line under the box that says what went wrong, gone again after a few seconds. */
export function useNotice(): ComposerNotice {
    const [shown, setShown] = useState<{ text: string; tone: NoticeTone } | null>(null);

    useEffect(() => {
        if (!shown) {
            return;
        }
        const timer = setTimeout(() => setShown(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [shown]);

    const setNotice = useCallback((notice: string | null, tone: NoticeTone = 'error'): void => setShown(notice ? { text: notice, tone } : null), []);

    return {
        notice: shown?.text ?? null,
        tone: shown?.tone ?? 'error',
        setNotice,
        showError: (error) => setNotice(error instanceof Error ? error.message : String(error))
    };
}
