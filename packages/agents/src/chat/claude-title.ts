import { stat } from 'node:fs/promises';
import { isRecord } from '@adecore/agent-contracts';
import { cleanTitle, readLines } from '../title-file.ts';
import { usageRoots } from '../usage/roots.ts';
import { findClaudeSession } from './claude-transcript.ts';

interface Progress {
    offset: number;
    aiTitle: string | null;
    customTitle: string | null;
}

// The two records carry these words; a line without them is never parsed.
const MARKERS = ['"ai-title"', '"custom-title"'];

/*
 * The name Claude Code gave a session, out of its own transcript. It writes an `ai-title` record a
 * few seconds after the first prompt, anywhere in the file and more than once, and a `custom-title`
 * when a person ran /rename in the CLI, which wins because a person chose it. A transcript only ever
 * grows, so each path is read from where the previous read stopped: a file of many megabytes costs
 * its full read once, and every read after that only the lines added since.
 */
export class ClaudeTitleReader {
    private readonly progress = new Map<string, Progress>();
    private readonly projectsDir: string;
    private readonly chunkBytes: number;

    constructor(projectsDir: string = usageRoots().find((root) => root.provider === 'claude')?.path ?? '', chunkBytes = 4 * 1024 * 1024) {
        this.projectsDir = projectsDir;
        this.chunkBytes = chunkBytes;
    }

    /* The title of a session found by its id, for a chat, which knows no transcript path; in the projects of its account, its own folder first. */
    async forSession(agentSessionId: string, projectsDir: string = this.projectsDir, cwd?: string): Promise<string | null> {
        const path = await findClaudeSession(projectsDir, agentSessionId, cwd);
        return path === null ? null : await this.forTranscript(path);
    }

    async forTranscript(path: string): Promise<string | null> {
        let size: number;
        try {
            size = (await stat(path)).size;
        } catch {
            return null;
        }
        let progress = this.progress.get(path);
        // Smaller than where we were is a file that was replaced, not one that grew.
        if (!progress || size < progress.offset) {
            progress = { offset: 0, aiTitle: null, customTitle: null };
            this.progress.set(path, progress);
        }
        if (size > progress.offset) {
            const current = progress;
            current.offset = await readLines(path, current.offset, size, this.chunkBytes, (line) => this.take(line, current));
        }
        return progress.customTitle ?? progress.aiTitle;
    }

    private take(line: string, progress: Progress): void {
        if (!MARKERS.some((marker) => line.includes(marker))) {
            return;
        }
        let record: unknown;
        try {
            record = JSON.parse(line);
        } catch {
            return;
        }
        if (!isRecord(record)) {
            return;
        }
        if (record.type === 'ai-title') {
            progress.aiTitle = cleanTitle(record.aiTitle) ?? progress.aiTitle;
        } else if (record.type === 'custom-title') {
            progress.customTitle = cleanTitle(record.customTitle) ?? progress.customTitle;
        }
    }
}
