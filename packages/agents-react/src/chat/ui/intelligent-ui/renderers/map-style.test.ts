import { expect, test } from 'bun:test';
import { baseMapStyle, boundsOf, localizedTextField, mapFitOptions, spreadOverlaps } from './map-style';

test('the map without tiles is land over water in the colors it is given, from one world outline', () => {
    const style = baseMapStyle({ land: '#111111', water: '#222222' });
    expect(style.layers.map((layer) => layer.id)).toEqual(['water', 'land']);
    expect(style.layers[0]).toMatchObject({ type: 'background', paint: { 'background-color': '#222222' } });
    expect(style.layers[1]).toMatchObject({ type: 'fill', source: 'land', paint: { 'fill-color': '#111111' } });
    const source = style.sources.land as { type: string; data: { geometry: { type: string; coordinates: unknown[] } } };
    expect(source.type).toBe('geojson');
    expect(source.data.geometry.type).toBe('MultiPolygon');
    expect(source.data.geometry.coordinates.length).toBeGreaterThan(100);
    expect(JSON.stringify(style)).not.toContain('glyphs');
});

test('a label prefers the translated property and keeps what the style wrote as its last resort', () => {
    expect(localizedTextField('{name}', 'name_nl')).toEqual(['coalesce', ['get', 'name_nl'], ['to-string', ['coalesce', ['get', 'name'], '']]]);
    expect(localizedTextField('{name}\n{ref}', 'name_nl')).toEqual([
        'coalesce',
        ['get', 'name_nl'],
        ['concat', ['to-string', ['coalesce', ['get', 'name'], '']], '\n', ['to-string', ['coalesce', ['get', 'ref'], '']]]
    ]);
    const written = ['get', 'name'];
    expect(localizedTextField(written, 'name_nl')).toEqual(['coalesce', ['get', 'name_nl'], written]);
    expect(localizedTextField('Plain', 'name_nl')).toEqual(['coalesce', ['get', 'name_nl'], 'Plain']);
});

test('a text field that is neither text nor an expression is left alone', () => {
    const legacy = { stops: [[1, '{name}']] };
    expect(localizedTextField(legacy, 'name_nl')).toBe(legacy);
});

test('the bounds hold every point, and none for no points', () => {
    expect(boundsOf([])).toBeNull();
    expect(
        boundsOf([
            { id: 'a', lat: 52, lon: 5 },
            { id: 'b', lat: 48, lon: 11 },
            { id: 'c', lat: 50, lon: -2 }
        ])
    ).toEqual([
        [-2, 48],
        [11, 52]
    ]);
});

test('points on both sides of the date line span a few degrees, not the globe', () => {
    expect(
        boundsOf([
            { id: 'a', lat: -17, lon: 179.5 },
            { id: 'b', lat: -18, lon: -179 }
        ])
    ).toEqual([
        [179.5, -18],
        [181, -17]
    ]);
    expect(
        boundsOf([
            { id: 'a', lat: 0, lon: -170 },
            { id: 'b', lat: 0, lon: 170 },
            { id: 'c', lat: 0, lon: 178 }
        ])
    ).toEqual([
        [170, 0],
        [190, 0]
    ]);
    expect(boundsOf([{ id: 'a', lat: 1, lon: 5 }])).toEqual([
        [5, 1],
        [5, 1]
    ]);
});

test('the first view and the way back fit with the same padding and zoom limit', () => {
    expect(mapFitOptions(false)).toEqual({ padding: 32, maxZoom: 16 });
    expect(mapFitOptions(true)).toEqual({ padding: 32, maxZoom: 6 });
});

test('markers that do not cover each other stay where they are', () => {
    const offsets = spreadOverlaps([
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 0 },
        { id: 'c', x: 0, y: 100 }
    ]);
    expect([...offsets.values()]).toEqual([
        [0, 0],
        [0, 0],
        [0, 0]
    ]);
});

test('a marker on top of an earlier one moves to the nearest free spot beside it, and the earlier one stays', () => {
    const offsets = spreadOverlaps([
        { id: 'a', x: 50, y: 50 },
        { id: 'b', x: 50, y: 50 },
        { id: 'c', x: 55, y: 50 },
        { id: 'd', x: 50, y: 50 }
    ]);
    expect(offsets.get('a')).toEqual([0, 0]);
    expect(offsets.get('b')).toEqual([20, 0]);
    expect(offsets.get('c')).toEqual([0, 20]);
    expect(offsets.get('d')).toEqual([-20, 0]);
});

test('no marker of a crowd ends up on another', () => {
    const crowd = Array.from({ length: 9 }, (_, i) => ({ id: String(i), x: 10, y: 10 }));
    const offsets = spreadOverlaps(crowd);
    const spots = crowd.map((point) => ({ x: point.x + offsets.get(point.id)![0], y: point.y + offsets.get(point.id)![1] }));
    for (const [i, spot] of spots.entries()) {
        for (const other of spots.slice(i + 1)) {
            expect(Math.hypot(spot.x - other.x, spot.y - other.y)).toBeGreaterThanOrEqual(20);
        }
    }
});
