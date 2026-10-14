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

One to 50 places, with a numbered list of them under the map. A complete `Map` without a `Place` or with more than 50 written is refused. An `Each` or a `Show` inside it is counted again once it drew: a `Map` that draws none fails as a whole, and one that draws more than 50 shows the first 50 with the diagnostic `too_many_children` and a line under the list that says how many were left out (`UiViewNode.omitted`). The list is the accessible form of the map and the form a page shows when it has no tiles, so every place appears in it, also one the map could not place.

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
| `address` | string | Or `lat` and `lon` | At most 512 characters; looked up by the host |
| `detail`  | string | No       | A line under the name                                                 |
| `value`   | scalar | No       | What picking the place sets on the bound `Map`                        |

A `Place` that gives `lat` without `lon` (or the other way round), or neither coordinates nor an address, fails alone and draws as its text. Give both and the host's lookup of the address wins: the point it finds is the one drawn, and `lat` and `lon` stand while the lookup is on its way, when it finds nothing and when the host looks nothing up.

## Looking up an address

A renderer does not look anything up. `UiRenderContext.place(nodeId, address)` hands it the point the host read for that address, which is `undefined` until the block is frozen, and `null` for an address with no point. A reading counts only for the address it was made for, so a place that moved to another node (an `Each` that reordered) or whose address changed never wears another place's point. A reply the machine keeps no readings for reads as not found at once. The list says `Looking up` for the first and `Not on the map` for the second; a place without a point has no marker. [Live queries](/intelligent-ui/host/queries#places) says how the machine freezes the points.

## What the host draws

The host chooses the map, so a block cannot name tiles, a style or a vendor. A renderer that draws the picture has the host's tiles when it has them, and otherwise an outline of the world with the same numbered markers, always with the list under it. The picture is not part of the block: it is not saved, and the same block reads on a page without tiles. A point drawn at street level on the outline would be a blank patch, so the outline never zooms closer than about a country. The outline is the 110m land of Natural Earth, which is in the public domain.

## Fallback

A `Map` falls back to a numbered list, one line per place that drew (a place that failed stays unnumbered, as its text): `1. Domtoren (52.0907, 5.1214): Climb the tower`. The coordinates, the address and the detail are all in it, so another agent reading the reply sees where the places are.
