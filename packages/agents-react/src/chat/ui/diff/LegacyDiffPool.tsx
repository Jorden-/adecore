import type { ReactNode } from 'react';
import { useWorkerPool } from '@pierre/diffs/react';
import { useChatHost } from '../../../host';
import DiffPool from '../DiffPool';

export function LegacyDiffPool({ children }: { children: ReactNode }) {
    const host = useChatHost();
    const outer = useWorkerPool();
    const workerFactory = host.code.legacyDiffWorker;
    if (outer !== undefined || workerFactory === undefined) {
        return children;
    }
    return <DiffPool workerFactory={workerFactory}>{children}</DiffPool>;
}
