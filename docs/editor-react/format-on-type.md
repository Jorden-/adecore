# Format on type

The language server tidies the code around the caret as a person types: a `}` that moves to the indentation of its block, the line after Enter, a `;` that closes a statement. It is `textDocument/onTypeFormatting`, and it runs without any key or command.

`language.formatOnType` is the feature. It asks only when the service has `onTypeFormatting` (optional on [`LanguageService`](/lsp/language-service)) and `supports('textDocument/onTypeFormatting', uri)` is true, which is a server announcing `documentOnTypeFormattingProvider`. The characters that ask are the server's `firstTriggerCharacter` and `moreTriggerCharacter`, read with `providerOptions` and listed by `triggerCharacters()`. `supported` says whether the feature can ask for this document.

## When it asks

The request goes out after the change that typed a trigger character, with the caret behind it, the character as `ch` and the indentation of the editor (`tabSize` and `insertSpaces`) as the formatting options. All of these must hold:

- The change comes from the keyboard (`source` is `'input'`) or is marked `typed` (Enter runs as a command, and says so), and is the only change of that edit. Undo, redo, a command of the host, a reload from outside and a completion do not ask.
- The text is the trigger character alone, the closer the editor moved back to its opener's indentation (whitespace and one trigger character), or for `\n` a line break with the indentation after it, also with the closing line Enter adds between braces. A paste of several characters, a text from an input method that commits more than one character, do not ask. A single character pasted looks like a typed one and asks.
- The editor has one caret, is not read only and is not in a [snippet](/editor-react/completion) session. A session is skipped altogether instead of mapping the edits onto its tab stops.

The feature follows the editor's reports of changed text, so a character the editor absorbs instead of inserting, such as a closer typed over one that is already there, asks nothing: the editor reports no change for it.

## What happens to the answer

The answer is applied only while the text is exactly the one it was asked about and the caret has not moved. Every later change of the text cancels the request that is out, and an answer that arrives anyway, or a `StaleResultError` of the service, is dropped. Edits that overlap each other, an empty answer and a failing server change nothing and say nothing: the next trigger character asks again.

The edits are applied with `editor.applyEdits(edits, { mergeUndo: true })`, which joins the undo step of the typed character, so one undo takes the formatting and the character away together and redo brings both back.

## Enabling it

It is off by default. A host enables it explicitly with `language.formatOnType.configure(true)` after the person chooses it. `configure(false)` turns it off and cancels a request that is out. `isEnabled` reads the current state.
