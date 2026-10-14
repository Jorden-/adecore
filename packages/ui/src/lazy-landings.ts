let landings = 0;
const listeners = new Set<() => void>();

/* Called once per module, when a `LoadedComponent` first has it. */
export function noteLanding(): void {
    landings += 1;
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeLandings(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function readLandings(): number {
    return landings;
}
