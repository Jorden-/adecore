import { Fragment, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FileDiff, X } from 'lucide-react';
import type { ChatCheckpointDiff, ChatCheckpointFile, ChatFileChange, ChatToolItem, ChatTurnItem } from '@adecore/agent-contracts';
import type { BaseMoved } from '../../logic/timeline';
import { matchCommandLook, type CommandLookRun } from '../../logic/command-looks';
import {
    exitCodeOf,
    fileChanges,
    hasOutput,
    hasToolBody,
    liveOutput,
    readImagePath,
    shellCommand,
    toolCallLines,
    toolStartedAt,
    toolSummary,
    toolSummaryIsPath,
    unifiedChanges,
    type FileChange
} from '../../logic/tools';
import { useOpenForFind } from '../find-reveal';
import { useChatHost, type CommandLook } from '../../../host';
import { lazyNamed } from '../../../lazy';
import { useChatActions } from '../../actions';
import { ChatScopeContext, useChatScope } from '../../../scope';
import { useCurrentItem } from '../../../state/chats';
import { useTimelineFlash } from '../../timeline-flash';
import { formatClockDuration, formatElapsedShort } from '@adecore/ui/format';
import { Icon, LazyBoundary, MiddleTruncate, Spinner, useTickingText } from '@adecore/ui';
import { ROW_GUTTER, toolIcon } from '../icons';
import { AnsiOutput } from '../AnsiOutput';
import { RowTime } from '../RowTime';
import { ShellCommand, type NamedWord } from '../ShellCommand';
import { DiffStack, ReviewStackView } from '../diff/DiffStack';
import { reviewEntries, type ReviewEntry } from '../diff/review-plan';
import { useReviewStack } from '../diff/use-review-stack';

// A checkpoint opens its renderer only when a file is expanded.
const UnifiedDiff = lazyNamed(() => import('../UnifiedDiff'), 'default');

const OUTPUT_LIMIT = 4000;

/* The line that says how much of a text past the limit is left out; empty for a text within it. */
function clipNotice(text: string): string {
    return text.length > OUTPUT_LIMIT ? `\n${i18next.t('agent-chat:work.moreCharacters', { count: text.length - OUTPUT_LIMIT })}` : '';
}

function clip(text: string): string {
    return text.slice(0, OUTPUT_LIMIT) + clipNotice(text);
}

const BRAND = 'font-semibold';

/* `text` with `brand` in semibold where it names it, as a sentence about a look does. */
function withBrand(text: string, brands: readonly string[]): ReactNode {
    for (const brand of brands) {
        const at = brand === '' ? -1 : text.indexOf(brand);
        if (at !== -1) {
            return (
                <>
                    {text.slice(0, at)}
                    <span className={BRAND}>{brand}</span>
                    {text.slice(at + brand.length)}
                </>
            );
        }
    }
    return text;
}

/* The detail of a look's run, with the words its host names drawn as those names. */
function NamedLookDetail({ run, chatId, useNames }: { run: CommandLookRun; chatId: string; useNames: NonNullable<CommandLook['useNames']> }) {
    const scope = useContext(ChatScopeContext);
    const nameOf = useNames(scope?.id ?? '', chatId);
    const names = run.words.flatMap((word): NamedWord[] => {
        const name = nameOf(word.text, word.option);
        return name === null ? [] : [{ start: word.start, end: word.end, word: word.text, name }];
    });
    return <ShellCommand command={run.detail} code={run.code} names={names} />;
}

function LookDetail({ run, chatId }: { run: CommandLookRun; chatId: string }) {
    const { useNames } = run.look;
    if (useNames === undefined) {
        return <ShellCommand command={run.detail} code={run.code} />;
    }
    // Keyed by the look, so a row whose command turns into another look's starts its hooks again.
    return <NamedLookDetail key={run.look.program} run={run} chatId={chatId} useNames={useNames} />;
}

const TAG = 'shrink-0 rounded bg-surface-hover px-1.5 text-text-faint';

/* What else the line ran, in quiet tags: the other programs and a heredoc, and how many more runs of a look. */
function LookTags({ run }: { run: CommandLookRun }) {
    const { t } = useTranslation('agent-chat');
    const also = run.heredoc ? [...run.others, t('work.heredoc')] : run.others;
    return (
        <>
            {also.length > 0 && <span className={TAG}>{t('work.alsoRan', { programs: also.join(', ') })}</span>}
            {run.more > 0 && <span className={TAG}>{t('work.moreRuns', { count: run.more })}</span>}
        </>
    );
}

/*
 * The line of a call, a subagent or a group. Without `onToggle` it has nothing to open: no chevron, and
 * not a button. `time` shows at the right edge while the line is hovered or focused.
 */
export function ToggleLine({
    icon,
    label,
    brand,
    detail,
    command,
    look,
    path,
    open = false,
    onToggle,
    failed,
    live,
    trailing,
    time,
    className
}: {
    icon: ReactNode;
    label: ReactNode;
    /* Drawn in semibold before the label. */
    brand?: string;
    detail?: string;
    /* Draws `detail` as a shell command, in the colors of the code theme. */
    command?: boolean;
    /* A shell call read as a look's tool, whose detail and tags take the place of `detail`. */
    look?: { run: CommandLookRun; chatId: string };
    /* `detail` is the path of a file, cut in the middle so its name stays in sight. */
    path?: boolean;
    open?: boolean;
    onToggle?(): void;
    failed?: boolean;
    live?: boolean;
    trailing?: ReactNode;
    time?: number;
    className?: string;
}) {
    const classes = clsx(
        // Fix the width so long commands reach the truncation inside the negative margins.
        'group/line -mx-1 mb-0.5 flex h-7 w-[calc(100%+8px)] items-center gap-2 rounded-md px-1 text-left text-xs text-text-muted',
        onToggle !== undefined && 'hover:bg-surface-hover',
        failed && 'text-status-error',
        className
    );
    const content = (
        <>
            <span className={clsx(ROW_GUTTER, live && 'text-accent')}>{icon}</span>
            <span className={clsx('shrink-0', live && 'chat-live-text')}>
                {brand !== undefined && <span className={BRAND}>{brand}</span>}
                {brand !== undefined && label !== '' && ' '}
                {label}
            </span>
            {look !== undefined ? (
                <>
                    {look.run.detail !== '' && (
                        <span data-find-field="summary" className="min-w-0 truncate font-mono text-text-faint">
                            <LookDetail run={look.run} chatId={look.chatId} />
                        </span>
                    )}
                    <LookTags run={look.run} />
                </>
            ) : (
                detail && (
                    <span data-find-field="summary" className="min-w-0 truncate font-mono text-text-faint">
                        {command ? <ShellCommand command={detail} /> : path ? <MiddleTruncate text={detail} /> : detail}
                    </span>
                )
            )}
            <span className="grow" />
            {trailing}
            {time !== undefined && <RowTime at={time} />}
            {failed && <Icon icon={X} size={12} className="shrink-0" />}
            {onToggle !== undefined && (
                <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
            )}
        </>
    );
    if (onToggle === undefined) {
        return <div className={classes}>{content}</div>;
    }
    return (
        <button className={classes} onClick={onToggle}>
            {content}
        </button>
    );
}

/* The diff renderers load lazily, so a diff waits on them under a line that says so. */
function DiffSuspense({ children }: { children: ReactNode }) {
    const { t } = useTranslation('agent-chat');
    return <LazyBoundary fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>{children}</LazyBoundary>;
}

/* A file in a changed files card, which opens its diff under it. */
function ChangedFileLine({
    path,
    open,
    onToggle,
    trailing,
    children
}: {
    path: string;
    open: boolean;
    onToggle(): void;
    trailing: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="border-t border-border">
            <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface-hover"
                data-file-path={path}
                onClick={onToggle}
            >
                <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
                <MiddleTruncate text={path} className="font-mono text-text" />
                <span className="grow" />
                {trailing}
            </button>
            {open && <div className="border-t border-border">{children}</div>}
        </div>
    );
}

/* A diff keeps its card, with what the call answered under it. */
function DiffBody({ tool, entries, patched }: { tool: ChatToolItem; entries: readonly ReviewEntry[]; patched: boolean }) {
    return (
        <div className="mt-1.5 mb-2 ml-6 overflow-hidden rounded-md border border-border bg-surface-raised">
            <DiffStack entries={entries} />
            {hasOutput(tool.output) && !patched && (
                <pre
                    data-find-field="output"
                    className={clsx(
                        'max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-code select-text',
                        tool.state === 'error' ? 'text-chat-removed' : 'text-chat-output'
                    )}
                >
                    <AnsiOutput text={tool.output} limit={OUTPUT_LIMIT} />
                </pre>
            )}
        </div>
    );
}

/* What a call answered, muted under the call; a failure in the error color, or its exit code when the tool names one. */
function ToolOutput({ tool }: { tool: ChatToolItem }) {
    const { t } = useTranslation('agent-chat');
    if (!hasOutput(tool.output)) {
        return null;
    }
    const failed = tool.state === 'error';
    const { code, rest } = failed ? exitCodeOf(tool.output) : { code: null, rest: tool.output };
    return (
        <>
            {hasOutput(rest) && (
                <pre
                    data-find-field="output"
                    className={clsx('max-h-64 overflow-auto whitespace-pre-wrap', failed && code === null ? 'text-status-error' : 'text-text-muted')}
                >
                    <AnsiOutput text={rest} limit={OUTPUT_LIMIT} />
                </pre>
            )}
            {code !== null && <div className="text-status-error">{t('work.exitCode', { code: String(code) })}</div>}
        </>
    );
}

/* An opened call without a card: what it was asked in the foreground, what it answered muted below. */
function ToolBody({ tool }: { tool: ChatToolItem }) {
    const patches = unifiedChanges(tool);
    const changes = patches.length > 0 ? [] : fileChanges(tool.name, tool.input);
    if (patches.length + changes.length > 0) {
        return <DiffBody tool={tool} entries={reviewEntries(patches, changes)} patched={patches.length > 0} />;
    }
    const lines = toolCallLines(tool.name, tool.input);
    return (
        <div className="mt-0.5 mb-2 ml-6 flex flex-col gap-1.5 font-mono text-code select-text">
            {lines.command !== null && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere text-text">
                    <ShellCommand command={lines.command.slice(0, OUTPUT_LIMIT)} />
                    {clipNotice(lines.command)}
                </pre>
            )}
            {lines.args.length > 0 && (
                <dl className="grid max-h-64 grid-cols-[auto_minmax(0,1fr)] gap-x-3 overflow-auto">
                    {lines.args.map(([key, value]) => (
                        <Fragment key={key}>
                            <dt className="text-text-faint">{key}</dt>
                            <dd className="whitespace-pre-wrap wrap-anywhere text-text">{clip(value)}</dd>
                        </Fragment>
                    ))}
                </dl>
            )}
            {lines.text !== null && <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere text-text">{clip(lines.text)}</pre>}
            <ToolOutput tool={tool} />
        </div>
    );
}

/*
 * One settled tool call: a line, and what it was asked and answered behind it. An image the call
 * looked at is drawn under the line. `icon`, `label` and `failed` let a row that knows the call better name it.
 */
export function WorkRow({
    tool,
    chatId,
    nested,
    detail,
    icon,
    label,
    failed
}: {
    tool: ChatToolItem;
    /* The chat the call is in, which names the words of a look's run. */
    chatId?: string;
    nested?: boolean;
    detail?: string;
    icon?: ReactNode;
    label?: string;
    failed?: boolean;
}) {
    const host = useChatHost();
    const [open, setOpen] = useState(false);
    const image = tool.state === 'done' ? readImagePath(tool.name, tool.input) : null;
    const { ReadImage } = host;
    useOpenForFind(tool.id, 'output', setOpen);
    const summary = detail ?? toolSummary(tool.name, tool.input);
    const opens = hasToolBody(tool);
    const shell = shellCommand(tool.name, tool.input);
    const run = detail === undefined && icon === undefined && label === undefined && shell !== null ? matchCommandLook(shell, host.commandLooks) : null;
    return (
        <div data-find-item={tool.id} className={nested ? 'ml-6' : undefined}>
            <ToggleLine
                icon={run === null ? (icon ?? toolIcon(tool.name)) : <run.look.Mark size={12} />}
                label={run === null ? (label ?? tool.name) : run.match.label}
                brand={run?.look.brand}
                detail={summary}
                look={run === null ? undefined : { run, chatId: chatId ?? '' }}
                command={detail === undefined && summary === shell}
                path={detail === undefined && toolSummaryIsPath(tool.name, tool.input)}
                open={open && opens}
                onToggle={opens ? () => setOpen((o) => !o) : undefined}
                failed={failed ?? tool.state === 'error'}
                time={tool.createdAt}
            />
            {image !== null && ReadImage !== null && <ReadImage path={image} />}
            {open && opens && <ToolBody tool={tool} />}
        </div>
    );
}

/* "running for 12s" next to a live call. */
export function RunningFor({ startedAt }: { startedAt: number }) {
    const { t } = useTranslation('agent-chat');
    const ref = useTickingText(() => t('work.runningFor', { elapsed: formatElapsedShort(Date.now() - startedAt) }));
    return <span ref={ref} className="shrink-0 text-xs text-text-faint tabular-nums" />;
}

/* A call still running: its timer on the line, and for a provider that streams output, the last lines under it. */
export function WorkLiveRow({ chatId, tool: derived }: { chatId: string; tool: ChatToolItem }) {
    const [open, setOpen] = useState(false);
    const tool = useCurrentItem(chatId, derived);
    const tail = liveOutput(tool);
    const summary = toolSummary(tool.name, tool.input);
    const opens = hasToolBody(tool);
    const shell = shellCommand(tool.name, tool.input);
    const { commandLooks } = useChatHost();
    const run = shell === null ? null : matchCommandLook(shell, commandLooks);
    return (
        <div>
            <ToggleLine
                icon={run === null ? toolIcon(tool.name) : <run.look.Mark size={12} />}
                label={run === null ? tool.name : run.match.label}
                brand={run?.look.brand}
                look={run === null ? undefined : { run, chatId }}
                detail={summary || tool.progress?.description || ''}
                command={summary !== '' && summary === shellCommand(tool.name, tool.input)}
                path={summary !== '' && toolSummaryIsPath(tool.name, tool.input)}
                open={open && opens}
                onToggle={opens ? () => setOpen((o) => !o) : undefined}
                trailing={<RunningFor startedAt={toolStartedAt(tool)} />}
                live
            />
            {open && opens && <ToolBody tool={tool} />}
            {tail !== null && !open && (
                <pre className="mt-1.5 mb-2 ml-6 max-h-48 overflow-auto rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-code whitespace-pre-wrap text-chat-output select-text">
                    <AnsiOutput text={tail} tailLines={12} />
                </pre>
            )}
        </div>
    );
}

/* A run of tool calls as one line ("Read 4 files"); opening it lists every call. A run of one look wears its mark and its brand. */
export function WorkGroupRow({
    tools,
    summary,
    look,
    expanded,
    onToggle
}: {
    tools: ChatToolItem[];
    summary: string;
    look?: CommandLook;
    expanded: boolean;
    onToggle(): void;
}) {
    const failed = tools.some((tool) => tool.state === 'error');
    return (
        <div>
            <ToggleLine
                icon={look === undefined ? toolIcon(tools[0]!.name) : <look.Mark size={12} />}
                label={look?.brand === undefined ? summary : withBrand(summary, [look.brand])}
                open={expanded}
                onToggle={onToggle}
                failed={failed}
                time={tools[0]!.createdAt}
            />
        </div>
    );
}

/*
 * A settled turn folded behind how long it took and what it did. A line and not a button, like the
 * tool lines it hides; the work reads fainter than the time so the eye lands on the time first.
 */
export function TurnFoldRow({
    turn,
    label,
    work,
    expanded,
    onToggle
}: {
    turn: ChatTurnItem;
    label: string;
    work: readonly string[];
    expanded: boolean;
    onToggle(): void;
}) {
    const { commandLooks } = useChatHost();
    const brands = commandLooks?.flatMap(({ brand }) => (brand === undefined ? [] : [brand])) ?? [];
    return (
        <button
            className={clsx(
                'group group/line -mx-1 mb-2 flex h-7 w-[calc(100%+8px)] min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs text-text-muted hover:bg-surface-hover',
                turn.state === 'error' && 'text-status-error'
            )}
            aria-expanded={expanded}
            onClick={onToggle}
        >
            <span className={ROW_GUTTER}>
                <Icon icon={ChevronRight} size={12} className={clsx('transition-transform', expanded && 'rotate-90')} />
            </span>
            <span className="shrink-0 group-hover:text-text">{label}</span>
            {work.length > 0 && (
                <span className="min-w-0 truncate text-text-faint">
                    {work.map((part, index) => (
                        <Fragment key={index}>
                            {' · '}
                            {withBrand(part, brands)}
                        </Fragment>
                    ))}
                </span>
            )}
            <span className="grow" />
            <RowTime at={turn.createdAt} />
        </button>
    );
}

function omittedLabel(reason: 'binary' | 'too-large'): string {
    return reason === 'binary' ? i18next.t('agent-chat:work.omitted.binary') : i18next.t('agent-chat:work.omitted.tooLarge');
}

/* One file of a turn's checkpoint diff: its patch, or the reason there is none. */
function CheckpointFileBody({ file }: { file: ChatCheckpointFile }) {
    if (file.omitted) {
        return <div className="px-3 py-2 text-xs text-text-faint">{omittedLabel(file.omitted)}</div>;
    }
    return (
        <DiffSuspense>
            <UnifiedDiff change={file} />
        </DiffSuspense>
    );
}

/* The frame of a changed files card: a header that folds the list of files away. */
function ChangedFilesCard({
    count,
    truncated,
    added,
    deleted,
    revealNonce = 0,
    baseMoved,
    children
}: {
    count: number;
    truncated?: boolean;
    /* Set when the branch moved during the turn: the count is then what changed in the folder, not only the agent's work. */
    baseMoved?: BaseMoved | undefined;
    added?: number;
    deleted?: number;
    /* A jump from outside the chat that asked for this card; each new one opens it. */
    revealNonce?: number;
    children: ReactNode;
}) {
    const { t } = useTranslation('agent-chat');
    const [expanded, setExpanded] = useState(false);
    // A jump opens the card, also one that mounted it by scrolling it on screen; the flash is gone by the next visit.
    const [seenReveal, setSeenReveal] = useState(0);
    if (revealNonce > 0 && revealNonce !== seenReveal) {
        setSeenReveal(revealNonce);
        setExpanded(true);
    }
    return (
        <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface-raised">
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:bg-surface-hover"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
            >
                <Icon icon={FileDiff} size={12} className="shrink-0" />
                <span className="shrink-0 font-medium text-text">
                    {baseMoved === undefined ? t('work.changedFiles', { count }) : t('work.folderChanges', { count })}
                </span>
                {truncated && <span className="min-w-0 truncate text-text-faint">{t('work.andMore')}</span>}
                <span className="grow" />
                {added !== undefined && <span className="text-chat-added tabular-nums">+{added}</span>}
                {deleted !== undefined && <span className="text-chat-removed tabular-nums">-{deleted}</span>}
                <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', expanded && 'rotate-90')} />
            </button>
            {baseMoved !== undefined && (
                <div className="pr-3 pb-2 pl-8 text-xs text-text-faint">
                    {t('work.baseMoved', { from: baseMoved.from.slice(0, 7), to: baseMoved.to.slice(0, 7) })}
                </div>
            )}
            {expanded && children}
        </div>
    );
}

/*
 * The files a settled turn changed, as a card; each file opens its diff in place. The host's
 * checkpoint diff comes first (the working tree against the tree the turn started from), then the
 * unified diffs the CLI reported, then the before and after of its own edits. A turn that has a
 * checkpoint but no stored diff asks the host for one, which is also how a running turn gets it.
 */
export function ChangedFilesRow({
    tools,
    diff,
    checkpoint,
    baseMoved,
    chatId,
    turnId
}: {
    tools: ChatToolItem[];
    diff: ChatCheckpointDiff | null;
    checkpoint: boolean;
    baseMoved?: BaseMoved | undefined;
    chatId: string;
    turnId: string;
}) {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [fetched, setFetched] = useState<ChatCheckpointDiff | null>(null);
    const actions = useChatActions();
    useEffect(() => {
        if (diff !== null || !checkpoint) {
            return;
        }
        let alive = true;
        void actions
            .turnDiff(chatId, turnId)
            .then((answer) => {
                if (alive) {
                    setFetched(answer);
                }
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [actions, chatId, turnId, diff, checkpoint]);
    const checkpointDiff = diff ?? fetched;
    const { keyOf } = useChatScope();
    const flash = useTimelineFlash((s) => s.target);
    const revealNonce = flash !== null && flash.opens && flash.key === keyOf(chatId) && flash.rowId === `files-${turnId}` ? flash.nonce : 0;
    if (checkpointDiff !== null && checkpointDiff.files.length > 0) {
        const files = checkpointDiff.files;
        return (
            <ChangedFilesCard
                revealNonce={revealNonce}
                baseMoved={baseMoved}
                count={files.length}
                truncated={checkpointDiff.truncated}
                added={files.reduce((sum, file) => sum + file.added, 0)}
                deleted={files.reduce((sum, file) => sum + file.deleted, 0)}
            >
                {files.map((file) => (
                    <ChangedFileLine
                        key={file.path}
                        path={file.path}
                        open={open[file.path] === true}
                        onToggle={() => setOpen((o) => ({ ...o, [file.path]: !o[file.path] }))}
                        trailing={
                            <>
                                <span className="text-chat-added tabular-nums">+{file.added}</span>
                                <span className="text-chat-removed tabular-nums">-{file.deleted}</span>
                            </>
                        }
                    >
                        <CheckpointFileBody file={file} />
                    </ChangedFileLine>
                ))}
            </ChangedFilesCard>
        );
    }
    return <ProviderChangedFiles tools={tools} open={open} setOpen={setOpen} revealNonce={revealNonce} />;
}

interface FileReviews {
    readonly path: string;
    readonly count: number;
    readonly reviews: readonly ReviewEntry[];
}

function ProviderReviewFiles({
    reviews,
    open,
    setOpen
}: {
    reviews: readonly FileReviews[];
    open: Record<string, boolean>;
    setOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
    const { t } = useTranslation('agent-chat');
    const stack = useReviewStack(reviews.filter(({ path }) => open[path] === true).flatMap(({ reviews }) => reviews));
    return reviews.map(({ path, count, reviews }) => (
        <ChangedFileLine
            key={path}
            path={path}
            open={open[path] === true}
            onToggle={() => setOpen((previous) => ({ ...previous, [path]: !previous[path] }))}
            trailing={<span className="text-text-faint">{t('work.edits', { count })}</span>}
        >
            <ReviewStackView entries={reviews} stack={stack} />
        </ChangedFileLine>
    ));
}

/* The fallback card, built from what the CLI itself reported about its edits. */
function ProviderChangedFiles({
    tools,
    open,
    setOpen,
    revealNonce
}: {
    tools: ChatToolItem[];
    open: Record<string, boolean>;
    revealNonce: number;
    setOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
    const byPath = new Map<string, { edits: FileChange[]; patches: ChatFileChange[] }>();
    const entryFor = (path: string) => {
        const existing = byPath.get(path);
        if (existing) {
            return existing;
        }
        const created = { edits: [] as FileChange[], patches: [] as ChatFileChange[] };
        byPath.set(path, created);
        return created;
    };
    for (const tool of tools) {
        const patches = unifiedChanges(tool);
        if (patches.length > 0) {
            for (const patch of patches) {
                entryFor(patch.path).patches.push(patch);
            }
            continue;
        }
        for (const change of fileChanges(tool.name, tool.input)) {
            entryFor(change.path || tool.id).edits.push(change);
        }
    }
    const reviews = [...byPath].map(([path, entry]) => ({
        path,
        count: entry.patches.length + entry.edits.length,
        reviews: reviewEntries(entry.patches, entry.edits)
    }));
    return (
        <ChangedFilesCard count={byPath.size} revealNonce={revealNonce}>
            <ProviderReviewFiles reviews={reviews} open={open} setOpen={setOpen} />
        </ChangedFilesCard>
    );
}

/* "Working for 00:14". */
export function WorkingRow({ startedAt }: { startedAt: number }) {
    const { t } = useTranslation('agent-chat');
    const ref = useTickingText(() => formatClockDuration(Date.now() - startedAt));
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-muted">
            <span className={`${ROW_GUTTER} text-status-running`}>
                <Spinner size={12} />
            </span>
            <span className="chat-live-text">{t('work.workingFor')}</span>
            <span ref={ref} className="tabular-nums" />
        </div>
    );
}
