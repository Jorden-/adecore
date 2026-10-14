import { useEffect, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { isApplePlatform, TextArea } from '@adecore/ui';
import { CODE_TEXT } from '../code-text.ts';
import { applyEdit, indentEdit, newlineEdit, outdentEdit, type TextEdit } from './editing.ts';
import type { QueryConsoleEditorProps } from './editor-slot.ts';
import { runScopeOf } from './shortcuts.ts';

/*
 * Where the SQL is typed when the app brings no editor of its own: a plain text area that fills the
 * height it gets, with the same props an editor of the app receives.
 */
export function SqlEditor({ ref, value, onValueChange, run, label, placeholder, autoFocus }: QueryConsoleEditorProps) {
    const area = useRef<HTMLTextAreaElement>(null);
    const pendingSelection = useRef<{ area: HTMLTextAreaElement; start: number; end: number } | null>(null);

    useImperativeHandle(ref, () => ({ selection: () => ({ start: area.current?.selectionStart ?? 0, end: area.current?.selectionEnd ?? 0 }) }), []);

    useEffect(() => {
        if (autoFocus) {
            area.current?.focus();
        }
        // Only on mount: a console that later becomes active keeps the focus where the person put it.
        // eslint-disable-next-line react/exhaustive-deps
    }, []);

    useEffect(() => {
        const pending = pendingSelection.current;
        if (pending !== null) {
            pendingSelection.current = null;
            pending.area.setSelectionRange(pending.start, pending.end);
        }
    }, [value]);

    // Through the browser's own insert, so Cmd+Z undoes the edit; the fallback sets the value itself.
    const apply = (target: HTMLTextAreaElement, edit: TextEdit): void => {
        const before = target.value;
        target.setSelectionRange(edit.from, edit.to);
        const inserted = document.execCommand('insertText', false, edit.insert);
        if (inserted && target.value === applyEdit(before, edit)) {
            target.setSelectionRange(edit.selectionStart, edit.selectionEnd);
            return;
        }
        pendingSelection.current = { area: target, start: edit.selectionStart, end: edit.selectionEnd };
        onValueChange(applyEdit(before, edit));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        const scope = runScopeOf(event, isApplePlatform());
        if (scope !== null) {
            event.preventDefault();
            run(scope);
            return;
        }
        if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        const target = event.currentTarget;
        const { selectionStart, selectionEnd } = target;
        if (event.key === 'Tab') {
            event.preventDefault();
            const edit = event.shiftKey ? outdentEdit(target.value, selectionStart, selectionEnd) : indentEdit(target.value, selectionStart, selectionEnd);
            if (edit !== null) {
                apply(target, edit);
            }
        } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            apply(target, newlineEdit(target.value, selectionStart, selectionEnd));
        }
    };

    return (
        <TextArea
            ref={area}
            aria-label={label}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={value}
            className={clsx(CODE_TEXT, 'flex-1')}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
        />
    );
}
