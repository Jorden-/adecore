import './test-setup.ts';
import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setFormatSource, type FormatSource } from '@adecore/ui/format';
import { fakeFormatSource } from '@adecore/ui/testing';
import { LatestCommit } from './CodeAuthorsCard.tsx';

const DAY = 24 * 60 * 60;
// Blame writes when a commit was made in seconds since the epoch.
const COMMITTED = new Date(2026, 8, 19, 8, 5).getTime() / 1000;

const source = fakeFormatSource();
let previous: FormatSource;

beforeAll(() => {
    previous = setFormatSource(source);
    source.set({ region: 'nl-NL', language: 'en' });
});

afterAll(() => {
    setFormatSource(previous);
    setSystemTime();
});

const ageAt = (now: number): string => {
    setSystemTime(new Date(now * 1000));
    const markup = renderToStaticMarkup(
        createElement(LatestCommit, {
            commit: { hash: 'abc1234def', shortHash: 'abc1234', author: 'Ada', email: 'ada@example.com', at: COMMITTED, summary: 'Run it' }
        })
    );
    return /<span class="shrink-0">([^<]*)<\/span>/.exec(markup)?.[1] ?? '';
};

test('the latest commit says how long ago it was for a week, then its day, and the year once that is another', () => {
    expect(ageAt(COMMITTED + 3 * DAY)).toBe('3d ago');
    expect(ageAt(COMMITTED + 7 * DAY - 1)).toBe('6d ago');
    expect(ageAt(COMMITTED + 7 * DAY)).toBe('19 Sep');
    expect(ageAt(COMMITTED + 120 * DAY)).toBe('19 Sep 2026');
    expect(ageAt(COMMITTED - 60)).toBe('now');
});
