# Search and folding

## Find

`find(query, options?)` returns every `FindMatch` in the document: `from`, `to`, `text`, the regular expression's `captures` and named `groups`, and the `revision` it was found in. `findNext(query, from?, options?)` returns the first match at or after `from`, the primary caret by default, and wraps around unless `wrap` is `false`; `backwards: true` searches the other way.

| `FindOptions`   | Default | Meaning                                                                      |
| --------------- | ------- | ---------------------------------------------------------------------------- |
| `caseSensitive` | `false` |                                                                              |
| `wholeWord`     | `false` | A match may not touch a letter, digit, `_` or `$` on either side             |
| `regex`         | `false` | The query is a JavaScript regular expression, run with the `m` and `u` flags |
| `from`, `to`    | whole   | Keep only matches inside these offsets; the expression still sees the rest   |
| `maxResults`    | none    | Stop after this many                                                         |

`iterateMatches(text, query, revision, options?)` yields the same results one at a time, including captures and groups. Validation and regex execution begin on the first advance; stopping iteration releases the remaining scan without collecting an array. `findMatches` eagerly collects this iterator and keeps its existing exceptions and result shape.

`findMatchFrom(text, query, revision, offset, options?)` is the standalone form of `findNext`, retaining only a few matches. It clamps `offset` into the text, scans from the query's original bounds and respects `maxResults`, `backwards` and `wrap`. Searching `aa` in `aaaa` from offset 1 returns `[2, 4]`, not a new overlapping `[1, 3]` match. Backward search stops once the preceding result is known; wrapping without a preceding result scans to the end while keeping only the last result. `DocumentModel.findNext` uses this helper.

An empty plain query finds nothing. Bounds outside the document throw a `RangeError` and an invalid expression a `SyntaxError`. A regular expression has no time limit.

## Replace

`replace(match, replacement, options?)` replaces one match and returns `false`, with nothing changed, when the match comes from another revision or its text no longer stands there. `replaceAll(query, replacement, options?)` replaces every match in one undo step and returns how many it replaced, or `0` when nothing changed.

```ts
const document = new DocumentModel('Item one, item two, ITEM three');

document.replaceAll('item', 'entry', { preserveCase: true });
document.getText(); // 'Entry one, entry two, ENTRY three'
```

`replaceMatches(matches, replacement, options?)` applies retained, unique, nonoverlapping results from one search without running its expression again. It accepts `ReplaceOptions`, replaces the batch in one undo step and returns the number replaced, or `0` for an empty or unchanged batch. If any result has a stale revision or different text, the whole batch is refused. Duplicate ranges, invalid edit bounds or overlapping results throw before any change, as in `applyEdits`. This lets an asynchronous search provide results while the document still checks the revision at commit time. `replaceAll` uses the same batch path after its synchronous search.

With a regular expression the replacement expands `$1`, `$<name>`, `$&` and the other JavaScript patterns; `literal: true` turns that off. `preserveCase: true` gives the replacement the case of the text it replaces. `findMatches` and `replacementText` are the same search and expansion without a model.

## Folding ranges

`getFoldingRanges(options?)` reads the folds of the document. Without options it returns bracket pairs and block comments that span more than one line. Pass a `language` for the rest:

| `kind`          | What folds                                                                      | Needs               |
| --------------- | ------------------------------------------------------------------------------- | ------------------- |
| `bracket`       | A `{}`, `[]` or `()` pair over several lines                                    |                     |
| `comment`       | A block comment                                                                 |                     |
| `indentation`   | Lines indented deeper than the one above them                                   | `indentation: true` |
| `imports`       | A run of import lines                                                           | a language          |
| `line-comments` | A run of line comments                                                          | a language          |
| `region`        | What stands between `// region` and `// endregion` markers                      | a language          |
| `block`         | A Markdown front matter, code fence or table, a PHP heredoc or `<?php ?>` block | a language          |
| `section`       | What a Markdown heading holds                                                   | a language          |
| `server`        | A range a language server named that the text has no fold for                   | `hints`             |

`brackets`, `comments`, `imports`, `regions` and `lineComments` turn one kind off with `false`. `minLines`, `1` by default, is how many lines past its first a range spans before it folds. Lines are zero-based and inclusive; `from` and `to` are the offsets of the folded stretch.

## Roles

A range may carry a `role`, which a view uses to fold a kind of range when a file opens. The text gives `file-header` (the first comment of a file), `imports`, `doc-comment`, `region`, `object-literal` and `array-literal` (in TypeScript and JavaScript), `attribute` (a PHP `#[` list), `php-tag`, `heredoc`, `front-matter`, `code-fence` and `table`. The text cannot tell a function body from any other brace pair, so `function-body`, `method-body`, `class-body` and `tag` come from `hints`, which a host fills from a language server's symbols and folding ranges:

```ts
const text = 'function total(items) {\n    return items.length;\n}\n';
const document = new DocumentModel(text);

document.getFoldingRanges({
    language: 'typescript',
    hints: { symbols: [{ from: 0, to: 50, body: 'function' }] }
});
// [{ startLine: 0, endLine: 2, kind: 'bracket', role: 'function-body', from: 22, to: 50 }]
```

A symbol hint names the bracket pair or indented block that ends where the symbol ends. A range hint the text has no fold for becomes a `server` range. A role describes what the scanner found; it is not a parsed syntax tree.
