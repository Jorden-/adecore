/* One value that an effect sets and a render reads through `useSyncExternalStore`, without a state update inside the effect. */
export function createHolder<T>(): { get(): T | null; set(value: T | null): void; subscribe(listener: () => void): () => void } {
    let value: T | null = null;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: (next) => {
            value = next;
            for (const listener of [...listeners]) {
                listener();
            }
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}
