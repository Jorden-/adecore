import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UiProps } from '@adecore/intelligent-ui';
import { Button, SegmentBar, useMeasuredWidth } from '@adecore/ui';
import { formatNumber, formatRounded } from '@adecore/ui/format';
import { useBlockLocal } from '../block-local';
import { UI_CHART_ROWS, uiChartData, uiChartRange, uiChartValues, type UiChartData, type UiChartValues } from '../chart-data';
import { uiWithUnit } from '../node-text';
import type { UiRenderContext, UiRendererProps } from '../render-context';
import { UiFallbackPart } from '../UiFallbackPart';

type ChartKind = UiProps<'Chart'>['kind'];

const HEIGHT = 160;
const HBAR_ROW = 24;
const STACKED_ROW = 28;
const AXIS_WIDTH = 44;
const PLOT_TOP = 8;
const LABEL_ROOM = 20;
/* The narrowest band a category label is written under; narrower bands skip labels. */
const LABEL_BAND = 56;
/* Points get a dot up to this many categories; more would crowd the line. */
const DOTS_UP_TO = 30;
const GROW = 'transition-[scale,opacity] duration-400 ease-out motion-reduce:transition-none';

function seriesColor(index: number): string {
    return `var(--chart-${index + 1})`;
}

function valueText(value: number | null, unit: string | undefined): string {
    return value === null ? '' : uiWithUnit(formatRounded(value, 2), unit);
}

/* The height a chart will take, which its place holds while the node streams. */
function chartHeight(kind: ChartKind, rows: number): number {
    const count = Math.max(1, Math.min(rows, UI_CHART_ROWS));
    return kind === 'hbar' ? count * HBAR_ROW : kind === 'stacked' ? count * STACKED_ROW : HEIGHT;
}

/* One sentence with the main point over all of the data, drawn or not, which a screen reader hears in place of the drawing. */
function chartSummary(values: UiChartValues, unit: string | undefined, t: TFunction<'agent-chat'>): string {
    let top: { label: string; series: string; value: number } | null = null;
    for (const series of values.series) {
        for (let i = 0; i < series.values.length; i++) {
            const value = series.values[i];
            if (value !== null && value !== undefined && (top === null || value > top.value)) {
                top = { label: values.labels[i] ?? '', series: series.key, value };
            }
        }
    }
    if (top === null) {
        return t('blocks.chart.values');
    }
    return values.series.length > 1
        ? t('blocks.chart.summarySeries', { count: values.labels.length, series: top.series, label: top.label, value: valueText(top.value, unit) })
        : t('blocks.chart.summary', { count: values.labels.length, label: top.label, value: valueText(top.value, unit) });
}

function Legend({ chart }: { chart: UiChartData }) {
    return (
        <div aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
            {chart.series.map((series, index) => (
                <span key={series.key} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: seriesColor(index) }} />
                    {series.key}
                </span>
            ))}
        </div>
    );
}

/* Every number of the data, for a screen reader, and on screen once a person opens it. */
function ValuesTable({ values, unit, shown }: { values: UiChartValues; unit: string | undefined; shown: boolean }) {
    const { t } = useTranslation('agent-chat');
    const table = (
        <table className={shown ? 'w-full border-collapse text-xs tabular-nums' : 'sr-only'}>
            <caption className={shown ? 'sr-only' : undefined}>{t('blocks.chart.values')}</caption>
            <thead className={shown ? 'sticky top-0 z-1 bg-surface-hover' : undefined}>
                <tr>
                    <td />
                    {values.series.map((series) => (
                        <th key={series.key} scope="col" className={shown ? 'h-8 px-2 text-right font-medium whitespace-nowrap text-text-muted' : undefined}>
                            {series.key}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {values.labels.map((label, index) => (
                    <tr key={index} className={shown ? 'border-t border-border-soft' : undefined}>
                        <th scope="row" className={shown ? 'h-8 px-2 text-left font-normal wrap-anywhere text-text-muted' : undefined}>
                            {label}
                        </th>
                        {values.series.map((series) => (
                            <td key={series.key} className={shown ? 'h-8 px-2 text-right whitespace-nowrap text-text' : undefined}>
                                {valueText(series.values[index] ?? null, unit)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
    return shown ? <div className="max-h-80 w-full overflow-auto rounded-md border border-border-soft">{table}</div> : table;
}

/* The values of one category beside the pointer. */
function Readout({ chart, index, left, unit }: { chart: UiChartData; index: number; left: number; unit: string | undefined }) {
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute top-0 z-1 flex -translate-x-1/2 flex-col gap-0.5 rounded-md bg-surface-raised px-2 py-1 text-xs whitespace-nowrap shadow-raised"
            style={{ left }}
        >
            <span className="font-medium text-text">{chart.labels[index]}</span>
            {chart.series.map((series, at) => (
                <span key={series.key} className="flex items-center gap-1.5 text-text-muted tabular-nums">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: seriesColor(at) }} />
                    {chart.series.length > 1 && <span>{series.key}</span>}
                    <span className="text-text">{valueText(series.values[index] ?? null, unit)}</span>
                </span>
            ))}
        </div>
    );
}

/* Bars and lines over a value axis, in SVG at the measured width. */
function VerticalChart({ chart, kind, unit, width }: { chart: UiChartData; kind: 'bar' | 'line'; unit: string | undefined; width: number }) {
    const [hover, setHover] = useState<number | null>(null);
    // uiChartData only hands over data whose range is finite.
    const { low, high } = uiChartRange(chart.min, chart.max)!;
    const plotWidth = Math.max(0, width - AXIS_WIDTH);
    const plotHeight = HEIGHT - PLOT_TOP - LABEL_ROOM;
    const band = plotWidth / chart.labels.length;
    const y = (value: number): number => Math.round(PLOT_TOP + ((high - value) / (high - low)) * plotHeight);
    const baseline = y(0);
    const ticks = low === 0 ? [0, high / 2, high] : [low, 0, high];
    const labelEvery = Math.max(1, Math.ceil(LABEL_BAND / Math.max(1, band)));
    const center = (index: number): number => Math.round(AXIS_WIDTH + band * index + band / 2);
    const gap = band * 0.2;
    const barWidth = Math.max(1, (band - gap) / chart.series.length);

    const segments = (values: (number | null)[]): string =>
        values
            .map((value, index) => (value === null ? null : `${center(index)} ${y(value)}`))
            .reduce<string[]>((paths, point, index, all) => {
                if (point !== null) {
                    paths.push(`${index === 0 || all[index - 1] === null ? 'M' : 'L'}${point}`);
                }
                return paths;
            }, [])
            .join(' ');

    return (
        <>
            <svg width={width} height={HEIGHT} aria-hidden className="block overflow-visible" onPointerLeave={() => setHover(null)}>
                {hover !== null && (
                    <rect x={Math.round(AXIS_WIDTH + band * hover)} y={PLOT_TOP} width={Math.round(band)} height={plotHeight} className="fill-surface-hover" />
                )}
                {ticks.map((tick) => (
                    <g key={tick}>
                        <line
                            x1={AXIS_WIDTH}
                            x2={width}
                            y1={y(tick)}
                            y2={y(tick)}
                            className={tick === 0 ? 'stroke-border' : 'stroke-border-soft'}
                            shapeRendering="crispEdges"
                        />
                        <text x={AXIS_WIDTH - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-text-faint text-xs tabular-nums">
                            {valueText(tick, unit)}
                        </text>
                    </g>
                ))}
                {chart.labels.map((label, index) =>
                    index % labelEvery === 0 ? (
                        <text key={index} x={center(index)} y={HEIGHT - 4} textAnchor="middle" className="fill-text-faint text-xs">
                            {label}
                        </text>
                    ) : null
                )}
                {kind === 'bar' ? (
                    <g className={clsx(GROW, 'starting:scale-y-0')} style={{ transformOrigin: `0px ${baseline}px` }}>
                        {chart.series.map((series, at) =>
                            series.values.map((value, index) =>
                                value === null ? null : (
                                    <rect
                                        key={`${series.key}:${index}`}
                                        x={Math.round(AXIS_WIDTH + band * index + gap / 2 + barWidth * at)}
                                        y={Math.min(y(value), baseline)}
                                        width={Math.max(1, Math.round(barWidth) - 1)}
                                        height={Math.abs(y(value) - baseline)}
                                        rx={2}
                                        style={{ fill: seriesColor(at) }}
                                    />
                                )
                            )
                        )}
                    </g>
                ) : (
                    <g className={clsx(GROW, 'starting:opacity-0')}>
                        {chart.series.map((series, at) => (
                            <g key={series.key} style={{ color: seriesColor(at) }}>
                                <path
                                    d={segments(series.values)}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                />
                                {chart.labels.length <= DOTS_UP_TO &&
                                    series.values.map((value, index) =>
                                        value === null ? null : <circle key={index} cx={center(index)} cy={y(value)} r={3} fill="currentColor" />
                                    )}
                            </g>
                        ))}
                    </g>
                )}
                {chart.labels.map((_, index) => (
                    <rect
                        key={index}
                        x={Math.round(AXIS_WIDTH + band * index)}
                        y={0}
                        width={Math.max(1, Math.round(band))}
                        height={HEIGHT}
                        fill="transparent"
                        onPointerEnter={() => setHover(index)}
                    />
                ))}
            </svg>
            {hover !== null && <Readout chart={chart} index={hover} unit={unit} left={Math.min(Math.max(center(hover), 64), Math.max(64, width - 64))} />}
        </>
    );
}

/* A row of 24px per category, its label beside the bars, which grow from zero to either side. */
function HorizontalChart({ chart, unit }: { chart: UiChartData; unit: string | undefined }) {
    const { low, high } = uiChartRange(chart.min, chart.max)!;
    const span = high - low;
    const zero = (-low / span) * 100;
    const single = chart.series.length === 1;
    return (
        <div aria-hidden className="flex flex-col">
            {chart.labels.map((label, index) => (
                <div key={index} className="flex h-6 items-center gap-2 text-xs">
                    <span className="w-2/5 max-w-36 shrink-0 truncate text-text-muted">{label}</span>
                    <span className="relative flex min-w-0 grow flex-col justify-center gap-px">
                        {low < 0 && <span className="absolute inset-y-0 w-px bg-border" style={{ left: `${zero}%` }} />}
                        {chart.series.map((series, at) => {
                            const value = series.values[index] ?? 0;
                            return (
                                <span key={series.key} className={clsx('relative block', single ? 'h-3' : 'h-1')}>
                                    <span
                                        className={clsx(GROW, 'absolute inset-y-0 rounded-sm starting:scale-x-0', value < 0 ? 'origin-right' : 'origin-left')}
                                        style={{
                                            left: `${((Math.min(value, 0) - low) / span) * 100}%`,
                                            width: `${(Math.abs(value) / span) * 100}%`,
                                            backgroundColor: seriesColor(at)
                                        }}
                                    />
                                </span>
                            );
                        })}
                    </span>
                    {single && (
                        <span className="w-16 shrink-0 text-right text-text-faint tabular-nums">{valueText(chart.series[0]!.values[index] ?? null, unit)}</span>
                    )}
                </div>
            ))}
        </div>
    );
}

/* A bar per category split into its series, on one scale so the rows compare. */
function StackedChart({ chart, unit }: { chart: UiChartData; unit: string | undefined }) {
    return (
        <div className="flex flex-col gap-2">
            {chart.labels.map((label, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                    {chart.labels.length > 1 && <span className="w-2/5 max-w-36 shrink-0 truncate text-text-muted">{label}</span>}
                    <SegmentBar
                        size="sm"
                        className="grow"
                        label={label}
                        range={[0, chart.max]}
                        parts={chart.series.map((series, at) => ({
                            value: series.values[index] ?? 0,
                            color: seriesColor(at),
                            label: `${series.key} ${valueText(series.values[index] ?? 0, unit)}`
                        }))}
                    />
                </div>
            ))}
        </div>
    );
}

/* What the drawing leaves out or draws otherwise, said in words, with every value a press away. */
function ChartNotes({
    chart,
    requested,
    values,
    unit,
    context,
    nodeId
}: {
    chart: UiChartData;
    requested: ChartKind;
    values: UiChartValues;
    unit: string | undefined;
    context: UiRenderContext;
    nodeId: string;
}) {
    const { t } = useTranslation('agent-chat');
    const [shown, setShown] = useBlockLocal(context, `${nodeId}:values`, () => false);
    const notes = [
        ...(chart.truncated ? [t('blocks.chart.rowsLeftOut', { shown: formatNumber(chart.labels.length), total: formatNumber(chart.total) })] : []),
        ...(chart.omitted.length > 0 ? [t('blocks.chart.seriesLeftOut', { count: chart.omitted.length, series: chart.omitted.join(', ') })] : []),
        ...(requested === 'stacked' && chart.kind !== 'stacked' ? [t('blocks.chart.sideBySide')] : [])
    ];
    const partial = chart.truncated || chart.omitted.length > 0;
    return (
        <>
            {notes.length > 0 && (
                <div className="flex flex-col gap-0.5 text-xs text-text-muted">
                    {notes.map((note) => (
                        <p key={note}>{note}</p>
                    ))}
                </div>
            )}
            {partial && (
                <Button size="xs" variant="secondary" className="self-start" aria-expanded={shown} onClick={() => setShown(!shown)}>
                    {shown ? t('blocks.chart.hideValues') : t('blocks.chart.showValues')}
                </Button>
            )}
            <ValuesTable values={values} unit={unit} shown={partial && shown} />
        </>
    );
}

function DrawnChart({
    chart,
    requested,
    data,
    unit,
    context,
    nodeId
}: {
    chart: UiChartData;
    requested: ChartKind;
    data: UiProps<'Chart'>['data'];
    unit: string | undefined;
    context: UiRenderContext;
    nodeId: string;
}) {
    const { t } = useTranslation('agent-chat');
    const [measure, width] = useMeasuredWidth();
    const values = useMemo(() => uiChartValues(data), [data]);
    const { kind } = chart;
    return (
        <figure className="flex flex-col gap-2 px-2">
            {chart.series.length > 1 && <Legend chart={chart} />}
            <div ref={measure} role="img" aria-label={chartSummary(values, unit, t)} className="relative">
                {kind === 'hbar' ? (
                    <HorizontalChart chart={chart} unit={unit} />
                ) : kind === 'stacked' ? (
                    <StackedChart chart={chart} unit={unit} />
                ) : (
                    <div style={{ height: HEIGHT }}>{width > 0 && <VerticalChart chart={chart} kind={kind} unit={unit} width={width} />}</div>
                )}
            </div>
            <ChartNotes chart={chart} requested={requested} values={values} unit={unit} context={context} nodeId={nodeId} />
        </figure>
    );
}

/*
 * Draws only once its node closed; until then a quiet surface of the height it will take holds its
 * place. It grows in once, and not at all for a person who asked for less motion.
 */
export function ChartRenderer({ node, context }: UiRendererProps<UiProps<'Chart'>>) {
    const { kind, data, unit } = node.props;
    const chart = useMemo(() => (node.complete ? uiChartData(data, kind) : null), [node.complete, data, kind]);
    if (!node.complete) {
        return <div aria-hidden className="mx-2 rounded-md bg-surface-hover" style={{ height: chartHeight(kind, data.length) }} />;
    }
    if (chart === null) {
        return <UiFallbackPart fallback={node.fallback} problem={{ kind: 'failed' }} />;
    }
    return <DrawnChart chart={chart} requested={kind} data={data} unit={unit} context={context} nodeId={node.id} />;
}
