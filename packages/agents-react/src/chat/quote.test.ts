import { describe, expect, test } from 'bun:test';
import { quoteOf, splitQuote, withQuote } from './quote';

describe('the text a selection quotes', () => {
    test('is nothing when only whitespace is selected', () => {
        expect(quoteOf('')).toBeNull();
        expect(quoteOf('  \n\t\n ')).toBeNull();
    });

    test('drops the blank lines around it and the spaces at the end of a line', () => {
        expect(quoteOf('\n\nThe cache is per machine.  \n\n')).toBe('The cache is per machine.');
        expect(quoteOf('first  \r\nsecond')).toBe('first\nsecond');
    });

    test('keeps one blank line between paragraphs, and the indent of a line', () => {
        expect(quoteOf('One.\n\n\n\nTwo.\n    code')).toBe('One.\n\nTwo.\n    code');
    });
});

describe('a message with a quote', () => {
    test('goes out as it was typed without one', () => {
        expect(withQuote('', 'Why?')).toBe('Why?');
    });

    test('puts every line of the quote in a blockquote above the message', () => {
        expect(withQuote('One.\n\nTwo.', 'Why?')).toBe('> One.\n>\n> Two.\n\nWhy?');
    });

    test('is only the blockquote when nothing was typed', () => {
        expect(withQuote('One.', '')).toBe('> One.');
    });
});

describe('a message split into its quote and the rest', () => {
    test('is the inverse of withQuote, blank lines inside the quote included', () => {
        const quote = 'One.\n\nTwo.\n    code';
        expect(splitQuote(withQuote(quote, 'Why?\n\nAnd more.'))).toEqual({ quote, rest: 'Why?\n\nAnd more.' });
    });

    test('is only the quote when nothing was typed', () => {
        expect(splitQuote(withQuote('One.', ''))).toEqual({ quote: 'One.', rest: '' });
    });

    test('is nothing for a message that does not open with a quote', () => {
        expect(splitQuote('Why?')).toBeNull();
        expect(splitQuote('>no space')).toBeNull();
        expect(splitQuote('> One.\nno blank line')).toBeNull();
    });
});
