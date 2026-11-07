import { describe, it, expect } from 'bun:test';
import { BLANK_STATE } from '../src/constants/initialData';
import {
  applyStudyRecordCorrection,
  applyMovePlansToDate,
  applyEditBook,
  applyEditCourse,
  applyUpdateWrongRecord,
  applyUpdateSubjectLabel,
  applyStartTimer,
  applyPauseTimer,
  applyCompletePlan,
} from '../src/utils/workflowMutators';
import { getCompletionSummary, getActiveCountdownsForReminder } from '../src/utils/workflowPresentation';
import { getSubjectLabel } from '../src/types';
import type { AppState, StudyRecordCorrectionInput } from '../src/types';
import { validateStudyExtensions } from '../src/utils/studyExtensions';
import { buildGuestMigration } from '../src/utils/guestMigration';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { validateWorkspacePayload } from '../server/workspace';
import { STUDY_SUBJECTS, getSubjectOptions } from '../src/types';

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

  it('moves unfinished historical plans to today while preserving accumulated time', () => {
    const state = fixture();
    state.plans = [
      {
        id: 'p_hist',
        libraryId: 'lib_b',
        name: '2027图形推理700题',
        type: 'book',
        sourceId: 'b',
        subject: '判断推理',
        date: '2026-11-03',
        plannedMinutes: 30,
        actualMinutes: 20,
        done: false,
        archived: true,
        timerStart: 0,
        accumulatedMs: 20 * 60 * 1000,
      },
    ];
    const moved = applyMovePlansToDate(state, ['p_hist'], '2026-11-04');
    expect('nextState' in moved && moved.value).toBe(1);
    expect(state.plans[0].date).toBe('2026-11-04');
    expect(state.plans[0].archived).toBe(false);
    expect(state.plans[0].accumulatedMs).toBe(20 * 60 * 1000);
    expect(state.plans[0].actualMinutes).toBe(20);
  });

  it('transfers book and course categories and cascades subject to library, plans, records, and wrong records', () => {
    const state = fixture();
    state.library = [
      { id: 'lib_b', name: 'Book', type: 'book', subject: '判断推理', sourceId: 'b' },
      { id: 'lib_c', name: 'Course', type: 'course', subject: '申论', sourceId: 'c' },
    ];
    state.plans = [
      { id: 'p_b', libraryId: 'lib_b', name: 'Book', type: 'book', sourceId: 'b', subject: '判断推理', date: '2026-10-28', plannedMinutes: 30, done: false, timerStart: 0 },
      { id: 'p_c', libraryId: 'lib_c', name: 'Course', type: 'course', sourceId: 'c', subject: '申论', date: '2026-10-28', plannedMinutes: 40, done: false, timerStart: 0 },
    ];
    state.wrong = [
      { id: 'w_1', bookId: 'b', subject: '判断推理', date: '2026-10-28', note: 'note', image: 'media:w1' },
    ];

    const bookRes = applyEditBook(state, 'b', { subject: '资料分析' });
    expect('error' in bookRes).toBe(false);
    expect(state.books[0].subject).toBe('资料分析');
    expect(state.library[0].subject).toBe('资料分析');
    expect(state.plans[0].subject).toBe('资料分析');
    expect(state.records[0].subject).toBe('资料分析');
    expect(state.wrong[0].subject).toBe('资料分析');

    const courseRes = applyEditCourse(state, 'c', { subject: '面试' });
    expect('error' in courseRes).toBe(false);
    expect(state.courses[0].subject).toBe('面试');
    expect(state.library[1].subject).toBe('面试');
    expect(state.plans[1].subject).toBe('面试');
    expect(state.records[1].subject).toBe('面试');
  });

  it('transfers wrong question category and updates subject labels', () => {
    const state = fixture();
    state.wrong = [{ id: 'w_1', bookId: 'b', subject: '判断推理', date: '2026-10-28', note: 'old', image: 'media:w1' }];
    const wrongRes = applyUpdateWrongRecord(state, 'w_1', { subject: '言语理解', note: 'new note' });
    expect('error' in wrongRes).toBe(false);
    expect(state.wrong[0].subject).toBe('言语理解');
    expect(state.wrong[0].note).toBe('new note');

    const labelRes = applyUpdateSubjectLabel(state, '资料分析', '速算与资料');
    expect('error' in labelRes).toBe(false);
    expect(getSubjectLabel('资料分析', state.subjectLabels)).toBe('速算与资料');

    const resetRes = applyUpdateSubjectLabel(state, '资料分析', '');
    expect('error' in resetRes).toBe(false);
    expect(getSubjectLabel('资料分析', state.subjectLabels)).toBe('资料分析');
  });

  it('computes active countdown reminders sorted by days remaining', () => {
    const items = getActiveCountdownsForReminder(
      [
        { id: 'cd_past', name: '已过期考试', date: '2026-11-01' },
        { id: 'cd_later', name: '省考笔试', date: '2026-12-15' },
        { id: 'cd_soon', name: '国考笔试', date: '2026-11-29' },
      ],
      '2026-11-04'
    );
    expect(items.map(i => i.name)).toEqual(['国考笔试', '省考笔试']);
    expect(items[0].days).toBe(25);
  });

  it('rejects impossible migration dates atomically but accepts leap days', () => {
    for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '0000-01-01', '2026-13-01']) {
      const state = fixture(), before = structuredClone(state);
      expect('error' in applyMovePlansToDate(state, [], date)).toBe(true);
      expect(state).toEqual(before);
    }
    expect('nextState' in applyMovePlansToDate(fixture(), [], '2028-02-29')).toBe(true);
  });

  it('moves an unstarted plan with zero elapsed time instead of NaN', () => {
    const state = fixture();
    state.plans = [{ id: 'p', libraryId: '', name: 'Pending', type: 'custom', subject: '其他', date: '2026-11-03', plannedMinutes: 30, done: false, timerStart: 0 } as any];
    applyMovePlansToDate(state, ['p'], '2026-11-04');
    expect(state.plans[0].accumulatedMs).toBe(0);
    expect(state.plans[0].actualMinutes).toBe(0);
  });

  it('settles the old day before moving and continues timing without changing standalone sessions', () => {
    const state = fixture();
    const oldEnd = new Date('2026-11-04T00:00:00').getTime();
    const todayStart = new Date('2026-11-04T10:00:00').getTime();
    state.plans = [{ id: 'p', libraryId: '', name: 'Pending', type: 'book', sourceId: 'b', subject: '判断推理', date: '2026-11-03', plannedMinutes: 30, actualMinutes: 3, accumulatedMs: 185000, done: false, archived: true, timerStart: oldEnd - 60000 }];
    const session = { id: 'independent', subject: '判断推理', segments: [{ phase: 'focus', start: oldEnd - 60000, end: oldEnd }] };
    state.timerSessions = [session as any];
    expect('nextState' in applyMovePlansToDate(state, ['p', 'p', 'missing'], '2026-11-04', todayStart)).toBe(true);
    expect(state.plans[0]).toMatchObject({ accumulatedMs: 245000, actualMinutes: 4, archived: false, timerStart: 0 });
    applyStartTimer(state, 'p', todayStart);
    applyPauseTimer(state, 'p', todayStart + 55000);
    expect(state.plans[0].accumulatedMs).toBe(300000);
    applyCompletePlan(state, { type: 'book', planId: 'p', questions: 2, errors: 0, minutes: 5 }, todayStart + 55000);
    expect(state.records.at(-1)).toMatchObject({ date: '2026-11-04', minutes: 5 });
    expect(state.timerSessions).toEqual([session]);
  });

  it('validates a wrong record edit before changing its category or photos', () => {
    const state = fixture();
    state.wrong = [{
      id: 'w',
      bookId: 'b',
      subject: '判断推理',
      date: '2026-10-28',
      note: 'keep',
      image: 'media:w',
      images: ['media:w', 'media:w2'],
      imageOrientations: [{ status: 'resolved', rotation: 90, version: 1 }, { status: 'resolved', rotation: 180, version: 1 }]
    }];
    const before = structuredClone(state);
    expect('error' in applyUpdateWrongRecord(state, 'w', { subject: '其他', note: 'x'.repeat(2001) })).toBe(true);
    expect('error' in applyUpdateWrongRecord(state, 'w', { images: [] })).toBe(true);
    expect('error' in applyUpdateWrongRecord(state, 'w', { images: Array(10).fill('media:extra') })).toBe(true);
    expect('error' in applyUpdateWrongRecord(state, 'w', { images: ['   '] })).toBe(true);
    expect(state).toEqual(before);

    // Appending a third image preserves orientation of existing images and sets new one to null
    const res = applyUpdateWrongRecord(state, 'w', { images: ['media:w', 'media:w2', 'media:w3'] });
    expect('error' in res).toBe(false);
    expect(state.wrong[0].images).toEqual(['media:w', 'media:w2', 'media:w3']);
    expect(state.wrong[0].image).toBe('media:w');
    expect(state.wrong[0].imageOrientations).toEqual([
      { status: 'resolved', rotation: 90, version: 1 },
      { status: 'resolved', rotation: 180, version: 1 },
      null
    ]);
  });

  it('rejects non-plain or overlong category label payloads', () => {
    for (const labels of [new Date(), Object.assign(Object.create({ inherited: true }), { 其他: 'Other' }), { 其他: ` ${'x'.repeat(20)} ` }]) {
      const state = fixture(); state.version = 4; state.subjectLabels = labels as any;
      expect(validateStudyExtensions(state)).not.toBeNull();
    }
  });

  it('keeps guest labels during migration while account labels win conflicts', () => {
    const account = fixture(), guest = structuredClone(BLANK_STATE);
    account.subjectLabels = { 资料分析: 'Account' }; account.version = 4;
    guest.subjectLabels = { 资料分析: 'Guest', 其他: '自习' }; guest.version = 4;
    expect(buildGuestMigration(account, guest).mergedState.subjectLabels).toEqual({ 资料分析: 'Account', 其他: '自习' });
  });

  it('ignores impossible countdown dates and counts calendar days across daylight saving changes', () => {
    expect(getActiveCountdownsForReminder([{ id: 'bad', name: 'Bad', date: '2027-02-30' }], '2027-02-01')).toEqual([]);
    expect(getActiveCountdownsForReminder([{ id: 'ok', name: 'Ok', date: '2027-03-01' }], '2027-02-30')).toEqual([]);
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(getActiveCountdownsForReminder([{ id: 'dst', name: 'DST', date: '2026-11-02' }], '2026-11-01')[0].days).toBe(1);
    } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });

  it('changes only the terminal session minutes and adjusts the whole-plan total by the delta', () => {
    const state = fixture();
    state.records[0].sessionId = 's';
    state.records.unshift({ ...state.records[0], id: 'split', date: '2026-10-27', questions: 0, errors: 0, minutes: 10 });
    state.plans = [{ id: 'p', recordId: 'r', sessionId: 's', type: 'book', sourceId: 'b', date: '2026-10-28', name: 'Book', subject: '判断推理', libraryId: '', plannedMinutes: 40, actualMinutes: 40, accumulatedMs: 2400001, done: true, timerStart: 0 }];
    const split = structuredClone(state.records[0]);
    expect('nextState' in applyStudyRecordCorrection(state, { ...correction(), minutes: 35, expected: { ...correction().expected, minutes: 30 } })).toBe(true);
    expect(state.records[0]).toEqual(split);
    expect(state.records[1].minutes).toBe(35);
    expect(state.plans[0]).toMatchObject({ actualMinutes: 45, accumulatedMs: 2700001 });
    expect(state.books[0].minutes).toBe(65);
  });

  it('rejects stale duration drafts without overwriting changed minutes', () => {
    const state = fixture(), before = structuredClone(state);
    expect('error' in applyStudyRecordCorrection(state, { ...correction(), minutes: 35, expected: { questions: 20, errors: 12, minutes: 29 } })).toBe(true);
    expect(state).toEqual(before);
  });

  it('round-trips all nine labels through sync validation, portable backups and stable-key selectors', () => {
    const state = fixture();
    for (const subject of STUDY_SUBJECTS) expect('nextState' in applyUpdateSubjectLabel(state, subject, `新${subject}`)).toBe(true);
    expect(validateWorkspacePayload(state, state.version).valid).toBe(true);
    for (const payload of [state, { version: 1, state }]) {
      const backup = validateAndMigrateBackup(JSON.stringify(payload));
      expect(backup.valid).toBe(true);
      expect(backup.migratedState?.subjectLabels).toEqual(state.subjectLabels);
      expect(backup.migratedState?.records).toEqual(state.records);
    }
    expect(getSubjectOptions(state.subjectLabels, true).map(option => option.value)).toEqual([...STUDY_SUBJECTS]);
    expect(getSubjectOptions(state.subjectLabels, true).map(option => option.label)).toEqual(STUDY_SUBJECTS.map(subject => `新${subject}`));
    const invalid = { ...state, subjectLabels: { 综合: 'Invalid' } };
    expect(validateWorkspacePayload(invalid, state.version).valid).toBe(false);
    expect(validateAndMigrateBackup(JSON.stringify(invalid)).valid).toBe(false);
  });
});
