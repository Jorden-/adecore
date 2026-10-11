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
    expect(context('<script\n type="text/javascript"\n>¦')).toMatchObject({ markup: 'raw', element: 'script', embedded: 'javascript' });
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
        expect(context(source)).toMatchObject({ markup: 'raw', element: 'script', embedded: 'javascript' });
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

test('PHP script content uses script comments, regexes, templates and bracket stacks', () => {
    expect(context('<script>#x; call(¦</script>')).toMatchObject({ mode: 'code', embedded: 'javascript', bracket: { close: ')' } });
    expect(context('<script>let regex = /[a¦]/;</script>')).toMatchObject({ mode: 'regex', inClass: true, embedded: 'javascript' });
    expect(context('<script>// note¦</script>')).toMatchObject({ mode: 'line-comment', embedded: 'javascript' });
    expect(context('<script>/* note¦</script>')).toMatchObject({ mode: 'block-comment', embedded: 'javascript' });
    expect(context('<script>let value = `first\nsecond¦`;</script>')).toMatchObject({ mode: 'template', embedded: 'javascript' });
    expect(context('<script>let value = `${call(¦)}`;</script>')).toMatchObject({ mode: 'code', embedded: 'javascript', bracket: { close: ')' } });
    expect(context('<script>value <<<EOT\ncall¦\n</script>')).toMatchObject({ mode: 'code', embedded: 'javascript' });
});

test('PHP islands suspend the script state including across PHP source line breaks', () => {
    expect(context("<script>let value = '<?= $value ?>¦';</script>")).toMatchObject({ mode: 'quote', quote: "'", embedded: 'javascript' });
    expect(context("<script>let value = '<?=\n$value\n?>¦';</script>")).toMatchObject({ mode: 'quote', quote: "'", embedded: 'javascript' });
    expect(context('<script>let value = `<?=\n$value\n?>¦`;</script>')).toMatchObject({ mode: 'template', quote: '`', embedded: 'javascript' });
    expect(context('<script>// <?=\n$value\n?>¦')).toMatchObject({ mode: 'line-comment', embedded: 'javascript' });
    expect(context('<script>call(<?= $value ?>¦);</script>')).toMatchObject({ mode: 'code', embedded: 'javascript', bracket: { close: ')' } });
    expect(context('<script>call(<?= $value¦ ?>);</script>').embedded).toBeUndefined();
    expect(context('<script>call(<?= $value¦ ?>);</script>').mode).toBe('code');
});

test('HTML closes a script even inside a script string, comment, template or regex', () => {
    for (const prelude of ["let value = '", '// ', '/* ', 'let value = `', 'let regex = /']) {
        const result = context('<script>' + prelude + '</script><a href=¦>');
        expect(result).toMatchObject({ mode: 'html', markup: 'equals' });
        expect(result.embedded).toBeUndefined();
    }
    expect(context('<script>let value = "<\\/script>¦";</script>')).toMatchObject({ mode: 'quote', embedded: 'javascript' });
});

test('script line comments, regexes and ordinary quotes reset at emitted line breaks', () => {
    for (const prelude of ['// note', 'let value = "unfinished', 'let regex = /unfinished']) {
        expect(context('<script>\n' + prelude + '\n¦call();\n</script>')).toMatchObject({ mode: 'code', embedded: 'javascript' });
    }
    expect(context('<script>let value = "escaped\\\n¦continuation";</script>')).toMatchObject({ mode: 'quote', embedded: 'javascript' });
});

test('script queries do not mutate the state cached at the start of a line', () => {
    const model = new DocumentModel('<script>\nconst value = "unfinished\ncall();\n</script>');
    const contexts = new TypingContexts((line) => model.getLine(line));
    expect(contexts.at(1, 0, 'php').mode).toBe('code');
    expect(contexts.at(1, model.getLine(1).text.length, 'php').mode).toBe('quote');
    expect(contexts.at(1, 0, 'php').mode).toBe('code');
    expect(contexts.at(2, 0, 'php').mode).toBe('code');
    expect(contexts.at(1, 0, 'php').mode).toBe('code');
});

test('a real PHP closing tag consumes exactly its immediately trailing newline', () => {
    for (const newline of ['\n', '\r\n']) {
        expect(context('<script>// note <?php $x = 1; ?>' + newline + '¦call();</script>')).toMatchObject({ mode: 'line-comment', embedded: 'javascript' });
        expect(context('<script>// note <?php $x = 1; ?>' + newline + newline + '¦call();</script>')).toMatchObject({ mode: 'code', embedded: 'javascript' });
        expect(context('<script>// note <?php $x = 1; ?> ' + newline + '¦call();</script>')).toMatchObject({ mode: 'code', embedded: 'javascript' });
    }
    expect(context('<script>// note <?php // PHP note ?>\n¦call();</script>')).toMatchObject({ mode: 'line-comment', embedded: 'javascript' });
    expect(context("<script>let value = '<?= $value ?>\n¦';</script>")).toMatchObject({ mode: 'quote', embedded: 'javascript' });
    expect(context('<script>// ?>\n¦call();</script>')).toMatchObject({ mode: 'code', embedded: 'javascript' });
});

test('each PHP script context retains its own absolute body start', () => {
    const source = '<script>\nfirst();\n</script>\n<script>\nsecond();\n</script>';
    const model = new DocumentModel(source);
    const contexts = new TypingContexts((line) => model.getLine(line));
    const first = contexts.at(1, 0, 'php').embedStart;
    const second = contexts.at(4, 0, 'php').embedStart;
    expect(first).toBe(source.indexOf('>') + 1);
    expect(second).toBe(source.indexOf('>', source.indexOf('<script>', 1)) + 1);
    expect(contexts.at(1, 0, 'php').embedStart).toBe(first);
});
