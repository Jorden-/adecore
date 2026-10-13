# Documents and edits

`new DocumentModel(text?)` starts a document with one caret at offset 0 and an empty history. The model keeps its text in a persistent rope, so an edit copies only the chunks it touches and an old snapshot keeps its own text.

## Text and lines

`getText()` flattens the rope once per revision and caches it. A feature that needs a small region reads it with `getLength()`, `getLineCount()`, `getLine(line)` or `slice(from, to)` instead.

```ts
const document = new DocumentModel('first\r\nsecond');

document.getLineCount(); // 2
document.getLine(1); // { start: 7, end: 13, next: 13, text: 'second' }
document.positionAt(9); // { line: 1, column: 2 }
document.offsetAt({ line: 1, column: 99 }); // 13, the end of the line
```

The model keeps the line endings it was given. A line ends at `\n`, `\r\n` or a lone `\r`, the way the language server protocol counts lines, so a position means the same line to the model and to a server. A `\r\n` counts as one break, and neither of its characters is part of the line's `text`. An empty document has one line, and a trailing break adds an empty last line.

`getLine` clamps a line number out of range. `positionAt` and `offsetAt` clamp to the document and to the line. `slice` is a plain substring and can cut a surrogate pair in half.

## Selections

`getSelections()` returns copies in the order the carets were added. The last one is the primary caret, which `getPrimary()` returns: the view scrolls to it and a language feature asks about it.

`setSelections(selections)` clamps the offsets, moves an end out of the middle of a surrogate pair or a `\r\n`, and merges selections that touch or overlap. A merge that takes in the primary caret keeps the result last. An empty list becomes one caret at offset 0. A call to `setSelections` also ends the current typing group in the history.

```ts
const document = new DocumentModel('red blue red');

document.setSelections([
    { anchor: 0, head: 3 },
    { anchor: 9, head: 12 }
]);
document.typeText('green', { language: 'text' });
document.getText(); // 'green blue green'
```

## Edits

`applyEdits(edits, options?)` applies a batch of `TextEdit`s at once. Every range is in the coordinates of the text before the batch, so the order of the list does not matter. The batch is one undo step.

```ts
const document = new DocumentModel('red blue red');
const revision = document.getRevision();

document.applyEdits(
    [
        { from: 0, to: 3, text: 'green' },
        { from: 9, to: 12, text: 'green' }
    ],
    { expectedRevision: revision, source: 'command' }
);
```

It returns `true` when the text changed. It returns `false`, with nothing changed, for a batch that leaves the text as it was or for an `expectedRevision` the document moved past. It throws a `RangeError` for an offset outside the document, a range with `to` before `from`, an edge inside a surrogate pair, or two edits that overlap; two different insertions at one offset count as overlapping. A non-string `text` throws a `TypeError`. Nothing changes when it throws.

| `DocumentEditOptions` | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `expectedRevision`    | Refuse the batch unless the document is at this revision                               |
| `selections`          | The selections after the edit; without them the current ones move along with the edits |
| `source`              | `'input'`, `'command'` or `'external'` (the default), passed on to listeners           |
| `historyGroup`        | Joins this batch to the previous undo step of the same group                           |
| `joinPrevious`        | Joins the previous undo step when the text is exactly as that step left it             |
| `typed`               | Marks the change as a person's typing though it ran as a command; the snapshot says so |

`setText(text)` replaces everything as one undoable `external` edit. It keeps the history; to start over without one, make a new model.

## Revisions

`getRevision()` goes up by one with every change of the text, undo and redo included, and never returns to an earlier value. A selection change leaves it alone. Take the revision before asking something slow, such as a language server or a model, and pass it as `expectedRevision` with the answer. A `false` then means the person typed in between and the answer needs asking again.

## History

`undo()` and `redo()` return whether there was a step to take. A new edit clears the redo stack, and the history keeps the last 200 steps.

Edits with the same `historyGroup` join one undo step until something closes the group: a `setSelections`, an undo, an edit without the group, or any other change of the text or the selections in between. `typeText` uses the group `typing` unless told otherwise, so a word typed letter by letter undoes at once.

## Snapshots and listeners

`getSnapshot()` returns an `EditorSnapshot`: `text`, `selections`, `revision`, `canUndo` and `canRedo`. Its `text` is read lazily from the rope of that revision, so a snapshot kept across later edits still returns its own text.

`subscribe(listener)` returns a `Disposable` and calls the listener after every change, synchronously, with a fresh snapshot. It does not call it right away. A snapshot of a text change adds three fields:

- `source`: what made the change.
- `changes`: one list of `DocumentChange`s (`from`, `to`, `insertedLength`) per transaction in the step, each in the coordinates of the text before that transaction. An undo of a typing group has one list per keystroke.
- `contentEdits`: the same change as `ContentEdit`s with line and column positions, each in the text the edit before it left. That is the order a language server's `didChange` expects.

```ts
const subscription = document.subscribe((snapshot) => {
    if (snapshot.contentEdits === undefined) {
        return; // only the selection moved
    }
    send(snapshot.contentEdits);
});

subscription.dispose();
```

The model has no `dispose` of its own. Dispose its subscriptions and drop the reference; a retained snapshot keeps the rope of its revision alive.
