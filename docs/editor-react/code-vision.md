# Code vision

Rows above each declaration that say how often it is used and who wrote it. A press on the usages opens a [peek](/editor-react/navigation#peek) of the references; a press on the authors opens a card with them.

<Demo src="editor/code-vision" />

Both kinds are off until the app turns them on:

```ts
language.codeVision.configure({ usages: true, authors: true });
```

Usages come from `textDocument/references` for the declarations in view plus 40 lines around them, three requests at a time, after the text and the scroll have settled. Declarations are read from the document's symbols. A count stays on its row until a new one is in.

Authors come from Git, which the package never runs. The app runs `git blame` on the file as it is on disk and hands over the result with that text, the `base`:

```ts
language.codeVision.setBlame({ kind: 'pending' }); // holds the rows' height while Git runs
language.codeVision.setBlame({ kind: 'ready', blame, base: textOnDisk, openCommit: (hash) => showCommit(hash) });
```

A `GitBlameResult` has the `commits` (`hash`, `shortHash`, `author`, `email`, `at` in milliseconds, `summary`) and `lines`, the index of the commit of each line of `base`. `omitted: 'untracked'` or `'too-large'` says why there is none. Lines typed since the blame map onto no commit and count as uncommitted. `setBlame(null)` removes the authors.

The card lists the authors of the declaration by the number of lines they wrote, the uncommitted lines, and the latest commit, with a button to it when `openCommit` is set.

Files of more than 20,000 lines, or with more than 3,000 declarations , get no rows.
