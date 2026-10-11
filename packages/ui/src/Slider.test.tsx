import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useState, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { setFormatSource, type FormatSource } from './format/locale.ts';
import { Slider, type SliderProps } from './Slider.tsx';
import { fakeFormatSource } from './testing/fake-source.ts';
import { UIProvider } from './UIProvider.tsx';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });

let previousFormatSource: FormatSource;

beforeEach(() => {
    previousFormatSource = setFormatSource(fakeFormatSource());
});

afterEach(() => {
    setFormatSource(previousFormatSource);
});

const render = (node: ReactNode): string => renderToStaticMarkup(<UIProvider i18n={i18n}>{node}</UIProvider>);

describe('a slider', () => {
    test('names its range input after the visible label and says the value with its unit', () => {
        const markup = render(<Slider label="Opacity" value={0.4} onValueChange={() => {}} min={0} max={1} step={0.05} unit="%" />);
        const labelId = /<span id="([^"]+)"[^>]*>Opacity<\/span>/.exec(markup)?.[1];
        expect(labelId).toBeDefined();
        expect(markup).toContain('type="range"');
        expect(markup).toContain(`aria-labelledby="${labelId}"`);
        expect(markup).toContain('aria-valuenow="0.4"');
        expect(markup).toContain('aria-valuetext="0.40%"');
        expect(markup).toContain('min="0"');
        expect(markup).toContain('max="1"');
        expect(markup).toContain('step="0.05"');
    });

    test('writes the value with the places of its step unless told otherwise', () => {
        expect(render(<Slider label="Agents" value={8} onValueChange={() => {}} min={1} max={16} />)).toContain('aria-valuetext="8"');
        expect(render(<Slider label="Scale" value={2} onValueChange={() => {}} min={1} max={3} step={0.5} decimals={2} />)).toContain('aria-valuetext="2.00"');
    });

    test('turns its input off when disabled', () => {
        const markup = render(<Slider label="Agents" value={8} onValueChange={() => {}} min={1} max={16} disabled />);
        expect(markup).toContain('data-disabled');
        expect(markup).toMatch(/<input[^>]*disabled/);
    });
});

// Runs with the DOM preload: `bun test --preload ./packages/ui/src/file-tree/testing/preload.ts packages/ui/src/Slider.test.tsx`.
describe.skipIf(typeof document === 'undefined')('a slider under the keyboard', () => {
    let container: HTMLDivElement;
    let changes: number[];
    let root: Root;

    function Harness(props: Omit<SliderProps, 'value' | 'onValueChange' | 'label'> & { initial: number }) {
        const { initial, ...rest } = props;
        const [value, setValue] = useState(initial);
        return (
            <Slider
                {...rest}
                label="Agents"
                value={value}
                onValueChange={(next) => {
                    changes.push(next);
                    setValue(next);
                }}
            />
        );
    }

    const mount = async (node: ReactNode): Promise<HTMLInputElement> => {
        const { createRoot } = await import('react-dom/client');
        root = createRoot(container);
        await act(async () => {
            root.render(<UIProvider i18n={i18n}>{node}</UIProvider>);
        });
        const input = container.querySelector<HTMLInputElement>('input[type="range"]');
        if (input === null) {
            throw new Error('no range input');
        }
        return input;
    };

    const press = async (input: HTMLInputElement, key: string): Promise<void> => {
        await act(async () => {
            input.focus();
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            // Base UI 1.0.0-rc.0 reads the global `window.event` while it sets a value; Chromium has one, happy-dom none.
            Object.assign(globalThis, { event });
            try {
                input.dispatchEvent(event);
            } finally {
                Reflect.deleteProperty(globalThis, 'event');
            }
        });
    };

    beforeEach(() => {
        changes = [];
        container = document.createElement('div');
        document.body.append(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test('steps with the arrows, jumps a tenth of the range with Page Up and stops at the ends', async () => {
        const input = await mount(<Harness initial={8} min={0} max={20} />);
        await press(input, 'ArrowRight');
        await press(input, 'ArrowLeft');
        await press(input, 'ArrowLeft');
        await press(input, 'PageUp');
        await press(input, 'End');
        await press(input, 'ArrowRight');
        await press(input, 'Home');
        expect(changes).toEqual([9, 8, 7, 9, 20, 0]);
        expect(input.getAttribute('aria-valuetext')).toBe('0');
    });

    test('lands on a decimal step without drift', async () => {
        const input = await mount(<Harness initial={0.2} min={0} max={1} step={0.1} />);
        await press(input, 'ArrowRight');
        await press(input, 'ArrowRight');
        expect(changes).toEqual([0.3, 0.4]);
        expect(input.getAttribute('aria-valuetext')).toBe('0.4');
    });

    test('takes its input out of the tab order when disabled', async () => {
        const input = await mount(<Harness initial={8} min={0} max={20} disabled />);
        expect(input.disabled).toBe(true);
    });
});
