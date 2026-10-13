# ProjectSwitcher

A project name in a toolbar that opens a menu of projects, recent projects and the actions of each. The app hands it the lists and handles each pick; the component keeps no project state and opens nothing itself.

```tsx
import { ProjectSwitcher } from '@adecore/ui';
```

<Demo src="overlays/project-switcher" />

## Projects

Each `ProjectSwitcherItem` has an `id`, unique within its list, and a `name`. The lists are drawn as given, in order and unfiltered.

| Item field | What it draws |
| --- | --- |
| `icon` | A node before the name, in the row and in the trigger when this is `current`. |
| `description` | A tooltip beside the row, for a folder path or connection details. |
| `hint` | Quiet text at the end of the row, for a machine or workspace. |
| `disabled` | A project that cannot be picked. Its actions stay reachable. |
| `muted` | A dimmed row that can still be picked, for a disconnected project the app can try to reopen. |
| `actions` | `Menu.Item`s in a submenu beside the row. |

`projects` fill the top of the menu. A nonempty `recentProjects` adds a Recent projects submenu.

`onSelect(project, event)` receives the original item and the click event. `ProjectSwitcherProps<Item>` keeps the type of an item with fields of your own. The event carries the modifier keys, so the app can open a project in a new window on Cmd-click or Ctrl-click.

`current` gives the trigger its name and icon, and need not be in either list. With `current={null}` the trigger reads "Projects" (`projectSwitcher.label`). `leading` adds a node before the current icon, such as a machine indicator with its own tooltip.

## Groups

The menu draws three groups: the projects, then the items in `before`, then Recent projects with the items in `children`. Put the ways to open a project in `children`, such as opening a folder or creating a project, so they share a group with Recent projects. Put what is neither in `before`. A group with nothing in it draws no separator.

The same groups are `ProjectSwitcherGroups`, for a menu that opens from a trigger of its own, such as a plus at the end of a row of open projects. It takes `projects`, `recentProjects`, `before`, `children` and `onSelect` as above and goes inside a `Menu.Popup`.

```tsx
<Menu.Root>
    <IconButton render={<Menu.Trigger />} icon={Plus} label="Open project" />
    <Menu.Popup className="min-w-60">
        <ProjectSwitcherGroups projects={projects} onSelect={open} />
    </Menu.Popup>
</Menu.Root>
```

Keyboard, typeahead and submenus come from [Menu](/ui/overlays/menu). Typeahead matches the project name, not its hint.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `current` | `ProjectSwitcherItem \| null` | | Required. |
| `projects` | `readonly Item[]` | | Required. |
| `onSelect` | `(project: Item, event: MouseEvent<HTMLElement>) => void` | | Required. |
| `recentProjects` | `readonly Item[]` | `[]` | |
| `leading` | `ReactNode` | | |
| `before` | `ReactNode` | | Menu items between the projects and Recent projects. |
| `children` | `ReactNode` | | Menu items in the group of Recent projects. |
| `label` | `string` | the current name | The trigger's accessible name. |
| `disabled` | `boolean` | | |
| `open`, `defaultOpen`, `onOpenChange` | | | As on `Menu.Root`. |
| `className` | `string` | | On the trigger. |
| `ref` | `Ref<HTMLButtonElement>` | | The trigger. |

`ProjectSwitcherProps` and `ProjectSwitcherItem` are exported types.
