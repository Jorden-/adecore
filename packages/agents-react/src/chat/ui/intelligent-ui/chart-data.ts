import type { UiProps } from '@adecore/intelligent-ui';

/* The catalog promises up to six series, one per chart color. */
export const UI_CHART_SERIES = 6;
/* Categories a chart draws; more would not fit a column of a thread. */
export const UI_CHART_ROWS = 60;

type ChartRow = UiProps<'Chart'>['data'][number];
type ChartKind = UiProps<'Chart'>['kind'];

export interface UiChartSeries {
    key: string;
    /* One per label, null where a row has no number for this series. */
    values: (number | null)[];
}

/* Every row and every numeric series of a chart's data, whatever a drawing can hold. */
export interface UiChartValues {
    labels: string[];
    series: UiChartSeries[];
}

export interface UiChartData extends UiChartValues {
    /* What it is drawn as: stacked data with a negative value stands side by side as bars. */
    kind: ChartKind;
    /* The range the axis covers, from zero or below it, never empty. */
    min: number;
    max: number;
    /* Whether rows past `UI_CHART_ROWS` were left out. */
    truncated: boolean;
    /* The rows of the data, drawn or not. */
    total: number;
    /* The numeric series past the first six, which only the values hold. */
    omitted: string[];
}

function numericKeys(rows: readonly ChartRow[]): string[] {
    const keys: string[] = [];
    for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
            if (key !== 'label' && !keys.includes(key) && typeof value === 'number' && Number.isFinite(value)) {
                keys.push(key);
            }
        }
    }
    return keys;
}

function valuesOf(rows: readonly ChartRow[], keys: readonly string[]): UiChartValues {
    return {
        labels: rows.map((row) => (typeof row.label === 'string' || typeof row.label === 'number' ? String(row.label) : '')),
        series: keys.map((key) => ({
            key,
            values: rows.map((row) => {
                const value = row[key];
                return typeof value === 'number' && Number.isFinite(value) ? value : null;
            })
        }))
    };
}

/* All of a chart's numbers, for the table a person can open beside a drawing that left some out. */
export function uiChartValues(data: UiProps<'Chart'>['data']): UiChartValues {
    return valuesOf(data, numericKeys(data));
}

/* The rounded ends of a value axis, or null when they lie beyond what a number can hold. */
export function uiChartRange(min: number, max: number): { low: number; high: number } | null {
    const low = min < 0 ? -niceCeiling(-min) : 0;
    const high = max > 0 ? niceCeiling(max) : low === 0 ? 1 : 0;
    return Number.isFinite(high - low) ? { low, high } : null;
}

/*
 * The series a chart can draw: every key besides `label` with a finite number in some row, the
 * first six of them. A value that is missing or no finite number is a gap. Null when there is no
 * row or no series, or when the numbers are too large to scale, which draws the fallback.
 */
export function uiChartData(data: UiProps<'Chart'>['data'], kind: ChartKind): UiChartData | null {
    const rows = data.slice(0, UI_CHART_ROWS);
    const keys = numericKeys(rows);
    if (rows.length === 0 || keys.length === 0) {
        return null;
    }
    const { labels, series } = valuesOf(rows, keys.slice(0, UI_CHART_SERIES));
    const negative = series.some(({ values }) => values.some((value) => value !== null && value < 0));
    const drawn = kind === 'stacked' && negative ? 'bar' : kind;
    const extents =
        drawn === 'stacked'
            ? labels.map((_, index) => series.reduce((sum, { values }) => sum + (values[index] ?? 0), 0))
            : series.flatMap(({ values }) => values.filter((value) => value !== null));
    const min = Math.min(0, ...extents);
    const max = Math.max(0, ...extents);
    if (uiChartRange(min, max) === null) {
        return null;
    }
    return {
        labels,
        series,
        kind: drawn,
        min,
        max: max === min ? min + 1 : max,
        truncated: data.length > rows.length,
        total: data.length,
        omitted: numericKeys(data).filter((key) => !series.some((drawnSeries) => drawnSeries.key === key))
    };
}

/* A round number at or above `value`, for the top of an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceCeiling(value: number): number {
    if (value <= 0) {
        return 0;
    }
    const power = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) ?? 10;
    return step * power;
}
