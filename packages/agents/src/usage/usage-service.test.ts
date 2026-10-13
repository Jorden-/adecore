import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '../events.ts';
import { UsageService } from './usage-service.ts';

const made: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('a summary does not wait for the price table or the rate, and their arrival is announced', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-usage-service-'));
    made.push(home);
    const answers: Array<() => void> = [];
    globalThis.fetch = ((url: string) =>
        new Promise<Response>((resolve) => {
            const body = String(url).includes('frankfurter') ? { date: '2026-10-13', rates: { EUR: 0.9 } } : {};
            answers.push(() => resolve(Response.json(body)));
        })) as typeof fetch;
    const service = new UsageService({ home, roots: [], knownProjects: async () => [] });
    const events: AgentEvent[] = [];
    service.subscribe('client', (event) => events.push(event));

    const summary = await service.summary({ from: '2026-10-13', to: '2026-10-13', resolution: 'day', timeZone: 'UTC' });
    expect(summary.rate).toBeNull();
    expect(answers).toHaveLength(2);

    for (const answer of answers) {
        answer();
    }
    await Bun.sleep(20);
    expect(events.map((event) => event.event)).toEqual(['usage.changed']);
    const again = await service.summary({ from: '2026-10-13', to: '2026-10-13', resolution: 'day', timeZone: 'UTC' });
    expect(again.rate?.rate).toBe(0.9);
    service.stop();
});
