import { join } from 'node:path';
import { RuntimeModeSchema, type RuntimeMode } from '@adecore/agent-contracts';
import { z } from 'zod';
import { RecordDirectory } from './record-directory.ts';

const LineageSchema = z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    /* The node that ran the verb; a caller is counted against this to cap one runaway agent. */
    openedBy: z.string().min(1),
    depth: z.number().int().nonnegative(),
    /* Whether this is an agent node, which is what the depth and the per-caller cap are about. A
       record written before a plain node was written down at all is one of those, hence the default. */
    agent: z.boolean().default(true),
    /* A fork is a sibling a person made beside `openedBy` rather than a node it opened; absent is opened by a verb. */
    relation: z.literal('fork').optional(),
    /* The widest mode the agent may start in, the mode of its opener when it was made. Absent on a
       record from before, and on a node nobody may widen anyway since no agent started it. */
    ceiling: RuntimeModeSchema.optional(),
    createdAt: z.number(),
    /* When stopping or deleting the node that opened it ended this one too; a cascade never ends a node twice. */
    endedAt: z.number().optional(),
    /* Set when the agent that opened this one runs on another machine; `openedBy` then names it there, not a node here. */
    peer: z.object({ machineId: z.string().min(1) }).optional()
});

type Lineage = z.infer<typeof LineageSchema>;

/* Opened by the agent it names, which is what every rule about children is about; a fork lives on its own. */
function openedByAgent(entry: Lineage): boolean {
    return entry.agent && entry.relation !== 'fork';
}

/*
 * Lives under the host's data folder, outside the agent-writable project, so an agent cannot reset its
 * own depth; on disk, so a restart of the host does not reset it either.
 */
export class AgentLineageStore {
    readonly dir: string;
    private readonly opened: RecordDirectory<Lineage>;

    constructor(dataDir: string) {
        this.dir = join(dataDir, 'lineage');
        this.opened = new RecordDirectory({ dir: this.dir, schema: LineageSchema, idOf: (entry) => entry.nodeId });
    }

    /* Reads what an earlier run of the host wrote down. Call before any verb can ask. */
    load(): Promise<void> {
        return this.opened.load();
    }

    async put(record: Omit<Lineage, 'createdAt' | 'endedAt'>): Promise<void> {
        await this.opened.write({ ...record, createdAt: Date.now() });
    }

    /*
     * The agent nodes this one opened and the ones those opened in turn that no cascade ended yet,
     * nearest first, so whoever ends them can go from the leaves back up.
     */
    descendants(nodeId: string): string[] {
        const found: string[] = [];
        const seen = new Set([nodeId]);
        for (let i = -1; i < found.length; i++) {
            const parent = i === -1 ? nodeId : found[i]!;
            for (const entry of this.opened.all()) {
                if (entry.openedBy === parent && openedByAgent(entry) && entry.endedAt === undefined && !seen.has(entry.nodeId)) {
                    seen.add(entry.nodeId);
                    found.push(entry.nodeId);
                }
            }
        }
        return found;
    }

    /* Moves a node's record to another project with its dates as they were; false when nothing was written down for it or a prune took it meanwhile. */
    async rehome(nodeId: string, projectId: string): Promise<boolean> {
        const entry = this.opened.get(nodeId);
        if (entry === undefined) {
            return false;
        }
        return this.opened.write({ ...entry, projectId });
    }

    /* The project a node was made in, for work owed about it after the node that opened it is gone. */
    projectOf(nodeId: string): string | null {
        return this.opened.get(nodeId)?.projectId ?? null;
    }

    endedAt(nodeId: string): number | null {
        return this.opened.get(nodeId)?.endedAt ?? null;
    }

    /* On the wall clock, like `createdAt`: a chat holds the mark against the time its turn started. */
    async markEnded(nodeIds: readonly string[]): Promise<void> {
        const at = Date.now();
        for (const nodeId of nodeIds) {
            const entry = this.opened.get(nodeId);
            if (entry && entry.endedAt === undefined) {
                await this.opened.write({ ...entry, endedAt: at });
            }
        }
    }

    /* The nodes of this project whose opener it no longer places, and that no cascade ended yet. */
    orphans(projectId: string, ids: ReadonlySet<string>): Array<{ nodeId: string; openedBy: string }> {
        return [...this.opened.all()]
            .filter(
                (entry) =>
                    entry.projectId === projectId && openedByAgent(entry) && entry.endedAt === undefined && ids.has(entry.nodeId) && !ids.has(entry.openedBy)
            )
            .map((entry) => ({ nodeId: entry.nodeId, openedBy: entry.openedBy }));
    }

    /* The widest mode this agent node may start in, every time it starts; null for one no agent opened. */
    ceilingOf(nodeId: string): RuntimeMode | null {
        const entry = this.opened.get(nodeId);
        return entry !== undefined && openedByAgent(entry) ? (entry.ceiling ?? null) : null;
    }

    /* The machine whose agent opened this node, or null for a node opened on this one. */
    peerOf(nodeId: string): { machineId: string } | null {
        return this.opened.get(nodeId)?.peer ?? null;
    }

    /* How deep a node sits. A node nobody wrote down is one a person made, which is where a chain starts. */
    depthOf(nodeId: string): number {
        return this.opened.get(nodeId)?.depth ?? 0;
    }

    // A host may exclude completed hidden agents while keeping their lineage for later reads and tasks.
    openedCount(callerId: string, include: (nodeId: string) => boolean = () => true): number {
        let count = 0;
        for (const entry of this.opened.all()) {
            if (entry.openedBy === callerId && openedByAgent(entry) && include(entry.nodeId)) {
                count += 1;
            }
        }
        return count;
    }

    /* Who made this node, or null for one a person made: the whole of the rule node delete follows. */
    madeBy(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry === undefined || entry.relation === 'fork' ? null : entry.openedBy;
    }

    /* The node that opened this one as an agent, or null for a node no agent or team started. */
    startedBy(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry !== undefined && openedByAgent(entry) ? entry.openedBy : null;
    }

    /* The chat a fork was made from, or null for a node that is no fork. */
    forkedFrom(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry?.relation === 'fork' ? entry.openedBy : null;
    }

    forksOf(nodeId: string): string[] {
        return [...this.opened.all()].filter((entry) => entry.relation === 'fork' && entry.openedBy === nodeId).map((entry) => entry.nodeId);
    }

    /* The forks of this project whose node is gone, read before `prune` forgets them. */
    forksLeaving(projectId: string, ids: ReadonlySet<string>): string[] {
        return [...this.opened.all()]
            .filter((entry) => entry.projectId === projectId && entry.relation === 'fork' && !ids.has(entry.nodeId))
            .map((entry) => entry.nodeId);
    }

    /* Drops what this project wrote down for ids it no longer has: the node was deleted. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.opened.prune((entry) => entry.projectId === projectId && !ids.has(entry.nodeId));
    }
}
