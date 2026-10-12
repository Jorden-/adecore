# Models

The features are built on pure functions without React or an editor, which `@adecore/editor-react/models` exports on their own. The root exports them too. They suit a host that draws its own cards, and tests.

## Completion

| Export                                                                                  | What it does                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `itemsOf`, `rankCompletions`, `matchScore`, `matchDetail`, `matchedCharacters`          | The items of an answer, ranked and scored against the typed prefix           |
| `prefixFor`, `identifierPrefix`, `isIdentifierCharacter`, `editRangeOf`                 | What was typed and which range an item replaces                              |
| `insertionOf`, `mirroredInsertions`, `snippetToText`, `SNIPPET_FORMAT`                  | What an item inserts, at one caret or several                                |
| `documentationText`, `completionDocsOf`, `qualifierOf`, `qualifiersOf`                  | The documentation and the module or class an item comes from                 |
| `kindLetterOf`, `kindToneOf`, `rowWindow`, `METHOD_KIND`, `FUNCTION_KIND`, `CONSTRUCTOR_KIND`, `CLASS_KIND` | How a row looks and which rows are drawn                   |
| `planCall`, `isCallItem`, `hasParameters`, `withParentheses`, `PARAMETER_HINTS_COMMAND` | Adding the parentheses of a call                                             |
| `parseSnippet`, `tabOrder`                                                              | A snippet's text and stops                                                   |

## Hover, signatures and problems

| Export                                                                                   | What it does                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `hoverTextOf`, `hoverSectionsOf`, `splitSignatures`, `splitDocTags`, `docblockMarkdown`, `markdownParts`, `isEmptyHover`, `locationsOf`, `sameRange` | The parts of a hover answer |
| `signatureViewOf`, `parameterSpan`                                                       | A `SignatureViewModel` and the span of a parameter      |
| `severityOf`, `markerOf`, `codeLabelOf`, `problemsAt`, `neighborProblem`, `comparePositions`, `shiftPosition`, `shiftRange`, `rangeHolds` | Diagnostics as markers and problems |
| `linkTypeNames`, `isTypeName`, `declaredNameOf`, `placesOfName`, `SYMBOL_LINK_CLASS`     | The type names in a signature that link to their definition |
| `decodeSemanticTokens`, `scopesOf`                                                       | Semantic tokens as scopes                               |

## Navigation, rename and actions

| Export                                                                                    | What it does                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `peekFilesOf`, `snippetOf`, `definitionSnippetOf`, `distinguishingFolders`, `visualColumnOf`, `PEEK_READ_FILES` | The files and code of a peek |
| `entriesOf`, `groupEntries`, `filterEntries`, `scoreOf`, `modeOf`, `workspaceEntriesOf`, `groupOfKind`, `letterOfKind`, `toneOfKind`, `SYMBOL_GROUPS` | The symbol picker |
| `wordRangeAt`, `renameTargetOf`, `occurrencesOf`, `renameRowsOf`, `renamePreviewOf`       | Rename                                           |
| `resourceOperationsOf`, `ResourceOperationView`                                           | The files an edit makes, moves and deletes       |
| `actionsOf`, `groupOf`, `mergeEntries`, `isHint`, `fixableOnLine`, `diagnosticsAt`, `previewOf`, `ACTION_GROUPS`, `REFACTOR_GROUPS` | Code actions |
| `declarationsOf`, `startAfterComments`, `usagesText`, `MAX_DECLARATIONS`                  | Code vision declarations                         |
| `mapBlame`, `authorshipOf`, `authorsText`, `shortName`, `UNCOMMITTED`                     | Authors from Git blame                           |

## Proposals and diffs

| Export                                                                                 | What it does                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `parseAnswer`                                                                          | The last closed `replacement` fence of a Markdown answer, and the rest |
| `fitReplacement`, `endOfInsertion`                                                     | A replacement in the line breaks of the text it replaces             |
| `lineSpanOf`, `inlineRangeOf`, `isEmptyRange`, `problemsOnLines`                       | The stretch a proposal is about                                      |
| `locateSelection`, `offsetOf`, `textInRange`, `replaceRange`                           | Finding and replacing text by position                               |
| `diffSegments`, `emphasisOf`, `replacedWords`                                          | The segments and changed words `ChangeReview` draws                  |
| `replaceLines`, `replaceAllLines`                                                      | Replacing whole lines                                                |
| `planConflict`                                                                         | The stretches of a three-way merge that need a person                |

```ts
import { parseAnswer } from '@adecore/editor-react/models';

parseAnswer('Shorter:\n```replacement\nconst total = sum(lines);\n```\nIt reads better.');
// { replacement: 'const total = sum(lines);', rest: 'Shorter:\nIt reads better.' }
```

## Find and placement

| Export                                                             | What it does                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `compileFind`, `matchesIn`, `stepIndex`, `EMPTY_FIND_QUERY`, `MATCH_LIMIT` | A find query checked, run over a text, and stepped through |
| `placePopup`, `placeBeside`                                        | Where a card goes next to a character, inside the window   |
