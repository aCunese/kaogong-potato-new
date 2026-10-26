import { AppState, Book, Course, Countdown, Plan, StudyRecord, WrongRecord, Profile } from '../types';
import { buildLibraryFromSources, INITIAL_PROFILE, INITIAL_COUNTDOWNS } from '../constants/initialData';

export interface BackupValidationResult {
  valid: boolean;
  migratedState?: AppState;
  error?: string;
  summary?: {
    bookCount: number;
    courseCount: number;
    planCount: number;
    recordCount: number;
    wrongCount: number;
    countdownCount: number;
    profileName: string;
  };
}

/**
 * Validates, migrates, and repairs imported backup JSON.
 * Fixes:
 * - A02: Rejects incomplete/corrupted backups without crashing, provides detailed schema validation.
 * - A04: Assigns stable IDs to legacy countdowns lacking 'id' property.
 */
export function validateAndMigrateBackup(jsonString: string): BackupValidationResult {
  if (!jsonString || typeof jsonString !== 'string') {
    return { valid: false, error: '备份文件内容为空或不是字符串' };
  }

  let raw: any;
  try {
    raw = JSON.parse(jsonString);
  } catch (err: any) {
    return { valid: false, error: `JSON 格式解析失败: ${err.message || '语法错误'}` };
  }

  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '备份文件数据结构非法，根节点不是对象' };
  }

  // Handle both { version: N, state: { ... } } and direct AppState
  const target = raw.state && typeof raw.state === 'object' ? raw.state : raw;

  // Verify core arrays
  if (!Array.isArray(target.books)) {
    return { valid: false, error: '备份缺少必要的 books (题本列表) 数据' };
  }
  if (!Array.isArray(target.courses)) {
    return { valid: false, error: '备份缺少必要的 courses (课程列表) 数据' };
  }
  if (!Array.isArray(target.countdowns)) {
    return { valid: false, error: '备份缺少必要的 countdowns (倒计时列表) 数据' };
  }

  // Normalize countdowns with stable IDs (Fix A04)
  const countdowns: Countdown[] = target.countdowns.map((cd: any, idx: number) => ({
    id: typeof cd.id === 'string' && cd.id.trim() ? cd.id.trim() : `cd-${idx + 1}-${cd.name || 'exam'}`,
    name: typeof cd.name === 'string' ? cd.name : `考试 ${idx + 1}`,
    date: typeof cd.date === 'string' ? cd.date : '',
  }));

  // Fallback if empty countdowns
  const finalCountdowns = countdowns.length > 0 ? countdowns : INITIAL_COUNTDOWNS;

  // Sanitize books
  const books: Book[] = target.books.map((b: any, idx: number) => ({
    id: typeof b.id === 'string' && b.id ? b.id : `b-${Date.now()}-${idx}`,
    name: typeof b.name === 'string' ? b.name : '未命名题本',
    subject: b.subject || '言语理解',
    total: typeof b.total === 'number' ? b.total : 100,
    pages: typeof b.pages === 'number' ? b.pages : 1,
    done: typeof b.done === 'number' ? b.done : 0,
    errors: typeof b.errors === 'number' ? b.errors : 0,
    minutes: typeof b.minutes === 'number' ? b.minutes : 0,
  }));

  // Sanitize courses
  const courses: Course[] = target.courses.map((c: any, idx: number) => ({
    id: typeof c.id === 'string' && c.id ? c.id : `c-${Date.now()}-${idx}`,
    name: typeof c.name === 'string' ? c.name : '未命名课程',
    subject: c.subject || '言语理解',
    totalLessons: typeof c.totalLessons === 'number' ? c.totalLessons : 20,
    completedLessons: typeof c.completedLessons === 'number' ? c.completedLessons : 0,
    minutes: typeof c.minutes === 'number' ? c.minutes : 0,
    url: typeof c.url === 'string' ? c.url : '',
  }));

  // Safe fallback for profile (Fix A02)
  const profile: Profile = {
    name: (target.profile && typeof target.profile.name === 'string') ? target.profile.name : INITIAL_PROFILE.name,
    username: (target.profile && typeof target.profile.username === 'string') ? target.profile.username : INITIAL_PROFILE.username,
    avatar: (target.profile && typeof target.profile.avatar === 'string') ? target.profile.avatar : INITIAL_PROFILE.avatar,
  };

  // Safe fallback for plans
  const plans: Plan[] = Array.isArray(target.plans)
    ? target.plans.map((p: any, idx: number) => ({
        id: typeof p.id === 'string' && p.id ? p.id : `plan-${Date.now()}-${idx}`,
        date: typeof p.date === 'string' ? p.date : new Date().toISOString().slice(0, 10),
        libraryId: typeof p.libraryId === 'string' ? p.libraryId : '',
        name: typeof p.name === 'string' ? p.name : '学习计划',
        type: p.type === 'course' ? 'course' : p.type === 'custom' ? 'custom' : 'book',
        sourceId: typeof p.sourceId === 'string' ? p.sourceId : '',
        subject: p.subject || '言语理解',
        plannedMinutes: typeof p.plannedMinutes === 'number' ? p.plannedMinutes : 30,
        actualMinutes: typeof p.actualMinutes === 'number' ? p.actualMinutes : 0,
        done: Boolean(p.done),
        timerStart: typeof p.timerStart === 'number' ? p.timerStart : 0,
        recordId: typeof p.recordId === 'string' ? p.recordId : undefined,
      }))
    : [];

  // Safe fallback for records
  const records: StudyRecord[] = Array.isArray(target.records)
    ? target.records.map((r: any, idx: number) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `rec-${Date.now()}-${idx}`,
        planId: typeof r.planId === 'string' ? r.planId : '',
        date: typeof r.date === 'string' ? r.date : new Date().toISOString().slice(0, 10),
        type: r.type === 'course' ? 'course' : r.type === 'custom' ? 'custom' : 'book',
        sourceId: typeof r.sourceId === 'string' ? r.sourceId : '',
        subject: r.subject || '言语理解',
        minutes: typeof r.minutes === 'number' ? r.minutes : 0,
        questions: typeof r.questions === 'number' ? r.questions : 0,
        errors: typeof r.errors === 'number' ? r.errors : 0,
      }))
    : [];

  // Safe fallback for wrong records
  const wrong: WrongRecord[] = Array.isArray(target.wrong)
    ? target.wrong.map((w: any, idx: number) => ({
        id: typeof w.id === 'string' && w.id ? w.id : `wrong-${Date.now()}-${idx}`,
        date: typeof w.date === 'string' ? w.date : new Date().toISOString().slice(0, 10),
        bookId: typeof w.bookId === 'string' ? w.bookId : '',
        note: typeof w.note === 'string' ? w.note : '',
        image: typeof w.image === 'string' ? w.image : '',
        storagePath: typeof w.storagePath === 'string' ? w.storagePath : undefined,
      }))
    : [];

  // Rebuild library from sanitized sources
  const existingLib = Array.isArray(target.library) ? target.library : [];
  const library = buildLibraryFromSources(books, courses, existingLib);

  const migratedState: AppState = {
    profile,
    countdowns: finalCountdowns,
    books,
    courses,
    library,
    plans,
    records,
    wrong,
    version: 2,
  };

  return {
    valid: true,
    migratedState,
    summary: {
      bookCount: books.length,
      courseCount: courses.length,
      planCount: plans.length,
      recordCount: records.length,
      wrongCount: wrong.length,
      countdownCount: finalCountdowns.length,
      profileName: profile.name,
    },
  };
}
