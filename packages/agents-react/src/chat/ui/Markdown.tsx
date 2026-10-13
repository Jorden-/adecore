import { createContext, memo, useContext, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { Zap } from 'lucide-react';
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { CHIP_IN_MESSAGE, MENTION_TONE, SKILL_TONE } from './chips';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { CodeStreamingContext } from './code-streaming';
import { splitMarkdownBlocks } from './markdown-blocks';
import { rehypeChips, type ChipOptions } from './rehype-chips';
import { rehypeFadeWords } from './rehype-fade';
import { remarkHtmlAsText } from './remark-html-as-text';
import { useChatHost, type ChatHost, type FileRef, type ShellCodeBlockContext } from '../../host';
import { useFileLinkCwd, useFileLinkScopeId, useFileLinkTarget, useOpenFileLink } from './file-links';
import { ErrorBoundary, FileIcon, Icon } from '@adecore/ui';
import { useTranslation } from 'react-i18next';

type ShellCodeBlockReply = Pick<ShellCodeBlockContext, 'scopeId' | 'chatId' | 'itemId'> & { streaming: boolean };

type ShellFence = Pick<ShellCodeBlockContext, 'language' | 'code'> & { closed: boolean };

const ShellCodeBlockReplyContext = createContext<ShellCodeBlockReply | null>(null);
const BlockCodeContext = createContext(false);

interface MarkdownNode {
    type: string;
    children?: MarkdownNode[];
    position?: { start: { offset?: number }; end: { offset?: number } };
    data?: { hProperties?: Record<string, unknown> };
}

/* The command a shell fence holds, read from the fence as written, so it keeps the indentation and line endings it has. */
function shellFence(source: string): ShellFence | null {
    const opening = /^ {0,3}(`{3,}|~{3,})[ \t]*(sh|bash|zsh)[ \t]*\r?\n/.exec(source);
    if (opening === null) {
        return null;
    }
    const body = source.slice(opening[0].length);
    const closing = /(?:^|\r?\n) {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
    const closed = closing !== null && closing[1]![0] === opening[1]![0] && closing[1]!.length >= opening[1]!.length;
    return { language: opening[2] as ShellFence['language'], code: closed ? body.slice(0, closing.index) : body, closed };
}

/* Only root children qualify; Markdown's parser decides whether a fence belongs to a list or quote. */
function remarkShellCodeBlocks() {
    return (tree: MarkdownNode, file: { value: unknown }) => {
        for (const node of tree.children ?? []) {
            if (node.type !== 'code') {
                continue;
            }
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start === undefined || end === undefined) {
                continue;
            }
            const shell = shellFence(String(file.value).slice(start, end));
            if (shell === null) {
                continue;
            }
            node.data = {
                ...node.data,
                hProperties: {
                    ...node.data?.hProperties,
                    'data-shell-language': shell.language,
                    'data-shell-code': shell.code,
                    'data-shell-closed': shell.closed
                }
            };
        }
    };
}

/* What the host adds to a shell fence of a main reply, which is complete once the fence closed and the reply stopped. */
function shellCodeBlockActions(reply: ShellCodeBlockReply | null, shell: ShellFence | null, render: ChatHost['renderShellCodeBlock']): ReactNode {
    if (reply === null || shell === null) {
        return undefined;
    }
    const { scopeId, chatId, itemId } = reply;
    return render?.({ scopeId, chatId, itemId, language: shell.language, code: shell.code, complete: !reply.streaming && shell.closed });
}

function languageOf(className: string | undefined): string {
    return /language-([\w-]+)/.exec(className ?? '')?.[1] ?? 'text';
}

const INLINE_CODE = 'rounded-sm bg-surface-sunken px-1 py-px font-mono text-code';

/*
 * A path an agent wrote down. It keeps the shape of the code chip it would otherwise be, so a sentence
 * full of them does not shift; `data-file-path` is what the thread's right-click menu reads.
 */
function FileLink({ target, className, children }: { target: FileRef; className?: string; children: ReactNode }) {
    const cwd = useFileLinkCwd();
    const scopeId = useFileLinkScopeId();
    const openFileLink = useOpenFileLink();
    return (
        // A button is not selectable on its own, and a thread is copied as often as it is clicked.
        <button
            type="button"
            className={clsx('cursor-pointer select-text', className)}
            data-file-path={target.path}
            data-file-line={target.line}
            data-file-column={target.column}
            data-file-end-line={target.endLine}
            data-file-directory={target.directory}
            data-file-cwd={cwd ?? ''}
            data-file-scope-id={scopeId ?? ''}
            onClick={() => openFileLink(cwd, target, scopeId)}
        >
            {children}
        </button>
    );
}

/* Inline code, which is a file reference often enough that it is worth asking every time. */
function InlineCode({ text }: { text: string }) {
    const target = useFileLinkTarget(text);
    if (target === null) {
        return <code className={INLINE_CODE}>{text}</code>;
    }
    return (
        <FileLink target={target} className={`${INLINE_CODE} text-accent hover:underline`}>
            {text}
        </FileLink>
    );
}

/*
 * The path a link target spells, without the one scheme that still means a file on the host's machine.
 * A href nobody encoded is left as it is, since decoding throws on a stray percent.
 */
function hrefPath(href: string): string {
    const bare = href.replace(/^file:\/\//, '');
    try {
        return decodeURI(bare);
    } catch {
        return bare;
    }
}

/* A markdown link, which is a file when its target names no scheme of its own. */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
    const target = useFileLinkTarget(hrefPath(href ?? ''));
    if (target !== null) {
        return (
            <FileLink target={target} className="text-accent underline underline-offset-2">
                {children}
            </FileLink>
        );
    }
    return <ExternalLink href={href}>{children}</ExternalLink>;
}

function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}

/* A ```mermaid fence, which draws what it says. */
function Diagram({ code }: { code: string }) {
    const { t } = useTranslation('agent-chat');
    return (
        <ErrorBoundary label={t('code.mermaid.crashed')} resetKeys={[code]} compact className="rounded-lg border border-border">
            <MermaidBlock code={code} />
        </ErrorBoundary>
    );
}

function MarkdownCode({ className, children, plain = false }: { className?: string; children?: ReactNode; plain?: boolean }) {
    const block = useContext(BlockCodeContext);
    const text = String(children ?? '');
    if (block) {
        const lang = languageOf(className);
        const code = text.replace(/\n$/, '');
        return lang === 'mermaid' ? <Diagram code={code} /> : <CodeBlock code={code} lang={lang} />;
    }
    return plain ? <code className={INLINE_CODE}>{text}</code> : <InlineCode text={text} />;
}

const components = {
    pre({ children }: { children?: ReactNode }) {
        return <BlockCodeContext.Provider value={true}>{children}</BlockCodeContext.Provider>;
    },
    code: MarkdownCode,
    a({ href, children }: { href?: string; children?: ReactNode }) {
        return <MarkdownLink href={href}>{children}</MarkdownLink>;
    },
    table({ children }: { children?: ReactNode }) {
        // A table wider than the column scrolls on its own instead of pushing the thread sideways.
        return (
            <div className="chat-table">
                <table>{children}</table>
            </div>
        );
    }
};

/* For text from outside this machine, where a path in inline code is not a file anybody meant to open here. */
const plainComponents = {
    ...components,
    code({ className, children }: { className?: string; children?: ReactNode }) {
        return (
            <MarkdownCode className={className} plain>
                {children}
            </MarkdownCode>
        );
    },
    a: ExternalLink
};

// A reply sits under the heading of its message, an `h3`, so its own headings start one level below
// that. Only `aria-level` moves. The tag stays, since the styles and a copy of the thread read it.
const REPLY_HEADING_OFFSET = 3;

function replyHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    const Tag = `h${level}` as const;
    return function ReplyHeading({ children }: { children?: ReactNode }) {
        return <Tag aria-level={Math.min(6, level + REPLY_HEADING_OFFSET)}>{children}</Tag>;
    };
}

const replyComponents = {
    ...components,
    code: ReplyCode,
    h1: replyHeading(1),
    h2: replyHeading(2),
    h3: replyHeading(3),
    h4: replyHeading(4),
    h5: replyHeading(5),
    h6: replyHeading(6)
};

function ReplyCode({ className, children, node }: { className?: string; children?: ReactNode } & ExtraProps) {
    const reply = useContext(ShellCodeBlockReplyContext);
    const block = useContext(BlockCodeContext);
    const { renderShellCodeBlock } = useChatHost();
    const properties = node?.properties;
    const language = properties?.['data-shell-language'];
    const code = properties?.['data-shell-code'];
    const shell: ShellFence | null =
        (language === 'sh' || language === 'bash' || language === 'zsh') && typeof code === 'string'
            ? { language, code, closed: properties?.['data-shell-closed'] === true }
            : null;
    const text = String(children ?? '');
    if (block && languageOf(className) === 'mermaid') {
        return <Diagram code={text.replace(/\n$/, '')} />;
    }
    if (block) {
        return <CodeBlock code={text.replace(/\n$/, '')} lang={languageOf(className)} actions={shellCodeBlockActions(reply, shell, renderShellCodeBlock)} />;
    }
    return <InlineCode text={text} />;
}

/* A picked file or skill in a sent message. The glyph stands in for the sigil the text still carries. */
function Chip({ kind, value }: { kind: string; value: string }) {
    if (kind === 'skill') {
        return (
            <span className={clsx(CHIP_IN_MESSAGE, SKILL_TONE)}>
                <Icon icon={Zap} size={14} className="shrink-0 opacity-85" />
                <span className="truncate">{value}</span>
            </span>
        );
    }
    return (
        // The path is what the thread's menu opens in the preview from here.
        <span className={clsx(CHIP_IN_MESSAGE, MENTION_TONE)} data-file-path={value} data-file-directory={/[\\/]$/.test(value)}>
            <FileIcon path={value} size={14} />
            <span className="truncate">{value}</span>
        </span>
    );
}

const messageComponents = {
    ...replyComponents,
    span({ children, 'data-chip': chip, 'data-value': value }: { children?: ReactNode; 'data-chip'?: string; 'data-value'?: string }) {
        if (chip === undefined || value === undefined) {
            return <span>{children}</span>;
        }
        return <Chip kind={chip} value={value} />;
    }
};

// Module constants, so a render never hands react-markdown a fresh array and makes it parse again.
const PLUGINS = [remarkGfm];
const REPLY_PLUGINS = [remarkGfm, remarkShellCodeBlocks];
const PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks];
const MESSAGE_PLUGINS = [remarkGfm, remarkHtmlAsText, remarkBreaks];
const FADE_PLUGINS = [rehypeFadeWords];
const NO_PLUGINS: typeof FADE_PLUGINS = [];

/* One block of a reply. It renders no element of its own, so prose keeps its first and last margins. */
const ReplyBlock = memo(function ReplyBlock({ text, fade, open, reply }: { text: string; fade: boolean; open: boolean; reply?: ShellCodeBlockReply }) {
    return (
        // A context rather than a second set of components. A component that changed would mount the
        // code block again the moment its fence closes, and it would lose the lines it already has.
        <CodeStreamingContext.Provider value={open}>
            <ShellCodeBlockReplyContext.Provider value={reply ?? null}>
                <ReactMarkdown remarkPlugins={REPLY_PLUGINS} rehypePlugins={fade ? FADE_PLUGINS : NO_PLUGINS} components={replyComponents}>
                    {text}
                </ReactMarkdown>
            </ShellCodeBlockReplyContext.Provider>
        </CodeStreamingContext.Provider>
    );
});

/*
 * A code fence at the top level of a reply, drawn as markdown draws it but without parsing, so a word
 * added to a long fence costs no more than one added to a short one. It is the same tree whether the
 * fence is open or closed, so closing it keeps the lines its code block already has.
 */
const ReplyFence = memo(function ReplyFence({
    info,
    body,
    source,
    open,
    reply
}: {
    info: string;
    body: string;
    source: string;
    open: boolean;
    reply?: ShellCodeBlockReply;
}) {
    const { renderShellCodeBlock } = useChatHost();
    // The class markdown gives the code, read back the way a parsed fence's is.
    const lang = languageOf(`language-${info.split(/[ \t]/, 1)[0]}`);
    const shell = reply === undefined ? null : shellFence(source);
    return (
        <CodeStreamingContext.Provider value={open}>
            {lang === 'mermaid' ? (
                <Diagram code={body} />
            ) : (
                <CodeBlock code={body} lang={lang} actions={shellCodeBlockActions(reply ?? null, shell, renderShellCodeBlock)} />
            )}
        </CodeStreamingContext.Provider>
    );
});

/*
 * A reply in a chat thread, parsed a block at a time so a delta only parses the block that grows,
 * and a code fence at the top level not at all. While it streams every new word fades in, and a fence
 * that has not closed yet is highlighted a line at a time as it grows. `arriving` fades in each block
 * as it is added instead, for a reply that is shown a block at a time.
 */
export const ReplyMarkdown = memo(function ReplyMarkdown({
    text,
    streaming,
    arriving = false,
    reply
}: {
    text: string;
    streaming: boolean;
    arriving?: boolean;
    reply?: ShellCodeBlockReply;
}) {
    const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm" data-arriving={arriving || undefined}>
            {blocks.map((block, index) =>
                // Blocks only ever grow at the end, so the place of a block is a stable key.
                block.fence !== undefined ? (
                    <ReplyFence
                        key={index}
                        info={block.fence.info}
                        body={block.fence.body}
                        source={block.fence.source}
                        open={streaming && !block.fence.closed}
                        reply={reply}
                    />
                ) : (
                    <ReplyBlock key={index} text={block.text} fade={streaming} open={streaming && block.openFence} reply={reply} />
                )
            )}
        </div>
    );
});

/*
 * A message a person sent. Enter meant a line break, a tag typed without backticks stays the text
 * it was, and the files and skills picked in the composer are chips again.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ text, mentions, skills }: { text: string; mentions?: string[]; skills?: string[] }) {
    const rehypePlugins = useMemo((): [typeof rehypeChips, ChipOptions][] => [[rehypeChips, { mentions, skills }]], [mentions, skills]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm">
            <ReactMarkdown remarkPlugins={MESSAGE_PLUGINS} rehypePlugins={rehypePlugins} components={messageComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
});

/*
 * `breaks` is for person-authored notes; applying it to CLI markdown would change its layout. `muted`
 * sets the text a step back, for what stands beside an answer rather than being one.
 */
export const Markdown = memo(function Markdown({
    text,
    breaks = false,
    fileLinks = true,
    muted = false,
    rehypePlugins,
    componentOverrides
}: {
    text: string;
    breaks?: boolean;
    fileLinks?: boolean;
    muted?: boolean;
    rehypePlugins?: Options['rehypePlugins'];
    componentOverrides?: Components;
}) {
    const renderComponents = useMemo(() => ({ ...(fileLinks ? components : plainComponents), ...componentOverrides }), [fileLinks, componentOverrides]);
    return (
        <div className="chat-markdown prose prose-sm max-w-none text-sm" data-muted={muted || undefined}>
            <ReactMarkdown remarkPlugins={breaks ? PLUGINS_WITH_BREAKS : PLUGINS} rehypePlugins={rehypePlugins} components={renderComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
});
