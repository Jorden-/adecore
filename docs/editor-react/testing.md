# Testing

`@adecore/editor-react/testing` holds a fake language service and a manual clock, so the features run in `bun test` without a server, a process or a browser.

## FakeLanguageService

`FakeLanguageService` implements [`LanguageService`](/lsp/language-service) in memory. `respond(method, answer, provider?)` registers an answer for an LSP method and the provider options the service declares for it, such as `triggerCharacters`. A method without an answer is unsupported and rejects with code `-32601`.

```ts
import { expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage, ProjectLanguage } from '@adecore/editor-react';
import { FakeLanguageService, ManualTimers } from '@adecore/editor-react/testing';

test('the editor reports its edits and counts problems', async () => {
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one', theme: 'light' });
    const language = new EditorLanguage(project, editor, 'file:///work/example.ts', 'typescript', new ManualTimers());

    await language.document.ready;
    editor.type('two');
    expect(service.documents.get(language.uri)?.text).toBe('two');

    service.report({
        uri: language.uri,
        source: 'fake',
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: 'A problem', severity: 1 }]
    });
    expect(language.diagnostics.counts().error).toBe(1);

    language.dispose();
    project.dispose();
});
```

| Member                        | What it is                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `documents`                   | The open documents with their `text` and `version`                               |
| `calls`                       | Every request and document notification, as `LanguageCall`s (`method`, `uri`, `params`, `options`) |
| `report(report)`              | Sends a diagnostics report                                                       |
| `refresh(uri)`                | Fires `onProvidersChanged`, as a server that came up                             |
| `respond('open', answer)`     | Runs when a document opens; an answer that returns a promise delays the open     |

An answer for a document whose text changed while it was pending rejects with `StaleResultError`, as a real service must. The fake does not model several clients of one document or a server that fails; for those, test the [LSP layer](/lsp/testing).

## ManualTimers

The features wait before they ask: 80 milliseconds before suggestions, 300 before a hover card. `ManualTimers` replaces the clock, passed as the last argument of `EditorLanguage`; `realTimers` is the default one, on `setTimeout`, and a subclass of `EditorLanguage` that takes a `Timers` of its own defaults to it too. `advance(ms)` runs what is due, and the test awaits the promises of the requests that started.
