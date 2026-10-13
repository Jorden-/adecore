import { describe, expect, test } from 'bun:test';
import { CHAT_READING_WIDTHS, isChatReadingWidth, readingMeasure, readingWidthLabel, readingWidthStyle } from './reading-width';

describe('reading width', () => {
    test('comfortable is the column a chat of its own always had', () => {
        expect(readingMeasure('comfortable')).toBe(768);
        expect(readingWidthStyle('comfortable') as Record<string, string>).toEqual({ '--chat-measure': '768px' });
    });

    test('narrow is narrower and full has no bound', () => {
        expect(readingMeasure('narrow')).toBeLessThan(readingMeasure('comfortable'));
        expect(readingMeasure('full')).toBe(Number.POSITIVE_INFINITY);
        expect(readingWidthStyle('full') as Record<string, string>).toEqual({ '--chat-measure': '100%' });
    });

    test('only the known widths are one', () => {
        expect(CHAT_READING_WIDTHS.every(isChatReadingWidth)).toBe(true);
        expect(isChatReadingWidth('wide')).toBe(false);
        expect(isChatReadingWidth(undefined)).toBe(false);
    });

    test('every width has words', () => {
        expect(CHAT_READING_WIDTHS.map(readingWidthLabel)).toEqual(['Narrow', 'Comfortable', 'Full']);
    });
});
