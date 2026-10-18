import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Workflow } from 'lucide-react';
import { IconButton } from '@adecore/ui';
import { useChatHost } from '../../host';
import { CodeBlock } from './CodeBlock';
import { CodeStreamingContext } from './code-streaming';
import { MERMAID_TOKENS, mermaidConfig, sizedSvg, svgDataUrl, type MermaidColors, type SizedSvg } from './mermaid';
import { watchTheme } from './theme-watch';

type Drawing = { state: 'drawing' } | { state: 'drawn'; image: SizedSvg } | { state: 'failed' };

// Mermaid keeps one configuration for the page, so one diagram is drawn at a time with its own.
let queue: Promise<unknown> = Promise.resolve();

let probeCanvas: HTMLCanvasElement | null = null;

/* A token as an opaque `#rrggbb` over `ground`, which is what Mermaid's color math reads. */
function resolveColor(element: HTMLElement, token: string, ground: string): string {
    probeCanvas ??= document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
    const context = probeCanvas.getContext('2d', { willReadFrequently: true });
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    if (context === null || value === '') {
        return ground;
    }
    context.fillStyle = ground;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((channel) => channel!.toString(16).padStart(2, '0')).join('')}`;
}

function themeColors(element: HTMLElement): MermaidColors {
    const ground = resolveColor(element, MERMAID_TOKENS.ground, '#808080');
    const entries = Object.entries(MERMAID_TOKENS).map(([name, token]) => [name, name === 'ground' ? ground : resolveColor(element, token, ground)]);
    return Object.fromEntries(entries) as unknown as MermaidColors;
}

/* What a diagram reads of the theme where it stands. */
interface DiagramLook {
    colors: MermaidColors;
    font: { family: string; size: string };
}

function diagramLook(element: HTMLElement): DiagramLook {
    const style = getComputedStyle(element);
    return { colors: themeColors(element), font: { family: style.fontFamily, size: style.fontSize } };
}

async function drawDiagram(id: string, source: string, look: DiagramLook, dark: boolean): Promise<SizedSvg | null> {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize(mermaidConfig(look.colors, dark, look.font));
    const { svg } = await mermaid.render(id, source);
    return sizedSvg(svg);
}

/*
 * A ```mermaid fence, drawn as the diagram once the fence is closed. Mermaid is large, so it loads on
 * the first diagram of the page. While the fence grows, and when the text is no diagram Mermaid can
 * draw, it is the code block it would otherwise be.
 */
export function MermaidBlock({ code }: { code: string }) {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    const streaming = useContext(CodeStreamingContext);
    const dark = host.code.useMode() === 'dark';
    const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`;
    const frame = useRef<HTMLDivElement>(null);
    const [source, setSource] = useState(false);
    const [drawing, setDrawing] = useState<Drawing>({ state: 'drawing' });
    // The look of the diagram on screen or on its way there, null before the first.
    const drawnLook = useRef<string | null>(null);
    const [themeRevision, setThemeRevision] = useState(0);

    // An app may change its colors without turning light or dark, which only the root of the page tells.
    useEffect(() => {
        const element = frame.current;
        if (element === null) {
            return;
        }
        return watchTheme(element.ownerDocument, () => {
            if (drawnLook.current !== null && JSON.stringify(diagramLook(element)) !== drawnLook.current) {
                setThemeRevision((revision) => revision + 1);
            }
        });
    }, []);

    useEffect(() => {
        const element = frame.current;
        if (streaming || element === null) {
            return;
        }
        let cancelled = false;
        const look = diagramLook(element);
        drawnLook.current = JSON.stringify(look);
        // A diagram already drawn stays until the next one is there, so a change of the theme does not make it blink.
        setDrawing((current) => (current.state === 'drawn' ? current : { state: 'drawing' }));
        const drawn = queue.then(() => (cancelled ? null : drawDiagram(id, code, look, dark)));
        queue = drawn.catch(() => undefined);
        drawn.then(
            (image) => !cancelled && setDrawing(image === null ? { state: 'failed' } : { state: 'drawn', image }),
            () => !cancelled && setDrawing({ state: 'failed' })
        );
        return () => {
            cancelled = true;
        };
    }, [code, dark, id, streaming, themeRevision]);

    const showsDiagram = !streaming && !source && drawing.state !== 'failed';
    const toggle =
        streaming || drawing.state === 'failed' ? undefined : (
            <IconButton
                icon={source ? Workflow : Code}
                size="sm"
                label={source ? t('code.mermaid.showDiagram') : t('code.mermaid.showSource')}
                onClick={() => setSource((shown) => !shown)}
            />
        );
    return (
        // One tree in every state, so the code block keeps the lines it has when the fence closes.
        <div ref={frame}>
            <CodeBlock
                code={code}
                lang="mermaid"
                actions={toggle}
                view={
                    showsDiagram ? (
                        <div className="overflow-x-auto p-3" aria-busy={drawing.state === 'drawing' || undefined}>
                            {drawing.state === 'drawn' && (
                                <img
                                    src={svgDataUrl(drawing.image.svg)}
                                    width={drawing.image.width}
                                    height={drawing.image.height}
                                    alt={t('code.mermaid.diagram')}
                                    className="m-0 max-w-none"
                                    draggable={false}
                                />
                            )}
                        </div>
                    ) : undefined
                }
            />
            {drawing.state === 'failed' && <p className="m-0 mt-1 text-xs text-text-faint">{t('code.mermaid.failed')}</p>}
        </div>
    );
}
