import { describe, expect, it } from 'bun:test';
import { BLANK_STATE } from '../src/constants/initialData';
import { AppState, CompletionInput } from '../src/types';
import { applyCompletePlan } from '../src/utils/workflowMutators';

function createState(): AppState {
  const state = structuredClone(BLANK_STATE);
  state.books.push({ id: 'book', name: 'Book', subject: '资料分析', total: 100, pages: 10, done: 0, errors: 0, minutes: 0 });
  state.plans.push({ id: 'plan', date: '2026-10-26', libraryId: 'lib-book-book', name: 'Book', type: 'book', sourceId: 'book', subject: '资料分析', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0 });
  return state;
}

describe('Completion mutation rejects invalid data without changing state', () => {
  for (const minutes of [NaN, Infinity, 0, 1.5]) {
    it(`rejects invalid minutes ${minutes}`, () => {
      const state = createState();
      const before = structuredClone(state);
      const result = applyCompletePlan(state, { type: 'book', planId: 'plan', questions: 10, errors: 1, minutes });
      expect('error' in result).toBe(true);
      expect(state).toEqual(before);
    });
  }

  it('rejects non-finite or fractional counts', () => {
    for (const questions of [NaN, Infinity, 1.5]) {
      const state = createState();
      const before = structuredClone(state);
      const result = applyCompletePlan(state, { type: 'book', planId: 'plan', questions, errors: 0, minutes: 10 });
      expect('error' in result).toBe(true);
      expect(state).toEqual(before);
    }
  });

  it('does not let a different completion type bypass book progress updates', () => {
    const state = createState();
    const before = structuredClone(state);
    const input: CompletionInput = { type: 'custom', planId: 'plan', minutes: 10 };
    const result = applyCompletePlan(state, input);
    expect('error' in result).toBe(true);
    expect(state).toEqual(before);
  });
});
