import { useState } from 'react';
import { Segmented } from '@adecore/ui';
import type { ChatFileChange } from '@adecore/agent-contracts';
import { DiffPool, EditDiff, UnifiedDiff } from '@adecore/agents-react/chat/ui';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

const PATCH: ChatFileChange = {
    path: 'src/station.ts',
    kind: 'update',
    diff: `@@ -29,4 +29,8 @@ export class Station {
     async refresh(): Promise<void> {
-        this.reading = await fetchJson<Reading>(this.url);
+        try {
+            this.reading = await fetchJson<Reading>(this.url);
+        } catch (error) {
+            console.warn('Kept the last reading', error);
+        }
         this.draw();
     }
`
};

const EDIT = {
    path: 'src/http.ts',
    before: 'const response = await fetch(url);\nif (!response.ok) {\n    throw new Error(response.statusText);\n}',
    after: 'const response = await fetch(url);\nif (!response.ok && attempt === attempts) {\n    throw new Error(response.statusText);\n}'
};

export default function DiffsDemo() {
    const [style, setStyle] = useState<'unified' | 'split'>('unified');

    return (
        <DiffPool workerFactory={() => new DiffWorker()}>
            <div className="flex w-full flex-col gap-4">
                <Segmented<'unified' | 'split'>
                    value={style}
                    label="Layout"
                    options={[
                        { id: 'unified', label: 'Unified' },
                        { id: 'split', label: 'Split' }
                    ]}
                    onValueChange={setStyle}
                />
                <div className="overflow-hidden rounded-lg border border-border">
                    <UnifiedDiff change={PATCH} diffStyle={style} />
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                    <EditDiff change={EDIT} />
                </div>
            </div>
        </DiffPool>
    );
}
