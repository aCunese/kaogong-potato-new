import { describe, it, expect } from 'bun:test';
import { BLANK_STATE } from '../src/constants/initialData';
import { applyStudyRecordCorrection } from '../src/utils/workflowMutators';
import { getCompletionSummary } from '../src/utils/workflowPresentation';
import type { AppState, StudyRecordCorrectionInput } from '../src/types';

function fixture(): AppState {
  const state = structuredClone(BLANK_STATE);
  state.books = [{ id: 'b', name: 'Book', subject: '判断推理', total: 700, pages: 0, done: 40, errors: 15, minutes: 60 }];
  state.courses = [{ id: 'c', name: 'Course', subject: '申论', totalLessons: 10, completedLessons: 10, minutes: 100, url: '' }];
  state.records = [
    { id: 'r', planId: 'p', type: 'book', sourceId: 'b', subject: '判断推理', date: '2026-10-28', minutes: 30, questions: 20, errors: 12 },
    { id: 'rc', planId: 'pc', type: 'course', sourceId: 'c', subject: '申论', date: '2026-10-28', minutes: 40, questions: 0, errors: 0, lessons: 3 },
  ];
  return state;
}
const correction = (): StudyRecordCorrectionInput => ({ recordId: 'r', type: 'book', questions: 20, errors: 2, expected: { questions: 20, errors: 12 } });
describe('saved registration correction', () => {
  it('corrects screenshot errors atomically without adding records or changing duration', () => {
    const state = fixture(), old = structuredClone(state.records[0]);
    const result = applyStudyRecordCorrection(state, correction());
    expect('nextState' in result).toBe(true);
    expect(state.books[0]).toMatchObject({ done: 40, errors: 5, minutes: 60 });
    expect(state.records).toHaveLength(2);
    expect(state.records[0]).toEqual({ ...old, errors: 2 });
    expect(getCompletionSummary(state.records[0])).toContain('90%');
  });
  it('allows correcting a lesson registration when its course is already complete', () => {
    const state = fixture();
    expect('nextState' in applyStudyRecordCorrection(state, { recordId: 'rc', type: 'course', lessons: 2, expected: { lessons: 3 } })).toBe(true);
    expect(state.courses[0]).toMatchObject({ completedLessons: 9, minutes: 100 });
    expect(state.records[1].lessons).toBe(2);
  });
  it('rejects invalid quantities and stale drafts without partial writes', () => {
    for (const input of [
      { ...correction(), errors: 21 }, { ...correction(), questions: 0 }, { ...correction(), questions: 2.5 },
      { ...correction(), expected: { questions: 20, errors: 3 } },
      { recordId: 'rc', type: 'course', lessons: 4, expected: { lessons: 3 } },
    ] as StudyRecordCorrectionInput[]) {
      const state = fixture(), before = structuredClone(state);
      expect('error' in applyStudyRecordCorrection(state, input)).toBe(true);
      expect(state).toEqual(before);
    }
  });
  it('preserves sourceApplied=false counters, deleted sources and wrong photos', () => {
    const state = fixture();
    state.records[0].sourceApplied = false;
    state.wrong = [{ id: 'w', bookId: 'b', date: '2026-10-28', note: 'keep', image: 'media:w' }];
    applyStudyRecordCorrection(state, correction());
    expect(state.books[0].errors).toBe(15);
    expect(state.wrong).toHaveLength(1);
    const deleted = fixture(); deleted.books = [];
    expect('nextState' in applyStudyRecordCorrection(deleted, correction())).toBe(true);
    expect(deleted.records[0].errors).toBe(2);
  });
  it('rejects inconsistent source counters instead of clamping them', () => {
    const state = fixture(); state.books[0].errors = 1;
    const before = structuredClone(state);
    expect('error' in applyStudyRecordCorrection(state, correction())).toBe(true);
    expect(state).toEqual(before);
  });
  it('rejects a contradictory residual so a successful correction can still be reversed', () => {
    const state = fixture(); state.books[0].done = 20; state.books[0].errors = 15;
    const before = structuredClone(state);
    expect('error' in applyStudyRecordCorrection(state, correction())).toBe(true);
    expect(state).toEqual(before);
  });
  it('edits only the terminal quantity record of a cross-day session', () => {
    const state = fixture();
    state.records[0].sessionId = 's';
    state.records.unshift({ ...state.records[0], id: 'split', date: '2026-10-27', questions: 0, errors: 0, minutes: 10 });
    state.plans = [{ id: 'p', recordId: 'r', sessionId: 's', type: 'book', sourceId: 'b', date: '2026-10-28', name: 'Book', subject: '判断推理', libraryId: '', plannedMinutes: 40, actualMinutes: 40, done: true, timerStart: 0 }];
    const before = structuredClone(state.records[0]);
    expect('error' in applyStudyRecordCorrection(state, { ...correction(), recordId: 'split', expected: { questions: 0, errors: 0 } })).toBe(true);
    expect('nextState' in applyStudyRecordCorrection(state, correction())).toBe(true);
    expect(state.records[0]).toEqual(before);
    expect(state.plans[0].actualMinutes).toBe(40);
  });
  it('keeps repeated practice beyond book size compatible', () => {
    const state = fixture(); state.books[0].total = 30;
    expect('nextState' in applyStudyRecordCorrection(state, { ...correction(), questions: 30 })).toBe(true);
    expect(state.books[0].done).toBe(50);
  });
});
