import {
  AppState,
  Book,
  Course,
  LibraryItem,
  Plan,
  StudyRecord,
  WrongRecord,
  Subject,
  Profile,
  CompletionInput,
  MediaRecord,
} from '../types';
import { buildLibraryFromSources } from '../constants/initialData';

export type MutatorReturn<T> =
  | { nextState: AppState; value: T; newMedia?: MediaRecord[]; deletedMediaIds?: string[] }
  | { error: { code: string; message: string; field?: string } };

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
  if (plan.done) {
    return { error: { code: 'PLAN_ALREADY_DONE', message: '已完成的计划无法开始计时' } };
  }
  if (plan.timerStart > 0) {
    // Idempotent: already running, do not modify timestamp
    return { nextState: draft, value: undefined };
  }
  plan.timerStart = now;
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
  if (plan.timerStart === 0) {
    // Idempotent: already paused
    return { nextState: draft, value: undefined };
  }

  const elapsed = Math.max(0, now - plan.timerStart);
  const prevAccumulated = typeof plan.accumulatedMs === 'number'
    ? plan.accumulatedMs
    : (plan.actualMinutes || 0) * 60000;
  const newAccumulated = prevAccumulated + elapsed;

  plan.accumulatedMs = newAccumulated;
  plan.actualMinutes = Math.floor(newAccumulated / 60000);
  plan.timerStart = 0;

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

  if (input.minutes < 0) {
    return { error: { code: 'INVALID_INPUT', message: '用时不能为负数' } };
  }

  if (input.type === 'book') {
    if (input.questions < 0 || input.errors < 0) {
      return { error: { code: 'INVALID_INPUT', message: '做题数和错题数不能为负数' } };
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
    if (input.lessons <= 0) {
      return { error: { code: 'INVALID_INPUT', message: '完成课时数必须大于0' } };
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
          message: '完成讲数超过剩余未学讲数',
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
  plannedMinutes?: number
): MutatorReturn<Plan> {
  const item = draft.library.find(l => l.id === libraryId);
  if (!item) {
    return { error: { code: 'LIBRARY_ITEM_NOT_FOUND', message: '事项库未找到该项目' } };
  }

  const mins = plannedMinutes && plannedMinutes > 0 ? plannedMinutes : item.defaultMinutes;
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

  draft.plans.push(newPlan);
  return { nextState: draft, value: newPlan };
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
  draft.plans = draft.plans.filter(p => p.id !== planId);
  return { nextState: draft, value: undefined };
}

/**
 * Adds a new book and reconciles library.
 */
export function applyAddBook(
  draft: AppState,
  bookData: Omit<Book, 'id'>
): MutatorReturn<string> {
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
  subject: Subject,
  defaultMinutes: number
): MutatorReturn<LibraryItem> {
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
  draft.library = draft.library.map(l =>
    l.id === id ? { ...l, defaultMinutes: Math.max(1, defaultMinutes) } : l
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

/**
 * Updates countdown date.
 */
export function applyUpdateCountdown(
  draft: AppState,
  id: string,
  date: string
): MutatorReturn<void> {
  if (!id) {
    return { error: { code: 'INVALID_ID', message: '倒计时 ID 不能为空' } };
  }
  const exists = draft.countdowns.some(cd => cd.id === id);
  if (!exists) {
    return { error: { code: 'NOT_FOUND', message: `未找到 ID 为 ${id} 的倒计时` } };
  }
  draft.countdowns = draft.countdowns.map(cd => (cd.id === id ? { ...cd, date } : cd));
  return { nextState: draft, value: undefined };
}
