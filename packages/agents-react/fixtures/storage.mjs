import assert from 'node:assert/strict';

let reads = 0;
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
        reads += 1;
        throw new Error('Storage has not been configured');
    }
});
const chat = await import('@adecore/agents-react/chat');
const state = await import('@adecore/agents-react/state');
const storage = await import('@adecore/agents-react');
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
assert.equal(chat.CHAT_PREFERENCES_KEY, 'custom.preferences');
assert.equal(state.USAGE_PREFERENCES_KEY, 'example.usage');
assert.deepEqual(chat.useDrafts.getState().ids, ['chat']);
assert.equal(chat.readDraft('chat').text, 'unsent');
assert.equal(chat.readDraft('chat').quote, 'remember');
assert.equal(chat.readChatPreferences().lastProvider, 'codex');
assert.equal(chat.readChatPreferences().changedAt, 42);
assert.equal(state.useUsageStore.getState().currency, 'EUR');
// A store imported after hydration still loads on its first use; the stash is internal, so it is read from its source.
const stash = await import('../src/chat/stash.ts');
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
state.reloadUsagePreferences();
assert.equal(state.useUsageStore.getState().period, 'today');
refuseWrites = true;
chat.writeDraft('new', { ...chat.EMPTY_DRAFT, text: 'kept in memory' });
assert.equal(chat.readDraft('new').text, 'kept in memory');
chat.rememberChatPreferences({ runtimeMode: 'auto' });
chat.reloadChatPreferences();
assert.equal(chat.readChatPreferences().runtimeMode, 'auto');
state.useUsageStore.getState().setCurrency('EUR');
state.reloadUsagePreferences();
assert.equal(state.useUsageStore.getState().currency, 'EUR');
assert.equal(reads, 0);
console.log('Storage compatibility fixture passed');
