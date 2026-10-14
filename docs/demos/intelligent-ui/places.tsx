import { useState } from 'react';
import { DemoBlock } from '../shared/intelligent-ui.tsx';
import { bound, ui } from '../shared/intelligent-ui-tree.ts';

export default function PlacesDemo() {
    const [picked, setPicked] = useState<unknown>('');
    return (
        <DemoBlock
            nodes={[
                bound(
                    ui(
                        'Map',
                        {},
                        ui('Place', { lat: 52.0907, lon: 5.1214, value: 'dom', detail: 'Climb the tower' }, 'Domtoren'),
                        ui('Place', { address: 'Oudegracht 245, Utrecht', value: 'gracht' }, 'Oudegracht'),
                        ui('Place', { lat: 52.0894, lon: 5.1103, value: 'station' }, 'Station')
                    ),
                    picked,
                    setPicked
                )
            ]}
            context={{ place: (nodeId) => (nodeId.endsWith('.1') ? { lat: 52.0849, lon: 5.1181 } : undefined) }}
        />
    );
}
