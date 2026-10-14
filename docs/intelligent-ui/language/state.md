# State and inputs

A block keeps its own state: the values a person changes while reading it. State is local. It lives in the page, it never reaches the agent until a person picks a Choice, and it starts again from the defaults when the page reloads.

```ui
$scope = "failed"
$limit = 20
<Segmented value={$scope}>
<Option value="failed">Failed</Option>
<Option value="all">All</Option>
</Segmented>
<Slider value={$limit} min={10} max={100} step={10} unit="runs">Runs to compare</Slider>
<Button action={@Reset()}>Reset</Button>
<Choices>
<Choice context={"Compare the last " + $limit + " runs, " + $scope + " only"}>Compare</Choice>
</Choices>
```

## Declarations

`$name = value` at the top of the block declares a variable with a literal JSON default. The type of the default is the type of the variable: a person can change `$limit` to another number, never to a string or `null`. See [Syntax](/intelligent-ui/language/syntax#declarations).

## Bindings

Six inputs take a `value`. Write `value={$name}` and the control is bound: a person's change writes the variable. Write anything else and the control only shows the value and is disabled.

| Component   | Binds `value` as          |
| ----------- | ------------------------- |
| `Checklist` | The list of checked `Item` values |
| `Switch`    | A boolean                 |
| `Slider`    | A number between `min` and `max` |
| `Segmented` | The value of the chosen `Option` |
| `Select`    | The value of the chosen `Option` |
| `TextField` | A string of at most `maxLength` characters |

A binding takes effect only when the prop is a bare reference to a declared variable that is not a query. `value={$limit + 1}` shows a number and binds nothing. A control changes state only after its tag closed, and only with a value its schema accepts. [Inputs](/intelligent-ui/components/inputs) lists their props.

A `TextField` is state like any other: what a person types lives in the page, never reaches the agent until a Choice carries it, and returns to its default when the page reloads. A text longer than its limit is never written, so a variable always fits the field that binds it. A query that reads `$q` reads again once the text rests, like a slider that stopped moving.

Everything else reads state through expressions. A Summary that counts the checked items redraws when the checklist changes.

```ui
$selected = []
<Summary>{@Count($selected)} selected</Summary>
<Checklist value={$selected}>
<Item value="lint">Lint</Item>
<Item value="test">Test</Item>
</Checklist>
<Show when={@Count($selected) > 0}>
<Choices><Choice context={"Run " + @Join($selected)}>Run selected</Choice></Choices>
</Show>
```

## Buttons

A Button runs one action on local state when a person presses it. Its children are the label.

| Action               | Effect                                             |
| -------------------- | -------------------------------------------------- |
| `@Set($name, value)` | Sets the variable to a constant value              |
| `@Reset($name)`      | Puts one variable back to its default              |
| `@Reset()`           | Puts every variable back to its default            |

```ui
$range = "week"
<Segmented value={$range}>
<Option value="day">Day</Option>
<Option value="week">Week</Option>
</Segmented>
<Button action={@Set($range, "day")}>Only today</Button>
<Button action={@Reset($range)} disabled={$range == "week"}>Back to the week</Button>
```

The value of `@Set` must be a constant: a literal, or an array or record of literals. `@Set($limit, $limit + 10)` is refused with `refused_action`. A constant gives the same result whatever state the Button was pressed in, so the backend can tell which values a person could have produced on screen. The target must be a declared variable and never a query; anything else is `refused_binding`. A Button needs its `action`, and `disabled={true}` turns it off.

## Choices read state

A Choice's `context` and label may use state, and the message it sends is evaluated with the values on screen. The backend checks those values again before it sends: each must equal its default, be held by a visible control, or be the value a visible enabled Button sets. See [Choices](/intelligent-ui/host/choices).

## UiState

`UiState` holds the state of one block in the page. A renderer creates one per block and keeps it while the block is mounted.

| Member                    | What it does                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `new UiState(block)`      | Starts from the block's defaults                                                                 |
| `sync(block)`             | Takes a recompiled block: keeps an edit while its default is unchanged, resets a changed default, drops a removed variable and clears query data whose definition changed |
| `scope()`                 | A copy of every variable and query value, for evaluation                                         |
| `set(name, value)`        | Writes a declared variable; refuses another type with `invalid_value`                            |
| `setQuery(name, value, block)` | Stores a host's reading for a query of this block                                           |
| `run(action)`             | Runs `@Set`, `@Reset($name)` or `@Reset()`                                                       |
| `snapshot()`, `subscribe(listener)` | A revision number and a listener for every change, for `useSyncExternalStore`          |

A block that streams is recompiled many times. Its id stays the same, so `sync` keeps what a person did while the rest arrives. A block with another id starts over.

`evaluateUiBlock(block, state)` returns a `UiEvaluation`: `nodes`, the `UiViewNode` tree to draw, and `diagnostics` for the parts that failed. A bound control's `node.bindings.value` is a `UiBinding` with the current `value` and `onValueChange(next)`. A Button's `node.onAction()` runs its action. Both do nothing until the node is complete; `onAction` also does nothing while the Button is disabled.
