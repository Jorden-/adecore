import { expect, test } from 'bun:test';
import { placePoint } from './place-point';

const FOUND = { lat: 52.09, lon: 5.12 };

test('the point the host found for the address wins over the coordinates written beside it', () => {
    const props = { lat: 1, lon: 2, address: ' Domplein 1 ' };
    const asked: Array<[string, string]> = [];
    const context = {
        place: (nodeId: string, address: string) => {
            asked.push([nodeId, address]);
            return FOUND;
        }
    };
    expect(placePoint(props, 'node', context)).toEqual(FOUND);
    expect(asked).toEqual([['node', ' Domplein 1 ']]);
});

test('the coordinates stand while the lookup is on its way and when it finds nothing', () => {
    const props = { lat: 1, lon: 2, address: 'Nowhere 1' };
    expect(placePoint(props, 'node', { place: () => undefined })).toEqual({ lat: 1, lon: 2 });
    expect(placePoint(props, 'node', { place: () => null })).toEqual({ lat: 1, lon: 2 });
    expect(placePoint(props, 'node', {})).toEqual({ lat: 1, lon: 2 });
});

test('an address alone waits for the lookup, and has no point when there is none', () => {
    const props = { address: 'Domplein 1' };
    expect(placePoint(props, 'node', { place: () => undefined })).toBeUndefined();
    expect(placePoint(props, 'node', { place: () => null })).toBeNull();
    expect(placePoint(props, 'node', {})).toBeNull();
    expect(placePoint({ lat: 3, lon: 4 }, 'node', {})).toEqual({ lat: 3, lon: 4 });
});
