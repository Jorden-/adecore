# Attachments and mentions

The composer reads files, checks them against the limits and turns `@` picks and dragged paths into mentions. The helpers are exported for a drop target or a file list of your own.

## Reading files

```ts
import { checkAttachmentLimits, readAttachments, uploadBytes } from '@adecore/agents-react/chat/attachments';

const { accepted, rejected } = checkAttachmentLimits(
    held.length,
    files.map((file) => ({ file, name: file.name, mime: file.type, bytes: file.size })),
    held.reduce((bytes, upload) => bytes + uploadBytes(upload), 0)
);
const uploads = await readAttachments(accepted.map((entry) => entry.file));
```

`checkAttachmentLimits(count, incoming, bytes)` sorts files into `accepted` and `rejected`, each rejection with a reason a person can read: empty, larger than 10 MiB, one too many, or past 10 MiB for the message. The limits are those of [the contract](/agent-contracts/conversation#attachments), which the host checks again. `readAttachments(files)` reads them as uploads, names a pasted picture that has none, and takes the image type from the name when the browser gave none. `readStoredAttachments(read, stored)` turns attachments the host keeps back into uploads, which is how a queued message comes back into the draft.

`isImageAttachment(mime)`, `fileBadge(name)`, `formatBytes(bytes)`, `filesOf(dataTransfer)`, `uploadBytes(upload)` and `uploadPreviewUrl(upload)` are the small parts.

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

A path picked with `@` sits in the text and in `mentions`; a skill picked with `$` in the text and in `skills`. `findMentionQuery`, `findSkillQuery`, `insertMention`, `insertSkill`, `presentMentions` and `tokenizeChips` are the parsing and inserting the composer does.

A file list can hand paths to the composer by drag. The payload is the paths joined by spaces under `MENTION_DRAG_TYPE` (`application/x-adecore-mention`):

```ts
import { carriesMentions, droppedMentions, writeMentionDrag } from '@adecore/agents-react/chat/mentions';

row.addEventListener('dragstart', (event) => writeMentionDrag(event.dataTransfer!, [path]));

target.addEventListener('dragover', (event) => {
    if (carriesMentions(event.dataTransfer!.types)) {
        event.preventDefault();
    }
});
target.addEventListener('drop', (event) => insert(droppedMentions(event.dataTransfer!)));
```

`writeMentionDrag` also writes the older type `LEGACY_MENTION_DRAG_TYPE` unless its third argument is `false`, and `carriesMentions` and `droppedMentions` read both (`MENTION_DRAG_TYPES`). Stop writing the older type once every receiver reads the new one. The paths are split on whitespace, so a path with a space in it does not survive a drag.
