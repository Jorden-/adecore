# Data

Compare values and records. Give numbers as numbers, never as text, so a renderer can align, format and chart them.

<Demo src="intelligent-ui/data" />

```ui
<Stats>
<Stat label="Cold start" value={1.42} previous={1.9} unit="s" tone="success"/>
<Stat label="Bundle" value={812} unit="kB"/>
</Stats>
<EntityList>
<Entry label="Branch">main</Entry>
<Entry label="Runner">macOS arm64</Entry>
</EntityList>
<Table rows={[{"file": "src/app.ts", "size": 48213, "time": 1250}, {"file": "src/chat.ts", "size": 31877, "time": 830}]}>
<Column key="file" title="File" as="file"/>
<Column key="size" title="Size" as="bytes"/>
<Column key="time" title="Build time" as="duration"/>
</Table>
<Chart kind="bar" unit="s" data={[{"label": "Mon", "build": 41, "test": 63}, {"label": "Tue", "build": 38, "test": 59}, {"label": "Wed", "build": 44, "test": 71}]}/>
```

## Stats and Stat

A small set of key numbers. `Stats` has no props and holds only `Stat`. A `Stat` stands only inside `Stats` and has no children.

| Prop       | Type     | Required | Notes                                                         |
| ---------- | -------- | -------- | ------------------------------------------------------------- |
| `label`    | string   | Yes      |                                                               |
| `value`    | number   | Yes      |                                                               |
| `previous` | number   | No       | The value to compare with; the tile shows the change          |
| `unit`     | string   | No       | Written after the number, a percent sign without a space      |
| `tone`     | `UiTone` | No       | Colors the change; without it the change stays neutral        |

## EntityList and Entry

Labeled facts about one thing. `EntityList` has no props and holds only `Entry`. An `Entry` stands only inside `EntityList`; its children are the value.

| Prop    | Type   | Required | Notes |
| ------- | ------ | -------- | ----- |
| `label` | string | Yes      |       |

## Table and Column

Rows with named columns. `Table` holds only `Column`, which describes a field of the rows and draws nothing itself. Without Columns, the table shows the keys of the rows.

| Prop   | Type             | Required | Notes                         |
| ------ | ---------------- | -------- | ----------------------------- |
| `rows` | array of records | Yes      | At most 1,000 rows            |

| Column prop | Type   | Required | Notes                                                                        |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `key`       | string | Yes      | The field of each row, 1 to 256 characters                                   |
| `title`     | string | No       | The heading; the key without one                                             |
| `unit`      | string | No       | Written after each number                                                    |
| `as`        | string | No       | `text`, `number`, `bytes`, `duration`, `date`, `file` or `tag`                |

A `duration` is in milliseconds. A `date` is milliseconds since the epoch or an ISO string, within the range a JavaScript `Date` holds (8.64e15 milliseconds either way). A `file` is a path in mono text. A value of the wrong kind reads as text, and a missing one as nothing.

## Chart

Labeled numeric series. Each row of `data` has a `label` and up to six numeric series by name. Chart has no children.

| Prop   | Type             | Required | Notes                                              |
| ------ | ---------------- | -------- | -------------------------------------------------- |
| `kind` | string           | Yes      | `bar`, `hbar` (horizontal), `stacked` or `line`    |
| `data` | array of records | Yes      | At most 1,000 rows of scalars                      |
| `unit` | string           | No       | Written after each value                           |

A renderer draws only the series it can use. A value that is not a finite number is a gap, and a chart without one usable series, or with numbers too large to scale, draws as its data.

A bar and an `hbar` grow from zero to either side, so a negative value reads as one. Stacked parts cannot be negative: stacked data with a negative value is drawn as bars side by side, with a line that says so. A drawing holds the first 60 rows and the first six series; whatever it leaves out it names under the chart, with every value a press away. A chart with more than six series is noted as `too_many_series`. A label, tick or value too long for its room is cut short, which also offers every value; a long `unit` stands once above a bar, `hbar` or line chart instead of beside each number. An axis needs a span it can divide by, so data whose range is too large or too small to scale (such as a subnormal number) draws as its data.

```ui
$weeks = [{"label": "W1", "opened": 12, "closed": 9}, {"label": "W2", "opened": 8, "closed": 14}]
<Chart kind="stacked" data={$weeks}/>
```
