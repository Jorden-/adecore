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
    const signature = JSON.stringify(selected);
    const [mounted, setMounted] = useState({ signature, count: 1 });
    const count = mounted.signature === signature ? Math.min(mounted.count, selected.length) : Math.min(1, selected.length);
    if (mounted.signature !== signature) {
        setMounted({ signature, count: Math.min(1, selected.length) });
    }
    useEffect(() => {
        if (count >= selected.length) {
            return;
        }
        const frame = window.requestAnimationFrame(() => setMounted({ signature, count: count + 1 }));
        return () => window.cancelAnimationFrame(frame);
    }, [signature, count, selected.length]);
    return { slots, ready: new Set(selected.slice(0, count)), promote: setPromoted };
}
