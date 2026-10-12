import type { SnippetVariableContext } from './host-types.ts';
import type { SnippetVariableResolver } from './snippet.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createSnippetResolver(
    context: SnippetVariableContext,
    custom?: (name: string, context: SnippetVariableContext) => string | undefined,
    sources: { now?: Date; random?: () => number; uuid?: () => string } = {}
): SnippetVariableResolver {
    const now = sources.now ?? new Date();
    const random = sources.random ?? Math.random;
    const path = context.path;
    const filename = path?.replace(/\\/g, '/').split('/').at(-1);
    const folder = context.folder?.replace(/\\/g, '/').replace(/\/$/, '');
    const normalized = path?.replace(/\\/g, '/');
    const pad = (value: number): string => String(value).padStart(2, '0');
    const timezone = -now.getTimezoneOffset();
    const values: Record<string, string | undefined> = {
        TM_SELECTED_TEXT: context.selectedText,
        TM_CURRENT_LINE: context.currentLine,
        TM_CURRENT_WORD: context.currentWord,
        TM_LINE_INDEX: String(context.position.line),
        TM_LINE_NUMBER: String(context.position.line + 1),
        CURSOR_INDEX: String(context.cursorIndex),
        CURSOR_NUMBER: String(context.cursorIndex + 1),
        TM_FILENAME: filename,
        TM_FILENAME_BASE: filename === undefined ? undefined : filename.replace(/(?<=.)\.[^.]*$/, ''),
        TM_DIRECTORY: normalized?.slice(0, normalized.lastIndexOf('/')),
        TM_FILEPATH: path,
        RELATIVE_FILEPATH: folder !== undefined && normalized?.startsWith(folder + '/') ? normalized.slice(folder.length + 1) : path,
        WORKSPACE_FOLDER: context.folder,
        WORKSPACE_NAME: folder?.split('/').at(-1),
        CURRENT_YEAR: String(now.getFullYear()),
        CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(-2),
        CURRENT_MONTH: pad(now.getMonth() + 1),
        CURRENT_MONTH_NAME: MONTHS[now.getMonth()],
        CURRENT_MONTH_NAME_SHORT: MONTHS[now.getMonth()]!.slice(0, 3),
        CURRENT_DATE: pad(now.getDate()),
        CURRENT_DAY_NAME: DAYS[now.getDay()],
        CURRENT_DAY_NAME_SHORT: DAYS[now.getDay()]!.slice(0, 3),
        CURRENT_HOUR: pad(now.getHours()),
        CURRENT_MINUTE: pad(now.getMinutes()),
        CURRENT_SECOND: pad(now.getSeconds()),
        CURRENT_SECONDS_UNIX: String(Math.floor(now.getTime() / 1000)),
        CURRENT_TIMEZONE_OFFSET: (timezone < 0 ? '-' : '+') + pad(Math.floor(Math.abs(timezone) / 60)) + pad(Math.abs(timezone) % 60)
    };
    const builtins = new Map(Object.entries(values));
    const cache = new Map<string, string | undefined>();
    return (name) => {
        if (!cache.has(name)) {
            const supplied = custom?.(name, context);
            const value =
                supplied ??
                (name === 'RANDOM'
                    ? String(Math.floor(random() * 1_000_000)).padStart(6, '0')
                    : name === 'RANDOM_HEX'
                      ? Math.floor(random() * 0x1000000)
                            .toString(16)
                            .padStart(6, '0')
                      : name === 'UUID'
                        ? (sources.uuid?.() ?? globalThis.crypto?.randomUUID())
                        : builtins.get(name));
            cache.set(name, value);
        }
        return cache.get(name);
    };
}
