import type { EditorSemanticToken } from '@adecore/editor';
import type { SemanticTokens, SemanticTokensLegend } from '@adecore/lsp';

/*
 * The TextMate scopes a classification stands for, so the theme colors it as its grammar would; null where
 * the grammar already did better (a keyword, a string, a local variable). Calls, methods, statics and
 * declarations get scopes of their own, as the color scheme tells them apart. `scoped` says the server
 * marks what is local to a function, so a variable it leaves unmarked is drawn as a global.
 */
export function scopesOf(type: string, modifiers: ReadonlySet<string>, scoped = false): string[] | null {
    switch (type) {
        case 'namespace':
            return ['entity.name.namespace'];
        case 'class':
            return ['entity.name.type.class'];
        case 'enum':
            return ['entity.name.type.enum'];
        case 'interface':
            return ['entity.name.type.interface'];
        case 'struct':
            return ['entity.name.type.struct'];
        case 'type':
            return ['entity.name.type'];
        case 'typeParameter':
            return ['entity.name.type.parameter'];
        case 'parameter':
            return ['variable.parameter'];
        case 'property':
            return [modifiers.has('static') ? 'variable.other.property.static' : 'variable.other.property'];
        case 'enumMember':
            return ['variable.other.enummember'];
        case 'function':
        case 'method':
            if (modifiers.has('static')) {
                return ['entity.name.function.static'];
            }
            if (modifiers.has('declaration')) {
                return ['entity.name.function'];
            }
            return [type === 'method' ? 'entity.name.function.method' : 'entity.name.function.call'];
        case 'decorator':
            return ['meta.decorator'];
        case 'macro':
            return ['entity.name.function.macro'];
        case 'variable':
            if (scoped) {
                return modifiers.has('local') ? null : ['variable.other.constant'];
            }
            return modifiers.has('readonly') ? ['variable.other.constant'] : null;
        default:
            return null;
    }
}

/*
 * What a server sends for the language it reads inside a string (SQL in a PHP string). Outside a string the grammar
 * colors these better, so they only apply where the grammar says it is a string.
 */
const EMBEDDED_SCOPES: Record<string, string[] | undefined> = {
    keyword: ['keyword'],
    string: ['string'],
    number: ['constant.numeric'],
    comment: ['comment'],
    operator: ['keyword.operator']
};

/* The encoded data of `textDocument/semanticTokens` as one token per classified range, the ones the theme has nothing to say about left out. */
export function decodeSemanticTokens(tokens: SemanticTokens, legend: SemanticTokensLegend): EditorSemanticToken[] {
    const result: EditorSemanticToken[] = [];
    const { data } = tokens;
    const scoped = legend.tokenModifiers.includes('local');
    let line = 0;
    let character = 0;
    for (let at = 0; at + 4 < data.length; at += 5) {
        const deltaLine = data[at]!;
        line += deltaLine;
        character = deltaLine === 0 ? character + data[at + 1]! : data[at + 1]!;
        const type = legend.tokenTypes[data[at + 3]!];
        if (type === undefined) {
            continue;
        }
        const bits = data[at + 4]!;
        const modifiers = new Set(legend.tokenModifiers.filter((_, index) => (bits & (1 << index)) !== 0));
        const scopes = scopesOf(type, modifiers, scoped);
        if (scopes !== null) {
            result.push({ line, character, length: data[at + 2]!, scopes });
            continue;
        }
        const embedded = EMBEDDED_SCOPES[type];
        if (embedded !== undefined) {
            result.push({ line, character, length: data[at + 2]!, scopes: embedded, within: 'string' });
        }
    }
    return result;
}
