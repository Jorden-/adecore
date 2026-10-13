import { describe, expect, test } from 'bun:test';
import { flattenThought, thoughtLine, thoughtPreview } from './thought';

describe('flattenThought', () => {
    test('drops the marks and folds every line into one', () => {
        expect(flattenThought('The test in `chat.test.ts` fails.\n\nIt **races** the [outbox](https://bas.dev).')).toBe(
            'The test in chat.test.ts fails. It races the outbox.'
        );
    });

    test('drops list markers and heading marks', () => {
        expect(flattenThought('## Plan\n- read it\n* fix it\n1. test it')).toBe('Plan read it fix it test it');
    });
});

describe('thoughtPreview', () => {
    test('is the heading a thought opens with', () => {
        expect(thoughtPreview('**Checking the failing test**\n\nThe test fails because the entry is written first.')).toBe('Checking the failing test');
    });

    test('takes a heading after leading blank lines', () => {
        expect(thoughtPreview('\n\n  **Reading the outbox**  \nIt holds two entries.')).toBe('Reading the outbox');
    });

    test('is the whole thought flattened when it opens without one', () => {
        expect(thoughtPreview('The entry is written first.\n\n**Then** the task settles.')).toBe('The entry is written first. Then the task settles.');
    });

    test('is not a heading when the bold is only part of the line', () => {
        expect(thoughtPreview('**Note** that the outbox runs first.')).toBe('Note that the outbox runs first.');
    });

    test('is empty for an empty thought', () => {
        expect(thoughtPreview('')).toBe('');
        expect(thoughtPreview('  \n ')).toBe('');
    });
});

describe('thoughtLine', () => {
    test('is the last heading, the stretch the model is on', () => {
        expect(thoughtLine('**Reading the test**\nIt fails.\n\n**Checking the outbox**\nThe entry comes first.')).toBe('Checking the outbox');
    });

    test('takes a heading that just closed at the end of a streaming thought', () => {
        expect(thoughtLine('Some words.\n\n**Running the suite**')).toBe('Running the suite');
    });

    test('ignores a heading still being written', () => {
        expect(thoughtLine('The entry is written first. So it races.\n\n**Running the')).toBe('The entry is written first.');
    });

    test('is the first sentence of a thought without headings', () => {
        expect(thoughtLine('The outbox entry is written before the task settles, so the wake races. I will check `a.ts` next.')).toBe(
            'The outbox entry is written before the task settles, so the wake races.'
        );
    });

    test('keeps a file name and a number whole', () => {
        expect(thoughtLine('Version 1.5 of a.ts breaks it? Then revert.')).toBe('Version 1.5 of a.ts breaks it?');
    });

    test('is all of it while no sentence has ended', () => {
        expect(thoughtLine('Looking at the outbox')).toBe('Looking at the outbox');
        expect(thoughtLine('')).toBe('');
    });
});
