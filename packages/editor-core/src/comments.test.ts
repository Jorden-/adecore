import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions, EditorCommand } from './types.ts';

/* `¦` marks a caret, `[` and `]` a selection. */
function parse(source: string): { text: string; selections: { anchor: number; head: number }[] } {
    const open = source.indexOf('[');
    const close = source.indexOf(']');
    if (open >= 0 && close >= 0) {
        const text = source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1);
        return { text, selections: [{ anchor: open, head: close - 1 }] };
    }
    const caret = source.indexOf('¦');
    return { text: source.replace('¦', ''), selections: [{ anchor: caret, head: caret }] };
}

function render(model: DocumentModel): string {
    const [selection] = model.getSelections();
    const text = model.getText();
    if (selection!.anchor === selection!.head) {
        return text.slice(0, selection!.head) + '¦' + text.slice(selection!.head);
    }
    const from = Math.min(selection!.anchor, selection!.head);
    const to = Math.max(selection!.anchor, selection!.head);
    return `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`;
}

function run(command: EditorCommand, source: string, expected: string, options: CommandOptions = {}): void {
    const initial = parse(source);
    const model = new DocumentModel(initial.text);
    model.setSelections(initial.selections);
    model.execute(command, { language: 'typescript', ...options });
    expect(render(model)).toBe(expected);
}

const line = (source: string, expected: string, options: CommandOptions = {}): void => run('toggleLineComment', source, expected, options);
const block = (source: string, expected: string, options: CommandOptions = {}): void => run('toggleBlockComment', source, expected, options);

describe('line comments', () => {
    it('comments a line and moves the caret down one', () => {
        line('foo¦\nbar', '// foo\nbar¦');
        line('fo¦o\nbar', '// foo\nbar¦');
    });

    it('takes the comment off again and keeps the caret in step', () => {
        line('// foo¦\nbar', 'foo\nbar¦');
        line('//foo¦\nbar', 'foo\nbar¦');
    });

    it('puts the markers at the smallest indentation', () => {
        line('[    a\n  b\n      c]', '[  //   a\n  // b\n  //     c]');
        line('[\ta\n\t\tb]', '[\t// a\n\t// \tb]');
    });

    it('comments blank lines of a selection with a bare marker and decides by the others', () => {
        line('[a\n\nb]', '[// a\n//\n// b]');
        line('[// a\n//\n// b]', '[a\n\nb]');
        line('[// a\n\n// b]', '[a\n\nb]');
        line('[// a\nb]', '[// // a\n// b]');
    });

    it('aligns with a comment on the line above', () => {
        line('    // x\n        foo¦', '    // x\n    //     foo¦');
    });

    it('starts a comment on an empty line and puts the caret after it', () => {
        line('foo {\n¦\n}', 'foo {\n// ¦\n}');
        line('foo {\n    ¦\n}', 'foo {\n//     ¦\n}');
    });

    it('keeps a selection of whole lines whole', () => {
        line('[one\ntwo\n]three', '[// one\n// two\n]three');
        line('o[ne\ntw]o', '// o[ne\n// tw]o');
    });

    it('keeps the direction of a selection', () => {
        const model = new DocumentModel('  one\n\ttwo');
        model.setSelections([{ anchor: 10, head: 0 }]);
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('  // one\n\t// two');
        expect(model.getSelections()[0]!.anchor).toBeGreaterThan(model.getSelections()[0]!.head);
    });

    it('moves every caret that is alone on its lines', () => {
        const model = new DocumentModel('a\nb\nc\nd');
        model.setSelections([
            { anchor: 0, head: 0 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('// a\nb\n// c\nd');
        expect(model.getSelections().map((selection) => selection.head)).toEqual([6, 13]);
    });

    it('leaves the last line where it is', () => {
        line('a\nb¦', 'a\n// b¦');
    });

    it('comments with the marker of the language', () => {
        line('x = 1¦\ny', '# x = 1\ny¦', { language: 'python' });
        line('select 1¦\ny', '-- select 1\ny¦', { language: 'sql' });
        line('key: 1¦\ny', '# key: 1\ny¦', { language: 'yaml' });
        line('echo¦\ny', '# echo\ny¦', { language: 'shellscript' });
        line('{ "a": 1¦ }\ny', '// { "a": 1 }\ny¦', { language: 'jsonc' });
        line('$a = 1;¦\ny', '// $a = 1;\ny¦', { language: 'php' });
    });

    it('has no marker in plain text', () => {
        const model = new DocumentModel('text');
        expect(model.execute('toggleLineComment', { language: 'plaintext' })).toBe(false);
        expect(model.getText()).toBe('text');
    });

    it('wraps each line where the language has only block comments', () => {
        line('a { color: red; }¦\nb', '/* a { color: red; } */\nb¦', { language: 'css' });
        line('/* a { color: red; } */¦\nb', 'a { color: red; }\nb¦', { language: 'css' });
        line('[a\n\nb]', '[/* a */\n\n/* b */]', { language: 'css' });
        line('<div>¦\nb', '<!-- <div> -->\nb¦', { language: 'html' });
        line('  <div>¦\nx', '  <!-- <div> -->\nx¦', { language: 'html' });
        line('# title¦\nb', '<!-- # title -->\nb¦', { language: 'markdown' });
    });

    it('picks the markers of a Vue region by the line', () => {
        const file = '<template>\n  <div />\n</template>\n<script setup>\nfoo()\n</script>\n<style>\na {}\n</style>';
        const at = (text: string): string => file.replace(text, `${text}¦`);
        line(at('<div />'), file.replace('<div />', '<!-- <div /> -->').replace('</template>', '</template>¦'), { language: 'vue' });
        line(at('foo()'), file.replace('foo()', '// foo()').replace('</script>', '</script¦>'), { language: 'vue' });
        line(at('a {}'), file.replace('a {}', '/* a {} */').replace('</style>', '</style>¦'), { language: 'vue' });
    });
});

describe('block comments', () => {
    it('wraps a selection and takes the markers off again', () => {
        block('foo [bar] baz', 'foo [/* bar */] baz');
        block('foo [/* bar */] baz', 'foo [bar] baz');
        block('foo /* bar ¦*/ baz', 'foo bar¦ baz');
    });

    it('opens an empty comment at the caret', () => {
        block('foo¦', 'foo/* ¦ */');
    });

    it('puts a selection of whole lines between lines of their own', () => {
        block('[a\n  b\n]c', '[/*\na\n  b\n*/\n]c');
        block('[  a\n  b\n]c', '[  /*\n  a\n  b\n  */\n]c');
    });

    it('uses the markers of the language and skips what has none', () => {
        block('[<div>]\nx', '[<!-- <div> -->]\nx', { language: 'html' });
        block('[<!-- x -->]\ny', '[x]\ny', { language: 'html' });
        block('[a { }]\ny', '[/* a { } */]\ny', { language: 'css' });
        block('[x]\ny', '[x]\ny', { language: 'python' });
    });

    it('refuses a selection that holds a closing marker or cuts through a comment', () => {
        block('[a /* b */ c]\nx', '[a /* b */ c]\nx');
        block('/* a [b] c */\nx', '/* a [b] c */\nx');
    });

    it('uses the markers of the region in a Vue file', () => {
        block('<script>\n[foo()]\n</script>', '<script>\n[/* foo() */]\n</script>', { language: 'vue' });
        block('<template>\n[<div/>]\n</template>', '<template>\n[<!-- <div/> -->]\n</template>', { language: 'vue' });
    });
});

describe('comments in embedded markup', () => {
    function commented(source: string, language: string, command: EditorCommand = 'toggleLineComment'): DocumentModel {
        const at = source.indexOf('¦');
        const model = new DocumentModel(source.replace('¦', ''));
        model.setSelections([{ anchor: at, head: at }]);
        model.execute(command, { language });
        return model;
    }

    for (const language of ['tsx', 'typescriptreact', 'jsx', 'javascriptreact']) {
        it(`wraps JSX children and toggles them back in ${language}`, () => {
            for (const text of ['<span>text</span>', 'ordinary JSX text']) {
                const source = `const view = (\n    <div>\n        ¦${text}\n    </div>\n);`;
                const model = commented(source, language);
                expect(model.getText()).toBe(source.replace('¦' + text, `{/* ${text} */}`));
                const at = model.getLine(2).start;
                model.setSelections([{ anchor: at, head: at }]);
                model.execute('toggleLineComment', { language });
                expect(model.getText()).toBe(source.replace('¦', ''));
            }
        });
    }

    it('keeps attribute lines and expression bodies in JavaScript comment syntax', () => {
        const attribute = 'const view = <div\n    ¦className="box"\n>text</div>;';
        expect(commented(attribute, 'tsx').getText()).toBe(attribute.replace('¦', '// '));
        const expression = 'const view = <div>{\n    ¦items.map(item => item.name)\n}</div>;';
        expect(commented(expression, 'tsx').getText()).toBe(expression.replace('¦', '// '));
        const ordinary = 'const ¦value = 1;';
        expect(commented(ordinary, 'typescript').getText()).toBe('// const value = 1;');
    });

    it('keeps an element inside an expression in JavaScript comment syntax', () => {
        const source = 'const view = <div>{items.map(item => (\n    <span>\n        ¦{item.name}\n    </span>\n))}</div>;';
        const element = source.replace('¦{item.name}', '{item.name}').replace('<span>', '¦<span>');
        expect(commented(element, 'tsx').getText()).toBe(element.replace('¦', '// '));
    });

    it('uses JSX block comments for child text and JavaScript blocks within an expression', () => {
        const source = 'const view = <div><span>¦text</span></div>;';
        expect(commented(source, 'tsx', 'toggleBlockComment').getText()).toBe(source.replace('¦', '{/*  */}'));
        const expression = 'const view = <div>{¦value}</div>;';
        expect(commented(expression, 'tsx', 'toggleBlockComment').getText()).toBe(expression.replace('¦', '/*  */'));
    });

    it('wraps and unwraps a selected JSX text range', () => {
        block('const view = <div>[text]</div>;', 'const view = <div>[{/* text */}]</div>;', { language: 'tsx' });
        block('const view = <div>[{/* text */}]</div>;', 'const view = <div>[text]</div>;', { language: 'tsx' });
        block('const view = <div>{/* te¦xt */}</div>;', 'const view = <div>te¦xt</div>;', { language: 'tsx' });
    });

    it('uses HTML comments for PHP markup and code comments within PHP tags', () => {
        const markup = '<div>\n    ¦<p>text</p>\n</div>\n<?php echo 1; ?>';
        expect(commented(markup, 'php').getText()).toBe(markup.replace('¦<p>text</p>', '<!-- <p>text</p> -->'));
        const code = '<div>\n<?php\n¦$value = 1;\n?>\n</div>';
        expect(commented(code, 'php').getText()).toBe(code.replace('¦', '// '));
        const phpFirst = '<?php\n¦$value = 1;';
        expect(commented(phpFirst, 'php').getText()).toBe(phpFirst.replace('¦', '// '));
    });

    it('recognizes script and style content in PHP markup', () => {
        const script = '<script>\n¦const value = 1;\n</script>';
        expect(commented(script, 'php').getText()).toBe(script.replace('¦', '// '));
        const rawScript = '<script>\nconst text = "<style>";\n¦const value = 1;\n</script>';
        expect(commented(rawScript, 'php').getText()).toBe(rawScript.replace('¦', '// '));
        const style = '<style>\n¦.box { color: red; }\n</style>';
        expect(commented(style, 'php').getText()).toBe(style.replace('¦.box { color: red; }', '/* .box { color: red; } */'));
    });

    it('does not treat tags inside PHP strings or HTML attributes and comments as embedded sections', () => {
        for (const prefix of ['<div title="<script>">', '<!-- <script> -->', '<?php\n$value = "<script>";\n?>']) {
            const source = prefix + '\n¦<p>text</p>';
            expect(commented(source, 'php').getText()).toBe(source.replace('¦<p>text</p>', '<!-- <p>text</p> -->'));
        }
        const heredoc = '<?php\n$value = <<<HTML\n¦<script>\nHTML;';
        expect(commented(heredoc, 'php').getText()).toBe(heredoc.replace('¦', '// '));
    });

    it('leaves mixed PHP and HTML lines unchanged', () => {
        for (const source of ['¦<?php if ($value): ?>', '<p>¦<?= $value ?></p>', '<?php\n¦echo $value; ?> <p>text</p>']) {
            const model = commented(source, 'php');
            expect(model.getText()).toBe(source.replace('¦', ''));
            expect(model.getSnapshot().canUndo).toBe(false);
        }
    });

    it('leaves markup beyond the scan budget unchanged', () => {
        const source = '<p>text</p>\n' + 'x'.repeat(2_000_001);
        const model = new DocumentModel(source);
        expect(model.execute('toggleLineComment', { language: 'php' })).toBe(false);
        expect(model.getText()).toBe(source);
    });

    it('skips mixed PHP lines within a selection and comments its markup neighbors', () => {
        const source = '<p>one</p>\n<?php echo $value; ?>\n<p>two</p>';
        const model = new DocumentModel(source);
        model.setSelections([{ anchor: 0, head: source.length }]);
        expect(model.execute('toggleLineComment', { language: 'php' })).toBe(true);
        expect(model.getText()).toBe('<!-- <p>one</p> -->\n<?php echo $value; ?>\n<!-- <p>two</p> -->');
        model.setSelections([{ anchor: 0, head: model.getText().length }]);
        model.execute('toggleLineComment', { language: 'php' });
        expect(model.getText()).toBe(source);
    });
});

describe('JSX line comment context remains stable across toggles', () => {
    it('uses JSX comments for an expression container at the start of a child line', () => {
        const source = 'const view = <div>\n    {items.map(item => item.name)}\n</div>;';
        const model = new DocumentModel(source);
        const at = model.getLine(1).start + 4;
        model.setSelections([{ anchor: at, head: at }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe('const view = <div>\n    {/* {items.map(item => item.name)} */}\n</div>;');
        model.setSelections([{ anchor: at, head: at }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe(source);
    });
    it('toggles all lines of a nested multiline opening tag with the first line marker', () => {
        const source = 'const view = <div>\n    <Foo\n        bar="x"\n    />\n</div>;';
        const model = new DocumentModel(source);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(3).end }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe('const view = <div>\n    {/* <Foo */}\n    {/*     bar="x" */}\n    {/* /> */}\n</div>;');
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(3).end }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe(source);
    });
    it('preserves JavaScript markers across a complete return block', () => {
        const source = 'function view() {\n    return (\n        <div>\n            text\n        </div>\n    );\n}';
        const model = new DocumentModel(source);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(5).end }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        for (let line = 1; line <= 5; line++) {
            expect(model.getLine(line).text.trimStart().startsWith('//')).toBe(true);
        }
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(5).end }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe(source);
    });
    it('keeps a self-closing element within JavaScript parentheses in script syntax', () => {
        const source = 'const view = <div>{items.map(item => (\n    <li />\n))}</div>;';
        const model = new DocumentModel(source);
        const at = model.getLine(1).start;
        model.setSelections([{ anchor: at, head: at }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getLine(1).text).toBe('    // <li />');
    });
});

describe('JSX attribute comments retain child context', () => {
    it('toggles a child after commenting an attribute and restores both', () => {
        const source = 'const view = <div>\n    <Foo\n        bar="x"\n    />\n    text\n</div>;';
        const model = new DocumentModel(source);
        const toggle = (line: number) => {
            const at = model.getLine(line).start;
            model.setSelections([{ anchor: at, head: at }]);
            model.execute('toggleLineComment', { language: 'tsx' });
        };
        toggle(2);
        const attributeComment = model.getText();
        expect(model.getLine(2).text).toBe('        // bar="x"');
        toggle(4);
        expect(model.getLine(4).text).toBe('    {/* text */}');
        toggle(4);
        expect(model.getText()).toBe(attributeComment);
        toggle(2);
        expect(model.getText()).toBe(source);
    });
    it('recognizes children around block comments between attributes', () => {
        const source = 'const view = <div>\n    <Foo\n        /* bar="x" */\n    />\n    text\n</div>;';
        const model = new DocumentModel(source);
        const at = model.getLine(4).start;
        model.setSelections([{ anchor: at, head: at }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getLine(4).text).toBe('    {/* text */}');
        model.setSelections([{ anchor: at, head: at }]);
        model.execute('toggleLineComment', { language: 'tsx' });
        expect(model.getText()).toBe(source);
    });
});

describe('embedded selections keep their region boundaries', () => {
    it('leaves a PHP selection spanning markup and script or style unchanged', () => {
        for (const tag of ['script', 'style']) {
            const source = `<${tag}>\nrun();\n</${tag}>`;
            const model = new DocumentModel(source);
            model.setSelections([{ anchor: 0, head: source.length }]);
            expect(model.execute('toggleLineComment', { language: 'php' })).toBe(false);
            expect(model.getText()).toBe(source);
            expect(model.getSnapshot().canUndo).toBe(false);
        }
    });
    it('keeps a homogeneous PHP script-body selection reversible', () => {
        const source = '<script>\nrun();\nnext();\n</script>';
        const model = new DocumentModel(source);
        const select = () => model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(2).end }]);
        select();
        expect(model.execute('toggleLineComment', { language: 'php' })).toBe(true);
        expect(model.getText()).toBe('<script>\n// run();\n// next();\n</script>');
        select();
        model.execute('toggleLineComment', { language: 'php' });
        expect(model.getText()).toBe(source);
    });
    it('leaves a Vue selection spanning template and script unchanged', () => {
        const source = '<template>\n<div />\n</template>\n<script>\nrun();\n</script>';
        const model = new DocumentModel(source);
        model.setSelections([{ anchor: 0, head: source.length }]);
        expect(model.execute('toggleLineComment', { language: 'vue' })).toBe(false);
        expect(model.getText()).toBe(source);
    });
    it('retains Vue block delimiters while toggling their body', () => {
        const source = '<script>\nrun();\n</script>';
        const model = new DocumentModel(source);
        const select = () => model.setSelections([{ anchor: 0, head: model.getText().length }]);
        select();
        model.execute('toggleLineComment', { language: 'vue' });
        expect(model.getText()).toBe('<script>\n// run();\n</script>');
        select();
        model.execute('toggleLineComment', { language: 'vue' });
        expect(model.getText()).toBe(source);
    });
});
