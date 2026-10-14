import { expect, test } from 'bun:test';
import { baseMapStyle, boundsOf, localizedTextField } from './map-style';

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
