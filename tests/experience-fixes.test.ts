import { describe, expect, it } from 'bun:test';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import * as workflow from '../src/utils/workflowMutators';
import { getPlanElapsedMs } from '../src/utils/workflowPresentation';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { validateWorkspacePayload } from '../server/workspace';
import type { AppState } from '../src/types';

const feature = workflow as any;
function fixture(): AppState {
  const state = structuredClone(BLANK_STATE);
  state.books = [{ id: 'b', name: 'Book', subject: '资料分析', total: 100, pages: 1, done: 3, errors: 1, minutes: 5 }];
  state.courses = [{ id: 'c', name: 'Course', subject: '资料分析', totalLessons: 10, completedLessons: 1, minutes: 15, url: '' }];
  state.library = buildLibraryFromSources(state.books, state.courses);
  workflow.applyAddPlan(state, 'lib-book-b', '2026-10-27', 30);
  return state;
}

describe('Experience: valid time and atomic reversals', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    it(`rejects explicit invalid planned minutes ${value} without defaulting`, () => {
      const state = fixture(); const before = structuredClone(state);
      expect('error' in workflow.applyAddPlan(state, 'lib-book-b', '2026-10-27', value)).toBe(true);
      expect(state).toEqual(before);
    });
  }
  it('reverses a completed book record once while preserving manual baseline and photos', () => {
    const s = fixture(); const id = s.plans[0].id;
    workflow.applyCompletePlan(s, { type: 'book', planId: id, questions: 20, errors: 4, minutes: 30 });
    s.wrong.push({ id: 'photo', bookId: 'b', date: '2026-10-27', note: 'Keep', image: '' });
    workflow.applyDeletePlan(s, id); workflow.applyDeletePlan(s, id);
    expect(s.books[0]).toMatchObject({ done: 3, errors: 1, minutes: 5 });
    expect(s.records).toHaveLength(0); expect(s.plans).toHaveLength(0); expect(s.wrong).toHaveLength(1);
  });
  it('reverses course lessons and minutes and also removes records when source is deleted', () => {
    const s = fixture(); const result = workflow.applyAddPlan(s, 'lib-course-c', '2026-10-27', 60);
    if ('error' in result) throw Error(result.error.message);
    workflow.applyCompletePlan(s, { type: 'course', planId: result.value.id, lessons: 2, minutes: 63 });
    workflow.applyDeletePlan(s, result.value.id);
    expect(s.courses[0]).toMatchObject({ completedLessons: 1, minutes: 15 });
    workflow.applyCompletePlan(s, { type: 'book', planId: s.plans[0].id, questions: 10, errors: 0, minutes: 30 });
    s.books = []; workflow.applyDeletePlan(s, s.plans[0].id); expect(s.records).toHaveLength(0);
  });
  it('rejects inconsistent manual counters without partly deleting anything', () => {
    const s = fixture(); const id = s.plans[0].id;
    workflow.applyCompletePlan(s, { type: 'book', planId: id, questions: 20, errors: 4, minutes: 30 });
    s.books[0].done = 1; const before = structuredClone(s);
    expect('error' in workflow.applyDeletePlan(s, id)).toBe(true); expect(s).toEqual(before);
  });
});

describe('Experience: independent dated todos and timers', () => {
  it('adds, toggles and deletes dated todos independently of plans/records', () => {
    const s = fixture(); const before = structuredClone(s);
    const added = feature.applyAddTodo(s, '  Read notes  ', '2026-10-27', 1234);
    expect(added.value.text).toBe('Read notes'); expect(s.version).toBe(4);
    feature.applyToggleTodo(s, added.value.id, 2345); expect((s as any).todos[0].completedAt).toBe(2345);
    feature.applyToggleTodo(s, added.value.id, 3456); expect((s as any).todos[0].done).toBe(false);
    feature.applyDeleteTodo(s, added.value.id); expect((s as any).todos).toEqual([]);
    expect(s.plans).toEqual(before.plans); expect(s.records).toEqual(before.records);
  });
  it('focus overtime counts, rest never counts, and next focus starts manually', () => {
    const s = fixture(); const p = s.plans[0]; const t = new Date('2026-10-27T10:00:00').getTime();
    feature.applyConfigureTimer(s, p.id, { timerMode: 'pomodoro', focusMinutes: 25, restMinutes: 5 });
    workflow.applyStartTimer(s, p.id, t);
    expect(getPlanElapsedMs(p, t + 30 * 60000)).toBe(30 * 60000);
    feature.applySwitchTimerPhase(s, p.id, 'rest', t + 30 * 60000);
    expect(getPlanElapsedMs(p, t + 40 * 60000)).toBe(30 * 60000);
    workflow.applyPauseTimer(s, p.id, t + 40 * 60000);
    expect(p.actualMinutes).toBe(30); expect((p as any).restStart).toBe(0);
    feature.applySwitchTimerPhase(s, p.id, 'focus', t + 50 * 60000);
    expect(getPlanElapsedMs(p, t + 51 * 60000)).toBe(31 * 60000);
  });
  it('caps background learning at the plan day midnight and archives without recording', () => {
    const s = fixture(); const p = s.plans[0]; const start = new Date('2026-10-27T23:50:00').getTime();
    workflow.applyStartTimer(s, p.id, start);
    expect(getPlanElapsedMs(p, new Date('2026-10-28T08:00:00').getTime())).toBe(10 * 60000);
    feature.applyArchiveOldPlans(s, '2026-10-28');
    expect(p.timerStart).toBe(0); expect(p.actualMinutes).toBe(10);
    expect(s.records).toHaveLength(0); expect(s.books[0].minutes).toBe(5);
    expect('error' in workflow.applyStartTimer(s, p.id, new Date('2026-10-28T09:00:00').getTime())).toBe(true);
  });
  it('persists all new fields through backup normalization and server validation', () => {
    const s = fixture(); feature.applyAddTodo(s, 'Todo', '2026-10-27', 1234);
    feature.applyConfigureTimer(s, s.plans[0].id, { timerMode: 'pomodoro', focusMinutes: 20, restMinutes: 3 });
    (s.plans[0] as any).plannedLessons = 2;
    const result = validateAndMigrateBackup(JSON.stringify(s));
    expect(result.valid).toBe(true); expect(result.migratedState).toEqual(s);
    expect(validateWorkspacePayload(s, 4).valid).toBe(true);
    expect(validateWorkspacePayload(s, 3).valid).toBe(false);
  });
});

it('produces foreground reminders even when the focus panel is closed', async () => {
  const timers = await import('../src/utils/studyTimers') as any;
  const s = fixture(); const p = s.plans[0]; const t = new Date('2026-10-27T10:00:00').getTime();
  feature.applyConfigureTimer(s, p.id, { timerMode: 'countdown', focusMinutes: 1, restMinutes: 5 });
  workflow.applyStartTimer(s, p.id, t);
  expect(timers.getTimerReminder(p, t + 61000)?.message).toContain('到点');
  expect(timers.getTimerReminder(p, t + 59000)).toBeUndefined();
});

it('deleting imported records does not reverse account counters that migration never increased', async () => {
  const { buildGuestMigration } = await import('../src/utils/guestMigration');
  const account = fixture(); account.plans = []; Object.assign(account.books[0], { done: 50, errors: 5, minutes: 100 }); Object.assign(account.courses[0], { completedLessons: 4, minutes: 100 });
  const guest = fixture(); const bookPlan = guest.plans[0];
  workflow.applyCompletePlan(guest, { type: 'book', planId: bookPlan.id, questions: 20, errors: 2, minutes: 30 });
  const addedCourse = workflow.applyAddPlan(guest, 'lib-course-c', '2026-10-27', 30);
  if ('error' in addedCourse) throw Error(addedCourse.error.message);
  workflow.applyCompletePlan(guest, { type: 'course', planId: addedCourse.value.id, lessons: 2, minutes: 30 });
  const { mergedState: merged } = buildGuestMigration(account, guest);
  const sourceBefore = structuredClone({ books: merged.books, courses: merged.courses });
  for (const plan of [...merged.plans]) expect('nextState' in workflow.applyDeletePlan(merged, plan.id)).toBe(true);
  expect(merged.books).toEqual(sourceBefore.books); expect(merged.courses).toEqual(sourceBefore.courses); expect(merged.records).toEqual([]);
  const { mergedState: portable } = buildGuestMigration(account, guest);
  const restored = validateAndMigrateBackup(JSON.stringify(portable));
  expect(restored.valid).toBe(true); expect(restored.migratedState?.records).toEqual(portable.records);
});

it('queued timer maintenance rechecks the current phase instead of pausing a new focus', async () => {
  const { commitMutation, loadLatestState, _resetInMemoryStore } = await import('../src/utils/db');
  _resetInMemoryStore();
  const s = fixture(); const p = s.plans[0]; const t = new Date('2026-10-27T10:00:00').getTime();
  feature.applyConfigureTimer(s, p.id, { timerMode: 'pomodoro', focusMinutes: 25, restMinutes: 5 });
  workflow.applyStartTimer(s, p.id, t); feature.applySwitchTimerPhase(s, p.id, 'rest', t + 25 * 60000);
  await commitMutation(() => ({ nextState: s, value: undefined }));
  const next = t + 31 * 60000;
  const results = await Promise.all([
    commitMutation(draft => feature.applySwitchTimerPhase(draft, p.id, 'focus', next)),
    commitMutation(draft => feature.applyMaintainTimers(draft, '2026-10-27', next)),
  ]);
  expect(results.every(r => r.ok)).toBe(true);
  const latest = (await loadLatestState()).state.plans[0];
  expect(latest.timerPhase).toBe('focus'); expect(latest.timerStart).toBe(next);
  _resetInMemoryStore();
});
