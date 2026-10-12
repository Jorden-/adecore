# Completion and signatures

<Demo src="editor/completion" />

## Suggestions

Typing an identifier character, or a trigger character the service lists in the `triggerCharacters` of its completion options, asks for suggestions after a pause of 80 milliseconds. Each later character filters the list that is there, unless the service marked it incomplete; then the list is asked again. `completion.invoke()` asks at once, as Ctrl+Space does.

`CompletionPopup` draws the list: the matched letters, a letter and color per kind, and the documentation of the active row beside it, resolved through `completionItem/resolve` when the service supports it. The keys while it is open:

| Key                    | What it does                                               |
| ---------------------- | ---------------------------------------------------------- |
| Up, Down               | Moves through the list, round at the ends                  |
| Page Up, Page Down     | Moves eight rows                                           |
| Enter                  | Inserts the active row                                     |
| Tab                    | Replaces the word after the caret with the active row     |
| Escape                 | Closes the list                                            |
| A commit character     | Inserts the row and types the character, once a person moved in the list or asked with the keyboard |

`completion.accept(replace, index?)`, `move(delta)` and `close()` do the same from code. A row the person picked before ranks higher next time. Accepting applies the item's `additionalTextEdits` too, such as an import, and runs its command when it has one.

For a function, method or constructor in TypeScript, JavaScript, Vue, PHP or Python, accepting adds the parentheses and puts the caret between them, unless the code after the caret already opens a call. That also opens the signature card when the function takes parameters.

## Snippets

An item with `insertTextFormat: 2` is a snippet. After it lands, Tab and Shift+Tab walk its stops, `$0` last, and the session ends at the last stop or when the caret leaves. Numbered stops with the same index share the first defined placeholder value and are edited together. This also works when completion inserts the snippet at several carets: every instance follows Tab and Shift+Tab, with the defining occurrence of the primary instance selected last. Typing and IME commits update the mirrors in one undo step; undo ends the session. Escape ends the session and keeps only the primary caret.

Nested placeholders are visited in numeric order. Editing a child updates that child inside copies of its parent. Replacing a parent removes its nested stops. Touching or overlapping mirror ranges stay static except for the primary occurrence, because the editor merges touching selections. The session also ends if distributed paste or contextual smart typing gives the selected mirrors different text; the inserted text is retained and only the primary caret remains. A variable inserts its default or nothing, and a choice inserts its first value. Variable resolution, choice selection and transforms remain separate work.

```ts
import { parseSnippet, tabOrder } from '@adecore/editor-react/models';

const snippet = parseSnippet('print(${1:value}, ${2:count})$0');
snippet.text; // 'print(value, count)'
tabOrder(snippet).map((stop) => stop.index); // [1, 2, 0]
```

## Signature help

Typing a trigger character of the service's signature help, such as `(` or `,`, asks for the signatures of the call around the caret. `signature.invoke()` asks at once, as Mod+P does, and `close()` closes the card. `SignatureCard` draws the active signature with the active parameter in bold, its documentation, and which of several signatures it is. Its prop is a `SignatureViewModel`, made by `signatureViewOf` from the service's answer.

`ParsedSnippet` keeps its `text` and `stops` shape and adds optional `fields`. A `SnippetField` groups UTF-16 `SnippetRange` offsets by index; `primary` selects the occurrence defining the default, `linked` describes child projections in parent copies, and `parents` names enclosing fields. `choices` preserves the offered strings for a future choice picker. `tabOrder` still returns one `SnippetStop` per index, ending at `$0` or the end of the inserted text. Stops are returned in text order, with an enclosing placeholder before its children.
