import { AppState, Book, Course, LibraryItem, Plan, StudyRecord, WrongRecord } from '../types';

/**
 * One-time legacy guest (v2 localStorage) -> account migration (R10).
 *
 * Builds an explicit preview first (scope + conflicts), then a full merge with ID
 * remapping across books, courses, library items, plans, records, wrong photos and
 * countdowns. Never copies only a subset by book name, never moves data across
 * accounts automatically; the legacy payload is preserved.
 */

export interface GuestMigrationPreview {
  available: boolean;
  booksToAdd: number;
  booksMatched: number;
  coursesToAdd: number;
  coursesMatched: number;
  libraryToAdd: number;
  plansToMigrate: number;
  plansSkipped: number;
  recordsToMigrate: number;
  wrongToMigrate: number;
  photosToMigrate: number;
  countdownsToFill: number;
  notes: string[];
}

export interface GuestMigrationResult {
  mergedState: AppState;
  preview: GuestMigrationPreview;
}

function uniqueId(prefix: string, existing: Set<string>): string {
  let id = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  while (existing.has(id)) id = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  existing.add(id);
  return id;
}

/**
 * Merge guest state into an account state with stable ID mapping.
 * Account data always wins for the same entity; guest data is added, never overwritten.
 */
export function buildGuestMigration(account: AppState, guest: AppState): GuestMigrationResult {
  const merged: AppState = JSON.parse(JSON.stringify(account));
  const preview: GuestMigrationPreview = {
    available: true,
    booksToAdd: 0,
    booksMatched: 0,
    coursesToAdd: 0,
    coursesMatched: 0,
    libraryToAdd: 0,
    plansToMigrate: 0,
    plansSkipped: 0,
    recordsToMigrate: 0,
    wrongToMigrate: 0,
    photosToMigrate: 0,
    countdownsToFill: 0,
    notes: [],
  };

  const accountBookIds = new Set(merged.books.map(b => b.id));
  const accountBookNames = new Map(merged.books.map(b => [`${b.name}::${b.subject}`, b.id]));
  const accountCourseIds = new Set(merged.courses.map(c => c.id));
  const accountCourseNames = new Map(merged.courses.map(c => [`${c.name}::${c.subject}`, c.id]));
  const accountLibraryIds = new Set(merged.library.map(l => l.id));
  const bookIdMap = new Map<string, string>(); // guest book id -> account book id
  const courseIdMap = new Map<string, string>();
  const libraryIdMap = new Map<string, string>(); // guest library id -> account library id

  // 1. Books — match by stable id, then name+subject; otherwise copy with remapped id.
  for (const guestBook of guest.books ?? []) {
    const byName = accountBookNames.get(`${guestBook.name}::${guestBook.subject}`);
    if (accountBookIds.has(guestBook.id)) {
      bookIdMap.set(guestBook.id, guestBook.id);
      preview.booksMatched += 1;
      continue;
    }
    if (byName) {
      bookIdMap.set(guestBook.id, byName);
      preview.booksMatched += 1;
      continue;
    }
    const newBook: Book = { ...guestBook, id: uniqueId('gb', accountBookIds) };
    merged.books.push(newBook);
    accountBookNames.set(`${newBook.name}::${newBook.subject}`, newBook.id);
    bookIdMap.set(guestBook.id, newBook.id);
    preview.booksToAdd += 1;
  }

  // 2. Courses — same strategy.
  for (const guestCourse of guest.courses ?? []) {
    const byName = accountCourseNames.get(`${guestCourse.name}::${guestCourse.subject}`);
    if (accountCourseIds.has(guestCourse.id)) {
      courseIdMap.set(guestCourse.id, guestCourse.id);
      preview.coursesMatched += 1;
      continue;
    }
    if (byName) {
      courseIdMap.set(guestCourse.id, byName);
      preview.coursesMatched += 1;
      continue;
    }
    const newCourse: Course = { ...guestCourse, id: uniqueId('gc', accountCourseIds) };
    merged.courses.push(newCourse);
    accountCourseNames.set(`${newCourse.name}::${newCourse.subject}`, newCourse.id);
    courseIdMap.set(guestCourse.id, newCourse.id);
    preview.coursesToAdd += 1;
  }

  // 3. Library items — remap book/course sources; custom items matched by name.
  const accountCustomNames = new Map(merged.library.filter(l => l.type === 'custom').map(l => [l.name, l.id]));
  for (const guestItem of guest.library ?? []) {
    if (accountLibraryIds.has(guestItem.id)) {
      libraryIdMap.set(guestItem.id, guestItem.id);
      continue;
    }
    if (guestItem.type === 'book') {
      const mappedBookId = bookIdMap.get(guestItem.sourceId) || guestItem.sourceId;
      const existing = merged.library.find(l => l.type === 'book' && l.sourceId === mappedBookId);
      if (existing) {
        libraryIdMap.set(guestItem.id, existing.id);
        continue;
      }
      const newItem: LibraryItem = {
        ...guestItem,
        id: uniqueId('gl', accountLibraryIds),
        sourceId: mappedBookId,
      };
      merged.library.push(newItem);
      libraryIdMap.set(guestItem.id, newItem.id);
      preview.libraryToAdd += 1;
    } else if (guestItem.type === 'course') {
      const mappedCourseId = courseIdMap.get(guestItem.sourceId) || guestItem.sourceId;
      const existing = merged.library.find(l => l.type === 'course' && l.sourceId === mappedCourseId);
      if (existing) {
        libraryIdMap.set(guestItem.id, existing.id);
        continue;
      }
      const newItem: LibraryItem = {
        ...guestItem,
        id: uniqueId('gl', accountLibraryIds),
        sourceId: mappedCourseId,
      };
      merged.library.push(newItem);
      libraryIdMap.set(guestItem.id, newItem.id);
      preview.libraryToAdd += 1;
    } else {
      const existingId = accountCustomNames.get(guestItem.name);
      if (existingId) {
        libraryIdMap.set(guestItem.id, existingId);
        continue;
      }
      const newItem: LibraryItem = { ...guestItem, id: uniqueId('gl', accountLibraryIds) };
      merged.library.push(newItem);
      accountCustomNames.set(newItem.name, newItem.id);
      libraryIdMap.set(guestItem.id, newItem.id);
      preview.libraryToAdd += 1;
    }
  }

  // 4. Plans — remap libraryId/sourceId; skip only when the source was invalid.
  const planIds = new Set(merged.plans.map(p => p.id));
  for (const guestPlan of guest.plans ?? []) {
    const mappedLibraryId = libraryIdMap.get(guestPlan.libraryId) || guestPlan.libraryId;
    const libraryItem = merged.library.find(l => l.id === mappedLibraryId);
    if (!libraryItem) {
      preview.plansSkipped += 1;
      continue;
    }
    const mappedSourceId = libraryItem.type === 'book'
      ? (bookIdMap.get(guestPlan.sourceId) || guestPlan.sourceId)
      : libraryItem.type === 'course'
        ? (courseIdMap.get(guestPlan.sourceId) || guestPlan.sourceId)
        : guestPlan.sourceId;
    const plan: Plan = {
      ...guestPlan,
      id: planIds.has(guestPlan.id) ? uniqueId('gp', planIds) : guestPlan.id,
      libraryId: mappedLibraryId,
      sourceId: mappedSourceId,
      // A timer that was running in the old guest session must not keep running.
      timerStart: 0,
      done: Boolean(guestPlan.done),
    };
    merged.plans.push(plan);
    planIds.add(plan.id);
    preview.plansToMigrate += 1;
  }

  // 5. Study records — remap plan/source references, keep actual values.
  const recordIds = new Set(merged.records.map(r => r.id));
  const planIdMap = new Map<string, string>();
  for (let i = 0; i < (guest.plans ?? []).length; i++) {
    const guestPlan = guest.plans![i];
    const migrated = merged.plans.find(p => p.libraryId === (libraryIdMap.get(guestPlan.libraryId) || guestPlan.libraryId)
      && p.date === guestPlan.date
      && p.name === guestPlan.name);
    if (migrated) planIdMap.set(guestPlan.id, migrated.id);
  }
  for (const guestRecord of guest.records ?? []) {
    const mappedLibraryItem = merged.library.find(l => l.id === (libraryIdMap.get((guestRecord as any).libraryId) || (guestRecord as any).libraryId));
    const record: StudyRecord = {
      ...guestRecord,
      id: recordIds.has(guestRecord.id) ? uniqueId('gr', recordIds) : guestRecord.id,
      planId: planIdMap.get(guestRecord.planId) || guestRecord.planId,
      sourceId: mappedLibraryItem?.type === 'book'
        ? (bookIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
        : mappedLibraryItem?.type === 'course'
          ? (courseIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
          : guestRecord.sourceId,
    };
    merged.records.push(record);
    recordIds.add(record.id);
    preview.recordsToMigrate += 1;
  }

  // 6. Wrong records (photos included) — remap bookId; data URLs are later uploaded
  //    through the media pipeline, so no photo is lost.
  const wrongIds = new Set(merged.wrong.map(w => w.id));
  const validBookIds = new Set(merged.books.map(b => b.id));
  for (const guestWrong of guest.wrong ?? []) {
    const mappedBookId = bookIdMap.get(guestWrong.bookId) || guestWrong.bookId;
    const wrong: WrongRecord = {
      ...guestWrong,
      id: wrongIds.has(guestWrong.id) ? uniqueId('gw', wrongIds) : guestWrong.id,
      bookId: validBookIds.has(mappedBookId) ? mappedBookId : (merged.books[0]?.id ?? mappedBookId),
    };
    merged.wrong.push(wrong);
    wrongIds.add(wrong.id);
    preview.wrongToMigrate += 1;
    if (wrong.image && wrong.image.startsWith('data:image/')) preview.photosToMigrate += 1;
  }

  // 7. Countdowns — only fill empty account dates, never overwrite user dates.
  const accountCountdowns = new Map(merged.countdowns.map(c => [c.id, c]));
  for (const guestCountdown of guest.countdowns ?? []) {
    const current = accountCountdowns.get(guestCountdown.id);
    if (current && !current.date && guestCountdown.date) {
      current.date = guestCountdown.date;
      preview.countdownsToFill += 1;
    } else if (!current) {
      merged.countdowns.push({ ...guestCountdown });
      preview.countdownsToFill += 1;
    }
  }

  // 8. Avatar — only when the account has none.
  if (!merged.profile.avatar && guest.profile?.avatar) {
    merged.profile.avatar = guest.profile.avatar;
    preview.notes.push('已迁移旧版头像（将自动上传为云端附件）');
  }
  if (preview.plansSkipped > 0) {
    preview.notes.push(`${preview.plansSkipped} 条旧日程因来源题本/课程不存在被跳过，其余数据已合并`);
  }
  if (preview.photosToMigrate > 0) {
    preview.notes.push(`${preview.photosToMigrate} 张旧错题照片将在联网后自动上传云端`);
  }

  merged.version = 3;
  return { mergedState: merged, preview };
}
