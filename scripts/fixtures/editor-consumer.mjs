import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentModel } from '@adecore/editor-core';
import { createSmartEditorEngine } from '@adecore/editor';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { resolveKeymap, chordOf } from '@adecore/editor/keymap';
import { shikiTokenizers } from '@adecore/editor/shiki';
import { createPage } from '@adecore/editor/testing';
import { applyTextEdits } from '@adecore/lsp';
import { createMemoryTransportPair, FakeLanguageServer } from '@adecore/lsp/testing';
import { ProjectLanguage, EditorLanguage, SignatureCard, ChangeReview, AttributionCard } from '@adecore/editor-react';
import { diffSegments } from '@adecore/editor-react/models';
import { FakeLanguageService, ManualTimers } from '@adecore/editor-react/testing';
const model = new DocumentModel('before');
model.applyEdits([{ from: 0, to: 6, text: 'after' }]);
assert.equal(model.getText(), 'after');
assert.equal(model.undo(), true);
assert.equal(model.getText(), 'before');
assert.equal(model.replaceMatches(model.find('before'), 'after'), 1);
assert.equal(model.getText(), 'after');
assert.equal(model.undo(), true);
assert.equal(model.getText(), 'before');
assert.equal(typeof createSmartEditorEngine, 'function');
assert.equal(typeof shikiTokenizers, 'function');
assert.ok(createPage().host);
assert.equal(typeof FakeLanguageServer, 'function');
assert.equal(createMemoryTransportPair().length, 2);
assert.equal(applyTextEdits('a', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'b' }]), 'b');
const keymap = resolveKeymap({ goToDefinition: { other: 'Alt+Shift+D' } });
assert.equal(chordOf('goToDefinition', false, keymap), 'Alt+Shift+D');
const service = new FakeLanguageService();
const timers = new ManualTimers();
const project = new ProjectLanguage(service, { keymap });
const editor = new FakeEditorEngine().mount({}, { text: 'one', language: 'typescript', theme: 'light' });
const language = new EditorLanguage(project, editor, 'file:///example.ts', 'typescript', timers);
await language.document.ready;
editor.setText('two');
await Promise.resolve();
assert.equal(service.documents.get(language.uri).text, 'two');
service.report({
    uri: language.uri,
    source: 'fake',
    diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: 'Problem' }]
});
assert.equal(language.diagnostics.counts().error, 1);
const signature = renderToStaticMarkup(
    createElement(SignatureCard, {
        model: {
            label: 'print(value)',
            active: { start: 6, end: 11 },
            index: 0,
            count: 1,
            parameterName: 'value',
            parameterDocumentation: 'A value',
            documentation: ''
        }
    })
);
assert.match(signature, /A value/);
assert.match(renderToStaticMarkup(createElement(ChangeReview, { editor, selected: 'a', proposal: 'b', label: 'Proposed edit' })), /Proposed edit/);
assert.equal(typeof AttributionCard, 'function');
assert.equal(diffSegments('a', 'b', 1)[0].firstLine, 1);
language.dispose();
editor.dispose();
project.dispose();
await Promise.resolve();
await Promise.resolve();
assert.equal(service.documents.size, 0);
console.log('Editor packed consumer execution passed.');
