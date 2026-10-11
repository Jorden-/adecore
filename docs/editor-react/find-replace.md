# FindReplace

A find and replace bar over the [matcher of an editor](/editor/find-folding#find).

<Demo src="editor/find-replace" />

```tsx
<FindReplace editor={editor} onClose={() => setFindOpen(false)} />
```

| Prop        | Type         | Meaning                                         |
| ----------- | ------------ | ----------------------------------------------- |
| `editor`    | `Editor`     | The editor to search                            |
| `onClose`   | `() => void` | Escape in the bar; the bar does not hide itself |
| `className` | `string`     | On the bar                                      |

When the editor reports more matches than it can mark, the count ends with `+`, for example `1 / 10,000+`. Replace all still covers every match.

The bar has case, whole word and regular expression toggles, a search in the selection, the count of matches, previous and next, and a replace row with preserve case, replace and replace all. Enter goes to the next match and Shift+Enter to the previous one. A regular expression that does not parse says so instead of searching. Unmounting the bar ends the find.

Whether the bar shows, and which key opens it, is the app's. The `findNext`, `findPrevious` and `replace` ids of the [key table](/editor/options#keymaps) name keys for that.
