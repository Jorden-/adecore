import { describe, expect, it } from 'bun:test';
import { DocumentModel, type TypeTextOptions } from './document.ts';

/* `¦` marks a caret, `«` and `»` a selection. */
function parse(source: string): { text: string; anchor: number; head: number } {
    const open = source.indexOf('«');
    const close = source.indexOf('»');
    if (open >= 0 && close >= 0) {
        return { text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1), anchor: open, head: close - 1 };
    }
    const caret = source.indexOf('¦');
    return { text: source.replace('¦', ''), anchor: caret, head: caret };
}

function render(model: DocumentModel): string {
    const { anchor, head } = model.getSelections()[0]!;
    const text = model.getText();
    if (anchor === head) {
        return text.slice(0, head) + '¦' + text.slice(head);
    }
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

function type(source: string, typed: string, expected: string, options: TypeTextOptions = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections([{ anchor: initial.anchor, head: initial.head }]);
    model.typeText(typed, { language: 'typescript', ...options });
    expect(render(model)).toBe(expected);
}

describe('typing over a selection', () => {
    it.each([
        ['«foo»', '(', '(«foo»)'],
        ['«foo»', '<', '<«foo»>'],
        ['«foo»', '"', '"«foo»"'],
        ['«foo»', '`', '`«foo»`'],
        ['a «b c» d', '{', 'a {«b c»} d'],
        ['«a\nb»', '[', '[«a\nb»]']
    ])('wraps %s in %s', (source, typed, expected) => type(source, typed, expected));

    it('keeps the direction of the selection', () => {
        const model = new DocumentModel('foo');
        model.setSelections([{ anchor: 3, head: 0 }]);
        model.typeText('(');
        expect(model.getText()).toBe('(foo)');
        expect(model.getSelections()).toEqual([{ anchor: 4, head: 1 }]);
    });

    it('replaces an operator that is typed over with a comparison sign', () => {
        type('a «==» b', '<', 'a <¦ b');
        type('a «<=» b', '<', 'a <¦ b');
        type('a «!=» b', '<', 'a <¦ b');
        type('a «foo» b', '<', 'a <«foo»> b');
        type('"a «==» b"', '<', '"a <«==»> b"');
    });

    it('swaps the delimiters of a selection that has them', () => {
        type('«"foo"»', "'", "'«foo»'");
        type('«(foo)»', '[', '[«foo»]');
        type('«(foo)»', '(', '(«(foo)»)');
        type('«"a"b"»', "'", `'«"a"b"»'`);
    });

    it('swaps the quotes of a string when one of them is selected', () => {
        type('x = «"»foo";', "'", "x = '¦foo';");
        type('x = "foo«"»;', "'", "x = 'foo'¦;");
        type('x = «`»a ${b}`;', '"', 'x = "¦a ${b}";');
    });

    it('escapes and unescapes the quotes inside the string it swaps', () => {
        type(`x = «"»it's \\"x\\"";`, "'", `x = '¦it\\'s "x"';`);
        type(`x = «'»a \\'b\\' "c"';`, '"', `x = "¦a 'b' \\"c\\"";`);
    });

    it('does not swap a quote that is not the quote of a string', () => {
        type('a «"» b', "'", `a '«"»' b`);
    });

    it('wraps without pairing and in plain text, and not when it is off', () => {
        type('«foo»', '(', '(«foo»)', { autoClosingPairs: false });
        type('«foo»', '(', '(«foo»)', { language: 'plaintext' });
        type('«foo»', '(', '(¦', { surroundSelection: false });
        type('«foo»', '"', '"«foo»"', { autoClosingQuotes: false });
    });
});

describe('pairing', () => {
    it('pairs a bracket only when it would have no closer of its own', () => {
        type('x = ¦ + y', '(', 'x = (¦) + y');
        type('x = ¦ + y)', '(', 'x = (¦ + y)');
        type('function f() ¦', '{', 'function f() {¦}');
        type('function f() ¦\n}', '{', 'function f() {¦\n}');
        type('const a = [¦, 2', '[', 'const a = [[¦], 2');
        type('f(¦', '(', 'f((¦)');
    });

    it('pairs a quote unless an identifier character follows, or the same quote', () => {
        type('¦.length', '"', '"¦".length');
        type('x = ¦;', '"', 'x = "¦";');
        type('¦foo', '"', '"¦foo');
        type('a ¦"b"', '"', 'a "¦"b"');
        type('foo¦', '"', 'foo"¦');
    });

    it('does not pair in plain text', () => {
        type('¦', '(', '(¦', { language: 'plaintext' });
        type('¦', '"', '"¦', { language: 'text' });
        type('(¦)', ')', '()¦)', { language: 'plaintext' });
    });

    it('leaves brackets and quotes to their own settings', () => {
        type('¦', '(', '(¦', { autoClosingBrackets: false });
        type('¦', '"', '"¦"', { autoClosingBrackets: false });
        type('¦', '"', '"¦', { autoClosingQuotes: false });
        type('¦', '(', '(¦)', { autoClosingQuotes: false });
        type('(¦)', ')', '()¦', { autoClosingQuotes: false });
    });

    it('types the third quote of a Python docstring as it is', () => {
        const model = new DocumentModel();
        for (const character of '"""') {
            model.typeText(character, { language: 'python' });
        }
        expect(model.getText()).toBe('"""');
        model.typeText('x', { language: 'python' });
        for (const character of '"""') {
            model.typeText(character, { language: 'python' });
        }
        expect(model.getText()).toBe('"""x"""');
        const single = new DocumentModel();
        for (const character of "'''") {
            single.typeText(character, { language: 'python' });
        }
        expect(single.getText()).toBe("'''");
        type("x = ''¦", "'", "x = '''¦", { language: 'python' });
    });

    it('still pairs the empty string of Python and types over its closer', () => {
        const model = new DocumentModel();
        model.typeText('"', { language: 'python' });
        expect(model.getText()).toBe('""');
        model.typeText('"', { language: 'python' });
        expect(model.getText()).toBe('""');
        expect(model.getSelections()[0]!.head).toBe(2);
    });
});

describe('a closing bracket typed on a line of its own', () => {
    it('goes back to the indentation of the line its opener is on', () => {
        type('if (x) {\n    foo();\n    ¦', '}', 'if (x) {\n    foo();\n}¦');
        type('    if (x) {\n        foo();\n        ¦', '}', '    if (x) {\n        foo();\n    }¦');
        type('foo(\n    a,\n    ¦', ')', 'foo(\n    a,\n)¦');
        type('x = [\n    1,\n    ¦', ']', 'x = [\n    1,\n]¦');
        type('if (x) {\n    foo();\n¦', '}', 'if (x) {\n    foo();\n}¦');
    });

    it('stays where it is with text before it, in a string or when smart indentation is off', () => {
        type('if (x) {\n    foo();\n    bar¦', '}', 'if (x) {\n    foo();\n    bar}¦');
        type('x = "{\n    ¦', '}', 'x = "{\n    }¦');
        type('if (x) {\n    foo();\n    ¦', '}', 'if (x) {\n    foo();\n    }¦', { smartEnter: false });
    });

    it('is one undo step with the typed character', () => {
        const model = new DocumentModel('if (x) {\n    foo();\n    ');
        model.setSelections([{ anchor: model.getLength(), head: model.getLength() }]);
        model.typeText('}', { language: 'typescript' });
        model.undo();
        expect(model.getText()).toBe('if (x) {\n    foo();\n    ');
    });
});

describe('backspace at the start of a line where brackets say nothing', () => {
    it('joins with the line above and takes the whitespace that trailed it', () => {
        const model = new DocumentModel('foo   \nbar');
        model.setSelections([{ anchor: 7, head: 7 }]);
        model.execute('smartBackspace', { language: 'python' });
        expect(model.getText()).toBe('foobar');
        expect(model.getSelections()).toEqual([{ anchor: 3, head: 3 }]);
        const tabbed = new DocumentModel('foo\t \r\nbar');
        tabbed.setSelections([{ anchor: 7, head: 7 }]);
        tabbed.execute('smartBackspace', { language: 'python' });
        expect(tabbed.getText()).toBe('foobar');
    });

    it('takes a line of whitespace entirely and leaves the text of the line alone', () => {
        const model = new DocumentModel('a\n    \n  b');
        model.setSelections([{ anchor: 7, head: 7 }]);
        model.execute('smartBackspace', { language: 'python' });
        expect(model.getText()).toBe('a\n  b');
        expect(model.getSelections()).toEqual([{ anchor: 2, head: 2 }]);
    });

    it('does not do this for the first line or a caret in the middle of one', () => {
        const model = new DocumentModel('foo  \nbar');
        model.setSelections([{ anchor: 0, head: 0 }]);
        expect(model.execute('smartBackspace')).toBe(false);
        model.setSelections([{ anchor: 8, head: 8 }]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('foo  \nbr');
    });
});

describe('the arrow of PHP', () => {
    const OPEN = '<?php\n';

    /* Types each key into a PHP file in turn and shows the code after the open tag. */
    function php(source: string, keys: readonly string[], options: TypeTextOptions = {}): { model: DocumentModel; shown: () => string } {
        const initial = parse(OPEN + source);
        const model = new DocumentModel(initial.text);
        model.setSelections([{ anchor: initial.anchor, head: initial.head }]);
        for (const key of keys) {
            model.typeText(key, { language: 'php', ...options });
        }
        return { model, shown: () => render(model).slice(OPEN.length) };
    }

    it.each([
        ['$user¦', '$user->¦'],
        ['$this¦', '$this->¦'],
        ['$user->profile¦', '$user->profile->¦'],
        ['$user?->profile¦', '$user?->profile->¦'],
        ['$user->load()¦', '$user->load()->¦'],
        ['$items[0]¦', '$items[0]->¦']
    ])('completes the arrow after %s', (source, expected) => {
        expect(php(source, ['-']).shown()).toBe(expected);
    });

    it.each([['$user ¦'], ['count¦'], ['Foo¦'], ['1¦'], ['if ($a)¦'], ["'$user¦'"], ['"$user¦"'], ['// $user¦'], ['/* $user¦ */']])(
        'types a minus after %s',
        (source) => {
            expect(php(source, ['-']).shown()).toBe(source.replace('¦', '-¦'));
        }
    );

    it.each([
        ['-', '$i--¦'],
        ['=', '$i-=¦'],
        ['1', '$i-1¦'],
        [' ', '$i- ¦'],
        ['$', '$i-$¦'],
        ['(', '$i-(¦)']
    ])('makes it a minus again when %j follows, which cannot follow an arrow', (key, expected) => {
        expect(php('$i¦', ['-', key]).shown()).toBe(expected);
    });

    it.each([
        ['n', '$user->n¦'],
        ['_', '$user->_¦'],
        ['{', '$user->{¦}']
    ])('keeps the arrow when %j follows', (key, expected) => {
        expect(php('$user¦', ['-', key]).shown()).toBe(expected);
    });

    it('goes over its own > when a person types the arrow out', () => {
        const { model, shown } = php('$user¦', ['-', '>']);
        expect(shown()).toBe('$user->¦');
        model.typeText('n', { language: 'php' });
        expect(shown()).toBe('$user->n¦');
    });

    it('takes the whole arrow back with backspace', () => {
        const { model, shown } = php('$user¦', ['-']);
        model.execute('smartBackspace', { language: 'php' });
        expect(shown()).toBe('$user¦');
    });

    it('undoes the > first and then the minus', () => {
        const { model, shown } = php('$user¦', ['-']);
        model.undo();
        expect(shown()).toBe('$user-¦');
        model.undo();
        expect(shown()).toBe('$user¦');
    });

    it('undoes a minus that the next key made of the arrow as one keystroke with it', () => {
        const { model, shown } = php('$i¦', ['-', '-']);
        model.undo();
        expect(shown()).toBe('$i¦');
        expect(model.redo()).toBe(true);
        expect(shown()).toBe('$i--¦');
    });

    it('forgets the arrow once the caret moves', () => {
        const { model, shown } = php('$user¦', ['-']);
        const caret = model.getSelections()[0]!.head;
        model.setSelections([{ anchor: caret - 1, head: caret - 1 }]);
        model.setSelections([{ anchor: caret, head: caret }]);
        model.typeText('1', { language: 'php' });
        expect(shown()).toBe('$user->1¦');
    });

    it('decides for every caret on its own', () => {
        const model = new DocumentModel(`${OPEN}$a\n1`);
        model.setSelections([
            { anchor: OPEN.length + 2, head: OPEN.length + 2 },
            { anchor: OPEN.length + 4, head: OPEN.length + 4 }
        ]);
        model.typeText('-', { language: 'php' });
        expect(model.getText()).toBe(`${OPEN}$a->\n1-`);
        model.typeText('b', { language: 'php' });
        expect(model.getText()).toBe(`${OPEN}$a->b\n1-b`);
    });

    it('types a minus when the arrow is off, and outside PHP', () => {
        expect(php('$user¦', ['-'], { smartArrow: false }).shown()).toBe('$user-¦');
        type('$user¦', '-', '$user-¦');
    });
});

describe('backspace in the indentation of a bracketed language', () => {
    /* Presses backspace once in a PHP file and shows the code after the open tag. */
    function backspace(source: string, language = 'php'): string {
        const open = language === 'php' ? '<?php\n' : '';
        const initial = parse(open + source);
        const model = new DocumentModel(initial.text);
        model.setSelections([{ anchor: initial.anchor, head: initial.head }]);
        model.execute('smartBackspace', { language, tabSize: 4 });
        return render(model).slice(open.length);
    }

    it('goes from an empty line at its indentation to the end of the line above', () => {
        expect(backspace('function f()\n{\n    ¦\n    return 1;\n}')).toBe('function f()\n{¦\n    return 1;\n}');
    });

    it('takes a line indented past where its brackets put it back to there', () => {
        expect(backspace('function f()\n{\n          ¦return 1;\n}')).toBe('function f()\n{\n    ¦return 1;\n}');
        expect(backspace('if (a) {\n      ¦  b();\n}', 'typescript')).toBe('if (a) {\n    ¦b();\n}');
    });

    it('joins a line at its indentation with the line above, spaced as join lines spaces it', () => {
        expect(backspace('{\n    a();\n    ¦b();\n}')).toBe('{\n    a(); ¦b();\n}');
        expect(backspace('{\n  ¦  b();\n}')).toBe('{ ¦b();\n}');
        expect(backspace('f(\n    ¦a\n)', 'typescript')).toBe('f(¦a\n)');
    });

    it('takes the place of a blank line above', () => {
        expect(backspace('{\n\n    ¦b();\n}')).toBe('{\n    ¦b();\n}');
    });

    it('takes the indentation of the first line away and leaves the rest', () => {
        expect(backspace('    ¦a();', 'typescript')).toBe('¦a();');
        expect(backspace('\n¦a();', 'typescript')).toBe('¦a();');
    });

    it('deletes one character when text stands before the caret, and goes by tab stops in a comment', () => {
        expect(backspace('{\n    a¦b();\n}')).toBe('{\n    ¦b();\n}');
        expect(backspace('/*\n        ¦x\n*/')).toBe('/*\n    ¦x\n*/');
    });
});

describe('PHP markup attribute quotes', () => {
    it('pairs quotes after an attribute equals sign, including across lines', () => {
        for (const quote of ['"', "'"]) {
            for (const source of [
                '<div title=¦>',
                '<div title= ¦/>',
                '<div\n title=\n ¦>',
                '<a href="<?= $url ?>" title=¦>',
                '<div title=<?= $value ?> other=¦>'
            ]) {
                type(source, quote, source.replace('¦', quote + '¦' + quote), { language: 'php' });
            }
        }
    });

    it('steps over attribute closers after PHP returns and on multiline values', () => {
        type('<a title="<?= $title ?>¦">', '"', '<a title="<?= $title ?>"¦>', { language: 'php' });
        type('<div title="first\nsecond¦">', '"', '<div title="first\nsecond"¦>', { language: 'php' });
        type("<div title='¦'>", "'", "<div title=''¦>", { language: 'php' });
    });

    it('removes an empty attribute pair with backspace', () => {
        for (const quote of ['"', "'"]) {
            const source = '<div\n title= ' + quote + quote + '>';
            const model = new DocumentModel(source);
            const at = source.indexOf(quote) + 1;
            model.setSelections([{ anchor: at, head: at }]);
            model.execute('smartBackspace', { language: 'php' });
            expect(model.getText()).toBe('<div\n title= >');
            expect(model.getSelections()[0]!.head).toBe(at - 1);
        }
    });

    it('keeps pairing, step-over and backspace correct after undo and redo', () => {
        const source = '<div title=>';
        for (const action of ['type', 'backspace']) {
            const model = new DocumentModel(source);
            const at = source.indexOf('>');
            model.setSelections([{ anchor: at, head: at }]);
            model.typeText('"', { language: 'php' });
            expect(model.getText()).toBe('<div title="">');
            expect(model.undo()).toBe(true);
            expect(model.getText()).toBe(source);
            expect(model.redo()).toBe(true);
            if (action === 'type') {
                model.typeText('"', { language: 'php' });
                expect(model.getText()).toBe('<div title="">');
                expect(model.getSelections()[0]!.head).toBe(at + 2);
            } else {
                model.execute('smartBackspace', { language: 'php' });
                expect(model.getText()).toBe(source);
            }
        }
    });

    it('respects pairing preferences and leaves text, comments, style content and unquoted values alone', () => {
        for (const source of ['<p>don¦t</p>', '<!-- title=¦ -->', '<style>title=¦</style>', '<div title=value¦>', '<div title=¦word>']) {
            type(source, "'", source.replace('¦', "'¦"), { language: 'php' });
        }
        type('<div title=¦>', '"', '<div title="¦>', { language: 'php', autoClosingQuotes: false });
        type('<div title=¦>', '`', '<div title=`¦>', { language: 'php' });
        type('<div title=¦>', '(', '<div title=(¦>', { language: 'php' });
        type('<script>¦</script>', '(', '<script>(¦)</script>', { language: 'php' });
    });

    it('pairs independently at several attribute carets', () => {
        const source = '<div title=>\n<a href=>';
        const model = new DocumentModel(source);
        model.setSelections([
            { anchor: 11, head: 11 },
            { anchor: source.length - 1, head: source.length - 1 }
        ]);
        model.typeText('"', { language: 'php' });
        expect(model.getText()).toBe('<div title="">\n<a href="">');
        model.execute('smartBackspace', { language: 'php' });
        expect(model.getText()).toBe(source);
    });
});

describe('JavaScript typing within PHP script elements', () => {
    it('pairs JavaScript brackets and quotes and steps over returned script strings', () => {
        for (const source of [
            '<script>#x; f¦</script>',
            '<script>\ny = z <<<EOT\nf¦\n</script>',
            "<script>s = '<?= $x ?>' + f¦</script>",
            '<script>// x\nf¦</script>'
        ]) {
            type(source, '(', source.replace('¦', '(¦)'), { language: 'php' });
        }
        type("<script>s = '<?= $x ?>¦';</script>", "'", "<script>s = '<?= $x ?>'¦;</script>", { language: 'php' });
        type('<script>t = `<?= $a ?>¦`</script>', '`', '<script>t = `<?= $a ?>`¦</script>', { language: 'php' });
        type('<script>f¦)</script>', '(', '<script>f(¦)</script>', { language: 'php' });
        type('<script>f¦x)</script>', '(', '<script>f(¦x)</script>', { language: 'php' });
    });

    it('applies PHP arrows only within a PHP island', () => {
        type('<script>a¦</script>', '-', '<script>a-¦</script>', { language: 'php' });
        type('<script>x = <?php $a¦ ?>;</script>', '-', '<script>x = <?php $a->¦ ?>;</script>', { language: 'php' });
        type('<script>a¦</script>', '#', '<script>a#¦</script>', { language: 'php' });
    });

    it('does not apply JavaScript rules to style content or self-closing script tags', () => {
        type('<style>a { #x¦', '(', '<style>a { #x(¦', { language: 'php' });
        type('<script src="a.js" /><a href=¦>', '"', '<script src="a.js" /><a href="¦">', { language: 'php' });
    });

    it('removes an empty script pair after undo and redo', () => {
        const model = new DocumentModel('<script>call</script>');
        model.setSelections([{ anchor: 12, head: 12 }]);
        model.typeText('(', { language: 'php' });
        expect(model.getText()).toBe('<script>call()</script>');
        model.undo();
        model.redo();
        model.execute('smartBackspace', { language: 'php' });
        expect(model.getText()).toBe('<script>call</script>');
    });

    it('invalidates script context when openers and closers change and history restores them', () => {
        const model = new DocumentModel('<div>\ncall\n</div>');
        model.applyEdits([
            { from: 0, to: 5, text: '<script>' },
            { from: 11, to: 17, text: '</script>' }
        ]);
        const at = model.getLine(1).end;
        model.setSelections([{ anchor: at, head: at }]);
        model.typeText('(', { language: 'php' });
        expect(model.getLine(1).text).toBe('call()');
        model.undo();
        model.undo();
        const oldAt = model.getLine(1).end;
        model.setSelections([{ anchor: oldAt, head: oldAt }]);
        model.typeText('(', { language: 'php' });
        expect(model.getLine(1).text).toBe('call(');
    });
});

it('restores script context when a closing tag is removed, undone and redone', () => {
    const model = new DocumentModel('<script>\ncall();\n</script>\naction');
    const closing = model.getLine(2);
    model.applyEdits([{ from: closing.start, to: closing.end, text: '' }]);
    let at = model.getLine(3).end;
    model.setSelections([{ anchor: at, head: at }]);
    model.typeText('(', { language: 'php' });
    expect(model.getLine(3).text).toBe('action()');
    model.undo();
    model.undo();
    model.redo();
    at = model.getLine(3).end;
    model.setSelections([{ anchor: at, head: at }]);
    model.typeText('(', { language: 'php' });
    expect(model.getLine(3).text).toBe('action()');
});
