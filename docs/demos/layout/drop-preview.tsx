import { useRef, useState, type PointerEvent } from 'react';
import { DropPreview, rectDropPreview, tabDropPreview, tabGapAt, type DropPreviewShape } from '@adecore/ui';

const BAR_HEIGHT = 36;
const TAB_WIDTH = 96;
const TABS = ['index.ts', 'theme.css', 'README.md'];

export default function DropPreviewDemo() {
    const box = useRef<HTMLDivElement>(null);
    const strip = useRef<HTMLDivElement>(null);
    const [shape, setShape] = useState<DropPreviewShape | null>(null);

    const follow = (event: PointerEvent<HTMLDivElement>): void => {
        const bounds = box.current!.getBoundingClientRect();
        const width = Math.round(bounds.width);
        const height = Math.round(bounds.height);
        const y = event.clientY - bounds.top;
        if (y < BAR_HEIGHT) {
            const rects = Array.from(strip.current!.children, (tab) => tab.getBoundingClientRect());
            const gap = tabGapAt(rects, event.clientX);
            const left = (rects[gap]?.left ?? rects.at(-1)!.right) - bounds.left;
            setShape(
                tabDropPreview(
                    { gap, left: Math.round(Math.min(left, width - TAB_WIDTH)), tabWidth: TAB_WIDTH, width, height, barHeight: BAR_HEIGHT },
                    { x: 0, y: 0 }
                )
            );
            return;
        }
        const half = Math.round(width / 2);
        const right = event.clientX - bounds.left > half;
        setShape(rectDropPreview({ x: right ? half : 0, y: BAR_HEIGHT, width: right ? width - half : half, height: height - BAR_HEIGHT }));
    };

    return (
        <div
            ref={box}
            className="relative flex h-56 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
            onPointerMove={follow}
            onPointerLeave={() => setShape(null)}
        >
            <div ref={strip} className="flex h-9 items-center gap-1 border-b border-border px-2">
                {TABS.map((tab) => (
                    <span key={tab} className="rounded-md px-3 py-1 text-xs text-text-muted">
                        {tab}
                    </span>
                ))}
            </div>
            <div className="grid grow place-items-center text-sm text-text-muted">Move the pointer over the bar or a half</div>
            <DropPreview shape={shape} />
        </div>
    );
}
