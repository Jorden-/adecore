import type { CompletionItem, CompletionList, Range } from './protocol.ts';

function validRange(range: Range): boolean {
    if (range === null || typeof range !== 'object') {
        return false;
    }
    const { start, end } = range;
    return (
        start !== undefined &&
        start !== null &&
        typeof start === 'object' &&
        end !== undefined &&
        end !== null &&
        typeof end === 'object' &&
        [start.line, start.character, end.line, end.character].every((value) => Number.isSafeInteger(value) && value >= 0) &&
        (start.line < end.line || (start.line === end.line && start.character <= end.character))
    );
}

export function applyCompletionDefaults(item: CompletionItem, defaults?: CompletionList['itemDefaults']): CompletionItem {
    if (defaults === undefined) {
        return item;
    }
    const next = { ...item };
    if (next.commitCharacters === undefined && defaults.commitCharacters !== undefined) {
        next.commitCharacters = defaults.commitCharacters;
    }
    if (next.insertTextFormat === undefined && defaults.insertTextFormat !== undefined) {
        next.insertTextFormat = defaults.insertTextFormat;
    }
    if (next.insertTextMode === undefined && defaults.insertTextMode !== undefined) {
        next.insertTextMode = defaults.insertTextMode;
    }
    if (next.data === undefined && defaults.data !== undefined) {
        next.data = defaults.data;
    }
    if (next.textEdit === undefined && defaults.editRange !== undefined) {
        const range = defaults.editRange;
        const newText = item.textEditText ?? item.label;
        if (range === null || typeof range !== 'object' || Array.isArray(range)) {
            throw new RangeError('Invalid completion default edit range.');
        }
        if ('start' in range) {
            if (!validRange(range)) {
                throw new RangeError('Invalid completion default edit range.');
            }
            next.textEdit = { range, newText };
        } else {
            if (!validRange(range.insert) || !validRange(range.replace)) {
                throw new RangeError('Invalid completion default insert/replace ranges.');
            }
            next.textEdit = { insert: range.insert, replace: range.replace, newText };
        }
    }
    return next;
}
