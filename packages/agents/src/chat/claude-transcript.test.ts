import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectSlug, findClaudeSession, findSubagentsDir } from './claude-transcript.ts';

const SESSION = '0b6f3c1e-4a2d-4f7e-9c8b-1d2e3f4a5b6c';

let projects: string;

async function transcriptIn(cwd: string, sessionId = SESSION): Promise<string> {
    const dir = join(projects, claudeProjectSlug(cwd));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    await writeFile(path, '{"type":"user"}\n');
    return path;
}

beforeEach(async () => {
    projects = await mkdtemp(join(tmpdir(), 'adecore-claude-sessions-'));
});

afterEach(async () => {
    await rm(projects, { recursive: true, force: true });
});

describe('findClaudeSession', () => {
    test("takes the transcript in the folder of the chat's own directory over one elsewhere", async () => {
        await transcriptIn('/work/other');
        const own = await transcriptIn('/work/demo');
        expect(await findClaudeSession(projects, SESSION, '/work/demo')).toBe(own);
    });

    test('finds a session in another project folder by its id alone', async () => {
        const elsewhere = await transcriptIn('/work/other');
        expect(await findClaudeSession(projects, SESSION, '/work/demo')).toBe(elsewhere);
        expect(await findClaudeSession(projects, SESSION)).toBe(elsewhere);
    });

    test('searches again once the file it found before was deleted', async () => {
        const first = await transcriptIn('/work/first');
        expect(await findClaudeSession(projects, SESSION)).toBe(first);
        await rm(first);
        expect(await findClaudeSession(projects, SESSION)).toBeNull();
        const second = await transcriptIn('/work/second');
        expect(await findClaudeSession(projects, SESSION)).toBe(second);
    });

    test('answers null for a session nobody kept, a missing projects folder and an id that reaches outside', async () => {
        await transcriptIn('/work/demo');
        expect(await findClaudeSession(projects, 'missing')).toBeNull();
        expect(await findClaudeSession(join(projects, 'nope'), SESSION)).toBeNull();
        expect(await findClaudeSession('', SESSION)).toBeNull();
        expect(await findClaudeSession(projects, `../${SESSION}`)).toBeNull();
        expect(await findClaudeSession(projects, `a\\${SESSION}`)).toBeNull();
    });
});

describe('findSubagentsDir', () => {
    test('is the folder beside the transcript, once the CLI made it', async () => {
        const transcript = await transcriptIn('/work/other');
        expect(await findSubagentsDir(projects, '/work/demo', SESSION)).toBeNull();
        const dir = join(transcript, '..', SESSION, 'subagents');
        await mkdir(dir, { recursive: true });
        expect(await findSubagentsDir(projects, '/work/demo', SESSION)).toBe(dir);
    });
});
