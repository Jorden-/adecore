/* How long a person must stop typing before a waiting prompt card takes the composer's place. */
export const PROMPT_HOLD_PAUSE_MS = 2000;

export interface HoldInput {
    /* When the last change to the draft was made; null when none was since the hold last lifted. */
    typedAt: number | null;
    /* An IME composition is under way, which can run for any length without a change. */
    composing: boolean;
}

export type HoldRelease = 'pause' | 'send' | 'blur' | 'show';

/* A card waits while the person is composing, or typed less than the pause ago. */
export function holdsPrompt(input: HoldInput, now: number): boolean {
    if (input.composing) {
        return true;
    }
    return input.typedAt !== null && now - input.typedAt < PROMPT_HOLD_PAUSE_MS;
}

/* The milliseconds until the hold lifts by itself; null when it holds until something else lifts it, or does not hold. */
export function holdLiftsIn(input: HoldInput, now: number): number | null {
    if (input.composing || input.typedAt === null) {
        return null;
    }
    return Math.max(0, input.typedAt + PROMPT_HOLD_PAUSE_MS - now);
}
