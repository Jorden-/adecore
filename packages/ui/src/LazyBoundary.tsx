import { Suspense, useSyncExternalStore, type ReactNode } from 'react';
import { readLandings, subscribeLandings } from './lazy-landings.ts';

export interface LazyBoundaryProps {
    readonly fallback?: ReactNode;
    readonly children?: ReactNode;
}

/*
 * `Suspense` for what `lazyNamed` loads. React holds content that comes in as a retry back until
 * 300 ms after its fallback showed; this boundary draws again as an ordinary update once a module
 * lands, so a chunk that takes 20 ms shows after 20 ms.
 */
export function LazyBoundary({ fallback = null, children }: LazyBoundaryProps) {
    useSyncExternalStore(subscribeLandings, readLandings, readLandings);
    return <Suspense fallback={fallback}>{children}</Suspense>;
}
