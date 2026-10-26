import { describe, it, expect, beforeEach } from 'bun:test';
import { AppState, Book, Course, Plan, CompletionInput } from '../src/types';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import {
  commitMutation,
  loadLatestState,
  _resetInMemoryStore,
} from '../src/utils/db';
import {
  applyStartTimer,
  applyPauseTimer,
  applyCompletePlan,
  applyAddPlan,
  applyQuickAddPlan,
  applyDeletePlan,
  applyAddBook,
  applyEditBook,
  applyDeleteBook,
  applyAddCourse,
  applyEditCourse,
  applyDeleteCourse,
  applyAddCustomItem,
  applyDeleteCustomItem,
  applyUpdateLibraryMinutes,
} from '../src/utils/workflowMutators';

function createTestState(): AppState {
  const books: Book[] = [
    {
      id: 'book-1',
      name: '资料分析高分题库',
      subject: '资料分析',
      total: 1000,
      pages: 300,
      done: 100,
      errors: 15,
      minutes: 120,
    },
  ];

  const courses: Course[] = [
    {
      id: 'course-1',
      name: '申论系统精讲课',
      subject: '申论',
      totalLessons: 20,
      completedLessons: 5,
      minutes: 250,
      url: 'https://example.com/course-1',
    },
  ];

  const library = buildLibraryFromSources(books, courses, []);

  const plans: Plan[] = [
    {
      id: 'plan-book-1',
      date: '2026-10-26',
      libraryId: 'lib-book-book-1',
      name: '资料分析高分题库',
      type: 'book',
      sourceId: 'book-1',
      subject: '资料分析',
      plannedMinutes: 30,
      actualMinutes: 0,
      accumulatedMs: 0,
      done: false,
      timerStart: 0,
    },
    {
      id: 'plan-course-1',
      date: '2026-10-26',
      libraryId: 'lib-course-course-1',
      name: '申论系统精讲课',
      type: 'course',
      sourceId: 'course-1',
      subject: '申论',
      plannedMinutes: 45,
      actualMinutes: 0,
      accumulatedMs: 0,
      done: false,
      timerStart: 0,
    },
    {
      id: 'plan-custom-1',
      date: '2026-10-26',
      libraryId: 'lib-custom-1',
      name: '晨读人民日报时评',
      type: 'custom',
      sourceId: '',
      subject: '申论',
      plannedMinutes: 20,
      actualMinutes: 0,
      accumulatedMs: 0,
      done: false,
      timerStart: 0,
    },
  ];

  return {
    profile: { name: '测试学员', username: 'tester', avatar: 'pose-1' },
    countdowns: [
      { id: 'exam-national', name: '国家公务员考试', date: '2026-11-29' },
      { id: 'exam-provincial', name: '省级公务员联考', date: '2027-03-15' },
      { id: 'exam-public-service', name: '事业单位统考', date: '2027-05-20' },
    ],
    books,
    courses,
    library,
    plans,
    records: [],
    wrong: [],
    version: 3,
  };
}

describe('Milestone 2: Millisecond Precision Timing & Idempotence', () => {
  let state: AppState;

  beforeEach(() => {
    state = createTestState();
  });

  it('Test 45s pause retains 45s (accumulatedMs = 45000, actualMinutes = 0)', () => {
    const t0 = 1000000;
    // 1. Start timer at t0
    const startRes = applyStartTimer(state, 'plan-book-1', t0);
    expect('nextState' in startRes).toBe(true);
    const planAfterStart = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(planAfterStart.timerStart).toBe(t0);

    // 2. Pause timer at t0 + 45s (45,000 ms)
    const t45 = t0 + 45000;
    const pauseRes = applyPauseTimer(state, 'plan-book-1', t45);
    expect('nextState' in pauseRes).toBe(true);

    const planAfterPause = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(planAfterPause.timerStart).toBe(0);
    // Crucial: exactly 45000 ms, not rounded up to 60000 ms!
    expect(planAfterPause.accumulatedMs).toBe(45000);
    expect(planAfterPause.actualMinutes).toBe(0);
  });

  it('Test 90s pause + 30s run = 120s exact (accumulatedMs = 120000, actualMinutes = 2)', () => {
    const t0 = 2000000;
    // 1. Start timer at t0
    applyStartTimer(state, 'plan-book-1', t0);

    // 2. Pause after 90 seconds (90,000 ms)
    const t90 = t0 + 90000;
    applyPauseTimer(state, 'plan-book-1', t90);

    let plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.accumulatedMs).toBe(90000);
    expect(plan.actualMinutes).toBe(1);
    expect(plan.timerStart).toBe(0);

    // 3. Resume timer at t1 (e.g. 5 minutes later)
    const t1 = t90 + 300000;
    applyStartTimer(state, 'plan-book-1', t1);
    plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.timerStart).toBe(t1);
    expect(plan.accumulatedMs).toBe(90000); // previous 90s preserved

    // 4. Run for another 30s and pause at t1 + 30000
    const t1_30 = t1 + 30000;
    applyPauseTimer(state, 'plan-book-1', t1_30);

    plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.timerStart).toBe(0);
    // 90000 + 30000 = 120000 ms = exactly 2 minutes
    expect(plan.accumulatedMs).toBe(120000);
    expect(plan.actualMinutes).toBe(2);
  });

  it('startTimer is idempotent: if timerStart > 0, returns ok without modifying timestamp', () => {
    const t0 = 3000000;
    applyStartTimer(state, 'plan-book-1', t0);
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.timerStart).toBe(t0);

    // Second call at t0 + 5000
    const secondCall = applyStartTimer(state, 'plan-book-1', t0 + 5000);
    expect('nextState' in secondCall).toBe(true);
    // Timestamp must NOT be overwritten!
    expect(plan.timerStart).toBe(t0);
  });

  it('pauseTimer is idempotent: if timerStart === 0, returns ok without modifying accumulatedMs', () => {
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    plan.accumulatedMs = 45000;
    plan.timerStart = 0;

    const res = applyPauseTimer(state, 'plan-book-1', 4000000);
    expect('nextState' in res).toBe(true);
    expect(plan.accumulatedMs).toBe(45000);
    expect(plan.timerStart).toBe(0);
  });

  it('startTimer rejects on already completed plan', () => {
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    plan.done = true;

    const res = applyStartTimer(state, 'plan-book-1', 5000000);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('PLAN_ALREADY_DONE');
    }
  });

  it('timer math in FocusModal display accurately computes mm:ss for both running and paused', () => {
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    plan.accumulatedMs = 45000; // 45 seconds paused
    plan.timerStart = 0;

    const isRunning = plan.timerStart > 0;
    const totalElapsedMs = (plan.accumulatedMs || 0) + (isRunning ? Math.max(0, Date.now() - plan.timerStart) : 0);
    const totalSeconds = Math.floor(totalElapsedMs / 1000);
    const displayMinutes = Math.floor(totalSeconds / 60);
    const displaySeconds = totalSeconds % 60;
    const formattedTime = `${String(displayMinutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;

    expect(formattedTime).toBe('00:45');
  });
});

describe('Milestone 2: Unified Atomic Plan Completion (completePlan)', () => {
  let state: AppState;

  beforeEach(() => {
    state = createTestState();
  });

  it('atomic completePlan for book updates book done, errors, minutes, marks plan done, creates StudyRecord', () => {
    const bookBefore = state.books.find(b => b.id === 'book-1')!;
    const initialDone = bookBefore.done; // 100
    const initialErrors = bookBefore.errors; // 15
    const initialMinutes = bookBefore.minutes; // 120

    const input: CompletionInput = {
      type: 'book',
      planId: 'plan-book-1',
      questions: 30,
      errors: 6,
      minutes: 35,
    };

    const res = applyCompletePlan(state, input, 999999);
    expect('nextState' in res).toBe(true);
    if (!('nextState' in res)) return;

    // 1. Plan updated atomically
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.done).toBe(true);
    expect(plan.timerStart).toBe(0);
    expect(plan.actualMinutes).toBe(35);
    expect(plan.accumulatedMs).toBe(35 * 60000);
    expect(plan.recordId).toBeDefined();

    // 2. Book totals updated atomically
    const bookAfter = state.books.find(b => b.id === 'book-1')!;
    expect(bookAfter.done).toBe(initialDone + 30);
    expect(bookAfter.errors).toBe(initialErrors + 6);
    expect(bookAfter.minutes).toBe(initialMinutes + 35);

    // 3. StudyRecord created atomically
    expect(state.records.length).toBe(1);
    const record = state.records[0];
    expect(record.planId).toBe('plan-book-1');
    expect(record.type).toBe('book');
    expect(record.sourceId).toBe('book-1');
    expect(record.subject).toBe('资料分析');
    expect(record.questions).toBe(30);
    expect(record.errors).toBe(6);
    expect(record.minutes).toBe(35);
    expect(record.date).toBe('2026-10-26');
    expect(res.value.recordId).toBe(record.id);
  });

  it('completePlan rejects duplicate completion on already done plan', () => {
    const input: CompletionInput = {
      type: 'book',
      planId: 'plan-book-1',
      questions: 20,
      errors: 2,
      minutes: 25,
    };

    // First completion
    const firstRes = applyCompletePlan(state, input);
    expect('nextState' in firstRes).toBe(true);

    // Second completion on same plan
    const secondRes = applyCompletePlan(state, input);
    expect('error' in secondRes).toBe(true);
    if ('error' in secondRes) {
      expect(secondRes.error.code).toBe('NOT_FOUND');
      expect(secondRes.error.message).toContain('计划未找到或已完成');
    }
  });

  it('completePlan rejects when errors > questions for book', () => {
    const input: CompletionInput = {
      type: 'book',
      planId: 'plan-book-1',
      questions: 10,
      errors: 15, // errors > questions
      minutes: 20,
    };

    const res = applyCompletePlan(state, input);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('INVALID_ERRORS');
      expect(res.error.message).toContain('错题数不能大于做题总数');
    }
  });

  it('completePlan rejects course lesson overflow (lessons > totalLessons - completedLessons)', () => {
    const course = state.courses.find(c => c.id === 'course-1')!;
    // total = 20, completed = 5, remaining = 15
    expect(course.totalLessons - course.completedLessons).toBe(15);

    const input: CompletionInput = {
      type: 'course',
      planId: 'plan-course-1',
      lessons: 16, // exceeds 15
      minutes: 40,
    };

    const res = applyCompletePlan(state, input);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('LESSONS_OVERFLOW');
      expect(res.error.message).toContain('完成讲数超过剩余未学讲数');
    }

    // Ensure state untouched
    expect(course.completedLessons).toBe(5);
    const plan = state.plans.find(p => p.id === 'plan-course-1')!;
    expect(plan.done).toBe(false);
  });

  it('completePlan successfully updates course when lessons within limit', () => {
    const course = state.courses.find(c => c.id === 'course-1')!;
    const initialCompleted = course.completedLessons; // 5
    const initialMinutes = course.minutes; // 250

    const input: CompletionInput = {
      type: 'course',
      planId: 'plan-course-1',
      lessons: 3,
      minutes: 50,
    };

    const res = applyCompletePlan(state, input);
    expect('nextState' in res).toBe(true);

    expect(course.completedLessons).toBe(initialCompleted + 3);
    expect(course.minutes).toBe(initialMinutes + 50);

    const plan = state.plans.find(p => p.id === 'plan-course-1')!;
    expect(plan.done).toBe(true);

    const record = state.records[0];
    expect(record.type).toBe('course');
    expect(record.lessons).toBe(3);
    expect(record.minutes).toBe(50);
  });

  it('completePlan rejects plan completion if source book was deleted', () => {
    // Delete source book from state
    state.books = [];

    const input: CompletionInput = {
      type: 'book',
      planId: 'plan-book-1',
      questions: 10,
      errors: 1,
      minutes: 15,
    };

    const res = applyCompletePlan(state, input);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('SOURCE_DELETED');
      expect(res.error.message).toContain('关联题本已被删除');
    }

    // Plan remains unfinished
    const plan = state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.done).toBe(false);
    expect(state.records.length).toBe(0);
  });

  it('completePlan rejects plan completion if source course was deleted', () => {
    // Delete source course from state
    state.courses = [];

    const input: CompletionInput = {
      type: 'course',
      planId: 'plan-course-1',
      lessons: 1,
      minutes: 20,
    };

    const res = applyCompletePlan(state, input);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('SOURCE_DELETED');
      expect(res.error.message).toContain('关联课程已被删除');
    }

    const plan = state.plans.find(p => p.id === 'plan-course-1')!;
    expect(plan.done).toBe(false);
  });

  it('completePlan completes custom plan without requiring source book or course', () => {
    const input: CompletionInput = {
      type: 'custom',
      planId: 'plan-custom-1',
      minutes: 25,
    };

    const res = applyCompletePlan(state, input);
    expect('nextState' in res).toBe(true);

    const plan = state.plans.find(p => p.id === 'plan-custom-1')!;
    expect(plan.done).toBe(true);
    expect(plan.actualMinutes).toBe(25);
    expect(plan.accumulatedMs).toBe(25 * 60000);

    const record = state.records[0];
    expect(record.type).toBe('custom');
    expect(record.minutes).toBe(25);
  });
});

describe('Milestone 2: Cross-day & Multi-day Task Attribution', () => {
  it('correctly includes unfinished cross-day plans with timer or accumulatedMs in today display', () => {
    const activeDate = '2026-10-26';

    const testPlans: Plan[] = [
      // 1. Today's plan (active)
      {
        id: 'plan-today-active',
        date: '2026-10-26',
        libraryId: 'lib-1',
        name: '今日计划1',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 30,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: 0,
      },
      // 2. Today's plan (done)
      {
        id: 'plan-today-done',
        date: '2026-10-26',
        libraryId: 'lib-2',
        name: '今日计划2-已做完',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 20,
        actualMinutes: 20,
        accumulatedMs: 20 * 60000,
        done: true,
        timerStart: 0,
      },
      // 3. Yesterday's plan, unfinished, with accumulated progress
      {
        id: 'plan-yesterday-progress',
        date: '2026-10-25',
        libraryId: 'lib-3',
        name: '昨天的题本-做了一半',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 40,
        actualMinutes: 15,
        accumulatedMs: 15 * 60000,
        done: false,
        timerStart: 0,
      },
      // 4. Yesterday's plan, unfinished, currently running across midnight
      {
        id: 'plan-yesterday-running',
        date: '2026-10-25',
        libraryId: 'lib-4',
        name: '跨夜刷题中',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 60,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: Date.now() - 3600000, // running for 1h
      },
      // 5. Yesterday's plan, already finished yesterday -> should NOT show in today
      {
        id: 'plan-yesterday-done',
        date: '2026-10-25',
        libraryId: 'lib-5',
        name: '昨天已完成计划',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 30,
        actualMinutes: 30,
        accumulatedMs: 30 * 60000,
        done: true,
        timerStart: 0,
      },
      // 6. Yesterday's plan, untouched (no timer, no progress) -> should NOT clutter today
      {
        id: 'plan-yesterday-untouched',
        date: '2026-10-25',
        libraryId: 'lib-6',
        name: '昨天没动过的计划',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 30,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: 0,
      },
      // 7. Tomorrow's plan -> should NOT show in today
      {
        id: 'plan-tomorrow',
        date: '2026-10-27',
        libraryId: 'lib-7',
        name: '明天计划',
        type: 'book',
        sourceId: 'b-1',
        subject: '资料分析',
        plannedMinutes: 30,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: 0,
      },
    ];

    const filterCriteria = (p: Plan) =>
      p.date === activeDate ||
      (!p.done && p.date < activeDate && (p.timerStart > 0 || ((p.accumulatedMs ?? 0) > 0)));

    const filtered = testPlans.filter(filterCriteria);
    const ids = filtered.map(p => p.id);

    expect(ids).toContain('plan-today-active');
    expect(ids).toContain('plan-today-done');
    expect(ids).toContain('plan-yesterday-progress');
    expect(ids).toContain('plan-yesterday-running');

    expect(ids).not.toContain('plan-yesterday-done');
    expect(ids).not.toContain('plan-yesterday-untouched');
    expect(ids).not.toContain('plan-tomorrow');
  });

  it('completing a cross-day plan attributes the StudyRecord to the original plan date', () => {
    const state = createTestState();
    // Add yesterday's plan
    state.plans.push({
      id: 'plan-cross-day-1',
      date: '2026-10-24',
      libraryId: 'lib-book-book-1',
      name: '跨日题本练习',
      type: 'book',
      sourceId: 'book-1',
      subject: '资料分析',
      plannedMinutes: 30,
      actualMinutes: 15,
      accumulatedMs: 15 * 60000,
      done: false,
      timerStart: 0,
    });

    const res = applyCompletePlan(state, {
      type: 'book',
      planId: 'plan-cross-day-1',
      questions: 20,
      errors: 3,
      minutes: 20,
    });

    expect('nextState' in res).toBe(true);
    const record = state.records.find(r => r.planId === 'plan-cross-day-1')!;
    expect(record).toBeDefined();
    // Record date strictly preserves the plan's original date '2026-10-24'
    expect(record.date).toBe('2026-10-24');
  });
});

describe('Milestone 2: Library & Entity Lifecycle Management', () => {
  let state: AppState;

  beforeEach(() => {
    state = createTestState();
  });

  it('permanently deletes custom library item without resurrection on buildLibraryFromSources', () => {
    // 1. Add custom item
    const addRes = applyAddCustomItem(state, '时政热点精读', '常识判断', 25);
    expect('nextState' in addRes).toBe(true);
    if (!('nextState' in addRes)) return;
    const customId = addRes.value.id;
    expect(state.library.some(l => l.id === customId)).toBe(true);

    // 2. Delete custom item
    applyDeleteCustomItem(state, customId);
    expect(state.library.some(l => l.id === customId)).toBe(false);

    // 3. Re-reconcile library via buildLibraryFromSources
    state.library = buildLibraryFromSources(state.books, state.courses, state.library);
    // Must NOT resurrect the deleted custom item!
    expect(state.library.some(l => l.id === customId)).toBe(false);
  });

  it('adding, editing, and deleting books reconciles library 1-to-1', () => {
    // Add
    const addRes = applyAddBook(state, {
      name: '判断推理精选',
      subject: '判断推理',
      total: 500,
      pages: 150,
      done: 0,
      errors: 0,
      minutes: 0,
    });
    expect('nextState' in addRes).toBe(true);
    if (!('nextState' in addRes)) return;
    const newBookId = addRes.value;

    const libItem = state.library.find(l => l.sourceId === newBookId);
    expect(libItem).toBeDefined();
    expect(libItem?.name).toBe('判断推理精选');

    // Edit
    applyEditBook(state, newBookId, { name: '判断推理精选（重印版）' });
    const updatedLibItem = state.library.find(l => l.sourceId === newBookId);
    expect(updatedLibItem?.name).toBe('判断推理精选（重印版）');

    // Delete
    applyDeleteBook(state, newBookId);
    expect(state.books.some(b => b.id === newBookId)).toBe(false);
    expect(state.library.some(l => l.sourceId === newBookId)).toBe(false);
  });

  it('adding, editing, and deleting courses reconciles library 1-to-1', () => {
    const addRes = applyAddCourse(state, {
      name: '言语理解技巧强化',
      subject: '言语理解',
      totalLessons: 12,
      completedLessons: 0,
      minutes: 0,
      url: 'https://example.com/course-verbal',
    });
    expect('nextState' in addRes).toBe(true);
    if (!('nextState' in addRes)) return;
    const newCourseId = addRes.value;

    const libItem = state.library.find(l => l.sourceId === newCourseId);
    expect(libItem).toBeDefined();
    expect(libItem?.name).toBe('言语理解技巧强化');

    // Edit
    applyEditCourse(state, newCourseId, { name: '言语理解深度技巧班' });
    const updatedLibItem = state.library.find(l => l.sourceId === newCourseId);
    expect(updatedLibItem?.name).toBe('言语理解深度技巧班');

    // Delete
    applyDeleteCourse(state, newCourseId);
    expect(state.courses.some(c => c.id === newCourseId)).toBe(false);
    expect(state.library.some(l => l.sourceId === newCourseId)).toBe(false);
  });
});

describe('Milestone 2: End-to-End IndexedDB Persistence via commitMutation', () => {
  beforeEach(async () => {
    _resetInMemoryStore();
    // Seed initial state
    await commitMutation(async () => {
      return {
        nextState: createTestState(),
        value: true,
      };
    });
  });

  it('commitMutation persists millisecond timing and survives state reload', async () => {
    const t0 = 5000000;
    // 1. Start timer
    const startRes = await commitMutation(async draft => applyStartTimer(draft, 'plan-book-1', t0));
    expect(startRes.ok).toBe(true);

    // 2. Pause after 45s
    const pauseRes = await commitMutation(async draft => applyPauseTimer(draft, 'plan-book-1', t0 + 45000));
    expect(pauseRes.ok).toBe(true);

    // 3. Reload from DB
    const loaded = await loadLatestState();
    const plan = loaded.state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.accumulatedMs).toBe(45000);
    expect(plan.timerStart).toBe(0);
    expect(plan.actualMinutes).toBe(0);
  });

  it('commitMutation completes plan atomically and increments revision', async () => {
    const beforeLoad = await loadLatestState();
    const prevRev = beforeLoad.revision;

    const res = await commitMutation(async draft => {
      return applyCompletePlan(draft, {
        type: 'book',
        planId: 'plan-book-1',
        questions: 25,
        errors: 3,
        minutes: 30,
      });
    });

    expect(res.ok).toBe(true);

    const loaded = await loadLatestState();
    expect(loaded.revision).toBe(prevRev + 1);

    const plan = loaded.state.plans.find(p => p.id === 'plan-book-1')!;
    expect(plan.done).toBe(true);
    expect(plan.actualMinutes).toBe(30);

    const book = loaded.state.books.find(b => b.id === 'book-1')!;
    expect(book.done).toBe(125); // 100 + 25
    expect(book.errors).toBe(18); // 15 + 3
    expect(book.minutes).toBe(150); // 120 + 30

    expect(loaded.state.records.length).toBe(1);
  });
});
