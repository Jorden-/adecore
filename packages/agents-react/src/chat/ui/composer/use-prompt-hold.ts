import { useEffect, useRef, useState } from 'react';
import { holdLiftsIn, type HoldRelease } from '../../prompt-hold';
import type { PromptHold } from '../PromptComposer';

export type ComposerPromptHold = PromptHold & { noteInput(): void; setComposing(composing: boolean): void };

/*
 * Keeps a waiting prompt card behind the draft while the person types. Typing, pasting and dictating
 * all change the draft, so `noteInput` is called from its change handler; the hold lifts after a pause.
 */
export function usePromptHold(): ComposerPromptHold {
    const typedAt = useRef<number | null>(null);
    const composing = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [state, setState] = useState<{ held: boolean; releasedBy: HoldRelease | null }>({ held: false, releasedBy: null });

    const clearTimer = (): void => {
        if (timer.current !== null) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    };

    const release = (reason: HoldRelease): void => {
        clearTimer();
        typedAt.current = null;
        composing.current = false;
        setState((current) => (current.held ? { held: false, releasedBy: reason } : current));
    };

    const schedule = (): void => {
        clearTimer();
        const wait = holdLiftsIn({ typedAt: typedAt.current, composing: composing.current }, Date.now());
        if (wait !== null) {
            timer.current = setTimeout(() => release('pause'), wait);
        }
    };

    const noteInput = (): void => {
        typedAt.current = Date.now();
        setState({ held: true, releasedBy: null });
        schedule();
    };

    const setComposing = (next: boolean): void => {
        composing.current = next;
        if (next) {
            setState({ held: true, releasedBy: null });
        } else {
            typedAt.current = Date.now();
        }
        schedule();
    };

    useEffect(() => clearTimer, []);

    return { held: state.held, releasedBy: state.releasedBy, release, noteInput, setComposing };
}
