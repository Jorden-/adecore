import { expect, test } from 'bun:test';
import { designProblemsIn, type DesignOptions } from './design-conventions.ts';

const cases: [string, string, DesignOptions, string][] = [
    ['global shortcut', "window.addEventListener('keydown', listener)", {}, 'a key is heard'],
    ['off-scale type', '<div className="text-[11px]" />', {}, 'type comes'],
    ['uppercase label', '<div className="hover:uppercase" />', {}, 'a label is sentence case'],
    ['focus ring', '<div className="focus-visible:ring-2" />', {}, 'keyboard focus'],
    ['native tooltip', '<button title="Run" />', {}, 'a hint is a Tooltip'],
    ['custom word button', '<button className="h-8 px-2 rounded-lg">Run</button>', {}, 'a button with a word'],
    ['custom icon button size', '<IconButton className="w-8" />', {}, 'an icon button is sized'],
    ['mismatched icon', '<button className="icon-btn icon-btn-sm"><Icon size={16} /></button>', {}, 'an icon button draws'],
    ['off-scale icon', '<Icon size={18} />', {}, 'an icon is 12'],
    ['raw formatter', 'new Intl.NumberFormat()', {}, 'only format/'],
    ['raw color', '<div className="text-[#ffffff]" />', {}, 'a color is a token'],
    ['fractional pixel', '<div className="w-[1.5px]" />', {}, 'a length is whole pixels'],
    ['global translations', "import i18next from 'i18next';", { namespace: 'database' }, 'words are read'],
    ['wrong namespace', "useTranslation('ui')", { namespace: 'database' }, 'words are read'],
    ['legacy ref', 'forwardRef(Component)', {}, 'a component takes its ref']
];

test.each(cases)('rejects %s', (_name, text, options, rule) => {
    const problems = designProblemsIn([{ path: 'Component.tsx', text }], options);
    expect(problems.some((problem) => problem.rule.startsWith(rule))).toBe(true);
    expect(problems.every((problem) => problem.location.startsWith('Component.tsx'))).toBe(true);
});

test('permits named frames, token colors, row buttons, and nested or overlaid icons', () => {
    const text = `<><iframe title="Preview" /><div className="text-accent focus:outline-accent" />
        <button role="checkbox" className="h-8 px-2 rounded-lg" />
        <button className="icon-btn icon-btn-sm"><IconButton size="md"><Icon /></IconButton><Icon className="absolute" size={12} /><Icon size={14} /></button></>`;
    expect(designProblemsIn([{ path: 'Component.tsx', text }])).toEqual([]);
});

test('keeps formatter and provider exemptions specific to their package and file', () => {
    const sources = [
        { path: 'format/number.ts', text: 'new Intl.NumberFormat()' },
        { path: 'Provider.tsx', text: 'useTranslation()' },
        { path: 'host/daemon.ts', text: "window.addEventListener('keydown', listener)" }
    ];
    expect(
        designProblemsIn(sources, { formatterDirectory: 'format/', namespace: 'database', namespaceExempt: ['Provider.tsx'], pageExclusions: ['host/'] })
    ).toEqual([]);
    expect(designProblemsIn(sources, { namespace: 'database' }).map((problem) => problem.rule)).toHaveLength(3);
});

test('exempts from the color rule only the files named for it', () => {
    const sources = [
        { path: 'logic/ansi.ts', text: "const color = 'rgb(255 0 0)';" },
        { path: 'Component.tsx', text: '<div className="text-[#ffffff]" />' }
    ];
    expect(designProblemsIn(sources, { colorExempt: ['logic/ansi.ts'] }).map((problem) => problem.location)).toEqual(['Component.tsx:1']);
});

test('reports invalid theme type, colors and lengths while permitting alpha masks', () => {
    const scale = '--text-xs: 12px; --text-sm: 14px; --text-md: 16px; --text-lg: 20px; --text-xl: round(2rem, 1px);';
    const theme = `${scale}\n/* Who floats over whom. */\n.mask { mask-image: linear-gradient(#000, #000); }`;
    expect(designProblemsIn([], { theme })).toEqual([]);
    const invalid = `${theme}\n.bad { font-size: 11px; color: #ffffff; width: 1.5px; height: 2rem; }`;
    const rules = designProblemsIn([], { theme: invalid }).map((problem) => problem.rule);
    expect(rules).toEqual([
        'the theme sets no type below 12px',
        'a color outside the theme block is a token, never a raw value',
        'a length is whole pixels: no fractional pixel',
        'every rem or em is rounded to whole pixels'
    ]);
});
