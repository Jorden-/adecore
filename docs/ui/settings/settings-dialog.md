# SettingsDialog

A settings window: sections on the left, one pane on the right, and an optional search that jumps to the row it found. It lives in its own entry point, `@adecore/ui/settings`, with the parts a pane is built from.

```tsx
import { SettingsDialog } from '@adecore/ui/settings';
```

<Demo src="settings/settings-dialog" />

## Sections and panes

You describe the sections, the dialog draws them. `groups` is the navigation, in order, each with an optional label (the first group usually goes without one). `footer` sections stand at the foot of the navigation. A section names a `pane`, a component the dialog renders only while that section is open, inside a `Suspense` and an [`ErrorBoundary`](/ui/display/error-boundary). A lazy pane loads when its section is first opened.

A pane is a padded column that scrolls, with a fade at its top once something scrolled under the header. A `split` section gets the whole height instead, for a [`MasterDetail`](/ui/settings/master-detail) whose two sides scroll on their own.

A section with a `hero` opens on that block, run to the edges of the pane, with the title bar floating over its top. The bar is clear at first and fills in with the dialog's surface and a hairline over the first 70 pixels of scroll. It covers the top 86 pixels of the hero, more when the description wraps, so leave that much room. The pane follows under the hero in the same padded column as any other pane. A `split` section draws no hero.

You keep which section is open. `onNavigate` tells you when a person picks another, with a click or the arrow keys in the navigation.

## Search

`search.find(query)` returns the results for what a person typed. It is yours, so it can search your own words in any language. While the field holds a query, the results take the place of the navigation. A result names a section and, optionally, the `searchId` of a [`SettingsRow`](/ui/settings/settings-section) in it. Picking one calls `onNavigate` with the section and the row as `target`. Pass that back in as `target`, and the row scrolls into view and lights up for a moment, then calls `onTargetShown`, where you clear it.

Escape in the search field clears the query first; only an empty field lets Escape close the dialog. Enter jumps to the first result. `search.hint` prints the shortcut that focuses the field. `search.focusAt` focuses and selects the field each time the number grows, so your shortcut handler can bump it.

## An account at the foot

`account` puts one more section under the footer, past a hairline, whose tab you draw yourself, such as an avatar and a name. The tab is a Base UI `Tabs.Tab` (from `@base-ui/react/tabs`) with the section's id as its value.

## Narrow windows

The dialog is 1200 by 760 pixels and steps down with the viewport. Under 960 pixels the navigation narrows, and under 640 it turns into a select of sections above the pane.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `open` | `boolean` | | Required. |
| `onOpenChange` | `(open: boolean) => void` | | Required. |
| `section` | `string` | | Required. The id of the open section. |
| `onNavigate` | `(next: { section: string; target?: string \| null }) => void` | | Required. |
| `groups` | `readonly SettingsGroupEntry[]` | | Required. `{ label: string \| null; sections }` |
| `footer` | `readonly SettingsSectionEntry[]` | `[]` | |
| `account` | `{ section: SettingsSectionEntry; tab: ReactNode }` | | |
| `search` | `SettingsSearch` | | `{ find(query), hint?, focusAt? }` |
| `target` | `string \| null` | `null` | The row a search result jumped to. |
| `onTargetShown` | `() => void` | | |
| `className` | `string` | | On the popup. |
| `ref` | `Ref<HTMLDivElement>` | | |

A `SettingsSectionEntry` is `{ id, icon, label, description, pane, split?, hero? }`, where the description is the line under the pane's title. A `SettingsSearchResult` is `{ section, id, label }`, with `id: null` for a result that is the pane itself.

`SettingsDialogProps`, `SettingsGroupEntry`, `SettingsSectionEntry`, `SettingsSearch` and `SettingsSearchResult` are exported types.
