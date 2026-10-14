# Models

`@adecore/editor-react/models` exports the pure functions the features are built on, without React or an editor, for a host and for tests. The helpers behind the cards are internal.

## Completion

| Export                                       | What it does                   |
| -------------------------------------------- | ------------------------------ |
| `parseSnippet`, `compileSnippet`, `tabOrder` | A snippet's text and stops     |
| `insertionOf`                                | What a completion item inserts |

## Hover, signatures and problems

| Export                             | What it does                           |
| ---------------------------------- | -------------------------------------- |
| `severityOf`, `codeLabelOf`        | The severity and label of a diagnostic |
| `decodeSemanticTokens`, `scopesOf` | Semantic tokens as scopes              |

## Navigation, rename and actions

| Export                  | What it does                               |
| ----------------------- | ------------------------------------------ |
| `distinguishingFolders` | The folders that tell peeked files apart   |
| `ResourceOperationView` | The files an edit makes, moves and deletes |

## Proposals and diffs

| Export                                                           | What it does                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `parseAnswer`                                                    | The last closed `replacement` fence of a Markdown answer, and the rest            |
| `fitReplacement`, `endOfInsertion`                               | A replacement in the line breaks of the text it replaces                          |
| `lineSpanOf`, `inlineRangeOf`, `isEmptyRange`, `problemsOnLines` | The stretch a proposal is about                                                   |
| `locateSelection`, `replaceRange`                                | Finding and replacing text by position                                            |
| `diffSegments`, `emphasisOf`, `replacedWords`                    | The segments and changed words `ChangeReview` draws                               |
| `replaceLines`, `replaceAllLines`                                | Replacing whole lines                                                             |
| `planConflict`                                                   | The stretches of a three-way merge that need a person                             |
| `patchLayoutOf`                                                  | The role, numbers and files of every line of a [patch](/editor-react/patch-files) |

````ts
import { parseAnswer } from '@adecore/editor-react/models';

parseAnswer('Shorter:\n```replacement\nconst total = sum(lines);\n```\nIt reads better.');
// { replacement: 'const total = sum(lines);', rest: 'Shorter:\nIt reads better.' }
````

## Find and placement

| Export                                                                     | What it does                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `compileFind`, `matchesIn`, `stepIndex`, `EMPTY_FIND_QUERY`, `MATCH_LIMIT` | A find query checked, run over a text, and stepped through |
