import { describe, expect, test } from 'bun:test';
import { claudeProjectSlug } from './claude-transcript.ts';
import { listClaudeSessions, listCodexSessions, type SessionFs } from './external-sessions.ts';

/* An in-memory tree: a path with content is a file, every parent of one is a folder. */
function memoryFs(files: Record<string, { content: string; mtimeMs?: number }>) {
    const touched: string[] = [];
    const fs: SessionFs = {
        readdir: async (path) => {
            touched.push(path);
            const prefix = `${path}/`;
            return [
                ...new Set(
                    Object.keys(files)
                        .filter((file) => file.startsWith(prefix))
                        .map((file) => file.slice(prefix.length).split('/')[0]!)
                )
            ];
        },
        stat: async (path) => {
            touched.push(path);
            const file = files[path];
            return file === undefined ? null : { mtimeMs: file.mtimeMs ?? 1 };
        },
        readHead: async (path) => {
            touched.push(path);
            return files[path]?.content ?? '';
        }
    };
    return { fs, touched };
}

const lines = (...entries: unknown[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n');
const userLine = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'user', message: { role: 'user', content: text }, ...extra });

describe('Claude sessions', () => {
    const folder = '/work/app';
    const projects = '/home/.claude/projects';
    const dir = `${projects}/${claudeProjectSlug(folder)}`;

    test('lists the sessions of the folder with the first thing said, newest first', async () => {
        const { fs } = memoryFs({
            [`${dir}/old.jsonl`]: { content: lines(userLine('First\nprompt')), mtimeMs: 1 },
            [`${dir}/new.jsonl`]: { content: lines({ type: 'queue-operation' }, userLine('Newer prompt')), mtimeMs: 2 }
        });
        const sessions = await listClaudeSessions({ projectsDir: projects, folder, fs });
        expect(sessions.map((session) => [session.sessionId, session.title, session.updatedAt])).toEqual([
            ['new', 'Newer prompt', 2],
            ['old', 'First prompt', 1]
        ]);
    });

    test('leaves out files nobody spoke in, and the lines that are not somebody speaking', async () => {
        const { fs } = memoryFs({
            [`${dir}/sidechain.jsonl`]: { content: lines(userLine('from an agent', { isSidechain: true })) },
            [`${dir}/summary.jsonl`]: { content: lines({ type: 'summary', summary: 'x' }, { type: 'file-history-snapshot' }) },
            [`${dir}/meta.jsonl`]: { content: lines(userLine('reminder', { isMeta: true })) },
            [`${dir}/tool.jsonl`]: { content: lines({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }) },
            [`${dir}/real.jsonl`]: { content: lines(userLine('reminder', { isMeta: true }), userLine('the real one')) },
            [`${dir}/session-1/subagents/agent-a.jsonl`]: { content: lines(userLine('subagent prompt')) }
        });
        const sessions = await listClaudeSessions({ projectsDir: projects, folder, fs });
        expect(sessions.map((session) => [session.sessionId, session.title])).toEqual([['real', 'the real one']]);
    });
});

describe('Codex sessions', () => {
    const folder = '/work/app';
    const root = '/home/.codex/sessions';
    const meta = (id: string, cwd: string, extra: Record<string, unknown> = {}) => ({ type: 'session_meta', payload: { id, cwd, ...extra } });
    const said = (message: string) => ({ type: 'event_msg', payload: { type: 'user_message', message } });

    test('keeps the rollouts of the folder and drops forks, subagents and other folders', async () => {
        const { fs } = memoryFs({
            [`${root}/2026/10/10/rollout-2026-10-10T08-00-00-a.jsonl`]: { content: lines(meta('a', folder), said('Fix the lexer')), mtimeMs: 10 },
            [`${root}/2026/10/11/rollout-2026-10-11T08-00-00-b.jsonl`]: { content: lines(meta('b', folder), said('Newer')), mtimeMs: 20 },
            [`${root}/2026/10/11/rollout-2026-10-11T09-00-00-fork.jsonl`]: { content: lines(meta('fork', folder, { forked_from_id: 'a' }), said('x')) },
            [`${root}/2026/10/11/rollout-2026-10-11T10-00-00-sub.jsonl`]: {
                content: lines(meta('sub', folder, { source: { subagent: { thread_spawn: { parent_thread_id: 'b' } } } }), said('x'))
            },
            [`${root}/2026/10/11/rollout-2026-10-11T11-00-00-other.jsonl`]: { content: lines(meta('other', '/elsewhere'), said('x')) },
            [`${root}/2026/10/11/rollout-2026-10-11T12-00-00-silent.jsonl`]: { content: lines(meta('silent', folder)) }
        });
        const sessions = await listCodexSessions({ sessionsDir: root, folder, fs });
        expect(sessions.map((session) => [session.sessionId, session.title, session.updatedAt])).toEqual([
            ['b', 'Newer', 20],
            ['a', 'Fix the lexer', 10]
        ]);
    });

    test('looks only at the newest rollouts', async () => {
        const { fs } = memoryFs({
            [`${root}/2026/10/09/rollout-1.jsonl`]: { content: lines(meta('old', folder), said('old')) },
            [`${root}/2026/10/10/rollout-2.jsonl`]: { content: lines(meta('new', folder), said('new')) }
        });
        const sessions = await listCodexSessions({ sessionsDir: root, folder, fs, maxFiles: 1 });
        expect(sessions.map((session) => session.sessionId)).toEqual(['new']);
    });
});

test('nothing outside the given roots is read', async () => {
    const claude = '/home/.claude/projects';
    const codex = '/home/.codex/sessions';
    const folder = '/work/app';
    const { fs, touched } = memoryFs({
        [`${claude}/${claudeProjectSlug(folder)}/s.jsonl`]: { content: lines(userLine('hi')) },
        [`${claude}/${claudeProjectSlug('/other')}/s.jsonl`]: { content: lines(userLine('hi')) },
        [`${codex}/2026/10/10/rollout-1.jsonl`]: { content: lines({ type: 'session_meta', payload: { id: 'a', cwd: folder } }) },
        '/home/.codex/auth.json': { content: '{}' },
        '/home/.claude/.credentials.json': { content: '{}' }
    });
    await listClaudeSessions({ projectsDir: claude, folder, fs });
    await listCodexSessions({ sessionsDir: codex, folder, fs });
    expect(touched.length).toBeGreaterThan(0);
    expect(
        touched.every((path) => path === claude || path === codex || path.startsWith(`${claude}/${claudeProjectSlug(folder)}`) || path.startsWith(`${codex}/`))
    ).toBe(true);
});
