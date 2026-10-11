import type { ReactNode } from 'react';
import { useWorkerPool } from '@pierre/diffs/react';
import { chatHost } from '../../../host';
import DiffPool from '../DiffPool';

export function LegacyDiffPool({ children }: { children: ReactNode }) {
    const outer = useWorkerPool();
    const workerFactory = chatHost().code.legacyDiffWorker;
    if (outer !== undefined || workerFactory === undefined) {
        return children;
    }
    return <DiffPool workerFactory={workerFactory}>{children}</DiffPool>;
}
