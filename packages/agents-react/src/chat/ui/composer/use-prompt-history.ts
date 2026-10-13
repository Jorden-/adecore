import { useMemo, useState } from 'react';
import { useChatRow } from '../../../state/chats';

// How many sent prompts the arrow keys walk back through, per chat.
const PROMPT_HISTORY = 50;

export interface PromptHistory {
    /* Whether a prompt was recalled and the box still holds it unedited. */
    recalled(text: string): boolean;
    /* Walks one prompt back (-1) or forward (1); false when there is nothing to walk through. */
    recall(direction: -1 | 1): boolean;
    /* Leaves a recalled prompt in the box as a draft of its own. */
    forget(): void;
    /* Leaves the walk and empties the box; false when no prompt was recalled. */
    leave(): boolean;
    /* Forgets the walk once the text no longer is the recalled prompt. */
    edited(text: string): void;
}

/* The prompts sent in this chat, for the arrow keys to put back in an empty box. */
export function usePromptHistory(chatId: string, setText: (next: string, mentions?: string[], skills?: string[]) => void): PromptHistory {
    const order = useChatRow(chatId, (row) => row?.order);
    const items = useChatRow(chatId, (row) => row?.structure);
    const [index, setIndex] = useState<number | null>(null);

    const history = useMemo(() => {
        const prompts: Array<{ text: string; mentions: string[] }> = [];
        for (const id of order ?? []) {
            const item = items?.[id];
            if (item?.kind === 'user') {
                prompts.push({ text: item.text, mentions: item.mentions ?? [] });
            }
        }
        // Walking back further than this is faster with the timeline than with the arrow key.
        return prompts.slice(-PROMPT_HISTORY);
    }, [order, items]);

    const recall = (direction: -1 | 1): boolean => {
        if (history.length === 0) {
            return false;
        }
        const next = index === null ? (direction === -1 ? history.length - 1 : null) : index + direction;
        if (next === null || next >= history.length) {
            setIndex(null);
            setText('', [], []);
            return true;
        }
        if (next < 0) {
            return true;
        }
        setIndex(next);
        setText(history[next]!.text, history[next]!.mentions);
        return true;
    };

    const leave = (): boolean => {
        if (index === null) {
            return false;
        }
        setIndex(null);
        setText('', [], []);
        return true;
    };

    return {
        recalled: (text) => index !== null && text === history[index]?.text,
        recall,
        forget: () => setIndex(null),
        leave,
        edited: (text) => {
            if (index !== null && text !== history[index]?.text) {
                setIndex(null);
            }
        }
    };
}
