import { FileIcon, MiddleTruncate } from '@adecore/ui';

const PATHS = ['packages/ui/src/settings/SettingsDialog.tsx', 'apps/client/src/shell/settings/panes/AppearancePane.tsx', 'docs/ui/display/middle-truncate.md'];

export default function MiddleTruncateDemo() {
    return (
        <div className="flex w-full max-w-60 resize-x flex-col gap-1 overflow-hidden rounded-md border border-border p-2 text-sm">
            {PATHS.map((path) => (
                <div key={path} className="flex items-center gap-2">
                    <FileIcon path={path} size={16} />
                    <MiddleTruncate text={path} className="font-mono text-text-muted" />
                </div>
            ))}
            <div className="flex items-center gap-2">
                <span className="shrink-0 text-text-faint">Branch</span>
                <MiddleTruncate text="feature/remember-the-width-of-a-reading-column" />
            </div>
        </div>
    );
}
