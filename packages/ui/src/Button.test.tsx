import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './Button.tsx';

describe('a button', () => {
    test('is a 32 pixel rounded rectangle by default', () => {
        const markup = renderToStaticMarkup(<Button>Save</Button>);
        expect(markup).toContain('h-8');
        expect(markup).toContain('rounded-md');
        expect(markup).toContain('text-xs');
    });

    test('is a 36 pixel pill that ignores its size', () => {
        const markup = renderToStaticMarkup(
            <Button shape="pill" size="xs">
                Continue
            </Button>
        );
        expect(markup).toContain('h-9');
        expect(markup).toContain('rounded-full');
        expect(markup).toContain('text-sm');
        expect(markup).not.toContain('h-6');
        expect(markup).not.toContain('rounded-md');
    });
});
