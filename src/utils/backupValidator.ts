import { validateStudyExtensions, planExtensions } from './studyExtensions';
import { AppState, Book, Course, Countdown, Plan, StudyRecord, WrongRecord, Profile, LibraryItem, SUBJECTS, Subject, PlanType } from '../types';
import { buildLibraryFromSources, BLANK_PROFILE, STABLE_COUNTDOWNS } from '../constants/initialData';

export const MAX_BACKUP_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const VALID_SUBJECT_SET = new Set<string>(SUBJECTS);
const VALID_PLAN_TYPES = new Set<string>(['book', 'course', 'custom']);

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

function isValidDateString(str: any): boolean {
  if (typeof str !== 'string' || !str.trim()) return false;
  const parsed = Date.parse(str);
  return !isNaN(parsed);
}

function isNonNegativeNumber(val: any): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

/**
 * Strict versioned validation and migration for backup data.
 * Supports v1–v4 backups; legacy data normalizes to v3 and v4 extensions are preserved.
 *
 * Rules:
 * - Rejects non-string and payload > 50MB
 * - Rejects non-JSON and invalid root objects
 * - Rejects unknown versions (version > 5)
 * - Rejects missing core arrays: books, courses, countdowns, plans, records, wrong
 * - Rejects null / non-object elements in any core array
 * - Validates field types, non-negative numbers, subjects against SUBJECTS, and date formats
 * - Strictly preserves accumulatedMs for plans; derives from (actualMinutes || 0) * 60000 if absent
 * - Normalizes countdown IDs to stable IDs (exam-national, exam-provincial, exam-public-service)
 */
export function validateAndMigrateBackup(jsonString: string): BackupValidationResult {
  if (!jsonString || typeof jsonString !== 'string') {
    return { valid: false, error: '备份文件内容为空或不是字符串' };
  }

  if (jsonString.length > MAX_BACKUP_SIZE_BYTES || new TextEncoder().encode(jsonString).byteLength > MAX_BACKUP_SIZE_BYTES) {
    return { valid: false, error: '备份文件大小超过 50MB 限制' };
  }

  let raw: any;
  try {
    raw = JSON.parse(jsonString);
  } catch (err: any) {
    return { valid: false, error: `JSON 格式解析失败: ${err.message || '语法错误'}` };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: '备份文件数据结构非法，根节点不是对象' };
  }

  // Handle both { version: N, state: { ... } } and direct AppState
  const target = raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state) ? raw.state : raw;

  // A declared version must be one of the supported integer schema versions.
  for (const candidate of [raw, target]) {
    if (Object.prototype.hasOwnProperty.call(candidate, 'version')) {
      const version = candidate.version;
      if (!Number.isInteger(version) || version < 1 || version > 5) {
        return { valid: false, error: `不支持的备份版本 (v${version})，当前最高支持 v5` };
      }
    }
  }

  const extensionError = validateStudyExtensions(target);
  if (extensionError) return { valid: false, error: extensionError };

  // CRITICAL: Reject missing core arrays!
  if (!Array.isArray(target.books)) {
    return { valid: false, error: '备份缺少必要的 books (题本列表) 数据' };
  }
  if (!Array.isArray(target.courses)) {
    return { valid: false, error: '备份缺少必要的 courses (课程列表) 数据' };
  }
  if (!Array.isArray(target.countdowns)) {
    return { valid: false, error: '备份缺少必要的 countdowns (倒计时列表) 数据' };
  }
  if (!Array.isArray(target.plans)) {
    return { valid: false, error: '备份缺少必要的 plans (学习计划) 数据' };
  }
  if (!Array.isArray(target.records)) {
    return { valid: false, error: '备份缺少必要的 records (学习记录) 数据' };
  }
  if (!Array.isArray(target.wrong)) {
    return { valid: false, error: '备份缺少必要的 wrong (错题记录) 数据' };
  }

  // Reject null or non-object elements in core arrays
  const coreArrayChecks = [
    { name: 'books', arr: target.books },
    { name: 'courses', arr: target.courses },
    { name: 'countdowns', arr: target.countdowns },
    { name: 'plans', arr: target.plans },
    { name: 'records', arr: target.records },
    { name: 'wrong', arr: target.wrong },
  ];

  for (const { name, arr } of coreArrayChecks) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === null || arr[i] === undefined || typeof arr[i] !== 'object' || Array.isArray(arr[i])) {
        return { valid: false, error: `数据校验失败: ${name} 中第 ${i + 1} 项包含空值或非法对象` };
      }
    }
  }

  // Validate & sanitize books
  const books: Book[] = [];
  for (let i = 0; i < target.books.length; i++) {
    const b = target.books[i];
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return { valid: false, error: `题本列表中第 ${i + 1} 项名称不能为空` };
    }
    if (!VALID_SUBJECT_SET.has(b.subject)) {
      return { valid: false, error: `题本 "${b.name}" 的科目 "${b.subject}" 不合法` };
    }
    if (!isNonNegativeNumber(b.total)) {
      return { valid: false, error: `题本 "${b.name}" 总题数必须为非负数字` };
    }
    if (!isNonNegativeNumber(b.pages)) {
      return { valid: false, error: `题本 "${b.name}" 总页数必须为非负数字` };
    }
    if (!isNonNegativeNumber(b.done)) {
      return { valid: false, error: `题本 "${b.name}" 已做题数必须为非负数字` };
    }
    if (!isNonNegativeNumber(b.errors)) {
      return { valid: false, error: `题本 "${b.name}" 错题数必须为非负数字` };
    }
    if (!isNonNegativeNumber(b.minutes)) {
      return { valid: false, error: `题本 "${b.name}" 学习用时必须为非负数字` };
    }

    books.push({
      id: typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `b-${Date.now()}-${i}`,
      name: b.name.trim(),
      subject: b.subject as Subject,
      total: Math.round(b.total),
      pages: Math.round(b.pages),
      done: Math.round(b.done),
      errors: Math.round(b.errors),
      minutes: Math.round(b.minutes),
    });
  }

  // Validate & sanitize courses
  const courses: Course[] = [];
  for (let i = 0; i < target.courses.length; i++) {
    const c = target.courses[i];
    if (typeof c.name !== 'string' || !c.name.trim()) {
      return { valid: false, error: `课程列表中第 ${i + 1} 项名称不能为空` };
    }
    if (!VALID_SUBJECT_SET.has(c.subject)) {
      return { valid: false, error: `课程 "${c.name}" 的科目 "${c.subject}" 不合法` };
    }
    if (!isNonNegativeNumber(c.totalLessons)) {
      return { valid: false, error: `课程 "${c.name}" 总讲数必须为非负数字` };
    }
    if (!isNonNegativeNumber(c.completedLessons)) {
      return { valid: false, error: `课程 "${c.name}" 已学讲数必须为非负数字` };
    }
    if (!isNonNegativeNumber(c.minutes)) {
      return { valid: false, error: `课程 "${c.name}" 学习用时必须为非负数字` };
    }

    courses.push({
      id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `c-${Date.now()}-${i}`,
      name: c.name.trim(),
      subject: c.subject as Subject,
      totalLessons: Math.round(c.totalLessons),
      completedLessons: Math.round(c.completedLessons),
      minutes: Math.round(c.minutes),
      url: typeof c.url === 'string' ? c.url.trim() : '',
    });
  }

  // Validate & normalize countdowns (Stable IDs: exam-national, exam-provincial, exam-public-service)
  const cdMap = new Map<string, Countdown>();
  const extraCountdowns: Countdown[] = [];

  for (let i = 0; i < target.countdowns.length; i++) {
    const cd = target.countdowns[i];
    const name = typeof cd.name === 'string' ? cd.name.trim() : `考试 ${i + 1}`;
    const date = typeof cd.date === 'string' ? cd.date.trim() : '';

    if (date !== '' && !isValidDateString(date)) {
      return { valid: false, error: `倒计时 "${name}" 的考试日期格式无效: ${cd.date}` };
    }

    let stableId: string | null = null;
    if (cd.id === 'exam-national' || name.includes('国考') || cd.id === 'cd-1') {
      stableId = 'exam-national';
    } else if (cd.id === 'exam-provincial' || name.includes('省考') || cd.id === 'cd-2') {
      stableId = 'exam-provincial';
    } else if (cd.id === 'exam-public-service' || name.includes('事业编') || cd.id === 'cd-3') {
      stableId = 'exam-public-service';
    }

    if (stableId) {
      cdMap.set(stableId, { id: stableId, name, date });
    } else {
      extraCountdowns.push({
        id: typeof cd.id === 'string' && cd.id.trim() ? cd.id.trim() : `cd-custom-${i + 1}`,
        name,
        date,
      });
    }
  }

  // Ensure all 3 stable countdowns exist
  const finalCountdowns: Countdown[] = [
    cdMap.get('exam-national') || { id: 'exam-national', name: '国考', date: '' },
    cdMap.get('exam-provincial') || { id: 'exam-provincial', name: '省考', date: '' },
    cdMap.get('exam-public-service') || { id: 'exam-public-service', name: '事业编', date: '' },
    ...extraCountdowns,
  ];

  // Validate & sanitize plans
  const plans: Plan[] = [];
  for (let i = 0; i < target.plans.length; i++) {
    const p = target.plans[i];
    if (typeof p.name !== 'string' || !p.name.trim()) {
      return { valid: false, error: `学习计划列表中第 ${i + 1} 项名称不能为空` };
    }
    if (!isValidDateString(p.date)) {
      return { valid: false, error: `学习计划 "${p.name}" 的日期格式无效: ${p.date}` };
    }
    if (!VALID_PLAN_TYPES.has(p.type)) {
      return { valid: false, error: `学习计划 "${p.name}" 的类型 "${p.type}" 不合法` };
    }
    if (!VALID_SUBJECT_SET.has(p.subject)) {
      return { valid: false, error: `学习计划 "${p.name}" 的科目 "${p.subject}" 不合法` };
    }
    if (!isNonNegativeNumber(p.plannedMinutes)) {
      return { valid: false, error: `学习计划 "${p.name}" 计划用时必须为非负数字` };
    }
    if (!isNonNegativeNumber(p.actualMinutes)) {
      return { valid: false, error: `学习计划 "${p.name}" 实际用时必须为非负数字` };
    }

    for (const field of ['accumulatedMs', 'timerStart']) {
      if (p[field] !== undefined && !isNonNegativeNumber(p[field])) {
        return { valid: false, error: `学习计划 "${p.name}" 的 ${field} 必须为有限非负数字` };
      }
    }

    // CRITICAL: Preserve accumulatedMs if valid number, otherwise derive from (actualMinutes || 0) * 60000
    const accumulatedMs = (isNonNegativeNumber(p.accumulatedMs))
      ? p.accumulatedMs
      : Math.round((p.actualMinutes || 0) * 60000);

    const timerStart = (isNonNegativeNumber(p.timerStart))
      ? p.timerStart
      : 0;

    plans.push({
      id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `plan-${Date.now()}-${i}`,
      date: p.date.trim(),
      libraryId: typeof p.libraryId === 'string' ? p.libraryId.trim() : '',
      name: p.name.trim(),
      type: p.type as PlanType,
      sourceId: typeof p.sourceId === 'string' ? p.sourceId.trim() : '',
      subject: p.subject as Subject,
      plannedMinutes: Math.round(p.plannedMinutes),
      actualMinutes: Math.round(p.actualMinutes),
      accumulatedMs,
      done: Boolean(p.done),
      timerStart,
      ...planExtensions(p),
      recordId: typeof p.recordId === 'string' && p.recordId.trim() ? p.recordId.trim() : undefined,
    });
  }

  // Validate & sanitize records
  const records: StudyRecord[] = [];
  for (let i = 0; i < target.records.length; i++) {
    const r = target.records[i];
    if (!isValidDateString(r.date)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项的日期格式无效: ${r.date}` };
    }
    if (!VALID_PLAN_TYPES.has(r.type)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项的类型 "${r.type}" 不合法` };
    }
    if (!VALID_SUBJECT_SET.has(r.subject)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项的科目 "${r.subject}" 不合法` };
    }
    if (!isNonNegativeNumber(r.minutes)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项用时必须为非负数字` };
    }
    if (!isNonNegativeNumber(r.questions)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项题目数必须为非负数字` };
    }
    if (!isNonNegativeNumber(r.errors)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项错题数必须为非负数字` };
    }

    if (r.lessons !== undefined && !isNonNegativeNumber(r.lessons)) {
      return { valid: false, error: `学习记录中第 ${i + 1} 项讲数必须为有限非负数字` };
    }
    const lessons = (isNonNegativeNumber(r.lessons))
      ? Math.round(r.lessons)
      : undefined;

    records.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `rec-${Date.now()}-${i}`,
      planId: typeof r.planId === 'string' ? r.planId.trim() : '',
      date: r.date.trim(),
      type: r.type as PlanType,
      sourceId: typeof r.sourceId === 'string' ? r.sourceId.trim() : '',
      subject: r.subject as Subject,
      minutes: Math.round(r.minutes),
      questions: Math.round(r.questions),
      errors: Math.round(r.errors),
      lessons,
      ...(r.sourceApplied !== undefined ? { sourceApplied: r.sourceApplied } : {}),
      ...(r.sessionId !== undefined ? { sessionId: r.sessionId } : {}),
    });
  }

  function isValidBackupImageRef(ref: unknown): boolean {
    if (typeof ref !== 'string') return false;
    if (ref === '') return true;
    if (/^pose-[0-7]$/.test(ref)) return true;
    if (ref.startsWith('/branding/')) return true;
    if (ref.startsWith('/api/media/')) return true;
    if (ref.startsWith('media:') || ref.startsWith('media_')) return true;
    if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(ref)) return true;
    if (/^https?:\/\//i.test(ref)) return true;
    return false;
  }

  function checkDataUrlSize(ref: string, fieldName: string): { ok: boolean; error?: string } {
    if (!ref.startsWith('data:image/')) return { ok: true };
    const comma = ref.indexOf(',');
    if (comma === -1) return { ok: false, error: `${fieldName} 图片格式非法` };
    const b64Len = ref.length - comma - 1;
    const approxBytes = Math.ceil((b64Len * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      return { ok: false, error: `${fieldName} 图片大小超出 10MB 限制` };
    }
    return { ok: true };
  }

  // Validate & sanitize wrong records
  const wrong: WrongRecord[] = [];
  for (let i = 0; i < target.wrong.length; i++) {
    const w = target.wrong[i];
    if (!isValidDateString(w.date)) {
      return { valid: false, error: `错题记录中第 ${i + 1} 项的日期格式无效: ${w.date}` };
    }

    if (w.image) {
      if (!isValidBackupImageRef(w.image)) {
        return { valid: false, error: `错题记录中第 ${i + 1} 项含不可恢复的本地图片引用，请重新导出完整备份` };
      }
      const sizeCheck = checkDataUrlSize(w.image, `错题记录第 ${i + 1} 项`);
      if (!sizeCheck.ok) {
        return { valid: false, error: sizeCheck.error };
      }
    }
    if (w.storagePath && !w.image) {
      return { valid: false, error: `错题记录中第 ${i + 1} 项缺少图片附件内容` };
    }

    let images: string[] | undefined = undefined;
    if (w.images !== undefined) {
      if (!Array.isArray(w.images)) {
        return { valid: false, error: `错题记录中第 ${i + 1} 项多图数据必须为数组` };
      }
      images = [];
      const limit = Math.min(w.images.length, 9);
      for (let j = 0; j < limit; j++) {
        const item = w.images[j];
        if (typeof item !== 'string' || (item !== '' && !isValidBackupImageRef(item))) {
          return { valid: false, error: `错题记录中第 ${i + 1} 项含不可恢复的多图图片引用，请重新导出完整备份` };
        }
        if (item) {
          const sizeCheck = checkDataUrlSize(item, `错题记录第 ${i + 1} 项多图第 ${j + 1} 张`);
          if (!sizeCheck.ok) {
            return { valid: false, error: sizeCheck.error };
          }
        }
        images.push(item);
      }
    }

    wrong.push({
      id: typeof w.id === 'string' && w.id.trim() ? w.id.trim() : `wrong-${Date.now()}-${i}`,
      date: w.date.trim(),
      bookId: typeof w.bookId === 'string' ? w.bookId.trim() : '',
      note: typeof w.note === 'string' ? w.note : '',
      image: typeof w.image === 'string' ? w.image : '',
      ...(images !== undefined ? { images } : {}),
    });
  }

  // Sanitize profile
  const rawProfile = target.profile && typeof target.profile === 'object' ? target.profile : {};
  if (rawProfile.avatar !== undefined && rawProfile.avatar !== null && rawProfile.avatar !== '') {
    if (!isValidBackupImageRef(rawProfile.avatar)) {
      return { valid: false, error: '头像含不可恢复的图片引用，请重新导出完整备份' };
    }
    if (typeof rawProfile.avatar === 'string') {
      const sizeCheck = checkDataUrlSize(rawProfile.avatar, '头像');
      if (!sizeCheck.ok) {
        return { valid: false, error: sizeCheck.error };
      }
    }
  }
  const profile: Profile = {
    name: typeof rawProfile.name === 'string' && rawProfile.name.trim() ? rawProfile.name.trim() : BLANK_PROFILE.name,
    username: typeof rawProfile.username === 'string' ? rawProfile.username.trim() : BLANK_PROFILE.username,
    avatar: typeof rawProfile.avatar === 'string' ? rawProfile.avatar : BLANK_PROFILE.avatar,
  };

  // Reconcile library from sources
  if (target.library !== undefined && !Array.isArray(target.library)) {
    return { valid: false, error: '事项库 library 必须为数组' };
  }
  const existingLib: LibraryItem[] = [];
  for (const [index, item] of (target.library ?? []).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.name !== 'string' || !item.name.trim()
      || !VALID_PLAN_TYPES.has(item.type) || !VALID_SUBJECT_SET.has(item.subject)
      || typeof item.sourceId !== 'string'
      || !isNonNegativeNumber(item.defaultMinutes) || item.defaultMinutes <= 0) {
      return { valid: false, error: `事项库中第 ${index + 1} 项数据无效` };
    }
    existingLib.push({ id: item.id.trim(), name: item.name.trim(), type: item.type, sourceId: item.sourceId.trim(), subject: item.subject, defaultMinutes: item.defaultMinutes });
  }
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
    ...(target.todos !== undefined ? { todos: structuredClone(target.todos) } : {}),
    ...(target.timerSessions !== undefined ? { timerSessions: structuredClone(target.timerSessions) } : {}),
    version: target.version === 5 ? 5 : target.version === 4 ? 4 : 3,
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
