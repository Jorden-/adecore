import {
    Component,
    createContext,
    Fragment,
    memo,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ComponentProps,
    type ReactNode
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useTranslation } from 'react-i18next';
import {
    evaluateUiBlock,
    uiInputValues,
    isUiComponent,
    UI_CATALOG_VERSION,
    UiState,
    type UiBlock,
    type UiNode,
    type UiViewNode
} from '@adecore/intelligent-ui';
import { ErrorBoundary, Tooltip } from '@adecore/ui';
import type { ChatUiAnswer, ChatUiQueryState } from '@adecore/agent-contracts';
import { useChatHost } from '../../../host';
import { UiReplyNavigationContext } from '../reply-context';
import { ReplyMarkdown } from '../Markdown';
import { rehypeFadeWords } from '../rehype-fade';
import { UI_RENDERERS } from './registry';
import type { UiRenderContext, UiRenderer } from './render-context';
import { UiPageMemory } from './block-local';
import { UiBlockFrame } from './UiBlockFrame';
import { UiFallbackPart } from './UiFallbackPart';
import { useUiLinks } from './use-ui-links';
import { useUiQueries, useUiLiveValues } from './use-ui-queries';
import { UiSourceCitation } from './renderers/content';
import { uiChildrenOf, revealUiSource, uiLiveChoiceReason, uiUrlDomain } from './node-text';
import { uiReplyParts } from './reply-parts';

const localStates = new UiPageMemory<UiState>(64);

function localState(key: string, block: UiBlock, answered?: ChatUiAnswer): UiState {
    let state = localStates.get(key);
    if (!state) {
        state = new UiState(block);
        if (answered && answered.revision === block.revision) {
            for (const [name, value] of Object.entries(answered.values ?? {})) {
                state.set(name, value);
            }
        }
        localStates.set(key, state);
    }
    return state;
}

/* The block itself, as the parent of its top-level nodes. */
const BLOCK = '$block';

/*
 * Parents whose text is read as written: code, a short tag, and the labels of controls, whose
 * accessible name and sent text are that same string.
 */
const LITERAL_PARENTS = new Set(['CodeBlock', 'Tag', 'Choice', 'Item', 'Switch', 'Slider', 'Segmented', 'Option', 'Button', 'Column']);

/* Parents that stack their children, where a run of text and inline nodes is one paragraph. */
const PARAGRAPHS: Readonly<Record<string, string>> = {
    [BLOCK]: 'px-2 text-xs text-text',
    Tab: 'px-2 text-xs text-text',
    Section: 'text-xs text-text-muted'
};

const LINKS = new Set(['File', 'Diff', 'Commit', 'Node']);

/* Constructs that would start a block or load an image stay text; without GFM a table never forms. */
const BLOCK_CONSTRUCTS = [
    'blockQuote',
    'codeFenced',
    'codeIndented',
    'definition',
    'headingAtx',
    'htmlFlow',
    'htmlText',
    'labelStartImage',
    'list',
    'setextUnderline',
    'thematicBreak'
];

interface ProseTree {
    type: string;
    children?: ProseTree[];
    value?: string;
    data?: unknown;
}

/* Prose between the tags of a block is inline: only emphasis, code and links are Markdown, and a blank line is a line break. */
function remarkInlineProse(this: { data(): object }) {
    // The field remark-parse reads its syntax extensions from, as remark-gfm adds its own.
    const data = this.data() as { micromarkExtensions?: unknown[] };
    data.micromarkExtensions = [...(data.micromarkExtensions ?? []), { disable: { null: BLOCK_CONSTRUCTS } }];
    return (tree: ProseTree) => {
        tree.children = [
            {
                type: 'paragraph',
                children: (tree.children ?? []).flatMap((paragraph, index) => [...(index > 0 ? [{ type: 'break' }] : []), ...(paragraph.children ?? [])])
            }
        ];
    };
}

function remarkCitations() {
    return (tree: ProseTree) => {
        const visit = (parent: ProseTree) => {
            if (['link', 'inlineCode', 'code'].includes(parent.type)) {
                return;
            }
            parent.children = parent.children?.flatMap((child) => {
                if (child.type !== 'text' || !child.value) {
                    visit(child);
                    return [child];
                }
                const parts: ProseTree[] = [];
                let start = 0;
                for (const match of child.value.matchAll(/\[(\d{1,3})\]/g)) {
                    parts.push({ type: 'text', value: child.value.slice(start, match.index) });
                    parts.push({
                        type: 'citation',
                        data: { hName: 'span', hProperties: { 'data-ui-citation': match[1] } },
                        children: [{ type: 'text', value: match[0] }]
                    });
                    start = match.index + match[0].length;
                }
                parts.push({ type: 'text', value: child.value.slice(start) });
                return parts;
            });
        };
        visit(tree);
    };
}

interface CitationTarget {
    id: string;
    title: string;
    url: string;
    ancestors: string[];
}
const CitationContext = createContext<{ sources: ReadonlyMap<number, CitationTarget>; reveal?: (source: CitationTarget) => void }>({ sources: new Map() });

function ProseCitation({ number, children }: { number: number; children?: ReactNode }) {
    const { sources, reveal } = useContext(CitationContext);
    const source = sources.get(number);
    return source ? <UiSourceCitation number={number} title={source.title} url={source.url} onReveal={reveal ? () => reveal(source) : undefined} /> : children;
}

function sourceTargets(nodes: readonly UiViewNode[]): Map<number, CitationTarget> {
    const lists: CitationTarget[][] = [];
    const visit = (nodes: readonly UiViewNode[], ancestors: string[] = []) => {
        for (const node of nodes) {
            const path = ['Tab', 'Section'].includes(node.type) ? [...ancestors, node.id] : ancestors;
            if (node.type === 'Sources') {
                lists.push(
                    uiChildrenOf(node, 'Source').map((source) => ({ id: source.id, title: source.props.title, url: source.props.url, ancestors: path }))
                );
            }
            visit(node.children, path);
        }
    };
    visit(nodes);
    // Numbers restart in each Sources list, so multiple lists have no unambiguous prose target.
    return new Map(lists.length === 1 ? lists[0].map((source, index) => [index + 1, source]) : []);
}

const PROSE_PLUGINS = [remarkInlineProse, remarkCitations];
const PROSE_ELEMENTS = ['p', 'br', 'strong', 'em', 'code', 'a', 'span'];
const FADE_PLUGINS = [rehypeFadeWords];
const NO_PLUGINS: typeof FADE_PLUGINS = [];

const ProseUrlContext = createContext<((url: string) => void) | undefined>(undefined);

/* Through the host only, like a Source: the address is the model's, so nothing here navigates by itself. */
function ProseLink({ href, children }: { href?: string; children?: ReactNode }) {
    const openUrl = useContext(ProseUrlContext);
    if (openUrl === undefined || href === undefined || !/^https?:\/\//i.test(href)) {
        return children;
    }
    return (
        <Tooltip label={uiUrlDomain(href)}>
            <button type="button" className="cursor-pointer text-accent underline underline-offset-2 select-text" onClick={() => openUrl(href)}>
                {children}
            </button>
        </Tooltip>
    );
}

const PROSE_COMPONENTS: Components = {
    p: ({ children }) => children,
    code: ({ children }) => <code className="rounded-sm bg-surface-sunken px-1 py-px font-mono text-code">{children}</code>,
    a: ({ href, children }) => <ProseLink href={href}>{children}</ProseLink>,
    span: ({ node, children, className }) =>
        node?.properties['data-ui-citation'] !== undefined ? (
            <ProseCitation number={Number(node.properties['data-ui-citation'])}>{children}</ProseCitation>
        ) : (
            <span className={className}>{children}</span>
        )
};

/*
 * Text an agent wrote in a block, as inline Markdown without raw HTML. Markdown trims a paragraph,
 * so the whitespace at either end stays text: it is the space between a word and the tag beside it.
 * While the block streams every new word fades in, as in the prose of the reply around it.
 */
const UiProse = memo(function UiProse({ text, fade, openUrl }: { text: string; fade: boolean; openUrl?: (url: string) => void }) {
    const [, lead = '', body = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
    if (body === '') {
        return text;
    }
    return (
        <ProseUrlContext value={openUrl}>
            {lead}
            <ReactMarkdown
                remarkPlugins={PROSE_PLUGINS}
                rehypePlugins={fade ? FADE_PLUGINS : NO_PLUGINS}
                allowedElements={PROSE_ELEMENTS}
                unwrapDisallowed
                components={PROSE_COMPONENTS}
            >
                {body}
            </ReactMarkdown>
            {trail}
        </ProseUrlContext>
    );
});

/* Which text nodes of a block the agent wrote out, by id; the value of an expression is data and stays as it is. */
function writtenTexts(nodes: readonly UiNode[], into = new Map<string, boolean>()): Map<string, boolean> {
    for (const node of nodes) {
        if (node.type === '$text') {
            into.set(node.id, node.expressions.text === undefined);
        }
        writtenTexts(node.children, into);
    }
    return into;
}

function isInline(node: UiViewNode): boolean {
    if (node.type === '$text') {
        return true;
    }
    return node.error === undefined && (node.type === 'Tag' || (LINKS.has(node.type) && node.children.length === 0));
}

function isBlank(node: UiViewNode): boolean {
    return node.type === '$text' && String(node.props.text ?? '').trim() === '';
}

interface UiNodesProps {
    nodes: readonly UiViewNode[];
    parent: string;
    texts: ReadonlyMap<string, boolean>;
    context: UiRenderContext;
}

/* The children of one parent, each in its own boundary. Where the parent stacks them, a run of text and inline nodes becomes a paragraph. */
function UiNodes({ nodes, parent, texts, context }: UiNodesProps): ReactNode {
    const drawn = (node: UiViewNode) => (
        <UiNodeBoundary key={node.id} node={node}>
            <UiNodeBody node={node} parent={parent} texts={texts} context={context} />
        </UiNodeBoundary>
    );
    const paragraph = PARAGRAPHS[parent];
    if (parent === 'Choices') {
        // A primary choice stands first in the order a keyboard and a screen reader meet it too, not only on screen.
        return [...nodes].sort((a, b) => Number(b.props.primary === true) - Number(a.props.primary === true)).map(drawn);
    }
    if (paragraph === undefined) {
        return nodes.map(drawn);
    }
    const output: ReactNode[] = [];
    let run: UiViewNode[] = [];
    const close = () => {
        if (run.some((node) => !isBlank(node))) {
            output.push(
                <div key={`run:${run[0]!.id}`} className={paragraph}>
                    {run.map(drawn)}
                </div>
            );
        }
        run = [];
    };
    for (const node of nodes) {
        if (isInline(node)) {
            run.push(node);
            continue;
        }
        close();
        output.push(drawn(node));
    }
    close();
    return output;
}

interface UiNodeBoundaryProps {
    node: UiViewNode;
    children: ReactNode;
}

interface UiNodeBoundaryState {
    failed: boolean;
    node: UiViewNode;
}

class UiNodeBoundary extends Component<UiNodeBoundaryProps, UiNodeBoundaryState> {
    override state = { failed: false, node: this.props.node };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    static getDerivedStateFromProps(props: UiNodeBoundaryProps, state: UiNodeBoundaryState): UiNodeBoundaryState | null {
        return props.node === state.node ? null : { failed: false, node: props.node };
    }

    override render(): ReactNode {
        return this.state.failed ? <UiFallbackPart fallback={this.props.node.fallback} problem={{ kind: 'failed' }} /> : this.props.children;
    }
}

function UiNodeBody({
    node,
    parent,
    texts,
    context
}: {
    node: UiViewNode;
    parent: string;
    texts: ReadonlyMap<string, boolean>;
    context: UiRenderContext;
}): ReactNode {
    if (node.type === '$text') {
        const text = String(node.props.text ?? '');
        return LITERAL_PARENTS.has(parent) || texts.get(node.sourceId ?? node.id) !== true ? (
            text
        ) : (
            <UiProse text={text} fade={context.phase === 'streaming'} openUrl={context.openUrl} />
        );
    }
    if (node.error !== undefined) {
        return <UiFallbackPart fallback={node.fallback} problem={{ kind: 'failed' }} />;
    }
    if (!isUiComponent(node.type)) {
        return <UiFallbackPart fallback={node.fallback} problem={{ kind: 'unknown', component: node.type }} />;
    }
    const Renderer = UI_RENDERERS[node.type] as UiRenderer<Record<string, unknown>> | null;
    if (Renderer === null) {
        return null;
    }
    return (
        <Renderer node={node} context={context}>
            <UiNodes nodes={node.children} parent={node.type} texts={texts} context={context} />
        </Renderer>
    );
}

/*
 * The points the machine froze beside a block, as a renderer asks for them. Until the block is frozen
 * nothing is looked up yet; once it is, a place with no reading is one the machine did not look up.
 */
function placeReader(frozen: ChatUiQueryState['blocks'][string] | undefined, revision: string | undefined): UiRenderContext['place'] {
    if (frozen === undefined || frozen.revision !== revision) {
        return () => undefined;
    }
    return (nodeId) => {
        const reading = Object.hasOwn(frozen.places ?? {}, nodeId) ? frozen.places![nodeId] : undefined;
        return reading?.state === 'found' && reading.lat !== undefined && reading.lon !== undefined
            ? { lat: reading.lat, lon: reading.lon, label: reading.label }
            : null;
    };
}

/* What names a block and whether it still streams; the rest of its render context the block works out itself. */
type UiBlockIdentity = Pick<UiRenderContext, 'scopeId' | 'chatId' | 'itemId' | 'blockId' | 'phase'>;

function UiBlockBody({
    block,
    context,
    answered,
    frozen
}: {
    block: UiBlock;
    context: UiBlockIdentity;
    answered?: ChatUiAnswer;
    frozen?: ChatUiQueryState['blocks'][string];
}): ReactNode {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    const key = JSON.stringify([context.scopeId, context.chatId, context.itemId, block.id]);
    const [state] = useState(() => localState(key, block, answered));
    state.sync(block);
    const stateRevision = useSyncExternalStore(
        (listener) => state.subscribe(listener),
        () => state.snapshot(),
        () => state.snapshot()
    );
    const [optimistic, setOptimistic] = useState<{ revision: string; choiceId: string; state: 'sending' | 'sent' | 'queued' } | null>(null);
    const [failedChoiceId, setFailedChoiceId] = useState<string | null>(null);
    const pending = useRef(false);
    useEffect(() => {
        if (answered && answered.revision === block.revision && answered.values) {
            for (const [name, value] of Object.entries(answered.values)) {
                state.set(name, value);
            }
        }
    }, [state, answered, block.revision]);
    const answer =
        answered && answered.revision === block.revision
            ? { choiceId: answered.choiceId, state: answered.queued ? ('queued' as const) : ('sent' as const) }
            : optimistic?.revision === block.revision
              ? optimistic
              : null;
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const navigation = useContext(UiReplyNavigationContext);
    const flash = navigation?.flash;
    const flashing =
        navigation?.chatId === context.chatId && flash?.itemId === context.itemId && flash.blockId === block.id && flash.revision === block.revision;
    const queries = useUiQueries(block, state, context, element, frozen);
    const links = useUiLinks(block, state, context, queries.reads, frozen);
    // The state changes in place, so its revision is what tells this evaluation it went stale.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const evaluation = useMemo(() => evaluateUiBlock(block, state), [block, state, stateRevision]);
    const texts = useMemo(() => writtenTexts(block.nodes), [block]);
    const sources = useMemo(() => sourceTargets(evaluation.nodes), [evaluation]);
    const citations = useMemo(
        () => ({
            sources,
            reveal: element
                ? (source: CitationTarget) => {
                      void revealUiSource(element, source.id, source.ancestors);
                  }
                : undefined
        }),
        [sources, element]
    );
    const liveValue = useUiLiveValues(block, evaluation.nodes, queries.currentReadings);
    const sendChoice = host.intelligentUi?.sendChoice;
    const place = useMemo(() => placeReader(frozen, block.revision), [frozen, block.revision]);
    const rendering: UiRenderContext = {
        ...context,
        ...links,
        place,
        answer,
        failedChoiceId,
        live: queries.live,
        liveValue,
        choiceReason: uiLiveChoiceReason(t, queries.live),
        onChoose:
            !queries.ready || queries.reading
                ? undefined
                : sendChoice && block.revision && block.complete && context.phase === 'final'
                  ? (choiceId) => {
                        if (pending.current || answer || queries.reading) {
                            return;
                        }
                        const values = uiInputValues(block, state);
                        const reads = queries.readsFor(values);
                        if (reads === null) {
                            return;
                        }
                        pending.current = true;
                        setFailedChoiceId(null);
                        const revision = block.revision!;
                        setOptimistic({ revision, choiceId, state: 'sending' });
                        void sendChoice(context.scopeId, {
                            chatId: context.chatId,
                            itemId: context.itemId,
                            blockId: block.id,
                            revision,
                            choiceId,
                            reads,
                            values
                        })
                            .then((state) => setOptimistic({ revision, choiceId, state }))
                            .catch(() => {
                                setOptimistic(null);
                                setFailedChoiceId(choiceId);
                            })
                            .finally(() => {
                                pending.current = false;
                            });
                    }
                  : undefined
    };
    const unknown = block.catalogVersion !== UI_CATALOG_VERSION;
    const failed = !unknown && !block.nodes.length && block.diagnostics.length > 0;
    const shownAsText = unknown ? t('blocks.unreadable') : failed ? block.diagnostics[0].message : undefined;
    return (
        <div ref={setElement} className="relative" data-ui-block={block.id} data-ui-revision={block.revision} tabIndex={-1}>
            {flashing && <span key={flash.nonce} className="chat-flash pointer-events-none absolute inset-0 rounded-lg" aria-hidden />}
            <UiBlockFrame
                live={queries.live}
                nodes={evaluation.nodes}
                phase={context.phase}
                fixes={[...block.diagnostics, ...evaluation.diagnostics]}
                shownAsText={shownAsText}
                answered={answered}
            >
                {unknown || failed ? (
                    <ReplyMarkdown text={block.fallback} streaming={false} />
                ) : (
                    <CitationContext value={citations}>
                        <UiNodes nodes={evaluation.nodes} parent={BLOCK} texts={texts} context={rendering} />
                    </CitationContext>
                )}
            </UiBlockFrame>
        </div>
    );
}

/* Prose and cards a block gap apart, as the rows of a turn are; text that is only the newline between two fences draws nothing. */
export function UiReply({
    text,
    blocks,
    context,
    answers,
    queries,
    reply
}: {
    text: string;
    blocks: readonly UiBlock[];
    context: Omit<UiBlockIdentity, 'blockId'>;
    answers?: Readonly<Record<string, ChatUiAnswer>>;
    queries?: ChatUiQueryState;
    reply?: ComponentProps<typeof ReplyMarkdown>['reply'];
}): ReactNode {
    return (
        <div className="flex flex-col gap-(--chat-block-gap)">
            {uiReplyParts(text, blocks, context.phase === 'streaming').map((part, index) =>
                part.kind === 'text' ? (
                    part.text.trim() !== '' && (
                        <Fragment key={`text:${index}`}>
                            <ReplyMarkdown text={part.text} streaming={context.phase === 'streaming'} reply={reply} />
                        </Fragment>
                    )
                ) : (
                    <ErrorBoundary key={JSON.stringify([context.scopeId, context.chatId, context.itemId, part.block.id])} label="UI block">
                        <UiBlockBody
                            block={part.block}
                            frozen={queries?.blocks[part.block.id]}
                            answered={answers?.[part.block.id]}
                            context={{ scopeId: context.scopeId, chatId: context.chatId, itemId: context.itemId, phase: context.phase, blockId: part.block.id }}
                        />
                    </ErrorBoundary>
                )
            )}
        </div>
    );
}
