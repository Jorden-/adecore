# Inputs

Change local block state. Bind a control with `value={$name}`; see [State and inputs](/intelligent-ui/language/state). State stays in the block until a Choice sends visible context.

<Demo src="intelligent-ui/inputs" />

```ui
$selected = ["links"]
$notify = false
$limit = 20
$scope = "failed"
<Checklist value={$selected}>
<Item value="links">Fix the link parser</Item>
<Item value="preload">Make the bridge method optional</Item>
</Checklist>
<Switch value={$notify}>Notify me when it lands</Switch>
<Slider value={$limit} min={10} max={100} step={10} unit="runs">Runs to compare</Slider>
<Segmented value={$scope}>
<Option value="failed">Failed</Option>
<Option value="all">All</Option>
</Segmented>
<Button action={@Reset()}>Reset</Button>
```

A control is disabled until its tag closed, and when its `value` is anything but a bare reference to a declared variable.

## Checklist and Item

Select values in a list. `Checklist` holds only `Item`, and binds the list of checked values. An `Item` stands only inside `Checklist`; its children are the label and may hold a link.

| Prop    | Type            | Required | Notes                   |
| ------- | --------------- | -------- | ----------------------- |
| `value` | array of scalars | Yes     | At most 1,000; bindable |

| Item prop | Type   | Required | Notes                               |
| --------- | ------ | -------- | ----------------------------------- |
| `value`   | scalar | Yes      | A string, number, boolean or `null` |

## Switch

A local boolean. Its children are the label.

| Prop    | Type    | Required | Notes    |
| ------- | ------- | -------- | -------- |
| `value` | boolean | Yes      | Bindable |

## Slider

A local number in a range. Its children are the label.

| Prop    | Type   | Required | Notes                                  |
| ------- | ------ | -------- | -------------------------------------- |
| `value` | number | Yes      | Bindable; from `min` to `max`          |
| `min`   | number | Yes      | Below `max`                            |
| `max`   | number | Yes      |                                        |
| `step`  | number | No       | Above zero                             |
| `unit`  | string | No       | Written after the value                |

## Segmented and Option

Choose one value. `Segmented` holds only `Option`, and binds the chosen option's value. An `Option` stands only inside `Segmented`; its children are its label. Option draws nothing itself: Segmented reads its options. Keep labels to a few words; an option longer than that makes the renderer of agents-react stand the options in a column.

| Prop    | Type   | Required | Notes    |
| ------- | ------ | -------- | -------- |
| `value` | scalar | Yes      | Bindable |

| Option prop | Type   | Required | Notes |
| ----------- | ------ | -------- | ----- |
| `value`     | scalar | Yes      |       |

## Button

Runs one action on local state when pressed. Its children are the label.

| Prop       | Type    | Required | Notes                                                     |
| ---------- | ------- | -------- | --------------------------------------------------------- |
| `action`   | action  | Yes      | `@Set($name, constant)`, `@Reset($name)` or `@Reset()`     |
| `disabled` | boolean | No       |                                                           |

`action` is kept as written and runs only when pressed. [Buttons](/intelligent-ui/language/state#buttons) gives the rules.

## Show

Shows its children while `when` is true. Show may stand inside any container, and its children follow that container's rule.

| Prop   | Type    | Required | Notes |
| ------ | ------- | -------- | ----- |
| `when` | boolean | Yes      |       |

```ui
$details = false
<Switch value={$details}>Show details</Switch>
<Show when={$details}><Callout tone="info">The cache missed on every cold start.</Callout></Show>
```

## Each

Repeats its children for every item. Each may stand inside any container, and its children follow that container's rule.

| Prop    | Type   | Required | Notes                                                     |
| ------- | ------ | -------- | --------------------------------------------------------- |
| `items` | array  | Yes      | At most 1,000                                             |
| `as`    | string | Yes      | The item's name, a letter or `_` then letters, digits, `_` |

```ui
$checks = ["lint", "types", "tests"]
$done = ["lint"]
<Checklist value={$done}>
<Each items={$checks} as="check"><Item value={check}>{check}</Item></Each>
</Checklist>
```
