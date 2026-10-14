# Storage

Everything a host keeps lives in its data folder. Give each host a folder of its own: the stores assume one writer, and the file helpers guard against a half-written file, not against a second process.

## What goes where

| Path in the data folder                            |                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `chats/<id>.json`                                  | A chat's record: `{ info, items, seq?, resetSeq?, preambles?, uiAccess? }` and the host's own extras. |
| `chats/<id>.log`                                   | Its events since the record, one JSON line each: `{ seq, at, event }`.            |
| `chats/<id>.bookmarks.json`                        | Its bookmarks.                                                                    |
| `chats/<id>.visuals.json`                          | Its [visuals](/agents/chats#visuals), as `{ version: 1, visuals }`.               |
| `attachments/<id>/`                                | The files attached to its messages, and the page of each visual as `<visual id>.html`. |
| `providers.json`                                   | The accounts, as `{ version: 1, accounts }`, without secrets.                     |
| `accounts/`                                        | The folders of accounts the host made.                                            |
| `usage/index.json`, `prices.json`, `exchange-rate.json` | The usage index, and the prices and rate last fetched.                       |
| `outbox/`, `tasks/`, `lineage/`, `notices/`        | The [coordination](/agents/coordination) stores, when a host uses them.           |

An id becomes a file name with `encodeURIComponent`. A host's extras sit at the top level of a chat's record, next to `info` and `items`, which they cannot replace. `ChatStoreOptions.isSidecar` keeps JSON files of your own in `chats/` out of the list of chats.

A record this version cannot read is left as it is and refused with `chat-unreadable`; creating the chat again does not write over it. A log can rebuild a record that is missing, when it holds a start to rebuild from.

A record starts with its `info`. `ChatStore.settled` reads only that and the last info in the log, so `recoverInterrupted` parses in full only the chats with a turn in flight or a resume after a limit. A record that starts with another key is read in full.

## Writing

`ChatCore` writes a small record at once and waits a moment with a large one, and joins deltas before they are written. `save` and `persisted(chatId)` wait for a write. The log is what makes replay possible: `after(since)` answers the events after a sequence number while the log still holds all of them, and a client gets a whole snapshot otherwise. Compacting folds old events into the record. `host.close()` writes every record, even of a turn still running, and ends the CLIs even when a write fails; `persistAllSync` is for an exit that cannot wait.

## File helpers

```ts
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic, Serializer } from '@adecore/agents';

export async function writeCounter(dataDir: string): Promise<number> {
    await mkdir(dataDir, { recursive: true });
    const path = join(dataDir, 'counter.json');
    await writeAtomic(path, JSON.stringify({ count: 0 }));
    const writes = new Serializer();
    const increment = (): Promise<void> =>
        writes.run(async () => {
            const current = JSON.parse(await readFile(path, 'utf8')) as { count: number };
            await writeAtomic(path, JSON.stringify({ count: current.count + 1 }), 0o600, { durable: true });
        });
    await Promise.all([increment(), increment()]);
    await writes.idle();
    return (JSON.parse(await readFile(path, 'utf8')) as { count: number }).count;
}
```

The count ends at 2. `Serializer.run` runs work one at a time, even after one failed, and each caller gets its own result or error; `idle()` waits for the queue without rethrowing. `KeyedSerializer` does the same per key.

`writeAtomic(target, content, mode = 0o600, { durable? })` writes a temporary file beside the target and renames it over, retrying a busy rename five times, 40 ms apart. `durable` syncs the file before the rename and its folder after, except on Windows. Create the folder first. `writeAtomicSync` and `replaceSync` do the same synchronously, without `durable`. `fileExists` is `false` for any error, so use `isNotFound` when other errors should surface.

`RecordDirectory<T>` is a folder of JSON records, checked by a schema on load and written one at a time per id; a record that does not parse stays on disk. `keep` can rewrite or drop records on load.

## Other helpers

- `runProcess(command, options)` runs a short command and answers its output and `exitCode` (`null` after a signal). A nonzero exit is an answer, not an error; The command runs in a process group of its own. `timeoutMs` rejects and sends the group a SIGTERM, then a SIGKILL two seconds later. Past 16 MB of stdout and stderr together, the run ends the same way and rejects, so keep it to commands that print little.
- `withTimeout(promise, ms, message)` rejects at a deadline without stopping what it waited for, and `wait(ms, signal?)` resolves early on an abort.
- `WatchSeams` is file watching you can swap: `SYSTEM_WATCH` uses `fs.watch`, recursive only where the platform supports it (`supportsRecursive`). `settled(seams, ms, run)` runs once after a burst of changes, and `PerClientWatches` keeps a watch per client and path.
- `cleanTitle` and `readLines` read titles from a transcript; `readLines` stops at the last whole line, so a line still being written is read later.
- `CodedError` is an error with a `code`, `errorText` and `describeError` write an error for a log, and `setErrorStacks` turns stack traces on or off for the whole package.

## Generated image attachments

The Codex adapter reads the bytes of an image through `generatedImage(data, prompt)`, which is internal to the package. It refuses a result that is empty, malformed, not an image or too large, tells PNG, JPEG, GIF and WebP apart by their bytes, and reads the size in pixels. It never reads the path where the provider saved the image. An `imageView` item records its path as tool input and does not read it either.

`AttachmentStore.saveGenerated(chatId, ref, upload)` takes the attachment id from the provider's item id and writes the bytes whole, never over an image already there. A completion that comes again reuses the file, and a replay with other bytes under the same id fails. The backend waits for the write before it passes on the events after it, the end of the turn included. `ChatCore.attachment` finds generated images in the chat's tool items as well as files in user messages and the queue.

`AttachmentStore.copy(chatId, attachment)` gives a fork a file of its own with the same id and size. The host copies the attachment's metadata into the fork's record, so deleting the chat it came from leaves the fork's images.
