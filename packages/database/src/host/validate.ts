import type { DatabaseError, DatabaseMethod, DatabaseRequest } from '../protocol/index.ts';

export type ParsedRequest =
    | { readonly ok: true; readonly request: DatabaseRequest }
    | { readonly ok: false; readonly id: string; readonly error: DatabaseError };

const MAX_ID_LENGTH = 200;
const MAX_LIMIT = 10000;
const MAX_CELL_LIMIT = 1048576;
const MAX_BYTES = 67108864;
const TLS_MODES = ['disable', 'prefer', 'require', 'verify'];
const TRANSACTION_ACTIONS = ['begin', 'commit', 'rollback'];
const EXPORT_FORMATS = ['csv', 'tsv', 'json', 'sql'];
const DELIMITED_FORMATS = ['csv', 'tsv'];
const HEX = /^(?:[0-9a-f]{2})*$/;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

type Dict = Record<string, unknown>;

class InvalidRequest extends Error {}

const fail = (message: string): never => {
    throw new InvalidRequest(message);
};

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

/* Rejects a key nobody asked for, so a typo cannot pass for an option the helper ignores. */
const shape = (value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Dict => {
    if (!isDict(value)) {
        return fail(`"${label}" must be an object.`);
    }

    for (const key of Object.keys(value)) {
        if (!required.includes(key) && !optional.includes(key)) {
            fail(`"${label}" has an unknown key "${key}".`);
        }
    }

    for (const key of required) {
        if (value[key] === undefined) {
            fail(`"${label}" needs "${key}".`);
        }
    }

    return value;
};

const filledText = (value: unknown, label: string): void => {
    if (typeof value !== 'string' || value.length === 0) {
        fail(`"${label}" must be a non-empty string.`);
    }
};

const anyText = (value: unknown, label: string): void => {
    if (typeof value !== 'string') {
        fail(`"${label}" must be a string.`);
    }
};

const flag = (value: unknown, label: string): void => {
    if (typeof value !== 'boolean') {
        fail(`"${label}" must be true or false.`);
    }
};

const integer = (value: unknown, label: string, min: number, max: number): void => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        fail(`"${label}" must be an integer from ${min} to ${max}.`);
    }
};

const oneOf = (allowed: readonly string[]) => (value: unknown, label: string) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        fail(`"${label}" must be one of ${allowed.join(', ')}.`);
    }
};

const absolutePath = (value: unknown, label: string): void => {
    filledText(value, label);

    if (!ABSOLUTE_PATH.test(value as string)) {
        fail(`"${label}" must be an absolute path.`);
    }
};

const port = (value: unknown, label: string): void => integer(value, label, 1, 65535);

const optional = (source: Dict, key: string, label: string, check: (value: unknown, label: string) => void): void => {
    if (source[key] !== undefined) {
        check(source[key], `${label}.${key}`);
    }
};

const value = (input: unknown, label: string): void => {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') {
        return;
    }

    if (typeof input === 'number') {
        if (!Number.isFinite(input)) {
            fail(`"${label}" must be a finite number.`);
        }
        return;
    }

    if (!isDict(input) || input.kind !== 'binary') {
        fail(`"${label}" must be a value, such as null, a boolean, a number, a string or a binary object.`);
    }

    const binary = shape(input, label, ['kind', 'hex']);

    if (typeof binary.hex !== 'string' || !HEX.test(binary.hex)) {
        fail(`"${label}.hex" must be lowercase hex of whole bytes.`);
    }
};

const editValue = (input: unknown, label: string): void => {
    if (isDict(input) && input.kind === 'default') {
        shape(input, label, ['kind']);
        return;
    }

    value(input, label);
};

const values = (input: unknown, label: string, check: (value: unknown, label: string) => void, atLeastOne: boolean): void => {
    if (!isDict(input)) {
        fail(`"${label}" must be an object.`);
        return;
    }

    const entries = Object.entries(input);

    if (atLeastOne && entries.length === 0) {
        fail(`"${label}" must name at least one column.`);
    }

    for (const [column, entry] of entries) {
        check(entry, `${label}.${column}`);
    }
};

const tunnel = (input: unknown, label: string): void => {
    if (!isDict(input)) {
        fail(`"${label}" must be an object.`);
        return;
    }

    if (input.kind === 'ssh') {
        const config = shape(input, label, ['kind', 'host'], ['port', 'user', 'identityFile']);
        filledText(config.host, `${label}.host`);
        optional(config, 'port', label, port);
        optional(config, 'user', label, filledText);
        optional(config, 'identityFile', label, filledText);
        return;
    }

    if (input.kind === 'docker') {
        const config = shape(input, label, ['kind', 'container'], ['port', 'context']);
        filledText(config.container, `${label}.container`);
        optional(config, 'port', label, port);
        optional(config, 'context', label, filledText);
        return;
    }

    fail(`"${label}.kind" must be "ssh" or "docker".`);
};

const connection = (input: unknown, label: string): void => {
    if (!isDict(input)) {
        fail(`"${label}" must be an object.`);
        return;
    }

    if (input.engine === 'sqlite') {
        const config = shape(input, label, ['engine', 'path'], ['create', 'readOnly']);
        absolutePath(config.path, `${label}.path`);
        optional(config, 'create', label, flag);
        optional(config, 'readOnly', label, flag);
        return;
    }

    if (input.engine === 'mysql') {
        const config = shape(input, label, ['engine', 'host', 'user'], ['port', 'socket', 'password', 'database', 'tls', 'readOnly', 'tunnel']);
        optional(config, 'tunnel', label, tunnel);

        // A Docker tunnel finds the server by its container, so the host is left empty.
        const viaDocker = isDict(config.tunnel) && config.tunnel.kind === 'docker';
        (viaDocker ? anyText : filledText)(config.host, `${label}.host`);
        filledText(config.user, `${label}.user`);
        optional(config, 'port', label, port);
        optional(config, 'socket', label, filledText);
        optional(config, 'password', label, anyText);
        optional(config, 'database', label, anyText);
        optional(config, 'tls', label, oneOf(TLS_MODES));
        optional(config, 'readOnly', label, flag);
        return;
    }

    fail(`"${label}.engine" must be "sqlite" or "mysql".`);
};

const rowChange = (input: unknown, label: string): void => {
    if (!isDict(input)) {
        fail(`"${label}" must be an object.`);
        return;
    }

    if (input.kind === 'insert') {
        const change = shape(input, label, ['kind', 'values']);
        values(change.values, `${label}.values`, editValue, false);
    } else if (input.kind === 'update') {
        const change = shape(input, label, ['kind', 'key', 'values']);
        values(change.key, `${label}.key`, value, true);
        values(change.values, `${label}.values`, editValue, true);
    } else if (input.kind === 'delete') {
        const change = shape(input, label, ['kind', 'key']);
        values(change.key, `${label}.key`, value, true);
    } else {
        fail(`"${label}.kind" must be "insert", "update" or "delete".`);
    }
};

const exportSource = (input: unknown, label: string): void => {
    if (!isDict(input)) {
        fail(`"${label}" must be an object.`);
        return;
    }

    if (input.kind === 'table') {
        const source = shape(input, label, ['kind', 'schema', 'table'], ['where', 'orderBy']);
        filledText(source.schema, `${label}.schema`);
        filledText(source.table, `${label}.table`);
        optional(source, 'where', label, anyText);
        optional(source, 'orderBy', label, anyText);
        return;
    }

    if (input.kind === 'query') {
        const source = shape(input, label, ['kind', 'sql'], ['schema']);
        filledText(source.sql, `${label}.sql`);
        optional(source, 'schema', label, filledText);
        return;
    }

    fail(`"${label}.kind" must be "table" or "query".`);
};

const cellLimit = (params: Dict): void => optional(params, 'cellLimit', 'params', (limit, name) => integer(limit, name, 1, MAX_CELL_LIMIT));

const maxBytes = (params: Dict): void => optional(params, 'maxBytes', 'params', (limit, name) => integer(limit, name, 1, MAX_BYTES));

const table = (params: Dict): void => {
    filledText(params.session, 'params.session');
    filledText(params.schema, 'params.schema');
    filledText(params.table, 'params.table');
};

const TARGET = ['session', 'schema', 'table'];

const PARAMS: { readonly [M in DatabaseMethod]: (input: unknown) => void } = {
    open: (input) => connection(shape(input, 'params', ['connection']).connection, 'params.connection'),
    test: (input) => connection(shape(input, 'params', ['connection']).connection, 'params.connection'),
    close: (input) => filledText(shape(input, 'params', ['session']).session, 'params.session'),
    schemas: (input) => filledText(shape(input, 'params', ['session']).session, 'params.session'),
    tables: (input) => {
        const params = shape(input, 'params', ['session', 'schema']);
        filledText(params.session, 'params.session');
        filledText(params.schema, 'params.schema');
    },
    structure: (input) => table(shape(input, 'params', TARGET)),
    rows: (input) => {
        const params = shape(input, 'params', [...TARGET, 'offset', 'limit'], ['where', 'orderBy', 'cellLimit', 'maxBytes']);
        table(params);
        optional(params, 'where', 'params', anyText);
        optional(params, 'orderBy', 'params', anyText);
        integer(params.offset, 'params.offset', 0, Number.MAX_SAFE_INTEGER);
        integer(params.limit, 'params.limit', 1, MAX_LIMIT);
        cellLimit(params);
        maxBytes(params);
    },
    count: (input) => {
        const params = shape(input, 'params', TARGET, ['where']);
        table(params);
        optional(params, 'where', 'params', anyText);
    },
    cell: (input) => {
        const params = shape(input, 'params', [...TARGET, 'key', 'column']);
        table(params);
        values(params.key, 'params.key', value, true);
        filledText(params.column, 'params.column');
    },
    apply: (input) => {
        const params = shape(input, 'params', [...TARGET, 'changes']);
        table(params);

        if (!Array.isArray(params.changes)) {
            fail('"params.changes" must be a list.');
            return;
        }

        params.changes.forEach((change, i) => rowChange(change, `params.changes[${i}]`));
    },
    execute: (input) => {
        const params = shape(input, 'params', ['session', 'sql'], ['schema', 'limit', 'cellLimit', 'maxBytes']);
        filledText(params.session, 'params.session');
        filledText(params.sql, 'params.sql');
        optional(params, 'schema', 'params', filledText);
        optional(params, 'limit', 'params', (limit, name) => integer(limit, name, 1, MAX_LIMIT));
        cellLimit(params);
        maxBytes(params);
    },
    page: (input) => {
        const params = shape(input, 'params', ['session', 'sql', 'offset', 'limit'], ['schema', 'cellLimit', 'maxBytes']);
        filledText(params.session, 'params.session');
        filledText(params.sql, 'params.sql');
        optional(params, 'schema', 'params', filledText);
        integer(params.offset, 'params.offset', 0, Number.MAX_SAFE_INTEGER);
        integer(params.limit, 'params.limit', 1, MAX_LIMIT);
        cellLimit(params);
        maxBytes(params);
    },
    transaction: (input) => {
        const params = shape(input, 'params', ['session', 'action']);
        filledText(params.session, 'params.session');
        oneOf(TRANSACTION_ACTIONS)(params.action, 'params.action');
    },
    export: (input) => {
        const params = shape(input, 'params', ['session', 'source', 'format', 'path'], ['header', 'tableName']);
        filledText(params.session, 'params.session');
        exportSource(params.source, 'params.source');
        oneOf(EXPORT_FORMATS)(params.format, 'params.format');
        absolutePath(params.path, 'params.path');
        optional(params, 'header', 'params', flag);
        optional(params, 'tableName', 'params', filledText);
    },
    sample: (input) => {
        const params = shape(input, 'params', ['path', 'format', 'header'], ['limit']);
        absolutePath(params.path, 'params.path');
        oneOf(DELIMITED_FORMATS)(params.format, 'params.format');
        flag(params.header, 'params.header');
        optional(params, 'limit', 'params', (limit, name) => integer(limit, name, 1, MAX_LIMIT));
    },
    import: (input) => {
        const params = shape(input, 'params', [...TARGET, 'path', 'format', 'header', 'columns']);
        table(params);
        absolutePath(params.path, 'params.path');
        oneOf(DELIMITED_FORMATS)(params.format, 'params.format');
        flag(params.header, 'params.header');

        if (!Array.isArray(params.columns)) {
            fail('"params.columns" must be a list.');
            return;
        }

        params.columns.forEach((column, i) => {
            if (column !== null) {
                filledText(column, `params.columns[${i}]`);
            }
        });
    },
    discover: (input) => {
        const params = shape(input, 'params', ['kind'], ['context']);
        oneOf(['docker'])(params.kind, 'params.kind');
        optional(params, 'context', 'params', filledText);
    },
    cancel: (input) => {
        const params = shape(input, 'params', ['request']);

        if (!isRequestId(params.request)) {
            fail(`"params.request" must be a string of 1 to ${MAX_ID_LENGTH} characters.`);
        }
    }
};

/* Checks the whole request before anything reaches the helper, which then never has to defend itself against a page. */
export const parseRequest = (input: unknown): ParsedRequest => {
    const id = isDict(input) && isRequestId(input.id) ? input.id : '';

    try {
        const envelope = shape(input, 'request', ['id', 'method', 'params']);

        if (id === '') {
            fail(`"id" must be a string of 1 to ${MAX_ID_LENGTH} characters.`);
        }

        if (typeof envelope.method !== 'string') {
            fail('"method" must be a string.');
        }

        const method = envelope.method as string;

        if (!Object.hasOwn(PARAMS, method)) {
            fail(`Unknown method ${JSON.stringify(method)}.`);
        }

        PARAMS[method as DatabaseMethod](envelope.params);

        return { ok: true, request: input as DatabaseRequest };
    } catch (error) {
        if (error instanceof InvalidRequest) {
            return { ok: false, id, error: { code: 'invalid-request', message: error.message } };
        }

        throw error;
    }
};
