import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { create } from 'zustand';
import { Bug, Cloud, GitBranch, Play, Rocket, Search, Server, X } from 'lucide-react';
import { ButtonGroup } from './ButtonGroup.tsx';
import { ColorSwatch } from './ColorSwatch.tsx';
import { EmptyState } from './EmptyState.tsx';
import { Field, FormError } from './Field.tsx';
import { formatLocale, setFormatSource, type FormatSource } from './format/locale.ts';
import { IconButton } from './IconButton.tsx';
import { IconPicker, type IconPickerGroup } from './IconPicker.tsx';
import { Input, TextArea } from './Input.tsx';
import { Kbd } from './Kbd.tsx';
import { ListRow } from './ListRow.tsx';
import * as Menu from './menu/index.parts.ts';
import { MenuCheck } from './menu/parts.tsx';
import { Meter } from './Meter.tsx';
import { PanelHeader } from './PanelHeader.tsx';
import { SectionLabel } from './SectionLabel.tsx';
import { SegmentBar } from './SegmentBar.tsx';
import { SlidingColumn } from './SlidingColumn.tsx';
import { Spinner } from './Spinner.tsx';
import { Stepper } from './Stepper.tsx';
import * as KeyValueList from './key-value-list/index.parts.ts';
import * as Tabs from './tabs/index.parts.ts';
import { Surface } from './Surface.tsx';
import { Toasts } from './Toasts.tsx';
import { createToastStore, type ToastStore } from './toast-store.ts';
import { fakeFormatSource } from './testing/fake-source.ts';
import { UIProvider } from './UIProvider.tsx';
import { Waveform } from './Waveform.tsx';

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
const classesIn = (markup: string): string[][] => [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]!.split(/\s+/));

describe('an icon button', () => {
    test('draws the icon of its size inside the square of its size', () => {
        const markup = render(<IconButton icon={X} size="sm" label="Close" />);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['icon-btn', 'icon-btn-sm']));
        expect(markup).toContain('width="14"');
        expect(markup).toContain('aria-label="Close"');
    });

    test('is 32 with a 16 icon when it names no size', () => {
        const markup = render(<IconButton icon={X} label="Close" />);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['icon-btn']));
        expect(markup).toContain('width="16"');
    });

    test('hands its icon the classes meant for the icon, at the size of the button', () => {
        const markup = render(<IconButton icon={X} size="xs" label="Play" iconClassName="fill-current" />);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['lucide-x', 'fill-current']));
        expect(markup).toContain('width="12"');
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['icon-btn', 'icon-btn-xs']));
    });

    test('draws a spinner of its size in place of the icon while it is busy', () => {
        const markup = render(<IconButton icon={X} size="sm" label="Refresh" busy iconClassName="text-accent" />);
        expect(markup).not.toContain('lucide-x');
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['spinner', 'text-accent']));
        expect(markup).toContain('--spinner-size:14px');
    });

    test('says it is pressed as a key, and is a plain button without a tooltip', () => {
        const markup = render(<IconButton icon={X} label="Mute" active tooltip={false} />);
        expect(markup).toContain('data-active="true"');
        expect(markup).toContain('type="button"');
    });
});

describe('a spinner', () => {
    test('is hidden from a screen reader without a label, like an icon', () => {
        const markup = render(<Spinner />);
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain('--spinner-size:16px');
        expect(markup).not.toContain('role=');
    });

    test('is an image with a name when it has a label', () => {
        const markup = render(<Spinner size={12} label="Running" />);
        expect(markup).toContain('role="img" aria-label="Running"');
        expect(markup).not.toContain('aria-hidden');
        expect(markup).toContain('--spinner-size:12px');
    });
});

describe('a waveform', () => {
    test('is an image with a name when it cannot seek', () => {
        const markup = render(<Waveform levels={[0.2, 1]} duration={10} label="Score" />);
        expect(markup).toContain('role="img"');
        expect(markup).not.toContain('tabindex');
        expect(markup).not.toContain('bg-accent');
    });

    test('is a slider that says where it is when it can seek', () => {
        const markup = render(<Waveform levels={[0.2, 0.4, 0.6, 1]} duration={225} value={83} onValueChange={() => {}} label="Record" />);
        expect(markup).toContain('role="slider"');
        expect(markup).toContain('tabindex="0"');
        expect(markup).toContain('aria-valuemax="225"');
        expect(markup).toContain('aria-valuetext="01:23 of 03:45"');
    });

    test('draws the playhead and the marks inside its range only', () => {
        const markup = render(<Waveform levels={[0.5]} duration={100} range={[20, 60]} value={30} marks={[10, 40]} label="Score" />);
        expect(markup).toContain('left:25%');
        expect(markup.match(/<line/g)).toHaveLength(1);
        expect(render(<Waveform levels={[0.5]} duration={100} range={[20, 60]} value={80} label="Score" />)).not.toContain('bg-accent');
    });
});

describe('a meter', () => {
    test('fills to its level on its scale and marks the target', () => {
        const markup = render(<Meter value={-22} min={-40} max={-4} marks={[-13]} label="Momentary" valueText="-22 LUFS" />);
        expect(markup).toContain('role="meter"');
        expect(markup).toContain('aria-valuenow="-22"');
        expect(markup).toContain('aria-valuetext="-22 LUFS"');
        expect(markup).toContain('width:50%');
        expect(markup).toContain('left:75%');
    });

    test('holds a level past its scale to the ends', () => {
        const markup = render(<Meter value={140} label="Used" />);
        expect(markup).toContain('aria-valuenow="100"');
        expect(markup).toContain('width:100%');
    });

    test('draws an empty track without a level', () => {
        const markup = render(<Meter value={null} min={-40} max={-4} label="Momentary" />);
        expect(markup).toContain('aria-valuenow="-40"');
        expect(markup).not.toContain('bg-accent');
    });
});

describe('a segment bar', () => {
    test('places each part exactly at its share of the range', () => {
        const markup = render(
            <SegmentBar
                parts={[
                    { value: 1, label: 'Intro' },
                    { value: 3, label: 'Verse', current: true }
                ]}
                range={[0, 8]}
                label="Sections"
            />
        );
        expect(markup).toContain('<ol aria-label="Sections"');
        expect(markup).toContain('left:0%;width:12.5%');
        expect(markup).toContain('left:12.5%;width:37.5%');
        expect(markup).toContain('aria-current="true"');
    });

    test('shows only the parts inside its range, cut to it', () => {
        const markup = render(
            <SegmentBar
                parts={[
                    { value: 10, label: 'A' },
                    { value: 10, label: 'B' },
                    { value: 10, label: 'C' }
                ]}
                range={[5, 15]}
            />
        );
        expect(markup).toContain('left:0%;width:50%');
        expect(markup).toContain('left:50%;width:50%');
        expect(markup).not.toContain('>C<');
    });

    test('leaves the stretch before a part with a start of its own empty', () => {
        const markup = render(
            <SegmentBar
                parts={[
                    { value: 2, start: 2, label: 'Verse' },
                    { value: 2, start: 6, label: 'Chorus' }
                ]}
                onSelect={() => {}}
            />
        );
        expect(markup).toContain('left:25%;width:25%');
        expect(markup).toContain('left:75%;width:25%');
        expect(markup.match(/<li/g)).toHaveLength(2);
        expect(markup.match(/<button type="button"/g)).toHaveLength(2);
    });

    test('makes every part a button when it can select', () => {
        const markup = render(
            <SegmentBar
                parts={[
                    { value: 1, label: 'A' },
                    { value: 1, label: 'B' }
                ]}
                onSelect={() => {}}
            />
        );
        expect(markup.match(/<button type="button"/g)).toHaveLength(2);
    });

    test('stays reachable when a person can press its parts, labels or not', () => {
        const markup = render(<SegmentBar parts={[{ value: 1 }, { value: 1 }]} onSelect={() => {}} />);
        expect(markup).not.toContain('aria-hidden');
    });

    test('is hidden from a screen reader when no part has a label', () => {
        const markup = render(<SegmentBar parts={[{ value: 1, color: 'var(--positive)' }, { value: 1 }]} size="sm" />);
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain('background-color:var(--positive)');
        expect(markup).toContain('left:50%;width:50%');
    });
});

describe('an empty state', () => {
    test('draws a spinner at the size of its icon while it is busy', () => {
        const markup = render(<EmptyState busy>Loading the files.</EmptyState>);
        expect(markup).toContain('--spinner-size:20px');
    });
});

describe('a color swatch', () => {
    test('wears its color and a ring with a tick once picked', () => {
        const markup = render(<ColorSwatch color="rgb(1 2 3)" picked on="popup" />);
        expect(markup).toContain('background:rgb(1 2 3)');
        expect(markup).toContain('ring-offset-surface-raised');
        expect(markup).toContain('<svg');
    });

    test('keeps its own padding and highlight as a menu item that is no row', () => {
        const markup = render(
            <Menu.Root>
                <ColorSwatch render={<Menu.Item unstyled />} aria-label="None" picked />
            </Menu.Root>
        );
        expect(markup).toContain('role="menuitem"');
        expect(markup).toContain('focus-ring');
        expect(markup).not.toContain('menu-item');
    });

    test('is an outlined circle without a color, and draws what it is handed instead of the tick', () => {
        const markup = render(<ColorSwatch>…</ColorSwatch>);
        expect(markup).toContain('border-border-strong');
        expect(markup).not.toContain('<svg');
        expect(markup).toContain('…');
    });
});

describe('a menu row', () => {
    test('is a named group of the row and its buttons, each an item of the menu', () => {
        const markup = render(
            <Menu.Root>
                <Menu.Row aria-label="Dev server">
                    <Menu.Item>Dev server</Menu.Item>
                    <Menu.RowAction icon={Play} label="Start Dev server" iconClassName="fill-current" closeOnClick={false} />
                </Menu.Row>
            </Menu.Root>
        );
        expect(markup).toContain('role="group"');
        expect(markup).toContain('aria-label="Dev server"');
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['menu-row']));
        expect(markup.split('role="menuitem"').length - 1).toBe(2);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['menu-item', 'menu-row-action']));
        expect(markup).toContain('aria-label="Start Dev server"');
        expect(markup).toContain('fill-current');
        expect(markup.indexOf('>Dev server<')).toBeLessThan(markup.indexOf('menu-row-action'));
    });
});

describe('a field', () => {
    test('points its label at the control and describes the control by its hint and its error', () => {
        const markup = render(
            <Field label="Name" hint="Shown in the sidebar" error="Taken">
                <Input />
            </Field>
        );
        const control = /<input id="([^"]+)"/.exec(markup)?.[1];
        expect(control).toBeDefined();
        expect(markup).toContain(`<label for="${control}"`);
        const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1]?.split(' ') ?? [];
        expect(describedBy).toHaveLength(2);
        for (const id of describedBy) {
            expect(markup).toContain(`id="${id}"`);
        }
        expect(markup).toContain('aria-invalid="true"');
        expect(markup).toContain('role="alert"');
    });

    test('names a group with its label when the control is no input, and leaves an input inside it unconnected', () => {
        const markup = render(
            <Field group label="Ground" hint="Behind every frame">
                <Input aria-label="Other" />
            </Field>
        );
        expect(markup).not.toContain('<label');
        const labelledBy = /role="group" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/.exec(markup);
        expect(labelledBy).not.toBeNull();
        expect(markup).toContain(`<span id="${labelledBy?.[1]}"`);
        expect(markup).toContain(`<p id="${labelledBy?.[2]}"`);
        expect(markup).toMatch(/<input[^>]*aria-label="Other"/);
    });

    test('leaves a control outside a field as it is', () => {
        const markup = render(<TextArea rows={3} />);
        expect(markup).not.toContain('aria-describedby');
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['field']));
    });

    test('takes the requested field size and resize mode', () => {
        expect(classesIn(render(<TextArea aria-label="Note" />))).toContainEqual(expect.arrayContaining(['field', 'resize-none']));
        expect(classesIn(render(<TextArea aria-label="Draft" size="sm" resize="vertical" />))).toContainEqual(expect.arrayContaining(['field-sm', 'resize-y']));
    });

    test('draws an icon in front of the text inside the box of the field, and keeps the field on the input', () => {
        const markup = render(
            <Field label="Search">
                <Input icon={Search} size="sm" className="grow" />
            </Field>
        );
        expect(markup).toMatch(/<span[^>]*><svg/);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['field', 'field-sm', 'grow']));
        expect(markup).toContain('width="12"');
        const control = /<input id="([^"]+)"/.exec(markup)?.[1];
        expect(markup).toContain(`<label for="${control}"`);
        expect(render(<Input icon={Search} aria-label="Search" />)).toContain('width="14"');
    });

    test('says what went wrong as an alert', () => {
        expect(render(<FormError>Nope</FormError>)).toMatch(/^<p\b[^>]*role="alert"[^>]*>Nope<\/p>$/);
    });
});

describe('a menu item', () => {
    const inMenu = (node: ReactNode): string => render(<Menu.Root>{node}</Menu.Root>);

    test('is a row with its indicator unless it asks to be left unstyled', () => {
        expect(classesIn(inMenu(<Menu.Item>Rename</Menu.Item>))).toContainEqual(expect.arrayContaining(['menu-item']));
        const bare = inMenu(
            <>
                <Menu.Item unstyled className="icon-btn">
                    +
                </Menu.Item>
                <Menu.CheckboxItem unstyled checked className="segment">
                    Wrap
                </Menu.CheckboxItem>
            </>
        );
        expect(bare).not.toContain('menu-item');
        expect(bare).not.toContain('<svg');
        expect(bare).toMatch(/<div role="menuitem"[^>]* tabindex="-1"/);
    });

    test('puts its indicator at the end of the row when it asks for it there', () => {
        const markup = inMenu(
            <Menu.CheckboxItem checked indicator="end">
                Fast mode
            </Menu.CheckboxItem>
        );
        expect(markup.indexOf('Fast mode')).toBeLessThan(markup.indexOf('border-border-strong'));
        expect(markup).toContain('ml-auto');
    });

    test('leaves the look of a group label to the group when it is unstyled', () => {
        const markup = inMenu(
            <Menu.Group>
                <Menu.GroupLabel unstyled className="font-medium">
                    Context
                </Menu.GroupLabel>
            </Menu.Group>
        );
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['font-medium']));
    });
});

describe('the element a part renders', () => {
    test('is its own tag by default and whatever `render` names otherwise, with the classes of both', () => {
        expect(render(<SectionLabel>Recent</SectionLabel>)).toMatch(/^<span\b[^>]*>Recent<\/span>$/);
        const heading = render(<SectionLabel render={<h3 className="px-2" />}>Recent</SectionLabel>);
        expect(heading).toMatch(/^<h3\b[^>]*>Recent<\/h3>$/);
        expect(classesIn(heading)).toContainEqual(expect.arrayContaining(['px-2']));
        expect(render(<ListRow variant="inset" render={<button type="button" />} />)).toMatch(/^<button\b[^>]*type="button"/);
        expect(render(<Surface className="rounded-lg" />)).toContain('rounded-lg');
        expect(render(<ButtonGroup role="group" />)).toMatch(/^<div\b[^>]*role="group"[^>]*><\/div>$/);
    });

    test('a panel header names its panel before its own controls', () => {
        const markup = render(
            <PanelHeader title="Files">
                <button type="button">x</button>
            </PanelHeader>
        );
        expect(markup.indexOf('Files')).toBeLessThan(markup.indexOf('<button'));
        expect(markup.startsWith('<header')).toBe(true);
    });
});

describe('an icon picker', () => {
    const GROUPS: IconPickerGroup[] = [
        { id: 'code', label: 'Code', icons: { 'git-branch': GitBranch, bug: Bug } },
        { id: 'infra', label: 'Infrastructure', icons: { server: Server, cloud: Cloud, rocket: Rocket } }
    ];

    test('draws a flat set as the plain grid under its label, without a frame or a search', () => {
        const markup = render(<IconPicker icons={{ rocket: Rocket, bug: Bug }} value="bug" onValueChange={() => {}} />);
        expect(markup).toContain('role="radiogroup" aria-label="Icon"');
        expect(markup).not.toContain('field');
        expect(markup).not.toContain('<input');
        expect(markup).not.toContain('role="group"');
        expect(markup).not.toContain('style=');
    });

    test('makes the grid one tab stop, on the chosen icon or else the first', () => {
        const tabStops = (value: string | null): string[] =>
            [
                ...render(<IconPicker icons={{ rocket: Rocket, bug: Bug }} value={value} onValueChange={() => {}} />).matchAll(
                    /aria-label="(\w+)"[^>]*tabindex="0"|tabindex="0"[^>]*aria-label="(\w+)"/g
                )
            ].map((match) => match[1] ?? match[2] ?? '');
        expect(tabStops('bug')).toEqual(['bug']);
        expect(tabStops(null)).toEqual(['rocket']);
    });

    test('draws groups under a heading each, with the number of icons, and a search in one frame with them', () => {
        const markup = render(<IconPicker icons={GROUPS} value="cloud" onValueChange={() => {}} />);
        expect(markup.match(/role="group"/g)).toHaveLength(2);
        expect(markup).toMatch(/role="group" aria-labelledby="([^"]+)"[\s\S]*?<span id="\1"[^>]*>Code<\/span><span[^>]*>2<\/span>/);
        expect(markup).toMatch(/<span id="[^"]+"[^>]*>Infrastructure<\/span><span[^>]*>3<\/span>/);
        expect(markup).toContain('placeholder="Find an icon"');
        expect(markup).toContain('sticky top-0');
        expect(markup.indexOf('<input')).toBeLessThan(markup.indexOf('role="radiogroup"'));
    });

    test('leaves the search out of groups when asked', () => {
        expect(render(<IconPicker icons={GROUPS} searchable={false} value={null} onValueChange={() => {}} />)).not.toContain('<input');
    });

    test('holds the grid at a height of rows, with room for one heading', () => {
        expect(render(<IconPicker icons={GROUPS} rows={7} value={null} onValueChange={() => {}} />)).toContain('style="height:256px"');
        expect(render(<IconPicker icons={{ rocket: Rocket }} rows={2} value={null} onValueChange={() => {}} />)).toContain('style="height:74px"');
    });
});

describe('a check in a menu row', () => {
    test('shows the tick of a plain row only while it is checked', () => {
        expect(render(<MenuCheck kind="radio" checked />)).toContain('<svg');
        expect(render(<MenuCheck kind="radio" checked={false} />)).not.toContain('<svg');
    });
});

describe('a shortcut chip', () => {
    test('prints what it is handed when it has no shortcut', () => {
        expect(render(<Kbd variant="inline">↑</Kbd>)).toContain('>↑</kbd>');
    });
});

describe('a key value list', () => {
    const list = (divided: boolean): string =>
        render(
            <KeyValueList.Root divided={divided}>
                <KeyValueList.Item>
                    <KeyValueList.Name>Message-ID</KeyValueList.Name>
                    <KeyValueList.Value mono>abc@example.com</KeyValueList.Value>
                </KeyValueList.Item>
            </KeyValueList.Root>
        );

    test('is a description list whose values can be selected', () => {
        const markup = list(false);
        expect(markup).toMatch(/^<dl\b/);
        expect(markup).toContain('>Message-ID</dt>');
        expect(markup).toMatch(/<dd\b[^>]*>abc@example.com<\/dd>/);
        expect(classesIn(markup)).toContainEqual(expect.arrayContaining(['select-text', 'font-mono']));
    });

    test('draws a hairline between rows only when divided', () => {
        expect(list(true)).toContain('divide-y');
        expect(list(false)).not.toContain('divide-y');
    });
});

describe('tabs', () => {
    const strip = (count: number): string => {
        const source = fakeFormatSource();
        source.set({ region: 'nl-NL' });
        return renderToStaticMarkup(
            <UIProvider i18n={i18n} formatSource={source}>
                <Tabs.Root value="links">
                    <Tabs.List aria-label="Views">
                        <Tabs.Tab value="preview">Preview</Tabs.Tab>
                        <Tabs.Tab value="links">
                            Links
                            <Tabs.Count value={count} />
                        </Tabs.Tab>
                    </Tabs.List>
                </Tabs.Root>
            </UIProvider>
        );
    };

    test('mark the picked tab in a named tab list', () => {
        const markup = strip(3);
        expect(markup).toContain('role="tablist"');
        expect(markup).toContain('aria-label="Views"');
        expect(markup).toMatch(/aria-selected="true"[^>]*>Links/);
    });

    test('write a count the way the region does, and none at zero', () => {
        expect(strip(1234)).toContain('>1.234</span>');
        expect(strip(0)).not.toContain('tabular-nums');
    });

    test('keep a closable tab one stop, with its close button out of the tab order', () => {
        const markup = render(
            <Tabs.Root value="one">
                <Tabs.List aria-label="Views" end={<span>after</span>}>
                    <Tabs.Tab value="one" onClose={() => {}}>
                        One
                    </Tabs.Tab>
                    <Tabs.Tab value="two">Two</Tabs.Tab>
                </Tabs.List>
            </Tabs.Root>
        );
        expect(markup.match(/aria-label="Close tab"/g)).toHaveLength(1);
        expect(markup).toContain('tabindex="-1"');
        expect(markup).toContain('>after</span>');
    });

    test('draw a pinned tab with its label and the shape of any tab, but without a close button', () => {
        const markup = render(
            <Tabs.Root value="one">
                <Tabs.List aria-label="Views" variant="pill">
                    <Tabs.Tab value="home" pinned onClose={() => {}}>
                        Home
                    </Tabs.Tab>
                    <Tabs.Tab value="one" onClose={() => {}}>
                        One
                    </Tabs.Tab>
                </Tabs.List>
            </Tabs.Root>
        );
        const pinned = /<[^>]*data-pinned=""[^>]*>Home</.exec(markup)?.[0] ?? '';
        expect(pinned).toContain('px-2');
        expect(markup.match(/aria-label="Close tab"/g)).toHaveLength(1);
    });

    test('draw what comes before the tabs ahead of the list', () => {
        const markup = render(
            <Tabs.Root value="one">
                <Tabs.List aria-label="Views" start={<span>before</span>}>
                    <Tabs.Tab value="one">One</Tabs.Tab>
                </Tabs.List>
            </Tabs.Root>
        );
        expect(markup.indexOf('>before</span>')).toBeGreaterThan(-1);
        expect(markup.indexOf('>before</span>')).toBeLessThan(markup.indexOf('role="tablist"'));
    });
});

describe('a stepper', () => {
    const renderStepper = (node: ReactNode): string => {
        const source = fakeFormatSource();
        source.set({ region: 'nl-NL' });
        return renderToStaticMarkup(
            <UIProvider i18n={i18n} formatSource={source}>
                {node}
            </UIProvider>
        );
    };

    test('writes its value with the places of its step, the way the region does', () => {
        const markup = renderStepper(<Stepper value={1} onValueChange={() => {}} min={1} max={2.5} step={0.1} unit="×" label="Line height" />);
        expect(markup).toMatch(/aria-live="polite">1,0<span[^>]*>×<\/span>/);
    });

    test('takes the places it is handed over the ones of its step', () => {
        const markup = renderStepper(<Stepper value={1.5} onValueChange={() => {}} min={1} max={2} step={0.5} decimals={2} label="Speed" />);
        expect(markup).toContain('aria-live="polite">1,50</span>');
    });

    test('reserves the width of both ends of its range', () => {
        const markup = renderStepper(<Stepper value={5} onValueChange={() => {}} min={-10} max={100} step={1} label="Offset" />);
        expect(markup).toMatch(/<span(?=[^>]*class="[^"]*\binvisible\b)[^>]*>-10<\/span>/);
        expect(markup).toMatch(/<span(?=[^>]*class="[^"]*\binvisible\b)[^>]*>100<\/span>/);
    });
});

describe('the provider', () => {
    test('adds the words of the library to the app i18next, so a control reads them on its first render', () => {
        const fresh = i18next.createInstance();
        void fresh.init({ lng: 'nl', resources: {} });
        const markup = renderToStaticMarkup(
            <UIProvider i18n={fresh}>
                <Stepper value={2} onValueChange={() => {}} min={0} max={4} step={1} label="Rand" />
            </UIProvider>
        );
        expect(fresh.hasResourceBundle('en', 'ui')).toBe(true);
        expect(markup).toContain('aria-label="Rand: kleiner"');
    });

    test('hands the formatters their source before the children format anything', () => {
        const source = fakeFormatSource();
        source.set({ region: 'nl-NL' });
        let seen = '';
        const Probe = () => {
            seen = formatLocale();
            return null;
        };
        renderToStaticMarkup(
            <UIProvider i18n={i18n} formatSource={source}>
                <Probe />
            </UIProvider>
        );
        expect(seen).toBe('nl-NL');
    });
});

describe('a sliding column', () => {
    const renderColumn = (open: boolean, instant: boolean, gap = 0): string =>
        render(
            <SlidingColumn open={open} instant={instant} gap={gap} width={380} bounds={{ min: 320, max: () => 800 }} onWidthChange={() => {}}>
                Panel
            </SlidingColumn>
        );

    test('reserves the gap only while open and keeps it outside the stored surface width', () => {
        const open = renderColumn(true, true, 8);
        expect(open).toContain('width:388px');
        expect(open).toContain('width:380px;margin-left:8px');
        expect(renderColumn(false, true, 8)).toContain('width:0');
    });

    test('lands without the motion while its width is being restored', () => {
        expect(renderColumn(true, true)).toContain('data-instant=""');
    });

    test('keeps the motion otherwise, open and closed', () => {
        for (const open of [true, false]) {
            const markup = renderColumn(open, false);
            expect(markup).not.toContain('data-instant');
            expect(markup).toContain('sliding-column');
            expect(markup).toContain(`width:${open ? '380px' : '0'}`);
        }
    });
});

describe('the toasts', () => {
    test('keep their live region in the page while there is nothing to say', () => {
        const markup = render(<Toasts store={createToastStore()} />);
        expect(markup).toContain('role="status"');
        expect(markup).toContain('aria-live="polite"');
    });

    test('draw an action as a button of the scale', () => {
        // Server rendering reads a store's initial state, so the toast is in it from the start.
        const store = create<ToastStore>(() => ({
            toasts: [{ id: 'save', kind: 'error', title: 'Could not save', action: { label: 'Retry', run: () => {} } }],
            show: () => 'save',
            update: () => {},
            dismiss: () => {}
        }));
        const markup = render(<Toasts store={store} />);
        expect(markup).toMatch(/<button type="button" class="[^"]*\bh-6\b[^"]*">Retry<\/button>/);
    });
});
