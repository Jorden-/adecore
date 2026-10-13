import { StaleResultError, type CallHierarchyItem } from '@adecore/lsp';
import { KEY_PRIORITY } from './key-priority.ts';
import type { EditorPosition } from '@adecore/editor';
import type { EditorLanguage } from './editor-language.ts';
import {
    CALL_LEVEL_LIMIT,
    childrenOf,
    moreIdOf,
    rootsOf,
    rowsOf,
    statusIdOf,
    stepsOf,
    targetOf,
    type CallDirection,
    type CallNode,
    type CallRow
} from './call-hierarchy-model.ts';
import { PEEK_HEIGHT } from './peek.ts';
import { snippetOf } from './peek-model.ts';
import { isShortcut } from './shortcut-keys.ts';
import { messageOf } from './error-message.ts';
import { realTimers, revealRow, type Timers } from './timers.ts';

const TOAST_ID = 'language-call-hierarchy';
const PREPARE = 'textDocument/prepareCallHierarchy';

/* The row the panel stands in is as tall as a peek's, plus the segmented control that is a pixel taller than the peek's title bar. */
export const CALL_HIERARCHY_HEIGHT = PEEK_HEIGHT + 2;

const OWNER = 'call-hierarchy';

/*
 * The callers of the symbol at the caret, or the symbols it calls, as a tree between the lines of the file
 * under the line the caret is on, with the code around the call that is active. A node asks the server for its
 * own calls when it is opened, and a level shows its first calls with a row that brings the others.
 * The editor keeps the keyboard: arrows move and open, Enter goes to the call, Escape closes, and the
 * shortcut that opened the tree switches between callers and callees. Typing closes it.
 */
export class CallHierarchyFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private nodes = new Map<string, CallNode>();
    private roots: string[] = [];
    private prepared: CallHierarchyItem[] = [];
    private direction: CallDirection = 'incoming';
    private controller = new AbortController();
    /* Raised whenever the tree starts over or closes, so an answer for the tree that was never lands in the one that is. */
    private epoch = 0;
    private previewEpoch = 0;
    private texts = new Map<string, string>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            language.onKey((event) => {
                if (isShortcut(this.language.shortcuts.callHierarchy, event)) {
                    if (this.isOpen) {
                        this.setDirection(this.direction === 'incoming' ? 'outgoing' : 'incoming');
                    } else {
                        void this.open();
                    }
                    return true;
                }
                return this.key(event);
            }, KEY_PRIORITY.callHierarchy),
            editor.onTextChange(() => this.close())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.language.popups.getState().callHierarchy !== null;
    }

    /* Whether a server of this document answers the three requests the tree is made of. */
    get supported(): boolean {
        const { project, uri } = this.language;
        const { service } = project;
        return (
            service.prepareCallHierarchy !== undefined &&
            service.incomingCalls !== undefined &&
            service.outgoingCalls !== undefined &&
            service.supports(PREPARE, uri)
        );
    }

    /* Opens the tree for the symbol at the position, on its callers unless told otherwise. */
    async open(position: EditorPosition = this.language.editor.getCaret(), direction: CallDirection = 'incoming'): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!this.supported) {
            this.tell(this.say('unavailable'));
            return;
        }
        this.close();
        const epoch = this.epoch;
        let items: CallHierarchyItem[] | null;
        try {
            items = await project.service.prepareCallHierarchy!(uri, position, { signal: this.controller.signal });
        } catch (error) {
            if (epoch === this.epoch && !(error instanceof StaleResultError)) {
                this.tell(this.say('failed', { message: messageOf(error) }));
            }
            return;
        }
        if (epoch !== this.epoch) {
            return;
        }
        if (items === null || items.length === 0) {
            this.tell(this.say('none'));
            return;
        }
        this.language.peek.close();
        this.prepared = items;
        this.direction = direction;
        this.seed();
        const active = this.roots[0]!;
        this.language.popups.setState({
            callHierarchy: { direction, container: null, name: items[0]!.name, rows: rowsOf(this.nodes, this.roots), active, site: 0, sites: 0, preview: null }
        });
        this.select(active);
        // The editor draws a row once per id, so a tree opened over another needs an id of its own to get a container.
        editor.setWidgets(
            [{ id: `call-hierarchy-${epoch}`, line: position.line, height: CALL_HIERARCHY_HEIGHT, render: (container) => this.mounted(container) }],
            OWNER
        );
        editor.focus();
        for (const root of this.roots) {
            void this.load(root);
        }
    }

    close(): void {
        this.reset();
        if (this.language.popups.getState().callHierarchy === null) {
            return;
        }
        this.language.popups.setState({ callHierarchy: null });
        this.language.editor.setWidgets([], OWNER);
        this.language.editor.setInputPopup(null);
        this.language.editor.focus();
    }

    /* Starts the tree over from the same symbols for the other direction. */
    setDirection(direction: CallDirection): void {
        const view = this.language.popups.getState().callHierarchy;
        if (view === null || view.direction === direction) {
            return;
        }
        this.reset();
        this.direction = direction;
        this.seed();
        const active = this.roots[0]!;
        this.language.popups.setState({
            callHierarchy: { ...view, direction, rows: rowsOf(this.nodes, this.roots), active, site: 0, sites: 0, preview: null }
        });
        this.select(active);
        for (const root of this.roots) {
            void this.load(root);
        }
    }

    /* Opens a node, asking the server for its calls the first time, or folds it away. */
    toggle(id: string): void {
        const node = this.nodes.get(id);
        if (node === undefined) {
            return;
        }
        if (node.expanded) {
            this.patch(id, { expanded: false });
            const view = this.language.popups.getState().callHierarchy;
            if (view !== null && this.hasAncestor(view.active, id)) {
                this.select(id);
            }
            return;
        }
        this.patch(id, { expanded: true });
        if (node.load === 'idle' || node.load === 'failed') {
            void this.load(id);
        }
    }

    /* Asks again for the calls of a node whose last try failed. */
    retry(id: string): void {
        if (this.nodes.get(id)?.load === 'failed') {
            void this.load(id);
        }
    }

    /* Brings the next stretch of calls of a level. */
    showMore(parent: string): void {
        const node = this.nodes.get(parent);
        if (node === undefined) {
            return;
        }
        this.patch(parent, { shown: Math.min(node.children.length, node.shown + CALL_LEVEL_LIMIT) });
        const first = node.children[node.shown];
        const view = this.language.popups.getState().callHierarchy;
        // The row that offered more is gone once everything shows, so the selection moves on to what it brought.
        if (first !== undefined && view?.active === moreIdOf(parent)) {
            this.select(first);
        }
    }

    /* Makes a row the active one and shows the code of its call. */
    select(id: string, site = 0): void {
        const view = this.language.popups.getState().callHierarchy;
        const node = this.nodes.get(id);
        if (view === null || !view.rows.some((row) => row.id === id)) {
            return;
        }
        const sites = node?.sites.length ?? view.sites;
        const next = node === undefined ? view.site : Math.max(0, Math.min(Math.max(0, sites - 1), site));
        this.language.popups.setState({ callHierarchy: { ...view, active: id, site: next, sites, preview: node === undefined ? view.preview : null } });
        if (node !== undefined) {
            void this.preview(node, next);
        }
    }

    /* Steps through the places a call is made from when the active one has more than one. */
    stepSite(direction: 1 | -1): void {
        const view = this.language.popups.getState().callHierarchy;
        if (view !== null && view.sites > 1) {
            this.select(view.active, (view.site + direction + view.sites) % view.sites);
        }
    }

    /* Goes to the call of a row, or to the symbol of a root, and closes the tree. */
    go(id: string): void {
        const view = this.language.popups.getState().callHierarchy;
        const node = this.nodes.get(id);
        if (view === null || node === undefined) {
            return;
        }
        const { uri, range } = targetOf(node, id === view.active ? view.site : 0);
        this.close();
        this.language.goTo({ uri, range });
    }

    private reset(): void {
        this.epoch++;
        this.previewEpoch++;
        this.controller.abort();
        this.controller = new AbortController();
        this.nodes = new Map();
        this.roots = [];
        this.texts = new Map();
    }

    private seed(): void {
        const roots = rootsOf(this.prepared);
        this.roots = roots.map((root) => root.id);
        this.nodes = new Map(roots.map((root) => [root.id, root]));
    }

    private mounted(container: HTMLElement): void {
        const view = this.language.popups.getState().callHierarchy;
        if (view !== null && view.container !== container) {
            this.language.popups.setState({ callHierarchy: { ...view, container } });
            revealRow(this.timers, container);
        }
    }

    private patch(id: string, change: Partial<CallNode>): void {
        const node = this.nodes.get(id);
        const view = this.language.popups.getState().callHierarchy;
        if (node === undefined || view === null) {
            return;
        }
        this.nodes.set(id, { ...node, ...change });
        this.language.popups.setState({ callHierarchy: { ...view, rows: rowsOf(this.nodes, this.roots) } });
    }

    private async load(id: string): Promise<void> {
        const node = this.nodes.get(id);
        if (node === undefined || node.load === 'loading') {
            return;
        }
        const { service, i18n } = this.language.project;
        const { uri, editor } = this.language;
        const { direction, epoch } = this;
        const options = { signal: this.controller.signal, parallel: true };
        this.patch(id, { load: 'loading', error: null });
        try {
            const calls =
                direction === 'incoming' ? await service.incomingCalls!(uri, node.item, options) : await service.outgoingCalls!(uri, node.item, options);
            if (epoch !== this.epoch) {
                return;
            }
            const children = childrenOf(direction, node, calls ?? []);
            for (const child of children) {
                this.nodes.set(child.id, child);
            }
            this.patch(id, { load: 'loaded', children: children.map((child) => child.id), shown: Math.min(children.length, CALL_LEVEL_LIMIT) });
            editor.announce(i18n.t(`editor:language.callHierarchy.announce.${direction}`, { count: children.length, name: node.item.name }));
        } catch (error) {
            if (epoch !== this.epoch) {
                return;
            }
            if (error instanceof StaleResultError) {
                this.close();
                return;
            }
            this.patch(id, { load: 'failed', error: messageOf(error) });
        }
    }

    private async preview(node: CallNode, site: number): Promise<void> {
        const { project } = this.language;
        const epoch = ++this.previewEpoch;
        const { uri, range } = targetOf(node, site);
        let text = this.texts.get(uri);
        if (text === undefined) {
            try {
                text = (await project.readText(uri)) ?? undefined;
            } catch {
                // A file that cannot be read shows no code, as one that is no text file does.
                text = undefined;
            }
            if (epoch !== this.previewEpoch) {
                return;
            }
            if (text !== undefined) {
                this.texts.set(uri, text);
            }
        }
        const view = this.language.popups.getState().callHierarchy;
        if (view === null || view.active !== node.id) {
            return;
        }
        const snippet = text === undefined ? null : snippetOf(text, range.start.line, range);
        this.language.popups.setState({ callHierarchy: { ...view, preview: snippet === null ? null : { ...snippet, uri } } });
    }

    /* Whether a row stands under a node; the `more` and `status` rows belong to the node they are about. */
    private hasAncestor(id: string, ancestor: string): boolean {
        const owner = [moreIdOf(''), statusIdOf('')]
            .map((suffix) => (id.endsWith(suffix) ? id.slice(0, -suffix.length) : null))
            .find((found) => found !== null);
        if (owner !== undefined && owner !== null) {
            return owner === ancestor || this.hasAncestor(owner, ancestor);
        }
        for (let node = this.nodes.get(id); node !== undefined && node.parent !== null; node = this.nodes.get(node.parent)) {
            if (node.parent === ancestor) {
                return true;
            }
        }
        return false;
    }

    private key(event: KeyboardEvent): boolean {
        const view = this.language.popups.getState().callHierarchy;
        if (view === null || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) {
            return false;
        }
        const steps = stepsOf(view.rows);
        const index = steps.findIndex((row) => row.id === view.active);
        const row: CallRow | undefined = steps[index];
        switch (event.key) {
            case 'ArrowDown':
                this.land(steps[Math.min(steps.length - 1, index + 1)]);
                return true;
            case 'ArrowUp':
                this.land(steps[Math.max(0, index - 1)]);
                return true;
            case 'Home':
                this.land(steps[0]);
                return true;
            case 'End':
                this.land(steps.at(-1));
                return true;
            case 'ArrowRight':
                this.expandOrEnter(row, steps[index + 1]);
                return true;
            case 'ArrowLeft':
                this.collapseOrLeave(row);
                return true;
            case 'Enter':
                if (row?.kind === 'more') {
                    this.showMore(row.parent);
                } else if (row !== undefined) {
                    this.go(row.id);
                }
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    private land(row: CallRow | undefined): void {
        if (row !== undefined) {
            this.select(row.id);
        }
    }

    /* Right opens a closed node, tries a failed one again, and steps into an open one. */
    private expandOrEnter(row: CallRow | undefined, next: CallRow | undefined): void {
        if (row?.kind !== 'node') {
            return;
        }
        if (!row.expanded) {
            this.toggle(row.id);
        } else if (row.load === 'failed') {
            this.retry(row.id);
        } else if (next !== undefined && next.level > row.level) {
            this.land(next);
        }
    }

    /* Left closes an open node and steps out of a closed one. */
    private collapseOrLeave(row: CallRow | undefined): void {
        if (row === undefined) {
            return;
        }
        if (row.kind === 'node' && row.expanded && !row.leaf) {
            this.toggle(row.id);
            return;
        }
        const parent = row.kind === 'node' ? (this.nodes.get(row.id)?.parent ?? null) : row.parent;
        if (parent !== null) {
            this.select(parent);
        }
    }

    private tell(title: string): void {
        this.language.project.host.notify?.({ id: TOAST_ID, kind: 'error', title });
    }

    private say(key: string, options?: Record<string, unknown>): string {
        return this.language.project.i18n.t(`editor:language.callHierarchy.${key}`, options);
    }
}
