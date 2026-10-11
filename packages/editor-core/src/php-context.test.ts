import { expect, test } from 'bun:test';
import { DocumentModel } from './document.ts';
import { TypingContexts } from './typing-context.ts';

function initialMode(text: string): string {
    const model = new DocumentModel(text);
    return new TypingContexts((line) => model.getLine(line)).at(0, 0, 'php').mode;
}

test('PHP templates start in markup after leading blank lines and prose before a tag', () => {
    expect(initialMode('\n\n<div class="a">')).toBe('html');
    expect(initialMode('Hello <?= $n ?>')).toBe('html');
    expect(initialMode("Don't panic <?= $n ?>")).toBe('html');
    const model = new DocumentModel("Hello <?= $n ?>\nDon't panic");
    const context = new TypingContexts((line) => model.getLine(line)).at(1, 11, 'php');
    expect(context.mode).toBe('html');
});

test('bare PHP fragments and tagged PHP code retain their code start', () => {
    for (const text of ['', "Don't panic", "$x = '<div>';", '$x = "<?= $n ?>";', 'echo "<?php";', '<?php', '#!/usr/bin/php']) {
        expect(initialMode(text)).toBe('code');
    }
});

test('editing the first nonblank line invalidates the PHP initial state', () => {
    const model = new DocumentModel('\n<div>');
    const contexts = new TypingContexts((line) => model.getLine(line));
    expect(contexts.at(1, 5, 'php').mode).toBe('html');
    model.applyEdits([{ from: 1, to: model.getText().length, text: '$value = 1;' }]);
    contexts.invalidate(1);
    expect(contexts.at(1, 11, 'php').mode).toBe('code');
    model.applyEdits([{ from: 1, to: model.getText().length, text: '<div>' }]);
    contexts.invalidate(1);
    expect(contexts.at(1, 5, 'php').mode).toBe('html');
});

test('an edit before the deciding line can change the PHP initial state', () => {
    const model = new DocumentModel('\n\n<div>');
    const contexts = new TypingContexts((line) => model.getLine(line));
    expect(contexts.at(2, 5, 'php').mode).toBe('html');
    model.applyEdits([{ from: 0, to: 0, text: '$value = 1;\n' }]);
    contexts.invalidate(0);
    expect(contexts.at(3, 0, 'php').mode).toBe('code');
});

test('markup typed into an empty PHP document is recognized by the next Enter', () => {
    const model = new DocumentModel('');
    model.typeText('<div></div>', { language: 'php' });
    model.setSelections([{ anchor: 5, head: 5 }]);
    model.execute('insertNewline', { language: 'php' });
    expect(model.getText()).toBe('<div>\n    \n</div>');
});

test('comments after leading blank lines use PHP markup markers', () => {
    const model = new DocumentModel('\n<div class="a">');
    model.setSelections([{ anchor: 1, head: 1 }]);
    model.execute('toggleLineComment', { language: 'php' });
    expect(model.getText()).toBe('\n<!-- <div class="a"> -->');
});

test('PHP initial-state inference stays within its line and character limits', () => {
    const model = new DocumentModel('\n'.repeat(65) + '<div>');
    const reads: number[] = [];
    const contexts = new TypingContexts((line) => {
        reads.push(line);
        return model.getLine(line);
    });
    expect(contexts.at(0, 0, 'php').mode).toBe('code');
    expect(reads.every((line) => line < 64)).toBe(true);
    expect(initialMode(' '.repeat(65536) + '<div>')).toBe('code');
});
