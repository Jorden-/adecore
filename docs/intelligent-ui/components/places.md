# Places

Show places on a map the host draws. Give a place as `lat` and `lon` in decimal degrees, or as an address the host looks up. Never give a tile or a map URL: the host chooses the map and where its tiles come from, and a block cannot name either.

<Demo src="intelligent-ui/places" />

```ui
$picked = ""
<Map value={$picked}>
<Place lat={52.0907} lon={5.1214} value="dom" detail="Climb the tower">Domtoren</Place>
<Place address="Oudegracht 245, Utrecht" value="gracht">Oudegracht</Place>
<Place lat={52.0894} lon={5.1103} value="station">Station</Place>
</Map>
<Choices><Choice context={"Plan the walk around " + $picked}>Plan the walk</Choice></Choices>
```

## Map

One to 50 places, with a numbered list of them under the map. A complete `Map` without a `Place` or with more than 50 is refused. The list is the accessible form of the map and the form a page shows when it has no tiles, so every place appears in it, also one the map could not place.

| Prop    | Type   | Required | Notes                                                |
| ------- | ------ | -------- | ---------------------------------------------------- |
| `value` | scalar | No       | Bindable; the `value` of the place a person picked   |

A `Map` is not an input unless it is bound. Bound, a row of the list is a button when its `Place` has a `value`, and picking it sets the binding. A Choice carries the value only when a place of that map offers it, or when it still has its default.

## Place

One place. It stands only inside `Map`, and its children are the name.

| Prop      | Type   | Required | Notes                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------- |
| `lat`     | number | With `lon` | From -90 to 90                                                      |
| `lon`     | number | With `lat` | From -180 to 180                                                    |
| `address` | string | Or `lat` and `lon` | At most 512 characters; looked up by the host when there are no coordinates |
| `detail`  | string | No       | A line under the name                                                 |
| `value`   | scalar | No       | What picking the place sets on the bound `Map`                        |

A `Place` that gives `lat` without `lon` (or the other way round), or neither coordinates nor an address, fails alone and draws as its text. Coordinates win over an address when both are given, and the address is then only shown.

## Looking up an address

A renderer does not look anything up. `UiRenderContext.place(nodeId)` hands it the point the host read, which is `undefined` until the block is frozen, and `null` for a place with no point. The list says `Looking up` for the first and `Not on the map` for the second; a place without a point has no marker. [Queries](/intelligent-ui/host/queries) says how the machine freezes the points.

## What the host draws

The host chooses the map, so a block cannot name tiles, a style or a vendor. A renderer that draws the picture has the host's tiles when it has them, and otherwise an outline of the world with the same numbered markers, always with the list under it. The picture is not part of the block: it is not saved, and the same block reads on a page without tiles. A point drawn at street level on the outline would be a blank patch, so the outline never zooms closer than a country. The outline is the 110m land of Natural Earth, which is in the public domain.

## Fallback

A `Map` falls back to a numbered list, one line per place: `1. Domtoren (52.0907, 5.1214): Climb the tower`. The coordinates, the address and the detail are all in it, so another agent reading the reply sees where the places are.
