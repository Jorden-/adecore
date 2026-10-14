import { createContext, type ReactNode } from 'react';
import type { UiComponentName, UiProps, UiViewNode } from '@adecore/intelligent-ui';
import type { UiLinkTarget } from '@adecore/intelligent-ui/links';

export type { UiLinkTarget };

/* How the host lets a link be drawn: a chip it can open, or plain text it cannot. */
export interface UiLink {
    state: 'chip' | 'plain';
    /* What the host calls the target, such as the title of a node or the subject of a commit. */
    label?: string;
    /* Why a plain link is not a chip, in its tooltip. */
    reason?: string;
    /* The stable code of that reason, which a client words itself where it knows it. */
    code?: string;
}

/* The point a Place stands at, in decimal degrees. */
export interface UiPlacePoint {
    lat: number;
    lon: number;
    /* What the host called the point it found, such as the street and town. */
    label?: string;
}

/* The Choice that answered a block. `sending` already reads as sent, so a second click does nothing. */
export interface UiAnswer {
    choiceId: string;
    state: 'sending' | 'sent' | 'queued';
}

/* What the footer of a block that reads live data says about its last reading. */
export interface UiLiveStatus {
    state: 'fresh' | 'reading' | 'failed' | 'refused';
    /* What the block reads, by the names a person knows them by. */
    sources: readonly string[];
    /* The last reading that succeeded, in milliseconds since the epoch; null when nothing was read yet. */
    readAt: number | null;
    /* The source that failed or was refused. */
    source?: string;
    /* Why a reading failed, in its tooltip. */
    reason?: string;
    /* The stable code of that reason, which a client words itself where it knows it. */
    code?: string;
}

/* Live history is separate from the comparison the agent supplies in Stat.previous. */
export interface UiLiveValue {
    previous?: unknown;
    changed: boolean;
    stale: boolean;
}

/*
 * What every renderer of a block knows besides its node. The callbacks are the host's: left out, a link
 * stays plain text, a source cannot be opened and a choice stays closed.
 */
export interface UiRenderContext {
    scopeId: string;
    chatId: string;
    itemId: string;
    blockId: string;
    phase: 'streaming' | 'final';
    answer: UiAnswer | null;
    /* The Choice whose last send failed, which opened the block again. */
    failedChoiceId?: string | null;
    live?: UiLiveStatus | null;
    link?(target: UiLinkTarget): UiLink;
    openLink?(target: UiLinkTarget): void;
    openUrl?(url: string): void;
    onChoose?(nodeId: string): void;
    /* Why the choices are closed while `onChoose` is absent, such as live data still being read; without it they say they are not available. */
    choiceReason?: string | null;
    /* Where the Place of `nodeId` stands: undefined while it is not looked up yet, null when no point was found. */
    place?(nodeId: string): UiPlacePoint | null | undefined;
    /* Table cells use the evaluated rows index and column key. */
    liveValue?(nodeId: string, prop: string, path?: readonly [row: number, key: string]): UiLiveValue | undefined;
}

export interface UiRendererProps<Props> {
    /* Valid and evaluated; its children are there as metadata, such as the columns of a table. */
    node: UiViewNode<Props>;
    /* The rendered children, in order, each inside its own error boundary. */
    children: ReactNode;
    context: UiRenderContext;
}

export type UiRenderer<Props> = (props: UiRendererProps<Props>) => ReactNode;

/* A renderer for every name in the catalog, or null where the runtime draws the node some other way. */
export type UiRenderers = { readonly [Name in UiComponentName]: UiRenderer<UiProps<Name>> | null };

/* The id of the Summary that heads the block. Undefined outside a frame, where every Summary heads. */
export const UiHeadContext = createContext<string | null | undefined>(undefined);
