import { useEffect, useMemo, useState } from 'react';
import { planReview, type ReviewEntry, type ReviewSlot } from './review-plan';

export interface ReviewStack {
    readonly slots: ReadonlyMap<string, ReviewSlot>;
    readonly ready: ReadonlySet<string>;
    promote(key: string): void;
}

export function useReviewStack(entries: readonly ReviewEntry[]): ReviewStack {
    const [promoted, setPromoted] = useState<string | null>(null);
    const slots = useMemo(() => planReview(entries, promoted), [entries, promoted]);
    const selected = [...slots].filter(([, slot]) => slot === 'editor').map(([key]) => key);
    const [admitted, setAdmitted] = useState<string[]>(() => selected.slice(0, 1));
    const retained = admitted.filter((key) => selected.includes(key));
    const live = retained.length === 0 ? selected.slice(0, 1) : retained;
    if (live.length !== admitted.length || live.some((key, index) => key !== admitted[index])) {
        setAdmitted(live);
    }
    const next = selected.find((key) => !live.includes(key));
    useEffect(() => {
        if (next === undefined) {
            return;
        }
        const frame = window.requestAnimationFrame(() => setAdmitted((previous) => [...previous, next]));
        return () => window.cancelAnimationFrame(frame);
    }, [next]);
    return { slots, ready: new Set(live), promote: setPromoted };
}
