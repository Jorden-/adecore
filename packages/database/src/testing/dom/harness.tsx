import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { UIProvider, isApplePlatform } from '@adecore/ui';
import type { DatabaseAction, DatabaseFiles, DatabaseNotice } from '../../actions.ts';
import { DatabaseProvider } from '../../DatabaseProvider.tsx';
import { createDatabaseClient } from '../../client/index.ts';
import type { DatabaseClient, DatabaseTransport } from '../../client/types.ts';
import type { DatabaseMethod, DatabaseParams, DatabaseRequest, DatabaseResponse, DatabaseResult, StatementResult } from '../../protocol/index.ts';
import type { DatabaseStorage } from '../../actions.ts';

/* A transport that remembers what it was asked and lets a test answer a method itself, which the fake database cannot for `execute`. */
export interface RecordedTransport {
    readonly transport: DatabaseTransport;
    readonly requests: DatabaseRequest[];
    /* The requests of one method, in order. */
    of<M extends DatabaseMethod>(method: M): DatabaseRequest<M>[];
    /* The SQL of every `execute`, in order. */
    executed(): string[];
    /* Answers a method from now on instead of the inner transport; `null` goes back to it. */
    respond<M extends DatabaseMethod>(method: M, answer: ((params: DatabaseParams<M>) => DatabaseResult<M>) | null): void;
    /* Answers every `execute` with these results; by default the inner transport, which only reads. */
    onExecute(answer: ((sql: string) => readonly StatementResult[]) | null): void;
}

export const recordTransport = (inner: DatabaseTransport): RecordedTransport => {
    const requests: DatabaseRequest[] = [];
    const answers = new Map<DatabaseMethod, (params: never) => unknown>();

    const transport: DatabaseTransport = async (request): Promise<DatabaseResponse> => {
        requests.push(request);
        const answer = answers.get(request.method);
        if (answer !== undefined) {
            return { id: request.id, ok: true, result: answer(request.params as never) } as DatabaseResponse;
        }
        return inner(request);
    };

    const respond: RecordedTransport['respond'] = (method, answer) => {
        if (answer === null) {
            answers.delete(method);
        } else {
            answers.set(method, answer as (params: never) => unknown);
        }
    };

    return {
        transport,
        requests,
        of: <M extends DatabaseMethod>(method: M) => requests.filter((request) => request.method === method) as DatabaseRequest<M>[],
        executed: () => requests.flatMap((request) => (request.method === 'execute' ? [request.params.sql] : [])),
        respond,
        onExecute: (answer) => respond('execute', answer === null ? null : ({ sql }) => ({ results: [...answer(sql)], inTransaction: false }))
    };
};

export const done = (sql: string, affected = 1): StatementResult => ({ kind: 'done', sql, affected, lastInsertId: null, elapsedMs: 0 });

export interface MountOptions {
    /* Without it the view is mounted with no `DatabaseProvider`, as a grid of an app's own rows is. */
    readonly client?: DatabaseClient;
    readonly actions?: DatabaseAction[];
    /* Collects what the views hand the app as notices; without it they show their own. */
    readonly notices?: DatabaseNotice[];
    readonly storage?: DatabaseStorage;
    readonly files?: DatabaseFiles;
}

export interface Mounted {
    readonly container: HTMLElement;
    unmount(): Promise<void>;
    rerender(node: ReactNode): Promise<void>;
}

/* An i18next with no words of its own: `UIProvider` and `DatabaseProvider` add theirs. */
export const createI18n = async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
    return i18n;
};

export const clientOver = (transport: DatabaseTransport): DatabaseClient => createDatabaseClient(transport);

/* A memory-backed storage, like `localStorage` without the globals. */
export const memoryStorage = (): DatabaseStorage & { readonly entries: Map<string, string> } => {
    const entries = new Map<string, string>();
    return {
        entries,
        get: (key) => entries.get(key) ?? null,
        set: (key, value) => {
            if (value === null) {
                entries.delete(key);
            } else {
                entries.set(key, value);
            }
        }
    };
};

/* Mounts a view the way an app does: inside `UIProvider` and `DatabaseProvider`, in a document that is part of the page so focus and portals behave. */
export const mount = async (node: ReactNode, { client, actions, notices, storage, files }: MountOptions = {}): Promise<Mounted> => {
    const i18n = await createI18n();
    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    const wrap = (inner: ReactNode): ReactNode => (
        <UIProvider i18n={i18n}>
            {client === undefined ? (
                inner
            ) : (
                <DatabaseProvider
                    client={client}
                    storage={storage}
                    files={files}
                    onAction={actions === undefined ? undefined : (action) => actions.push(action)}
                    onNotice={notices === undefined ? undefined : (notice) => notices.push(notice)}
                >
                    {inner}
                </DatabaseProvider>
            )}
        </UIProvider>
    );
    await act(async () => {
        root.render(wrap(node));
        await flush();
    });
    return {
        container,
        unmount: async () => {
            await perform(() => root.unmount());
            container.remove();
        },
        rerender: async (next) => {
            await perform(() => root.render(wrap(next)));
        }
    };
};

/* Lets pending promises and timers of zero delay finish, with their renders. */
export const settle = async (): Promise<void> => {
    await act(flush);
};

/* Several turns of the event loop, since an answer from the transport takes a few promises and a timer before it lands in state. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
};

/* Runs a change and waits for what it sets off, all inside one act. */
export const perform = (change: () => void): Promise<void> =>
    act(async () => {
        change();
        await flush();
    });

/* Waits until the check passes, or fails with the last error. */
export const waitFor = async <T,>(check: () => T, timeoutMs = 2000): Promise<T> => {
    const started = Date.now();
    for (;;) {
        try {
            return check();
        } catch (error) {
            if (Date.now() - started > timeoutMs) {
                throw error;
            }
            await settle();
        }
    }
};

const everywhere = (): HTMLElement => document.body;

/* The only element that matches, or a failure that says what was there. */
export const find = (selector: string, within: ParentNode = everywhere()): HTMLElement => {
    const found = [...within.querySelectorAll<HTMLElement>(selector)];
    if (found.length !== 1) {
        throw new Error(`Expected one element for "${selector}" and found ${found.length}.`);
    }
    return found[0]!;
};

export const findAll = (selector: string, within: ParentNode = everywhere()): HTMLElement[] => [...within.querySelectorAll<HTMLElement>(selector)];

const textOf = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/* The only element of a kind whose own text matches. */
export const byText = (selector: string, text: string | RegExp, within: ParentNode = everywhere()): HTMLElement => {
    const matches = (element: Element): boolean => (typeof text === 'string' ? textOf(element) === text : text.test(textOf(element)));
    const found = findAll(selector, within).filter(matches);
    if (found.length !== 1) {
        throw new Error(`Expected one "${selector}" with text ${String(text)} and found ${found.length}: ${findAll(selector, within).map(textOf).join(' | ')}`);
    }
    return found[0]!;
};

export const byLabel = (label: string, within: ParentNode = everywhere()): HTMLElement => find(`[aria-label="${label}"]`, within);

export const focus = (element: HTMLElement): Promise<void> =>
    perform(() => {
        element.focus();
    });

export const click = (element: Element): Promise<void> =>
    perform(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

export const doubleClick = (element: Element): Promise<void> =>
    perform(() => {
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

export const contextMenu = (element: Element): Promise<void> =>
    perform(() => {
        element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }));
    });

/* Puts the caret, or a selection, in a text field. */
export const select = (field: HTMLTextAreaElement | HTMLInputElement, start: number, end = start): Promise<void> =>
    perform(() => {
        field.focus();
        field.setSelectionRange(start, end);
    });

/* The modifier `Mod+` means on the platform the tests run on. */
export const MOD: KeyboardEventInit = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

export const press = (element: Element, key: string, init: KeyboardEventInit = {}): Promise<void> =>
    perform(() => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });

/* Sets the value of a text field the way typing does, so React sees an input event. */
export const type = (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    return perform(() => {
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
