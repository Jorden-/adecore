import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@base-ui/react/tabs';
import { Search, X, type LucideIcon } from 'lucide-react';
import { CloseButton } from '../CloseButton.tsx';
import { DialogDescription, DialogPopup, DialogRoot, DialogTitle } from '../dialog/parts.tsx';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import { Icon } from '../Icon.tsx';
import { IconButton } from '../IconButton.tsx';
import { LazyBoundary } from '../LazyBoundary.tsx';
import { Input } from '../Input.tsx';
import { Select } from '../Select.tsx';
import { SettingsTargetContext } from './target.ts';

export interface SettingsSectionEntry {
    id: string;
    icon: LucideIcon;
    label: string;
    /* One line under the pane title that says what the pane is about. */
    description: string;
    /* Rendered in a `LazyBoundary`, so a lazy component loads when its section is opened. */
    pane: ComponentType;
    /* A list beside a detail that scrolls on its own (`MasterDetail`), instead of one padded column. */
    split?: boolean;
    /* A block above the pane that runs to its edges, with the title bar floating over its top. Loads with
       the pane; a `split` section draws none. */
    hero?: ComponentType;
}

export interface SettingsGroupEntry {
    /* The first group usually goes without one. */
    label: string | null;
    sections: readonly SettingsSectionEntry[];
}

export interface SettingsSearchResult {
    section: string;
    /* The row to reveal (a `SettingsRow` `searchId`), or null for a result that is the pane itself. */
    id: string | null;
    label: string;
}

export interface SettingsSearch {
    find(query: string): readonly SettingsSearchResult[];
    /* The shortcut that focuses the field, as it is printed. */
    hint?: string;
    /* Focuses and selects the field each time it grows. */
    focusAt?: number;
}

export interface SettingsDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    section: string;
    /* A tab or a section picked, or a search result with the row it leads to. */
    onNavigate(next: { section: string; target?: string | null }): void;
    groups: readonly SettingsGroupEntry[];
    /* At the foot of the navigation, under the groups. */
    footer?: readonly SettingsSectionEntry[];
    /* Under the footer sections, past a hairline: a section whose tab the app draws itself (a `Tabs.Tab`
       with the section's id as its value), such as an account. */
    account?: { section: SettingsSectionEntry; tab: ReactNode };
    search?: SettingsSearch;
    /* The row a search result jumped to, lit until `onTargetShown`. */
    target?: string | null;
    onTargetShown?(): void;
    /* Extra on the popup. */
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

/* How far a pane with a hero scrolls before the title bar over it is filled in. */
const BAR_FILL_DISTANCE = 70;

const NAV_ITEM =
    'flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm focus-visible:-outline-offset-2 text-text-muted hover:bg-surface-hover hover:text-text data-active:bg-surface-active data-active:text-text';

function NavTab({ section }: { section: SettingsSectionEntry }) {
    return (
        <Tabs.Tab value={section.id} className={NAV_ITEM}>
            <Icon icon={section.icon} size={16} className="shrink-0 text-text-faint" />
            <span className="truncate">{section.label}</span>
        </Tabs.Tab>
    );
}

function SettingsNav({ groups, footer, account }: Pick<SettingsDialogProps, 'groups' | 'footer' | 'account'>) {
    const { t } = useTranslation('ui');
    return (
        <Tabs.List aria-label={t('settings.sections')} activateOnFocus className="flex min-h-0 grow flex-col">
            <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
                {groups.map((group) => (
                    <div key={group.sections[0]!.id} className="flex flex-col gap-0.5">
                        {group.label !== null && <span className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-text-faint">{group.label}</span>}
                        {group.sections.map((section) => (
                            <NavTab key={section.id} section={section} />
                        ))}
                    </div>
                ))}
            </div>
            {(footer?.length || account) && (
                <div className="mt-auto flex flex-col gap-3 pt-3.5">
                    {footer?.map((section) => (
                        <NavTab key={section.id} section={section} />
                    ))}
                    {account && <div className="-mx-3 -mb-1 border-t border-border px-3 pt-3">{account.tab}</div>}
                </div>
            )}
        </Tabs.List>
    );
}

interface SearchFieldProps {
    search: SettingsSearch;
    query: string;
    onQuery(query: string): void;
    onPick(result: SettingsSearchResult): void;
}

function SearchField({ search, query, onQuery, onPick }: SearchFieldProps) {
    const { t } = useTranslation('ui');
    const input = useRef<HTMLInputElement>(null);
    const focusAt = search.focusAt ?? 0;

    useEffect(() => {
        if (focusAt > 0) {
            input.current?.focus();
            input.current?.select();
        }
    }, [focusAt]);

    return (
        <div className="relative shrink-0">
            <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
            <Input
                ref={input}
                className="bg-surface-sunken pr-12 pl-8 text-xs"
                placeholder={t('settings.search.placeholder')}
                aria-label={t('settings.search.placeholder')}
                value={query}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                    // Escape clears the search first; the dialog only closes on an empty field.
                    if (event.key === 'Escape' && query) {
                        event.stopPropagation();
                        onQuery('');
                    }
                    if (event.key === 'Enter') {
                        const first = search.find(query)[0];
                        if (first) {
                            onPick(first);
                        }
                    }
                }}
            />
            {query ? (
                <IconButton
                    icon={X}
                    size="sm"
                    label={t('settings.search.clear')}
                    tooltip={false}
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    onClick={() => onQuery('')}
                />
            ) : (
                search.hint && (
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-text-faint" aria-hidden>
                        {search.hint}
                    </span>
                )
            )}
        </div>
    );
}

interface SearchResultsProps {
    search: SettingsSearch;
    query: string;
    labelOf(section: string): string;
    onPick(result: SettingsSearchResult): void;
}

/* In place of the navigation while a query is typed: the panes and rows that match, each a jump to where it lives. */
function SearchResults({ search, query, labelOf, onPick }: SearchResultsProps) {
    const { t, i18n } = useTranslation('ui');
    // The language is a dependency the linter cannot see; every result reads its words off i18next.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const results = useMemo(() => search.find(query), [search.find, query, i18n.language]);

    if (results.length === 0) {
        return <p className="px-2.5 py-1 text-xs break-words text-text-muted">{t('settings.search.none', { query: query.trim() })}</p>;
    }
    return (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-label={t('settings.search.results')}>
            {results.map((result) => (
                <li key={`${result.section}:${result.id ?? ''}`}>
                    <button
                        type="button"
                        className="flex w-full min-w-0 flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-surface-hover"
                        onClick={() => onPick(result)}
                    >
                        <span className="truncate text-sm text-text">{result.label}</span>
                        <span className="truncate text-xs text-text-faint">{result.id === null ? t('settings.search.pane') : labelOf(result.section)}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

/* Sections on the left, one pane on the right. A pane mounts only while its section is open. */
export function SettingsDialog({
    open,
    onOpenChange,
    section,
    onNavigate,
    groups,
    footer = [],
    account,
    search,
    target = null,
    onTargetShown,
    className,
    ref
}: SettingsDialogProps) {
    const { t } = useTranslation('ui');
    const [query, setQuery] = useState('');
    const sections = [...groups.flatMap((group) => group.sections), ...footer, ...(account ? [account.section] : [])];
    const meta = sections.find((entry) => entry.id === section) ?? sections[0]!;
    const items = sections.map((entry) => ({ value: entry.id, label: entry.label }));
    const searching = search !== undefined && query.trim() !== '';
    const floating = meta.hero !== undefined && !meta.split;
    const barFill = useRef<HTMLDivElement>(null);
    // The latest callback behind a stable one, so a lit row's timer does not start over on every render.
    const latestShown = useRef(onTargetShown);
    useEffect(() => {
        latestShown.current = onTargetShown;
    });
    const targetValue = useMemo(() => ({ target, shown: () => latestShown.current?.() }), [target]);

    const labelOf = (id: string): string => sections.find((entry) => entry.id === id)?.label ?? id;
    const pick = (result: SettingsSearchResult): void => onNavigate({ section: result.section, target: result.id });

    return (
        <DialogRoot
            open={open}
            onOpenChange={(next) => {
                onOpenChange(next);
                if (!next) {
                    setQuery('');
                }
            }}
        >
            {/* The width steps down with the viewport: a narrower navigation on a tablet, and a menu of
                sections instead of the column where even that leaves the panes too little room. */}
            <DialogPopup ref={ref} className={clsx('flex h-[760px] w-[1200px]', className)}>
                <Tabs.Root
                    value={meta.id}
                    onValueChange={(value) => onNavigate({ section: value as string })}
                    orientation="vertical"
                    className="flex min-h-0 min-w-0 grow max-[640px]:flex-col"
                >
                    <div className="flex w-58 shrink-0 flex-col gap-3.5 border-r border-border bg-surface bg-clip-padding px-3 py-4 max-[960px]:w-48 max-[640px]:w-auto max-[640px]:flex-row max-[640px]:items-center max-[640px]:border-r-0 max-[640px]:border-b">
                        <DialogTitle className="px-2.5 pt-1 max-[640px]:pt-0">{t('settings.title')}</DialogTitle>
                        <div className="contents max-[640px]:hidden">
                            {search && <SearchField search={search} query={query} onQuery={setQuery} onPick={pick} />}
                            {searching ? (
                                <SearchResults search={search} query={query} labelOf={labelOf} onPick={pick} />
                            ) : (
                                <SettingsNav groups={groups} footer={footer} account={account} />
                            )}
                        </div>
                        <div className="min-w-0 grow min-[641px]:hidden">
                            <Select value={meta.id} items={items} onValueChange={(value) => onNavigate({ section: value })} label={t('settings.section')} />
                        </div>
                    </div>
                    {/* The header sits outside the panels: inside one it remounts on every section
                        change, which throws the keyboard's focus away mid-arrow-key. */}
                    <div className="relative flex min-h-0 min-w-0 grow flex-col">
                        <div
                            className={clsx('flex min-w-0 items-start gap-4 px-8 pt-5.5 pb-4.5 max-[960px]:px-4', floating && 'absolute inset-x-0 top-0 z-10')}
                        >
                            {floating && (
                                // Keyed by section, so the next pane opens under a clear bar again.
                                <div
                                    key={meta.id}
                                    ref={barFill}
                                    className="absolute inset-0 -z-10 border-b border-border bg-surface-raised opacity-0"
                                    aria-hidden
                                />
                            )}
                            <div className="min-w-0 grow">
                                <h2 className="text-lg font-semibold text-text">{meta.label}</h2>
                                <p className="mt-0.5 text-xs break-words text-text-muted">{meta.description}</p>
                            </div>
                            <CloseButton label={t('settings.close')} dialog />
                        </div>
                        <SettingsTargetContext value={targetValue}>
                            {sections.map((entry) => {
                                const Pane = entry.pane;
                                const Hero = entry.split ? undefined : entry.hero;
                                return (
                                    <Tabs.Panel
                                        key={entry.id}
                                        value={entry.id}
                                        keepMounted={false}
                                        className={clsx(
                                            'flex min-h-0 min-w-0 grow flex-col outline-none',
                                            // A split pane scrolls each of its sides itself.
                                            !entry.split && 'gap-7 overflow-y-auto px-8 pb-10 max-[960px]:px-4',
                                            // Under a hero the bar's fill marks the edge; a fade would wipe the hero out behind the clear bar.
                                            !entry.split && !Hero && 'scroll-fade-top pt-1'
                                        )}
                                        onScroll={(event) => {
                                            const top = event.currentTarget.scrollTop;
                                            event.currentTarget.toggleAttribute('data-fade-start', top > 0);
                                            barFill.current?.style.setProperty('opacity', String(Math.min(top / BAR_FILL_DISTANCE, 1)));
                                        }}
                                    >
                                        <ErrorBoundary label={t('settings.failed')} className="min-h-0 grow">
                                            <LazyBoundary>
                                                {Hero && (
                                                    <div className="-mx-8 shrink-0 max-[960px]:-mx-4">
                                                        <Hero />
                                                    </div>
                                                )}
                                                <Pane />
                                            </LazyBoundary>
                                        </ErrorBoundary>
                                    </Tabs.Panel>
                                );
                            })}
                        </SettingsTargetContext>
                    </div>
                </Tabs.Root>
                <DialogDescription className="sr-only">{meta.description}</DialogDescription>
            </DialogPopup>
        </DialogRoot>
    );
}
