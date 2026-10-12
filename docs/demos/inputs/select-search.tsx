import { useState } from 'react';
import { Select } from '@adecore/ui';

const LABELS = [
    'Bug',
    'Docs',
    'Deps: JavaScript',
    'Deps: PHP',
    'Deps: Rust',
    'Design',
    'Enhancement',
    'Good first issue',
    'Help wanted',
    'Performance',
    'Question',
    'Security',
    'Tests',
    'Wontfix'
];

export default function SelectSearchDemo() {
    const [label, setLabel] = useState<string | null>(null);

    return (
        <Select
            label="Label"
            placeholder="All labels"
            value={label}
            onValueChange={setLabel}
            searchable={10}
            searchPlaceholder="Find a label"
            items={LABELS.map((entry) => ({ value: entry, label: entry }))}
        />
    );
}
