import type { LngLatBoundsLike, MapOptions } from 'maplibre-gl';
import { BASE_LAND_JSON } from './base-land';

// The package does not export its style type, only the options that take one.
export type MapStyle = Exclude<MapOptions['style'], string | undefined>;

type Expression = unknown[];

/* The two grounds of the built-in map, as the page paints them. */
export interface MapColors {
    land: string;
    water: string;
}

export interface MapPoint {
    id: string;
    lat: number;
    lon: number;
}

/* How far a map zooms to fit its points: street level with tiles, and only a country or two on the outline, which has nothing finer. */
export const MAP_MAX_ZOOM = { tiles: 16, outline: 6 } as const;

/* The room around the places in a fitted view, in pixels. */
export const MAP_FIT_PADDING = 32;

/* What fits every place in view: the first view and the way back to it share it, so they cannot drift apart. */
export function mapFitOptions(outline: boolean): { padding: number; maxZoom: number } {
    return { padding: MAP_FIT_PADDING, maxZoom: outline ? MAP_MAX_ZOOM.outline : MAP_MAX_ZOOM.tiles };
}

/* The width of a marker, in pixels. */
export const MAP_MARKER_SIZE = 20;

export interface ScreenPoint {
    id: string;
    x: number;
    y: number;
}

// Whole pixels to try around a place, nearest ring first: right, below, left, above, then the corners.
const SPREAD_STEPS: readonly (readonly [number, number])[] = [
    [20, 0],
    [0, 20],
    [-20, 0],
    [0, -20],
    [15, 15],
    [-15, 15],
    [-15, -15],
    [15, -15],
    [40, 0],
    [0, 40],
    [-40, 0],
    [0, -40],
    [30, 30],
    [-30, 30],
    [-30, -30],
    [30, -30]
];

/*
 * Offsets, in pixels, that keep markers from covering each other. A marker that fits where it is stays; one
 * that lands on an earlier marker moves to the nearest free spot beside it. The places are not moved on the
 * map, only their markers, and the offsets are worked out again at every zoom, so a map zoomed in far
 * enough draws them where they are.
 */
export function spreadOverlaps(points: readonly ScreenPoint[]): Map<string, [number, number]> {
    const offsets = new Map<string, [number, number]>();
    const placed: { x: number; y: number }[] = [];
    for (const point of points) {
        const free = ([dx, dy]: readonly [number, number]): boolean =>
            placed.every((other) => Math.hypot(other.x - (point.x + dx), other.y - (point.y + dy)) >= MAP_MARKER_SIZE);
        const step = [[0, 0] as const, ...SPREAD_STEPS].find(free) ?? ([0, 0] as const);
        offsets.set(point.id, [step[0], step[1]]);
        placed.push({ x: point.x + step[0], y: point.y + step[1] });
    }
    return offsets;
}

/* The map a page draws without tiles: land over water, from the outline of the world that ships with the package. */
export function baseMapStyle({ land, water }: MapColors): MapStyle {
    return {
        version: 8,
        sources: { land: { type: 'geojson', data: JSON.parse(BASE_LAND_JSON) } },
        layers: [
            { id: 'water', type: 'background', paint: { 'background-color': water } },
            { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': land } }
        ]
    };
}

const TOKEN = /\{([^{}]+)\}/g;

/* A `{name}` text field as the expression it stands for, since a field combined with another expression is no longer read for tokens. */
function tokenExpression(text: string): Expression | string {
    const parts: (Expression | string)[] = [];
    let at = 0;
    for (const match of text.matchAll(TOKEN)) {
        if (match.index > at) {
            parts.push(text.slice(at, match.index));
        }
        parts.push(['to-string', ['coalesce', ['get', match[1]], '']]);
        at = match.index + match[0].length;
    }
    if (parts.length === 0) {
        return text;
    }
    if (at < text.length) {
        parts.push(text.slice(at));
    }
    return parts.length === 1 && typeof parts[0] !== 'string' ? parts[0] : ['concat', ...parts];
}

/*
 * A label that prefers the property `field` of a feature and falls back to what the style wrote. A text
 * field that is neither a string nor an expression (a legacy zoom function) is left as it is.
 */
export function localizedTextField(original: unknown, field: string): unknown {
    const fallback = typeof original === 'string' ? tokenExpression(original) : original;
    if (typeof fallback !== 'string' && !Array.isArray(fallback)) {
        return original;
    }
    return ['coalesce', ['get', field], fallback];
}

/*
 * The bounds that hold every point, or null for none. Longitudes go round the globe, so the bounds leave out
 * the widest gap between two neighbors: points on both sides of the date line span a few degrees, not 360.
 * The east edge may then pass 180, which the map takes.
 */
export function boundsOf(points: readonly MapPoint[]): LngLatBoundsLike | null {
    if (points.length === 0) {
        return null;
    }
    const lons = points.map((point) => point.lon).sort((a, b) => a - b);
    let widest = lons[0]! + 360 - lons[lons.length - 1]!;
    let west = lons[0]!;
    let east = lons[lons.length - 1]!;
    for (let i = 1; i < lons.length; i++) {
        const gap = lons[i]! - lons[i - 1]!;
        if (gap > widest) {
            widest = gap;
            west = lons[i]!;
            east = lons[i - 1]! + 360;
        }
    }
    const lats = points.map((point) => point.lat);
    return [
        [west, Math.min(...lats)],
        [east, Math.max(...lats)]
    ];
}
