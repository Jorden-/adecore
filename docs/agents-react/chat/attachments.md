# Attachments and mentions

The composer reads files, checks them against the limits and turns `@` picks and dragged paths into mentions. The parts it does that with are internal; a host supplies the sink for a stored file (below) and the drag types.

## Reading files

The composer sorts the files a person drops, pastes or picks into accepted and rejected ones, each rejection with a reason a person can read: empty, larger than 10 MiB, one too many, or past 10 MiB for the message. The limits are those of [the contract](/agent-contracts/conversation#attachments), which the host checks again. It names a pasted picture that has none and takes the image type from the name when the browser gave none. An attachment the host keeps comes back as an upload when a queued message returns to the draft.

## Stored files

A sent attachment is an id and a path on the host's machine. The host's `attachments.useUrl(scopeId, chatId, attachmentId)` answers a `ResourceUrl` for it, `{ url, failure }`: a URL to draw, or why there is none. Revoke an object URL you made when the hook lets go of it.

```tsx
const CHAT_HOST: Partial<ChatHost> = {
    attachments: {
        read: (scopeId, chatId, attachmentId) => backend.readAttachment(chatId, attachmentId),
        useUrl: (scopeId, chatId, attachmentId) => useObjectUrl(() => backend.readAttachment(chatId, attachmentId), [chatId, attachmentId])
    }
};
```

`backend` and `useObjectUrl` stand for your app's own; the hook keeps a `ResourceUrl` in state while the bytes load.

Two optional functions let a person take a [generated image](/agents-react/chat/timeline#generated-images) out of the chat. Each gets the scope, the chat, the attachment and a suggested file name, and is never given a path from the chat item.

- `open(scopeId, chatId, attachmentId, suggestedName)` opens the file outside the chat, such as in the system's own app, or as a download in a browser.
- `saveToProject(scopeId, chatId, attachmentId, suggestedName)` shows your own dialog to save a copy in the folder the chat works for. It resolves with the saved path, which the row shows as a file link, or with `null` when the person cancels. The dialog shows a failure itself; a rejection leaves the row as it was.

Leave either out and its button is not drawn.

## Mentions

A path picked with `@` sits in the text and in `mentions`; a skill picked with `$` in the text and in `skills`. The composer does the parsing and inserting itself.

A file list can hand paths to the composer by drag. The payload is the paths joined by spaces under `MENTION_DRAG_TYPE` (`application/x-adecore-mention`):

```ts
import { carriesMentions, droppedMentions, writeMentionDrag } from '@adecore/agents-react/chat';

row.addEventListener('dragstart', (event) => writeMentionDrag(event.dataTransfer!, [path]));

target.addEventListener('dragover', (event) => {
    if (carriesMentions(event.dataTransfer!.types)) {
        event.preventDefault();
    }
});
target.addEventListener('drop', (event) => insert(droppedMentions(event.dataTransfer!)));
```

`writeMentionDrag` also writes the older type `LEGACY_MENTION_DRAG_TYPE` unless its third argument is `false`, and `carriesMentions` and `droppedMentions` read both. Stop writing the older type once every receiver reads the new one. The paths are split on whitespace, so a path with a space in it does not survive a drag.
