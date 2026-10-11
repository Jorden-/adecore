import { expect, test } from 'bun:test';
import { DocumentModel } from './document.ts';
import { TypingContexts } from './typing-context.ts';

function context(source: string) {
    const at = source.indexOf('¦');
    const model = new DocumentModel(source.replace('¦', ''));
    const position = model.positionAt(at);
    return new TypingContexts((line) => model.getLine(line)).at(position.line, position.column, 'php');
}

test('PHP markup tracks attribute assignment and quoted and unquoted values', () => {
    for (const [source, markup, quote] of [
        ['<div¦ class=x>', 'tag', undefined],
        ['<div class= ¦>', 'equals', undefined],
        ['<div class="¦x">', 'value', '"'],
        ["<div class='¦x'>", 'value', "'"],
        ['<div class=x¦>', 'value', undefined],
        ['<div class=x ¦>', 'tag', undefined],
        ['<div class="x"¦>', 'tag', undefined],
        ['<div>¦text', undefined, undefined]
    ] as const) {
        expect(context(source)).toMatchObject({ mode: 'html', markup, markupQuote: quote });
    }
});

test('PHP markup keeps assignment and value states across line breaks', () => {
    expect(context('<div\n class=\n ¦>')).toMatchObject({ mode: 'html', markup: 'equals' });
    expect(context('<div class=x\n¦title="y">')).toMatchObject({ mode: 'html', markup: 'tag' });
    expect(context('<div class="a\n¦b">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
    expect(context('<script\n type="text/javascript"\n>¦')).toMatchObject({ mode: 'html', markup: 'raw', element: 'script' });
});

test('PHP returns to the attribute state it entered from', () => {
    expect(context('<div title=<?= $title ?> ¦>')).toMatchObject({ mode: 'html', markup: 'tag' });
    expect(context('<div title="<?= $title ?>¦">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
    expect(context('<div title="<?= "?>" ?>¦">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
    expect(context('<div title="<?= // note ?>¦">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
    expect(context('<div title="<?= /* ?> */ $title ?>¦">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
    expect(context('<div title="<?= $title¦ ?>">')).toMatchObject({ mode: 'code', markup: 'value', markupQuote: '"' });
});

test('raw PHP markup only ends at its own closing tag', () => {
    for (const source of ['<script> <div>¦', '<script> </style>¦', '<script> </script:other>¦', '<script> <?= $x ?>¦']) {
        expect(context(source)).toMatchObject({ mode: 'html', markup: 'raw', element: 'script' });
    }
    expect(context('<script> </script>¦')).toMatchObject({ mode: 'html', markup: undefined, element: undefined });
    expect(context('<style> <script>¦')).toMatchObject({ mode: 'html', markup: 'raw', element: 'style' });
    expect(context('<script/>¦')).toMatchObject({ mode: 'html', markup: undefined, element: undefined });
});

test('PHP markup comments preserve embedded PHP and close correctly', () => {
    expect(context('<div><!-- text¦')).toMatchObject({ mode: 'html', markup: 'comment' });
    expect(context('<div><!-- <?= "-->" ?>¦')).toMatchObject({ mode: 'html', markup: 'comment' });
    expect(context('<div><!-- <?= "-->" ?> -->¦')).toMatchObject({ mode: 'html', markup: undefined });
    expect(context('<div><!-->¦')).toMatchObject({ mode: 'html', markup: undefined });
    expect(context('<div><!--->¦')).toMatchObject({ mode: 'html', markup: undefined });
});

test('malformed markup restarts on a bare opening bracket', () => {
    expect(context('<a <a <div class=¦>')).toMatchObject({ mode: 'html', markup: 'equals' });
    expect(context('<a < text¦')).toMatchObject({ mode: 'html', markup: undefined });
    expect(context('<div class="<a¦">')).toMatchObject({ mode: 'html', markup: 'value', markupQuote: '"' });
});

test('edits invalidate cached markup assignments and quoted values', () => {
    const model = new DocumentModel('<div\n class="a\nb">');
    const contexts = new TypingContexts((line) => model.getLine(line));
    expect(contexts.at(2, 1, 'php').markup).toBe('value');
    model.applyEdits([{ from: 12, to: 13, text: '' }]);
    contexts.invalidate(1);
    expect(contexts.at(2, 1, 'php').markupQuote).toBeUndefined();
    model.applyEdits([{ from: 12, to: 12, text: "'" }]);
    contexts.invalidate(1);
    expect(contexts.at(2, 1, 'php').markupQuote).toBe("'");
});
