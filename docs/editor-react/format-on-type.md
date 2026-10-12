# Format on type

The language server tidies the code around the caret as a person types: a `}` that moves to the indentation of its block, the line after Enter, a `;` that closes a statement. It is `textDocument/onTypeFormatting`, and it runs without any key or command.

`language.formatOnType` is the feature. It asks only when the service has `onTypeFormatting` (optional on [`LanguageService`](/lsp/language-service)) and `supports('textDocument/onTypeFormatting', uri)` is true, which is a server announcing `documentOnTypeFormattingProvider`. The characters that ask are the server's `firstTriggerCharacter` and `moreTriggerCharacter`, read with `providerOptions` and listed by `triggerCharacters()`. `supported` says whether the feature can ask for this document.

## When it asks

The request goes out after the change that typed a trigger character, with the caret behind it, the character as `ch` and the indentation of the editor (`tabSize` and `insertSpaces`) as the formatting options. All of these must hold:

- The change comes from the keyboard (`source` is `'input'`) and is the only change of that edit. Undo, redo, a command of the host, a reload from outside and a completion do not ask.
- The text is the trigger character alone, or for `\n` a line break with the indentation after it. A paste of several characters, a text from an input method that commits more than one character, and an Enter that also inserts a closing line do not ask. A single character pasted looks like a typed one and asks.
- The editor has one caret, is not read only and is not in a [snippet](/editor-react/completion) session. A session is skipped altogether instead of mapping the edits onto its tab stops.

The feature follows the editor's reports of changed text, so a character the editor absorbs instead of inserting, such as a closer that is already there, asks only if the editor reports a change for it.

## What happens to the answer

The answer is applied only while the text is exactly the one it was asked about and the caret has not moved. Every later change of the text cancels the request that is out, and an answer that arrives anyway, or a `StaleResultError` of the service, is dropped. Edits that overlap each other, an empty answer and a failing server change nothing and say nothing: the next trigger character asks again.

The edits are applied with `editor.applyEdits`, which is one undo step of its own, directly after the step of the typed character. Undo takes the formatting away first and the character second. The editor has no way to join an edit of the host to the typing before it, so the two cannot share a step.

## Turning it off

It is on wherever the server offers it. A host with a setting for it calls `language.formatOnType.configure(false)`, which also cancels a request that is out, and `configure(true)` when the setting comes back. `isEnabled` reads the current state.
