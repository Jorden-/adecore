import { useEffect, useState } from 'react';

const NOTICE_MS = 4000;

export interface ComposerNotice {
    notice: string | null;
    setNotice(notice: string | null): void;
    showError(error: unknown): void;
}

/* A line under the box that says what went wrong, gone again after a few seconds. */
export function useNotice(): ComposerNotice {
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        if (!notice) {
            return;
        }
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    return {
        notice,
        setNotice,
        showError: (error) => setNotice(error instanceof Error ? error.message : String(error))
    };
}
