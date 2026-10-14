import type { UiProps } from '@adecore/intelligent-ui';
import type { UiPlacePoint, UiRenderContext } from '../render-context';

/*
 * What the host found for the address of a place wins over the coordinates the agent wrote, which stand
 * while the lookup is on its way and when it finds nothing. An address alone waits for the host's reading.
 */
export function placePoint(props: UiProps<'Place'>, nodeId: string, context: Pick<UiRenderContext, 'place'>): UiPlacePoint | null | undefined {
    const { lat, lon, address } = props;
    const written = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
    if (address === undefined || address.trim() === '') {
        return written ?? null;
    }
    const found = context.place === undefined ? null : context.place(nodeId, address);
    return found ?? written ?? found;
}
