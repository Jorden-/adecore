# Patch files

A host that shows an editable `.patch` or `.diff` file can draw it the way the [diff views](/editor-react/change-review) draw a change, and list its files in a tree. Two pieces do that: `patchLayoutOf` reads the text, and `decoratePatch` applies the reading to a mounted editor. The editor stays fully editable. Saving the file is the host's.

## Reading a patch

`patchLayoutOf(text, limits?)` is a pure function from `@adecore/editor-react/models`. It never throws, and it returns a `PatchLayout`:

- `lines` has one entry per line of `text.split('\n')`, with a `role`, and for context, added and removed lines the one-based `old` and `new` numbers from the hunk headers (`null` where the file has no such line).
- `files` lists the file sections for a tree: `oldPath` and `newPath` (`null` for `/dev/null`), `status`, the zero-based `firstLine` and `lastLine` of the section in the text, the `added` and `removed` counts and the `hunks`.
- `truncated` says the text went past a limit.

| Role                                           | Lines                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `file-header`                                  | `diff --git`, `---`, `+++`, `index`, the mode, similarity, rename and copy lines                  |
| `hunk-header`                                  | `@@ -a,b +c,d @@ section`                                                                         |
| `context`, `added`, `removed`                  | The lines of a hunk. An empty line inside a hunk is context whose space an editor trimmed         |
| `no-newline`                                   | `\ No newline at end of file`                                                                      |
| `binary`                                       | `Binary files a and b differ`, and the data of a `GIT binary patch`                                |
| `other`                                        | Everything else: a mail header, a diffstat, a blank line, a line that belongs nowhere             |

A file `status` is `added`, `deleted`, `renamed`, `copied`, `modified` or `binary`. Git patches and plain `diff -u` output both work, with timestamps after a tab, quoted paths with escapes and octal bytes, names with spaces, and CRLF line endings. A `---` line followed by `+++` starts a file section; inside a hunk that still expects lines, `--- x` is a removed line. The `-- ` signature of a mailed patch is not a removed line.

### An edited patch

A person who edits the patch breaks its counts. The reading goes on: a hunk whose lines no longer add up to its header gets `consistent: false`, a line typed below a complete hunk extends it and is numbered on, and a header that is cut short ends the hunk. The line numbers are the ones the hunk header and the lines above give, so they move with the edit and are not repaired.

### Limits

`limits` has `maxLines` (50,000 by default) and `maxCharacters` (4,000,000); `DEFAULT_PATCH_LIMITS` holds both. Past either one, `lines` ends and `truncated` is `true`. The lines after the cut have no role and the last section ends where the reading stopped.

```ts
import { patchLayoutOf } from '@adecore/editor-react/models';

const layout = patchLayoutOf(text);
for (const file of layout.files) {
    console.log(file.status, file.newPath, `+${file.added} -${file.removed}`);
}
```

## Drawing it

`decoratePatch(editor, options?)` styles a mounted editor that holds the patch text:

- Added lines get a solid bar and removed lines a striped one, with the tinted cell and number of the [diff views](/editor-react/change-review#gutter), continuous over consecutive lines.
- The gutter shows the numbers from the hunk headers instead of the line numbers of the file, and none on header lines. `numbers: 'single'` shows the old number on a removed line and the new one otherwise; `'both'` shows old and new side by side.
- File headers sit on a raised surface, and hunk headers are tinted in the accent color.
- With `labels`, a screen reader hears `Removed, old line 8`, `Added, new line 12` or `Old line 3, new line 3` with the line, once. A hook that fills `labels` from the editor namespace is below.

`onLayout` is called with the layout after every read, the first one included, which is what a file tree follows. It returns a `PatchDecoration` with the current `layout`, `refresh()` and `dispose()`, which takes everything off the editor again. The text is read again once per turn of edits, however many keystrokes come in it, and a read is one pass over at most the limits.

```ts
import { decoratePatch } from '@adecore/editor-react';

const decoration = decoratePatch(editor, {
    numbers: 'both',
    limits: { maxLines: 20_000 },
    onLayout: (layout) => tree.setFiles(layout.files)
});
```

In React, `usePatchDecorations(editor, options?)` does the same for as long as the editor stands, with the words of the `editor` namespace, and returns the layout, or `null` without an editor.

The decorations use line highlights, a line number provider, line labels and change marks of the editor, so a host that sets those for the same editor replaces them.
