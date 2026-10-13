import { describe, expect, test } from 'bun:test';
import type { ChatGoal } from '@adecore/agent-contracts';
import { goalView } from './goal';

const goal = (status: ChatGoal['status']): ChatGoal => ({ objective: 'ship it', status });

describe('goalView', () => {
    test('no goal, no row', () => {
        expect(goalView({ activeTurnId: null }, 'native', true)).toBeNull();
    });

    test('a CLI with goal calls pauses an active goal, resumes a stopped one and clears any', () => {
        expect(goalView({ goal: goal('active'), activeTurnId: 'turn' }, 'native', true)?.actions).toEqual(['pause', 'clear']);
        expect(goalView({ goal: goal('paused'), activeTurnId: null }, 'native', true)?.actions).toEqual(['resume', 'clear']);
        expect(goalView({ goal: goal('budget-limited'), activeTurnId: null }, 'native', true)?.actions).toEqual(['resume', 'clear']);
        expect(goalView({ goal: goal('complete'), activeTurnId: null }, 'native', true)?.actions).toEqual(['clear']);
    });

    test('a CLI that only reads `/goal` clears between turns, and never a goal it met', () => {
        expect(goalView({ goal: goal('paused'), activeTurnId: null }, 'command', true)?.actions).toEqual(['clear']);
        expect(goalView({ goal: goal('active'), activeTurnId: 'turn' }, 'command', true)?.actions).toEqual([]);
        expect(goalView({ goal: goal('complete'), activeTurnId: null }, 'command', true)?.actions).toEqual([]);
    });

    test('a host without the action, or a CLI without goals, shows the goal and offers nothing', () => {
        expect(goalView({ goal: goal('active'), activeTurnId: 'turn' }, 'native', false)?.actions).toEqual([]);
        expect(goalView({ goal: goal('active'), activeTurnId: 'turn' }, undefined, true)?.actions).toEqual([]);
    });
});
