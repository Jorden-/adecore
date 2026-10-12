import type { CompletionItem, CompletionList, Range } from './protocol.ts';

function validRange(range: Range, singleLine = true): boolean {
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
        (!singleLine || start.line === end.line) &&
        (start.line < end.line || (start.line === end.line && start.character <= end.character))
    );
}

function validEditRange(range: Range | { insert: Range; replace: Range }, singleLine = true): boolean {
    if (range === null || typeof range !== 'object' || Array.isArray(range)) {
        return false;
    }
    if ('start' in range) {
        return validRange(range, singleLine);
    }
    return (
        validRange(range.insert) &&
        validRange(range.replace) &&
        range.insert.start.line === range.replace.start.line &&
        range.insert.start.character === range.replace.start.character &&
        range.insert.end.character <= range.replace.end.character
    );
}

export function applyCompletionDefaults(
    item: CompletionItem,
    defaults?: CompletionList['itemDefaults'],
    options?: { onInvalidRange?: (error: RangeError) => void }
): CompletionItem {
    if (typeof item?.label !== 'string') {
        throw new TypeError('A completion item must have a string label.');
    }
    for (const value of [item.filterText, item.sortText, item.insertText, item.textEditText]) {
        if (value !== undefined && typeof value !== 'string') {
            throw new TypeError('Completion ranking and insertion text must be strings.');
        }
    }
    if (item.textEdit !== undefined) {
        const edit = item.textEdit;
        if (
            edit === null ||
            typeof edit !== 'object' ||
            typeof edit.newText !== 'string' ||
            !('range' in edit ? validEditRange(edit.range, false) : validEditRange(edit))
        ) {
            throw new RangeError('Invalid completion item edit.');
        }
    }
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
        if (typeof newText !== 'string') {
            throw new TypeError('Completion edit text must be a string.');
        }
        const invalid = (message: string): CompletionItem => {
            const error = new RangeError(message);
            if (options?.onInvalidRange === undefined) {
                throw error;
            }
            options.onInvalidRange(error);
            return next;
        };
        if (!validEditRange(range)) {
            return invalid('Invalid completion default edit range.');
        }
        next.textEdit = 'start' in range ? { range, newText } : { insert: range.insert, replace: range.replace, newText };
    }
    return next;
}
