import { createContext, useContext, useEffect } from 'react';

export const ReviewSettleContext = createContext<{ readonly key: string; settle(key: string): void } | null>(null);

export function useReviewSettled(): void {
    const scope = useContext(ReviewSettleContext);
    const key = scope?.key;
    const settle = scope?.settle;
    useEffect(() => {
        if (key !== undefined) {
            settle?.(key);
        }
    }, [key, settle]);
}
