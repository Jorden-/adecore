import type { ConnectionConfig, DatabaseMethod, DatabaseParams, DatabaseRequest, DatabaseResult, ServerInfo } from '../protocol/index.ts';
import {
    DatabaseRequestError,
    type Connection,
    type DatabaseClient,
    type DatabaseSession,
    type DatabaseTransport,
    type ExecuteOptions,
    type RequestOptions,
    type SchemaChange
} from './types.ts';

export interface DatabaseClientOptions {
    /* Makes the id of a request. `crypto.randomUUID()` when left out. */
    readonly createId?: () => string;
}

interface Opened {
    readonly session: string;
    readonly server: ServerInfo;
}

const cancelledError = (): DatabaseRequestError => new DatabaseRequestError('cancelled', 'The request was cancelled.');

const isUnknownSession = (error: unknown): boolean => error instanceof DatabaseRequestError && error.code === 'unknown-session';

const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;
const SCHEMA_STATEMENT = /^(?:create|alter|drop|rename|truncate)\b/i;

const changesSchema = (sql: string): boolean => SCHEMA_STATEMENT.test(sql.replace(LEADING_COMMENTS, ''));

/* Structural equality for the JSON a config is made of; a key set to `undefined` counts as absent. */
const isEqual = (left: unknown, right: unknown): boolean => {
    if (left === right) {
        return true;
    }

    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
        return false;
    }

    const leftKeys = Object.keys(left).filter((key) => (left as Record<string, unknown>)[key] !== undefined);
    const rightKeys = Object.keys(right).filter((key) => (right as Record<string, unknown>)[key] !== undefined);

    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key) => isEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
    );
};

/* Rejects with `cancelled` as soon as the signal aborts, without waiting for the promise. */
const raceAbort = <T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
    if (signal === undefined) {
        return promise;
    }

    if (signal.aborted) {
        promise.catch(() => {});
        return Promise.reject(cancelledError());
    }

    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(cancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
};

export const createDatabaseClient = (transport: DatabaseTransport, options: DatabaseClientOptions = {}): DatabaseClient => {
    const createId = options.createId ?? (() => crypto.randomUUID());
    const live = new Map<string, Map<string, ReturnType<typeof createSession>>>();
    // Every session that opened on the helper and has not closed, also one a newer session replaced on its channel.
    const held = new Set<ReturnType<typeof createSession>>();
    const schemaListeners = new Set<(change: SchemaChange) => void>();

    const channelsOf = (connectionId: string): Map<string, ReturnType<typeof createSession>> => {
        let channels = live.get(connectionId);

        if (channels === undefined) {
            channels = new Map();
            live.set(connectionId, channels);
        }

        return channels;
    };

    const notifySchemaChange = (change: SchemaChange): void => {
        for (const listener of [...schemaListeners]) {
            try {
                listener(change);
            } catch (error) {
                // One failing listener must neither hide the result of the statement nor keep the others from hearing it.
                console.error('A schema change listener failed.', error);
            }
        }
    };

    /* With `settles`, an abort sends the cancel and waits for the answer, which can still carry what ran. */
    const send = async <M extends DatabaseMethod>(method: M, params: DatabaseParams<M>, signal?: AbortSignal, settles = false): Promise<DatabaseResult<M>> => {
        if (signal?.aborted) {
            throw cancelledError();
        }

        const id = createId();
        const request = { id, method, params } as DatabaseRequest;

        return new Promise<DatabaseResult<M>>((resolve, reject) => {
            const onAbort = (): void => {
                const cancel = { id: createId(), method: 'cancel', params: { request: id } } as DatabaseRequest;
                const cancelling = new Promise((done) => done(transport(cancel)));

                if (settles) {
                    // Without a cancel on its way, nothing tells the request to stop, so its answer may never come.
                    cancelling.catch(() => reject(cancelledError()));
                } else {
                    cancelling.catch(() => {});
                    reject(cancelledError());
                }
            };

            signal?.addEventListener('abort', onAbort, { once: true });

            new Promise((done) => done(transport(request)))
                .then(
                    (response) => {
                        const { ok, result, error } = response as {
                            ok: boolean;
                            result?: unknown;
                            error?: { code: never; message: string; sqlState?: string; change?: number };
                        };

                        if (ok) {
                            resolve(result as DatabaseResult<M>);
                        } else {
                            reject(new DatabaseRequestError(error!.code, error!.message, error!.sqlState, error!.change));
                        }
                    },
                    (error: unknown) => reject(new DatabaseRequestError('helper-unavailable', error instanceof Error ? error.message : String(error)))
                )
                .finally(() => signal?.removeEventListener('abort', onAbort));
        });
    };

    const createSession = (initial: Connection, channel: string) => {
        let connection = initial;
        let opened: Opened | null = null;
        let opening: Promise<Opened> | null = null;

        /* A session that was closed and is used again is findable again, so `disconnect` and `dispose` reach it. */
        const track = (): void => {
            const channels = channelsOf(connection.id);

            if (!channels.has(channel)) {
                channels.set(channel, created);
            }
        };

        const open = (): Promise<Opened> => {
            if (opened !== null) {
                return Promise.resolve(opened);
            }

            track();
            held.add(created);
            opening ??= send('open', { connection: connection.config })
                .then((result) => (opened = result))
                .finally(() => {
                    opening = null;
                });

            return opening;
        };

        /* Reads are safe to send twice, so they open again and retry once; a write is not, so it only drops the session. */
        const request = async <M extends DatabaseMethod>(
            method: M,
            build: (session: string) => DatabaseParams<M>,
            requestOptions: RequestOptions | undefined,
            retry: boolean,
            settles = false
        ): Promise<DatabaseResult<M>> => {
            const signal = requestOptions?.signal;

            if (signal?.aborted) {
                throw cancelledError();
            }

            const current = await raceAbort(open(), signal);

            try {
                return await send(method, build(current.session), signal, settles);
            } catch (error) {
                if (!isUnknownSession(error)) {
                    throw error;
                }

                if (opened === current) {
                    opened = null;
                }

                if (retry) {
                    return request(method, build, requestOptions, false, settles);
                }

                throw error;
            }
        };

        const close = async (): Promise<void> => {
            const channels = live.get(connection.id);

            if (channels?.get(channel) === created) {
                channels.delete(channel);

                if (channels.size === 0) {
                    live.delete(connection.id);
                }
            }

            held.delete(created);
            const current = opened ?? (opening === null ? null : await opening.catch(() => null));
            opened = null;

            if (current !== null) {
                await send('close', { session: current.session }).catch(() => {});
            }
        };

        const session: DatabaseSession = {
            get connection() {
                return connection;
            },
            async server(requestOptions) {
                return (await raceAbort(open(), requestOptions?.signal)).server;
            },
            async schemas(requestOptions) {
                return (await request('schemas', (id) => ({ session: id }), requestOptions, true)).schemas;
            },
            async tables(schema, requestOptions) {
                return (await request('tables', (id) => ({ session: id, schema }), requestOptions, true)).tables;
            },
            structure(schema, table, requestOptions) {
                return request('structure', (id) => ({ session: id, schema, table }), requestOptions, true);
            },
            rows(schema, table, query, requestOptions) {
                return request('rows', (id) => ({ session: id, schema, table, ...query }), requestOptions, true);
            },
            async count(schema, table, where, requestOptions) {
                const params = (id: string) => (where === undefined ? { session: id, schema, table } : { session: id, schema, table, where });
                return (await request('count', params, requestOptions, true)).count;
            },
            async cell(schema, table, key, column, requestOptions) {
                return (await request('cell', (id) => ({ session: id, schema, table, key, column }), requestOptions, true)).value;
            },
            async apply(schema, table, changes, requestOptions) {
                return (await request('apply', (id) => ({ session: id, schema, table, changes }), requestOptions, false)).affected;
            },
            async execute(sql, executeOptions?: ExecuteOptions) {
                const { signal: _signal, ...rest } = executeOptions ?? {};
                const result = await request('execute', (id) => ({ session: id, sql, ...rest }), executeOptions, false, true);

                if (result.results.some((item) => item.kind !== 'error' && changesSchema(item.sql))) {
                    notifySchemaChange({ connectionId: connection.id, ...(rest.schema === undefined ? {} : { schema: rest.schema }) });
                }

                return result;
            },
            page(sql, query, requestOptions) {
                return request('page', (id) => ({ session: id, sql, ...query }), requestOptions, true);
            },
            async transaction(action, requestOptions) {
                return (await request('transaction', (id) => ({ session: id, action }), requestOptions, false)).active;
            },
            export(exportRequest, requestOptions) {
                return request('export', (id) => ({ session: id, ...exportRequest }), requestOptions, false);
            },
            async import(schema, table, importRequest, requestOptions) {
                return (await request('import', (id) => ({ session: id, schema, table, ...importRequest }), requestOptions, false)).rows;
            },
            close
        };

        const created = {
            session,
            close,
            update(next: Connection): void {
                connection = next;
            }
        };
        return created;
    };

    return {
        test(config: ConnectionConfig, requestOptions?: RequestOptions) {
            return send('test', { connection: config }, requestOptions?.signal).then((result) => result.server);
        },
        async discover(kind, discoverOptions) {
            const params = discoverOptions?.context === undefined ? { kind } : { kind, context: discoverOptions.context };
            return (await send('discover', params, discoverOptions?.signal)).containers;
        },
        sample(path, format, header, requestOptions) {
            return send('sample', { path, format, header }, requestOptions?.signal);
        },
        notifySchemaChange,
        onSchemaChange(listener) {
            schemaListeners.add(listener);
            return () => {
                schemaListeners.delete(listener);
            };
        },
        session(connection, channel = '') {
            const existing = live.get(connection.id)?.get(channel);

            if (existing !== undefined && isEqual(existing.session.connection.config, connection.config)) {
                existing.update(connection);
                return existing.session;
            }

            void existing?.close();

            const created = createSession(connection, channel);
            channelsOf(connection.id).set(channel, created);
            return created.session;
        },
        async disconnect(connectionId) {
            const existing = new Set(live.get(connectionId)?.values());
            for (const entry of held) {
                if (entry.session.connection.id === connectionId) {
                    existing.add(entry);
                }
            }
            live.delete(connectionId);
            await Promise.all([...existing].map((entry) => entry.close()));
        },
        async dispose() {
            const all = new Set([...live.values()].flatMap((channels) => [...channels.values()]));
            for (const entry of held) {
                all.add(entry);
            }
            live.clear();
            await Promise.all([...all].map((entry) => entry.close()));
        }
    };
};
