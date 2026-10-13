# Persistence

Four records outlive a reload: the drafts of every chat, the chat preferences (the model per CLI, the runtime mode, the account per host, the reading width, the send key), the stash of prompts put aside, and the usage page's choices. Everything else, threads included, comes from the host again.

## Configure first

```ts
import { configureChatStorage } from '@adecore/agents-react/storage';

configureChatStorage({ namespace: 'my-app' });
```

Call it before the first render, outside React, since the stores are shared by every view on the page. Importing a module reads nothing; the first read of any record (a hook, `getState`, a subscription) fixes the configuration, and configuring after that throws `Configure chat storage before using chat stores`. There is no reset: a page that needs another configuration is a new page.

| Record        | Key                        |
| ------------- | -------------------------- |
| `drafts`      | `<namespace>.chat.drafts`      |
| `preferences` | `<namespace>.chat.preferences` |
| `stash`       | `<namespace>.chat.stash`       |
| `usage`       | `<namespace>.usage`            |

The namespace is `adecore` unless you set one. `keys` names a record's whole key and wins over the namespace. `chatStorageKey(record)` and `chatStorageLegacyKeys(record)` answer the keys in use without reading anything.

## Where it is kept

Without `storage` the records go to `localStorage`, looked up on first use; a page without one, or one that refuses access, keeps them in memory. `storage: null` keeps them in memory on purpose. Anything else is a `ChatStorageAdapter`, `{ getItem(key), setItem(key, value) }`, and has to answer at once:

```ts
const records = new Map<string, string>();

configureChatStorage({
    namespace: 'my-app',
    storage: { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => void records.set(key, value) }
});
```

A write that fails, such as a full storage, keeps the value in memory for the rest of the session. A draft that does not fit is written again without its attached files, so its text survives.

## Moving from older keys

An app that kept these records under other keys lists them, and the first read copies the old record over:

```ts
configureChatStorage({
    namespace: 'my-app',
    legacyKeys: { drafts: ['old-app.drafts'] },
    legacyNamespaces: ['old-app']
});
```

For each record the current key wins when it holds anything, even something that no longer parses. Otherwise `legacyKeys` are tried in order, then each of `legacyNamespaces`, and the first value found is copied unchanged to the current key. The old key stays, for a window that still reads it. The copy converts nothing: a field the current version does not read is ignored until the record is written again.

## What the records hold

- Drafts are keyed by chat id, not by scope, so two hosts with the same chat id share a draft. Pick chat ids that are unique on the page. A draft holds its text, mentions, skills, referenced chats, quote and attached files. `readDraft`, `writeDraft` and `useDrafts` read and write them; `offerDraft(chatId, text)` adds text under what is typed, for a person to read and send.
- Preferences hold the model per CLI (`selectionByProvider`), the last CLI, the runtime mode for chats and for terminals (both `full-access` by default), the account per host and CLI (`accountByMachine`) and `changedAt`. A model belongs to its CLI, so an old record with one global model loses it rather than guessing a CLI. `chatPreferencesPayload` makes the payload of `ChatClient.setPreferences` from them.
- The stash is at most `STASH_LIMIT` (20) prompts, newest first, shared by every chat. It keeps the text, mentions, skills and the names of attached files, not the files themselves.
- Usage holds the period (`7d`), the metric (`cost`) and the currency (`USD`). The numbers stay in memory.

## Another window

A `storage` event from another window of the same origin is how a change arrives there. Reload the preferences when their key changes:

```ts
import { chatPreferencesKey, reloadChatPreferences } from '@adecore/agents-react/chat/preferences';
import { reloadUsagePreferences, usagePreferencesKey } from '@adecore/agents-react/state/usage';

window.addEventListener('storage', (event) => {
    if (event.key === chatPreferencesKey()) {
        reloadChatPreferences();
    }
    if (event.key === usagePreferencesKey()) {
        reloadUsagePreferences();
    }
});
```

`CHAT_PREFERENCES_KEY` and `USAGE_PREFERENCES_KEY` hold the same keys and follow the configuration. Drafts and the stash have no reload.

## Lower down

`createChatStore(initial, hydrate)` is the Zustand `create` the persisted stores are made with: it reads its record on first use. `hydrateChatStorage()` reads every such store at once, `chatStorageAdapter()` answers the adapter in use, and `onChatStorageConfiguration(listener)` runs when the configuration changes; it cannot be removed. `persistedJson(key, parse, fallback)` is one record with the fallback to memory described above.
