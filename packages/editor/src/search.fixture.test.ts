import { serveEditorSearch, type EditorSearchInput, type EditorSearchOutput } from './search-worker.ts';
import type { Editor, EditorFindQuery, EditorFindState } from './types.ts';

export function searchWorker() {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    let receive: ((event: MessageEvent<EditorSearchInput>) => void) | undefined;
    let stopped = false;
    const dispose = serveEditorSearch({
        addEventListener(_type, listener) {
            receive = listener;
        },
        removeEventListener() {
            receive = undefined;
        },
        postMessage(data: EditorSearchOutput) {
            queueMicrotask(() => {
                if (stopped) {
                    return;
                }
                for (const listener of listeners.get('message') ?? []) {
                    const event = { data } as MessageEvent;
                    if (typeof listener === 'function') {
                        listener(event);
                    } else {
                        listener.handleEvent(event);
                    }
                }
            });
        }
    });
    return {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
            if (listener !== null) {
                const group = listeners.get(type) ?? new Set();
                group.add(listener);
                listeners.set(type, group);
            }
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
            if (listener !== null) {
                listeners.get(type)?.delete(listener);
            }
        },
        postMessage(data: EditorSearchInput) {
            queueMicrotask(() => {
                if (!stopped) {
                    receive?.({ data } as MessageEvent<EditorSearchInput>);
                }
            });
        },
        terminate() {
            stopped = true;
            dispose();
            listeners.clear();
        }
    };
}

export function findAsync(editor: Editor, query: EditorFindQuery): Promise<EditorFindState> {
    return new Promise((resolve) => {
        const off = editor.onFind((state) => {
            if (!state.searching) {
                off();
                resolve(state);
            }
        });
        editor.find(query);
    });
}

export function findEvent(editor: Editor, ready: (state: EditorFindState) => boolean): Promise<EditorFindState> {
    return new Promise((resolve) => {
        const off = editor.onFind((state) => {
            queueMicrotask(() => {
                if (ready(state)) {
                    off();
                    resolve(state);
                }
            });
        });
    });
}
