import { useState } from 'react';
import { Database, FileCode, House } from 'lucide-react';
import { Icon, Tabs } from '@adecore/ui';

interface Page {
    readonly id: string;
    readonly name: string;
    readonly pinned: boolean;
}

export default function TabsPinnedDemo() {
    const [pages, setPages] = useState<readonly Page[]>([
        { id: 'home', name: 'Home', pinned: true },
        { id: 'schema', name: 'Schema', pinned: true },
        { id: 'orders', name: 'orders.sql', pinned: false },
        { id: 'customers', name: 'customers.sql', pinned: false }
    ]);
    const [picked, setPicked] = useState('orders');

    function close(id: string): void {
        const rest = pages.filter((page) => page.id !== id);
        setPages(rest);
        if (picked === id) {
            setPicked(rest.at(-1)?.id ?? 'home');
        }
    }

    return (
        <Tabs.Root value={picked} onValueChange={(value) => setPicked(String(value))} className="w-full max-w-md">
            <Tabs.List aria-label="Pages" variant="pill">
                {pages.map((page) =>
                    page.pinned ? (
                        <Tabs.Tab key={page.id} value={page.id} pinned aria-label={page.name}>
                            <Icon icon={page.id === 'home' ? House : Database} size={16} />
                        </Tabs.Tab>
                    ) : (
                        <Tabs.Tab key={page.id} value={page.id} onClose={() => close(page.id)}>
                            <Icon icon={FileCode} size={14} /> {page.name}
                        </Tabs.Tab>
                    )
                )}
            </Tabs.List>
        </Tabs.Root>
    );
}
