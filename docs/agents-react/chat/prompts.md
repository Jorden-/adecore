# Prompts

The cards a person answers a chat's approvals and questions in. The [composer](/agents-react/chat/composer) draws them itself, in its own place, for every request the chat waits on (`PromptComposer`). The parts are exported for a stack of cards somewhere else, such as over a canvas of chats.

```tsx
import { PromptView, usePromptSession } from '@adecore/agents-react/prompts';
```

<Demo src="agents/prompts" />

## What a person sees

An approval names the tool and what it is about, with the command or the diff it wants to run, and buttons to deny or allow. When the CLI proposed a rule to remember, a third button grants it for good; the keyboard never starts on that one, nor on Allow. A denial can carry a reason when the CLI takes one.

A question shows its choices, one or several to pick, or a field for a written answer, and pages through several questions before it answers them together. Picking several choices answers them joined by commas. A question the CLI marked `async` can be dismissed.

Requests that hold the agent up come first, oldest first, then optional questions. A card being read stays in front when a new request arrives, and a press that started on the card before it never lands on the new one. A refusal leaves the card where it was, with the host's message under it.

## A stack of your own

`usePromptSession` keeps the state of a stack: which subject is in front, a draft per request, sending and the last error. `PromptView` draws one subject. `answerPrompt(subject, action, actions, host)` sends a card's action as the request it is answered with, or to the host's `prompts.answer` for a prompt of your app.

```tsx
import { useChatActions } from '@adecore/agents-react/chat';
import { useChatHost } from '@adecore/agents-react';
import { orderPrompts, answerPrompt, isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@adecore/agents-react/prompts';

const pick = (waiting: readonly PromptSubject[], id: string | null): PromptSubject | null =>
    waiting.find((subject) => promptIdOf(subject) === id) ?? orderPrompts(waiting, isBlockingSubject, promptCreatedAt)[0] ?? null;

function Stack({ subjects }: { subjects: PromptSubject[] }) {
    const actions = useChatActions();
    const host = useChatHost();
    const session = usePromptSession({ prompts: subjects, idOf: promptIdOf, pick, disabled: false });
    const active = session.active;
    if (!active) {
        return null;
    }
    const id = promptIdOf(active);
    return (
        <div onPointerDownCapture={session.onPointerDownCapture} onClickCapture={session.onClickCapture}>
            <PromptView
                subject={active}
                draft={session.draftOf(id)}
                onDraft={(draft) => session.setDraft(id, draft)}
                onAction={(action) => void session.act(active, () => answerPrompt(active, action, actions, host))}
                more={session.waiting.length - 1}
                hasDraft={false}
                denyReason
                disabled={false}
                sending={session.sending}
                error={session.errorOf(id)}
            />
        </div>
    );
}
```

A `PromptSubject` is `{ kind: 'chat', nodeId, item }` for a chat's pending approval or question item, where `nodeId` is the chat id, or `{ kind: 'host', nodeId, prompt }` for one of your own. Keep both capture handlers on the element around the card: they stop a press from answering a card that took the place of the one it started on. `act` answers `sent`, `failed` or `busy`; it sends one answer at a time and hides an answered card until the host settles it.

## Keys

Arrows, Home and End move through the choices and Space picks; Enter on a single choice picks and answers. Mod+Enter is the card's main action and Mod+Shift+Left and Right page through a stack (`PROMPT_SHORTCUTS`). A key typed for something else never answers a card: when a request arrives while a person types, the keyboard goes to its heading. `focusPromptStart` and `useFocusAfterAnswer` are those moves, for a stack of your own.

## Prompts of your own

The host's `prompts` adds prompts of your app beside a chat's, answered in the same place:

```tsx
const CHAT_HOST: Partial<ChatHost> = {
    prompts: {
        useExtra: (scopeId, chatId) => usePermissionRequests(scopeId, chatId),
        render: (prompt, props) => <PermissionCard prompt={prompt} {...props} />,
        answer: (prompt, action) => permissions.answer(prompt.id, action)
    }
};
```

A `HostPrompt` is `{ id, createdAt, blocking, asks, data }`: a stable id, whether it holds anything up, `approval` or `question` for its mark, and whatever your app needs in `data`. Return the same objects from `useExtra` while nothing changed. `PromptCard`, `PromptPrimary` and `ApprovalActions` build a card that looks like the others, and a `choose` action answers with one of your own choices.

## Parts

`PromptView` is made of `PromptCard` (the frame, with heading, meta, notice and error), the bodies for an approval and a question, and the action rows. `PROMPT_SURFACE` is the surface class of the card for a frame that matches it. The logic in `@adecore/agents-react/prompts` that a stack of your own needs is pure: `emptyPromptDraft` and `orderPrompts`.
