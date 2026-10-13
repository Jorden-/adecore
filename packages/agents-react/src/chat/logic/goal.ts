import type { ChatGoal, ChatGoalAction, ChatInfo, ProviderCapabilities } from '@adecore/agent-contracts';

export interface GoalView {
    goal: ChatGoal;
    // What a person may do to it from the row; empty where the CLI or the host offers nothing.
    actions: ChatGoalAction[];
}

/*
 * The row above the composer while the chat has a goal. A CLI with calls for goals pauses, resumes and
 * clears it at any time; one that only reads `/goal` clears it with a turn of its own, so only between
 * turns, and a goal it already met clears itself.
 */
export function goalView(info: Pick<ChatInfo, 'goal' | 'activeTurnId'>, goals: ProviderCapabilities['goals'], canAct: boolean): GoalView | null {
    const goal = info.goal;
    if (goal === undefined) {
        return null;
    }
    if (!canAct || goals === undefined) {
        return { goal, actions: [] };
    }
    if (goals === 'command') {
        return { goal, actions: goal.status === 'complete' || info.activeTurnId !== null ? [] : ['clear'] };
    }
    const actions: ChatGoalAction[] = [];
    if (goal.status === 'active') {
        actions.push('pause');
    } else if (goal.status !== 'complete') {
        actions.push('resume');
    }
    actions.push('clear');
    return { goal, actions };
}
