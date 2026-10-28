import {
  AppState,
  Book,
  Course,
  LibraryItem,
  Plan,
  StudyRecord,
  StudyRecordCorrectionInput,
  WrongRecord,
  StudySubject,
  isStudySubjectForType,
  Profile,
  CompletionInput,
  MediaRecord,
  TodoItem,
  TimerConfig,
  Countdown,
} from '../types';
import { learningElapsedMs, phaseElapsedMs, planDayEnd } from './studyTimers';
import { buildLibraryFromSources } from '../constants/initialData';

export type MutatorReturn<T> =
  | { nextState: AppState; value: T; newMedia?: MediaRecord[]; deletedMediaIds?: string[] }
  | { error: { code: string; message: string; field?: string } };

/** Correct quantities in place; timing, identity and photo archives retain their original values. */
export function applyStudyRecordCorrection(draft: AppState, input: StudyRecordCorrectionInput): MutatorReturn<StudyRecord> {
  const record = draft.records.find(r => r.id === input.recordId);
  if (!record) return { error: { code: 'NOT_FOUND', message: '这条学习登记已不存在，请刷新记录。' } };
  if (record.type !== input.type) return { error: { code: 'INVALID_INPUT', message: '登记类型不一致。' } };
  if (record.sessionId && !draft.plans.some(p => p.sessionId === record.sessionId && p.recordId === record.id)) {
    return { error: { code: 'TIME_ONLY_RECORD', message: '这是跨日用时分段，请修改该次学习结束日期的登记。' } };
  }
  if (input.type === 'book') {
    if (!Number.isSafeInteger(input.questions) || input.questions <= 0 || !Number.isSafeInteger(input.errors) || input.errors < 0 || input.errors > input.questions) {
      return { error: { code: 'INVALID_COUNTS', message: '做题数须为正整数，错题数须为不超过做题数的非负整数。' } };
    }
    if (!input.expected || record.questions !== input.expected.questions || record.errors !== input.expected.errors) {
      return { error: { code: 'RECORD_CHANGED', message: '这条登记已被修改，请重新打开后再编辑。' } };
    }
    const book = draft.books.find(b => b.id === record.sourceId);
    if (book && record.sourceApplied !== false) {
      const remainingDone = book.done - record.questions;
      const remainingErrors = book.errors - record.errors;
      const done = remainingDone + input.questions;
      const errors = remainingErrors + input.errors;
      if (![remainingDone, remainingErrors, done, errors].every(Number.isSafeInteger) || remainingDone < 0 || remainingErrors < 0 || remainingErrors > remainingDone || done < 0 || errors < 0 || errors > done) {
        return { error: { code: 'COUNTER_INCONSISTENT', message: '题本累计数据与登记不一致，请先校正题本累计数据。' } };
      }
      book.done = done;
      book.errors = errors;
    }
    record.questions = input.questions;
    record.errors = input.errors;
  } else {
    if (!Number.isSafeInteger(input.lessons) || input.lessons <= 0) return { error: { code: 'INVALID_LESSONS', message: '完成节数须为正整数。' } };
    const oldLessons = record.lessons ?? 0;
    if (!input.expected || oldLessons !== input.expected.lessons) return { error: { code: 'RECORD_CHANGED', message: '这条登记已被修改，请重新打开后再编辑。' } };
    const course = draft.courses.find(c => c.id === record.sourceId);
    if (course && record.sourceApplied !== false) {
      const completed = course.completedLessons - oldLessons + input.lessons;
      if (!Number.isSafeInteger(completed) || course.completedLessons < oldLessons || completed < 0 || completed > course.totalLessons) {
        return { error: { code: 'COUNTER_INCONSISTENT', message: '修正后的累计节数须在总节数范围内，请检查课程累计数据。' } };
      }
      course.completedLessons = completed;
    }
    record.lessons = input.lessons;
  }
  return { nextState: draft, value: record };
}

/**
 * Starts the positive timer on a plan.
 * Idempotent: If timerStart > 0, returns success without touching the timestamp.
 */
export function applyStartTimer(
  draft: AppState,
  planId: string,
  now: number = Date.now()
): MutatorReturn<void> {
  const plan = draft.plans.find(p => p.id === planId);
  if (!plan) {
    return { error: { code: 'NOT_FOUND', message: '计划未找到' } };
  }
  if (plan.archived || (draft.version >= 4 && now >= planDayEnd(plan))) {
    return { error: { code: 'PLAN_ARCHIVED', message: '昨天的日程已归档，请在今天新建日程；历史用时可补登记。' } };
  }
  if (plan.done) {
    return { error: { code: 'PLAN_ALREADY_DONE', message: '已完成的计划无法开始计时' } };
  }
  if (draft.timerSessions?.some(s => s.status === 'running') || draft.plans.some(p => p.id !== planId && !p.done && (p.timerStart > 0 || (p.restStart ?? 0) > 0))) return { error: { code: 'TIMER_BUSY', message: '请先暂停其他正在运行的计时。' } };
  if (plan.timerStart > 0) {
    // Idempotent: already running, do not modify timestamp
    return { nextState: draft, value: undefined };
  }
  if (plan.timerPhase === 'rest') {
    if ((plan.restStart ?? 0) > 0) return { nextState: draft, value: undefined };
    if (phaseElapsedMs(plan, now) >= (plan.restMinutes ?? 5) * 60000) {
      return { error: { code: 'REST_FINISHED', message: '休息已结束，请开始下一轮专注。' } };
    }
    plan.restStart = now;
  } else {
    plan.timerStart = now;
  }
  return { nextState: draft, value: undefined };
}

/**
 * Pauses the timer on a plan.
 * Idempotent: If timerStart === 0, returns success.
 * Accurately accumulates elapsed milliseconds without fractional pause minute inflation.
 */
export function applyPauseTimer(
  draft: AppState,
  planId: string,
  now: number = Date.now()
): MutatorReturn<void> {
  const plan = draft.plans.find(p => p.id === planId);
  if (!plan) {
    return { error: { code: 'NOT_FOUND', message: '计划未找到' } };
  }
  if (!plan.timerStart && !plan.restStart) return { nextState: draft, value: undefined };
  const elapsed = learningElapsedMs(plan, now);
  const phase = phaseElapsedMs(plan, now);
  plan.accumulatedMs = elapsed;
  plan.actualMinutes = Math.floor(elapsed / 60000);
  if (plan.timerMode) plan.phaseAccumulatedMs = phase;
  plan.timerStart = 0;
  if (plan.restStart !== undefined) plan.restStart = 0;

  return { nextState: draft, value: undefined };
}

/**
 * Atomic plan completion.
 * Updates source entity (book/course), marks plan done, and appends a StudyRecord in a single atomic transaction.
 */
export function applyCompletePlan(
  draft: AppState,
  input: CompletionInput,
  now: number = Date.now()
): MutatorReturn<{ recordId: string; record: StudyRecord }> {
  const plan = draft.plans.find(p => p.id === input.planId);
  if (!plan || plan.done) {
    return { error: { code: 'NOT_FOUND', message: '计划未找到或已完成' } };
  }

  if (input.type !== plan.type) {
    return { error: { code: 'INVALID_INPUT', message: '登记类型与计划类型不一致' } };
  }
  if (!Number.isSafeInteger(input.minutes) || input.minutes <= 0) {
    return { error: { code: 'INVALID_INPUT', message: '用时必须为大于0的整数分钟' } };
  }

  if (input.type === 'book') {
    if (!Number.isSafeInteger(input.questions) || !Number.isSafeInteger(input.errors) || input.questions <= 0 || input.errors < 0) {
      return { error: { code: 'INVALID_INPUT', message: '做题数必须为正整数，错题数必须为非负整数' } };
    }
    const sourceBook = draft.books.find(b => b.id === plan.sourceId);
    if (!sourceBook) {
      return {
        error: {
          code: 'SOURCE_DELETED',
          message: '关联题本已被删除，无法生成学习记录。建议直接移除该计划。',
        },
      };
    }
    if (input.errors > input.questions) {
      return { error: { code: 'INVALID_ERRORS', message: '错题数不能大于做题总数' } };
    }

    sourceBook.done += input.questions;
    sourceBook.errors += input.errors;
    sourceBook.minutes += input.minutes;
  } else if (input.type === 'course') {
    if (!Number.isSafeInteger(input.lessons) || input.lessons <= 0) {
      return { error: { code: 'INVALID_INPUT', message: '完成节数数必须为大于0的整数' } };
    }
    const sourceCourse = draft.courses.find(c => c.id === plan.sourceId);
    if (!sourceCourse) {
      return {
        error: {
          code: 'SOURCE_DELETED',
          message: '关联课程已被删除，无法生成学习记录。建议直接移除该计划。',
        },
      };
    }
    const remainingLessons = sourceCourse.totalLessons - sourceCourse.completedLessons;
    if (input.lessons > remainingLessons) {
      return {
        error: {
          code: 'LESSONS_OVERFLOW',
          message: '完成节数超过剩余未学节数',
        },
      };
    }

    sourceCourse.completedLessons += input.lessons;
    sourceCourse.minutes += input.minutes;
  }

  // Atomic state updates to the plan and creation of the StudyRecord
  const recordId = `rec-${now}-${Math.random().toString(36).slice(2, 6)}`;
  plan.done = true;
  plan.timerStart = 0;
  if (plan.restStart !== undefined) plan.restStart = 0;
  plan.actualMinutes = input.minutes;
  plan.accumulatedMs = input.minutes * 60000;
  plan.recordId = recordId;

  const record: StudyRecord = {
    id: recordId,
    planId: plan.id,
    date: plan.date, // Attributed to original plan date (supports cross-day completion)
    type: plan.type,
    sourceId: plan.sourceId || '',
    subject: plan.subject,
    minutes: input.minutes,
    questions: input.type === 'book' ? input.questions : 0,
    errors: input.type === 'book' ? input.errors : 0,
    lessons: input.type === 'course' ? input.lessons : undefined,
  };

  draft.records.push(record);
  return { nextState: draft, value: { recordId, record } };
}

/**
 * Adds a new plan from a library item.
 */
export function applyAddPlan(
  draft: AppState,
  libraryId: string,
  date: string,
  plannedMinutes?: number,
  plannedLessons?: number
): MutatorReturn<Plan> {
  const item = draft.library.find(l => l.id === libraryId);
  if (!item) {
    return { error: { code: 'LIBRARY_ITEM_NOT_FOUND', message: '事项库未找到该项目' } };
  }

  const mins = plannedMinutes === undefined ? item.defaultMinutes : plannedMinutes;
  if (!Number.isSafeInteger(mins) || mins <= 0) {
    return { error: { code: 'INVALID_MINUTES', message: '请填写大于0的整数分钟，空白或0不能加入日程。' } };
  }
  const lessons = plannedLessons ?? 1;
  if (item.type === 'course') {
    const course = draft.courses.find(c => c.id === item.sourceId);
    if (!course || !Number.isSafeInteger(lessons) || lessons <= 0 || lessons > course.totalLessons - course.completedLessons) {
      return { error: { code: 'INVALID_LESSONS', message: '计划节数必须为正整数，且不能超过剩余未学节数。' } };
    }
  }
  const newPlan: Plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    libraryId: item.id,
    name: item.name,
    type: item.type,
    sourceId: item.sourceId,
    subject: item.subject,
    plannedMinutes: mins,
    actualMinutes: 0,
    accumulatedMs: 0,
    done: false,
    timerStart: 0,
  };

  if (item.type === 'course') {
    newPlan.plannedLessons = lessons;
    draft.version = Math.max(draft.version, 4) as AppState['version'];
  }
  draft.plans.push(newPlan);
  return { nextState: draft, value: newPlan };
}

/** Creates a standalone custom plan without adding a reusable library item. */
export function applyAddCustomPlan(
  draft: AppState,
  name: string,
  subject: StudySubject,
  date: string,
  plannedMinutes: number
): MutatorReturn<Plan> {
  const title = name.trim();
  if (!title || title.length > 200) return { error: { code: 'INVALID_NAME', message: '请填写1至200字的事项名称。' } };
  if (!isStudySubjectForType(subject, 'custom')) return { error: { code: 'INVALID_SUBJECT', message: '请选择有效的所属科目。' } };
  if (!Number.isSafeInteger(plannedMinutes) || plannedMinutes <= 0) return { error: { code: 'INVALID_MINUTES', message: '请填写大于0的整数分钟。' } };
  const plan: Plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date, name: title, subject, type: 'custom', libraryId: '', sourceId: '',
    plannedMinutes, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0,
  };
  draft.plans.push(plan);
  return { nextState: draft, value: plan };
}

/**
 * Quickly adds a plan with default minutes.
 */
export function applyQuickAddPlan(
  draft: AppState,
  libraryId: string,
  date: string
): MutatorReturn<Plan> {
  return applyAddPlan(draft, libraryId, date);
}

/**
 * Deletes a plan by id.
 */
export function applyDeletePlan(draft: AppState, planId: string): MutatorReturn<void> {
  const plan = draft.plans.find(p => p.id === planId);
  if (!plan) return { nextState: draft, value: undefined };
  const records = draft.records.filter(r => r.planId === planId || r.id === plan.recordId);
  const books = structuredClone(draft.books);
  const courses = structuredClone(draft.courses);
  for (const record of records) {
    if (record.sourceApplied === false) continue;
    const source = record.type === 'book' ? books.find(b => b.id === record.sourceId)
      : record.type === 'course' ? courses.find(c => c.id === record.sourceId) : undefined;
    if (!source) continue;
    source.minutes -= record.minutes;
    if (record.type === 'book' && 'done' in source) {
      source.done -= record.questions;
      source.errors -= record.errors;
      if (source.done < 0 || source.errors < 0 || source.errors > source.done) {
        return { error: { code: 'COUNTER_INCONSISTENT', message: '题本累计数据曾被手动调整，与本次登记不一致；请先校正题本数据再撤销。' } };
      }
    } else if (record.type === 'course' && 'completedLessons' in source) {
      source.completedLessons -= record.lessons ?? 0;
      if (source.completedLessons < 0) return { error: { code: 'COUNTER_INCONSISTENT', message: '课程累计节数与登记不一致，请先校正课程数据。' } };
    }
    if (source.minutes < 0) return { error: { code: 'COUNTER_INCONSISTENT', message: '累计用时与登记不一致，请先校正数据再撤销。' } };
  }
  if (plan.sessionId) {
    const session = draft.timerSessions?.find(s => s.id === plan.sessionId);
    if (session) session.status = 'voided';
  }
  draft.books = books;
  draft.courses = courses;
  draft.records = draft.records.filter(r => !records.includes(r));
  draft.plans = draft.plans.filter(p => p.id !== planId);
  return { nextState: draft, value: undefined };
}

/**
 * Adds a new book and reconciles library.
 */
function validBookCounts(book: Pick<Book, 'total' | 'pages' | 'done' | 'errors'>) {
  return Number.isSafeInteger(book.total) && book.total > 0 && [book.pages, book.done, book.errors].every(n => Number.isSafeInteger(n) && n >= 0) && book.errors <= book.done;
}

export function applyAddBook(
  draft: AppState,
  bookData: Omit<Book, 'id'>
): MutatorReturn<string> {
  if (!validBookCounts(bookData)) return { error: { code: 'INVALID_COUNTS', message: '总题数须大于0，页数和累计题量须为非负整数，错题数不能超过已做题数。' } };
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newBook: Book = { ...bookData, id };
  draft.books.push(newBook);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: id };
}

/**
 * Edits an existing book and reconciles library.
 */
export function applyEditBook(
  draft: AppState,
  id: string,
  updates: Partial<Book>
): MutatorReturn<void> {
  const book = draft.books.find(b => b.id === id);
  if (!book) return { error: { code: 'NOT_FOUND', message: '题本未找到。' } };
  if (updates.minutes !== undefined && updates.minutes !== book.minutes) return { error: { code: 'READ_ONLY_DURATION', message: '累计用时由计时自动记录，不能手动修改。' } };
  if (!validBookCounts({ ...book, ...updates })) return { error: { code: 'INVALID_COUNTS', message: '请检查总题数、页数和累计题量。' } };
  draft.books = draft.books.map(b => b.id === id ? { ...b, ...updates } : b);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: undefined };
}

/**
 * Deletes a book and reconciles library.
 */
export function applyDeleteBook(draft: AppState, id: string): MutatorReturn<void> {
  draft.books = draft.books.filter(b => b.id !== id);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: undefined };
}

/**
 * Adds a new course and reconciles library.
 */
export function applyAddCourse(
  draft: AppState,
  courseData: Omit<Course, 'id'>
): MutatorReturn<string> {
  if (!Number.isSafeInteger(courseData.totalLessons) || courseData.totalLessons <= 0 || !Number.isSafeInteger(courseData.completedLessons) || courseData.completedLessons < 0 || courseData.completedLessons > courseData.totalLessons) return { error: { code: 'INVALID_LESSONS', message: '总节数必须大于0，已完成节数须为不超过总节数的非负整数。' } };
  const id = `course-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newCourse: Course = { ...courseData, id };
  draft.courses.push(newCourse);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: id };
}

/**
 * Edits an existing course and reconciles library.
 */
export function applyEditCourse(
  draft: AppState,
  id: string,
  updates: Partial<Course>
): MutatorReturn<void> {
  const course = draft.courses.find(c => c.id === id);
  if (!course) return { error: { code: 'NOT_FOUND', message: '课程未找到。' } };
  if (updates.minutes !== undefined && updates.minutes !== course.minutes) return { error: { code: 'READ_ONLY_DURATION', message: '累计用时由计时自动记录，不能手动修改。' } };
  const total = updates.totalLessons ?? course.totalLessons;
  const completed = updates.completedLessons ?? course.completedLessons;
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(completed) || completed < 0 || completed > total) return { error: { code: 'INVALID_LESSONS', message: '总节数必须大于0，已完成节数须为不超过总节数的非负整数。' } };
  draft.courses = draft.courses.map(c => c.id === id ? { ...c, ...updates } : c);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: undefined };
}

/**
 * Deletes a course and reconciles library.
 */
export function applyDeleteCourse(draft: AppState, id: string): MutatorReturn<void> {
  draft.courses = draft.courses.filter(c => c.id !== id);
  draft.library = buildLibraryFromSources(draft.books, draft.courses, draft.library);
  return { nextState: draft, value: undefined };
}

/**
 * Adds a custom library item.
 */
export function applyAddCustomItem(
  draft: AppState,
  name: string,
  subject: StudySubject,
  defaultMinutes: number
): MutatorReturn<LibraryItem> {
  if (!name.trim() || name.trim().length > 120 || !isStudySubjectForType(subject, 'custom')) return { error: { code: 'INVALID_INPUT', message: '请填写120字以内的事项名称，并选择有效科目。' } };
  if (!Number.isSafeInteger(defaultMinutes) || defaultMinutes <= 0) return { error: { code: 'INVALID_MINUTES', message: '默认时长必须为大于0的整数分钟。' } };
  const id = `lib-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newItem: LibraryItem = {
    id,
    type: 'custom',
    sourceId: '',
    name,
    subject,
    defaultMinutes: Math.max(1, defaultMinutes),
  };
  draft.library.push(newItem);
  return { nextState: draft, value: newItem };
}

/**
 * Updates default minutes for a library item.
 */
export function applyUpdateLibraryMinutes(
  draft: AppState,
  id: string,
  defaultMinutes: number
): MutatorReturn<void> {
  if (!Number.isSafeInteger(defaultMinutes) || defaultMinutes <= 0) return { error: { code: 'INVALID_MINUTES', message: '默认时长必须为大于0的整数分钟。' } };
  draft.library = draft.library.map(l =>
    l.id === id ? { ...l, defaultMinutes } : l
  );
  return { nextState: draft, value: undefined };
}

/**
 * Deletes a custom library item.
 * Custom item deletion is permanent and never resurrected by buildLibraryFromSources.
 */
export function applyDeleteCustomItem(
  draft: AppState,
  id: string
): MutatorReturn<void> {
  draft.library = draft.library.filter(l => l.id !== id);
  return { nextState: draft, value: undefined };
}

/**
 * Adds wrong question records with photo attachments.
 */
export function applyAddWrongRecords(
  draft: AppState,
  bookId: string,
  date: string,
  note: string,
  images: string[]
): MutatorReturn<WrongRecord[]> {
  const newRecords: WrongRecord[] = images.map(img => ({
    id: `wrong-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    bookId,
    note,
    image: img,
  }));
  draft.wrong = [...newRecords, ...draft.wrong];
  return { nextState: draft, value: newRecords };
}

/**
 * Deletes a wrong question record.
 */
export function applyDeleteWrongRecord(
  draft: AppState,
  id: string
): MutatorReturn<void> {
  draft.wrong = draft.wrong.filter(w => w.id !== id);
  return { nextState: draft, value: undefined };
}

/**
 * Updates profile information.
 */
export function applyUpdateProfile(
  draft: AppState,
  name: string,
  avatar?: string
): MutatorReturn<Profile> {
  draft.profile = {
    ...draft.profile,
    name: name.trim() || draft.profile.name,
    avatar: avatar !== undefined ? avatar : draft.profile.avatar,
  };
  return { nextState: draft, value: draft.profile };
}

export const COUNTDOWN_MAX = 6;
export const COUNTDOWN_NAME_MAX = 20;
const validCountdownDate = (date: string) => date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date);

/** 新增自定义倒数日（名称＋目标日期，首页最多展示 6 个）。 */
export function applyAddCountdown(
  draft: AppState,
  name: string,
  date: string,
  now = Date.now()
): MutatorReturn<Countdown> {
  const title = name.trim();
  if (!title || title.length > COUNTDOWN_NAME_MAX) {
    return { error: { code: 'INVALID_NAME', message: `倒数日名称需为1至${COUNTDOWN_NAME_MAX}个字符。` } };
  }
  if (!validCountdownDate(date)) {
    return { error: { code: 'INVALID_DATE', message: '请选择有效的目标日期，或留空稍后设置。' } };
  }
  if ((draft.countdowns?.length ?? 0) >= COUNTDOWN_MAX) {
    return { error: { code: 'COUNTDOWN_LIMIT', message: `最多保留 ${COUNTDOWN_MAX} 个倒数日，请先删除不再需要的。` } };
  }
  const countdown: Countdown = { id: `cd-${now}-${Math.random().toString(36).slice(2, 7)}`, name: title, date };
  draft.countdowns = [...(draft.countdowns ?? []), countdown];
  return { nextState: draft, value: countdown };
}

/**
 * Updates a countdown name/date (both editable; date may be empty).
 */
export function applyUpdateCountdown(
  draft: AppState,
  id: string,
  date: string,
  name?: string
): MutatorReturn<void> {
  if (!id) {
    return { error: { code: 'INVALID_ID', message: '倒计时 ID 不能为空' } };
  }
  const exists = draft.countdowns.some(cd => cd.id === id);
  if (!exists) {
    return { error: { code: 'NOT_FOUND', message: `未找到 ID 为 ${id} 的倒计时` } };
  }
  if (!validCountdownDate(date)) {
    return { error: { code: 'INVALID_DATE', message: '请选择有效的目标日期，或留空稍后设置。' } };
  }
  const trimmed = name === undefined ? undefined : name.trim();
  if (trimmed !== undefined && (!trimmed || trimmed.length > COUNTDOWN_NAME_MAX)) {
    return { error: { code: 'INVALID_NAME', message: `倒数日名称需为1至${COUNTDOWN_NAME_MAX}个字符。` } };
  }
  draft.countdowns = draft.countdowns.map(cd =>
    cd.id === id ? { ...cd, date, ...(trimmed !== undefined ? { name: trimmed } : {}) } : cd);
  return { nextState: draft, value: undefined };
}

/** 删除倒数日（含旧的国考/省考/事业编默认项）。 */
export function applyDeleteCountdown(draft: AppState, id: string): MutatorReturn<void> {
  if (!draft.countdowns.some(cd => cd.id === id)) {
    return { error: { code: 'NOT_FOUND', message: '该倒数日不存在或已被删除。' } };
  }
  draft.countdowns = draft.countdowns.filter(cd => cd.id !== id);
  return { nextState: draft, value: undefined };
}


export function applyAddTodo(draft: AppState, text: string, date: string, now = Date.now()): MutatorReturn<TodoItem> {
  if (!text.trim() || text.trim().length > 200) return { error: { code: 'INVALID_TODO', message: '待办内容需为1至200个字符。' } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: { code: 'INVALID_DATE', message: '请选择有效日期。' } };
  if ((draft.todos?.length ?? 0) >= 5000) return { error: { code: 'TODO_LIMIT', message: '待办数量已达5000条，请整理后再添加。' } };
  const todo: TodoItem = { id: `todo-${now}-${Math.random().toString(36).slice(2, 9)}`, text: text.trim(), date, done: false, createdAt: now, completedAt: 0 };
  draft.todos = [...(draft.todos ?? []), todo]; draft.version = Math.max(draft.version, 4) as AppState['version'];
  return { nextState: draft, value: todo };
}
export function applyToggleTodo(draft: AppState, id: string, now = Date.now()): MutatorReturn<void> {
  const todo = draft.todos?.find(t => t.id === id);
  if (!todo) return { error: { code: 'NOT_FOUND', message: '待办未找到。' } };
  todo.done = !todo.done; todo.completedAt = todo.done ? now : 0;
  return { nextState: draft, value: undefined };
}
export function applyDeleteTodo(draft: AppState, id: string): MutatorReturn<void> {
  draft.todos = (draft.todos ?? []).filter(t => t.id !== id); draft.version = Math.max(draft.version, 4) as AppState['version'];
  return { nextState: draft, value: undefined };
}
export function applyConfigureTimer(draft: AppState, id: string, config: TimerConfig): MutatorReturn<void> {
  const plan = draft.plans.find(p => p.id === id);
  if (!plan || plan.done || plan.timerStart > 0 || (plan.restStart ?? 0) > 0) return { error: { code: 'TIMER_BUSY', message: '请先暂停计时再设置模式。' } };
  if (!['countup', 'countdown', 'pomodoro'].includes(config.timerMode) || !Number.isSafeInteger(config.focusMinutes) || config.focusMinutes <= 0 || !Number.isSafeInteger(config.restMinutes) || config.restMinutes <= 0) return { error: { code: 'INVALID_TIMER', message: '专注与休息时长必须为大于0的整数分钟。' } };
  Object.assign(plan, config, { timerPhase: 'focus', phaseAccumulatedMs: 0, restStart: 0 }); draft.version = Math.max(draft.version, 4) as AppState['version'];
  return { nextState: draft, value: undefined };
}
export function applySwitchTimerPhase(draft: AppState, id: string, phase: 'focus' | 'rest', now = Date.now()): MutatorReturn<void> {
  const plan = draft.plans.find(p => p.id === id);
  if (!plan || plan.done || plan.archived || plan.timerMode !== 'pomodoro' || now >= planDayEnd(plan)) return { error: { code: 'INVALID_TIMER_PHASE', message: '该日程无法切换番茄阶段。' } };
  if (draft.timerSessions?.some(s => s.status === 'running') || draft.plans.some(p => p.id !== id && !p.done && (p.timerStart > 0 || (p.restStart ?? 0) > 0))) return { error: { code: 'TIMER_BUSY', message: '请先暂停其他正在运行的计时。' } };
  if (plan.timerPhase === phase) return { nextState: draft, value: undefined };
  applyPauseTimer(draft, id, now);
  plan.timerPhase = phase; plan.phaseAccumulatedMs = 0;
  if (phase === 'rest') plan.restStart = now; else plan.timerStart = now;
  return { nextState: draft, value: undefined };
}
export function applyArchiveOldPlans(draft: AppState, today: string): MutatorReturn<void> {
  for (const plan of draft.plans) {
    if (plan.date >= today || plan.archived) continue;
    applyPauseTimer(draft, plan.id, planDayEnd(plan));
    plan.archived = true; draft.version = Math.max(draft.version, 4) as AppState['version'];
  }
  return { nextState: draft, value: undefined };
}


/** Must run against the current transaction draft, never a captured list of expired IDs. */
export function applyMaintainTimers(draft: AppState, today: string, now = Date.now()): MutatorReturn<void> {
  applyArchiveOldPlans(draft, today);
  for (const plan of draft.plans) {
    if (!plan.done && plan.timerPhase === 'rest' && (plan.restStart ?? 0) > 0 &&
      phaseElapsedMs(plan, now) >= (plan.restMinutes ?? 5) * 60000) applyPauseTimer(draft, plan.id, now);
  }
  return { nextState: draft, value: undefined };
}

export function applyAddTodayTodo(draft: AppState, text: string, now = Date.now()) {
  const day = new Date(now);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return applyAddTodo(draft, text, date, now);
}
