import assert from 'node:assert/strict';

let reads = 0;
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
        reads += 1;
        throw new Error('Storage has not been configured');
    }
});
const drafts = await import('@adecore/agents-react/chat/drafts');
const preferences = await import('@adecore/agents-react/chat/preferences');
const usage = await import('@adecore/agents-react/state/usage');
const storage = await import('@adecore/agents-react/storage');
assert.equal(reads, 0);

const records = new Map([
    ['ruimte.chat.drafts', JSON.stringify({ chat: { text: 'unsent', mentions: ['a.ts'], quote: 'remember' } })],
    ['ruimte.chat.preferences', JSON.stringify({ lastProvider: 'codex', runtimeMode: 'supervised', changedAt: 42 })],
    ['ruimte.chat.stash', JSON.stringify([{ id: 'saved', text: 'for later', createdAt: 12 }])],
    ['ruimte.usage', JSON.stringify({ period: '30d', metric: 'tokens', currency: 'EUR' })]
]);
let refuseWrites = false;
storage.configureChatStorage({
    namespace: 'example',
    legacyNamespaces: ['ruimte'],
    keys: { preferences: 'custom.preferences' },
    storage: {
        getItem: (key) => records.get(key) ?? null,
        setItem: (key, value) => {
            if (refuseWrites) {
                throw new Error('Quota exceeded');
            }
            records.set(key, value);
        }
    }
});
assert.equal(reads, 0);
assert.equal(preferences.CHAT_PREFERENCES_KEY, 'custom.preferences');
assert.equal(usage.USAGE_PREFERENCES_KEY, 'example.usage');
assert.deepEqual(drafts.useDrafts.getState().ids, ['chat']);
assert.equal(drafts.readDraft('chat').text, 'unsent');
assert.equal(drafts.readDraft('chat').quote, 'remember');
assert.equal(preferences.readChatPreferences().lastProvider, 'codex');
assert.equal(preferences.readChatPreferences().changedAt, 42);
assert.equal(usage.useUsageStore.getState().currency, 'EUR');
// A store imported after hydration still loads on its first use.
const stash = await import('@adecore/agents-react/chat/stash');
assert.equal(stash.useStash.getState().prompts[0].text, 'for later');
for (const [oldKey, newKey] of [
    ['ruimte.chat.drafts', 'example.chat.drafts'],
    ['ruimte.chat.preferences', 'custom.preferences'],
    ['ruimte.chat.stash', 'example.chat.stash'],
    ['ruimte.usage', 'example.usage']
]) {
    assert.equal(records.get(oldKey), records.get(newKey));
}
assert.throws(() => storage.configureChatStorage({ namespace: 'too-late' }), /before using/);
records.set('example.usage', JSON.stringify({ period: 'today', currency: 'USD' }));
usage.reloadUsagePreferences();
assert.equal(usage.useUsageStore.getState().period, 'today');
refuseWrites = true;
drafts.writeDraft('new', { ...drafts.EMPTY_DRAFT, text: 'kept in memory' });
assert.equal(drafts.readDraft('new').text, 'kept in memory');
preferences.rememberChatPreferences({ runtimeMode: 'auto' });
preferences.reloadChatPreferences();
assert.equal(preferences.readChatPreferences().runtimeMode, 'auto');
usage.useUsageStore.getState().setCurrency('EUR');
usage.reloadUsagePreferences();
assert.equal(usage.useUsageStore.getState().currency, 'EUR');
assert.equal(reads, 0);
console.log('Storage compatibility fixture passed');
