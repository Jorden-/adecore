import { Play } from 'lucide-react';
import { Button, Icon } from '@adecore/ui';

export default function ButtonPill() {
    return (
        <div className="flex h-9 items-center rounded-full bg-surface-hover">
            <Button variant="primary" shape="pill">
                <Icon icon={Play} size={14} />
                Continue
            </Button>
        </div>
    );
}
