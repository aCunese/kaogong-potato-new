import {
  AppState,
  Book,
  Course,
  LibraryItem,
  MutationResult,
  OperationScope,
  Plan,
  SnapshotRecord,
  StudyRecord,
  WrongRecord,
} from '../types';
import {
  checkGuestMigrationCredential,
  commitGuestMigrationTransaction,
  CommitGuestMigrationParams,
  loadSnapshot,
  markGuestMigrationDone,
  saveNamedRecoverySnapshot,
  withUserLock,
} from './db';
import { BLANK_STATE } from '../constants/initialData';

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
  const planIdMap = new Map<string, string>();
  const migratedPlans: Plan[] = [];

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

    const newPlanId = planIds.has(guestPlan.id) ? uniqueId('gp', planIds) : guestPlan.id;
    planIdMap.set(guestPlan.id, newPlanId);

    const plan: Plan = {
      ...guestPlan,
      id: newPlanId,
      libraryId: mappedLibraryId,
      sourceId: mappedSourceId,
      // A timer that was running in the old guest session must not keep running.
      timerStart: 0,
      done: Boolean(guestPlan.done),
    };
    merged.plans.push(plan);
    migratedPlans.push(plan);
    planIds.add(plan.id);
    preview.plansToMigrate += 1;
  }

  // 5. Study records — remap plan/source references, keep actual values.
  const recordIds = new Set(merged.records.map(r => r.id));
  const recordIdMap = new Map<string, string>();

  for (const guestRecord of guest.records ?? []) {
    const newRecordId = recordIds.has(guestRecord.id) ? uniqueId('gr', recordIds) : guestRecord.id;
    recordIdMap.set(guestRecord.id, newRecordId);

    const mappedSourceId =
      guestRecord.type === 'book'
        ? (bookIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
        : guestRecord.type === 'course'
          ? (courseIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
          : guestRecord.sourceId;

    const record: StudyRecord = {
      ...guestRecord,
      id: newRecordId,
      planId: planIdMap.get(guestRecord.planId) || guestRecord.planId,
      sourceId: mappedSourceId,
    };
    merged.records.push(record);
    recordIds.add(record.id);
    preview.recordsToMigrate += 1;
  }

  // Bidirectional consistency between plan.recordId and record.planId
  for (const plan of migratedPlans) {
    if (plan.recordId) {
      plan.recordId = recordIdMap.get(plan.recordId) || plan.recordId;
    }
  }

  // Pre-existing orphan references in guest data should be preserved and reported in preview notes without throwing or fabricating false links.
  const mergedPlanIds = new Set(merged.plans.map(p => p.id));
  const mergedBookIds = new Set(merged.books.map(b => b.id));
  const mergedCourseIds = new Set(merged.courses.map(c => c.id));
  const mergedRecordIds = new Set(merged.records.map(r => r.id));

  let orphanRecordCount = 0;
  for (const guestRecord of guest.records ?? []) {
    const finalPlanId = planIdMap.get(guestRecord.planId) || guestRecord.planId;
    const finalSourceId =
      guestRecord.type === 'book'
        ? (bookIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
        : guestRecord.type === 'course'
          ? (courseIdMap.get(guestRecord.sourceId) || guestRecord.sourceId)
          : guestRecord.sourceId;

    const planMissing = Boolean(guestRecord.planId && !mergedPlanIds.has(finalPlanId));
    const sourceMissing =
      guestRecord.type === 'book'
        ? Boolean(guestRecord.sourceId && !mergedBookIds.has(finalSourceId))
        : guestRecord.type === 'course'
          ? Boolean(guestRecord.sourceId && !mergedCourseIds.has(finalSourceId))
          : false;

    if (planMissing || sourceMissing) {
      orphanRecordCount += 1;
    }
  }

  let orphanPlanRecordCount = 0;
  for (const plan of migratedPlans) {
    if (plan.recordId && !mergedRecordIds.has(plan.recordId)) {
      orphanPlanRecordCount += 1;
    }
  }

  if (orphanRecordCount > 0) {
    preview.notes.push(`${orphanRecordCount} 条旧学习记录包含未匹配的计划或实体引用，已保留原始引用`);
  }
  if (orphanPlanRecordCount > 0) {
    preview.notes.push(`${orphanPlanRecordCount} 条旧日程关联的学习记录不存在，已保留原始引用`);
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

export interface ExecuteGuestMigrationOptions {
  userId: string;
  scope?: OperationScope;
  isScopeValid?: (scope: OperationScope) => boolean;
  guard?: () => boolean;
  accountState?: AppState;
  guestState: AppState;
  localRevision?: number;
  expectedRevision?: number;
  loadSnapshotFn?: (userId: string) => Promise<SnapshotRecord | null>;
  saveNamedRecoverySnapshotFn?: (userId: string, state: AppState, revision: number, tag: string) => Promise<void>;
  commitMergedState?: (mergedState: AppState) => Promise<MutationResult<void>>;
  commitMigrationFn?: (params: CommitGuestMigrationParams) => Promise<MutationResult<void>>;
  markDoneFn?: (userId: string) => void;
  outboxBuilder?: (nextState: AppState, meta: any) => any;
}

/**
 * Execute guest data migration to account with strict OperationScope, account lock and epoch validation (Issue A01).
 * 1. Acquires user account lock to coordinate across tabs/sync.
 * 2. Re-reads real account snapshot from DB; aborts with LOCAL_CHANGED if local revision changed since preview.
 * 3. Base merge result and ID remapping on the real account snapshot.
 * 4. Commits via dedicated atomic migration transaction (snapshots, outbox, sync_state).
 */
export async function executeGuestMigration(options: ExecuteGuestMigrationOptions): Promise<MutationResult<void>> {
  const {
    userId,
    scope,
    isScopeValid,
    guard,
    accountState,
    guestState,
    localRevision,
    expectedRevision = localRevision,
    loadSnapshotFn = loadSnapshot,
    saveNamedRecoverySnapshotFn = saveNamedRecoverySnapshot,
    commitMergedState,
    commitMigrationFn = commitGuestMigrationTransaction,
    markDoneFn = markGuestMigrationDone,
    outboxBuilder,
  } = options;

  const checkGuard = (): boolean => {
    if (!userId) return false;
    if (guard && !guard()) return false;
    if (isScopeValid && scope && !isScopeValid(scope)) return false;
    if (scope && typeof (scope as any).isExpired === 'function' && (scope as any).isExpired()) return false;
    return true;
  };

  // 1. Pre-flight epoch / scope verification
  if (!checkGuard()) {
    return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
  }

  // 2. Acquire account lock to ensure exclusive migration execution across tabs
  return await withUserLock(userId, async () => {
    if (!checkGuard()) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
    }

    if (await checkGuestMigrationCredential(userId)) {
      return { ok: true, value: undefined };
    }

    // 3. Re-read real account snapshot from DB under the lock
    const accountSnapshot = await loadSnapshotFn(userId);
    if (!checkGuard()) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
    }

    const currentLocalVersion = accountSnapshot?.revision ?? 0;
    const targetExpectedRevision = expectedRevision !== undefined ? expectedRevision : currentLocalVersion;

    // Check if another page has written data since preview was built
    if (expectedRevision !== undefined && currentLocalVersion !== expectedRevision) {
      return {
        ok: false,
        code: 'LOCAL_CHANGED',
        message: '本地数据已被其他页面修改，请重新确认迁移预览',
      };
    }

    // 4. Generate merge result and ID mapping based on REAL snapshot from DB
    const realAccountState = accountSnapshot ? accountSnapshot.state : (accountState ?? structuredClone(BLANK_STATE));
    const { mergedState } = buildGuestMigration(realAccountState, guestState);

    // 5. If custom commitMergedState is provided (e.g. test suites mocking commit/snapshots):
    if (commitMergedState) {
      try {
        await saveNamedRecoverySnapshotFn(
          userId,
          accountSnapshot?.state ?? realAccountState,
          accountSnapshot?.revision ?? targetExpectedRevision,
          'pre_guest_migration'
        );
        if (!checkGuard()) {
          return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
        }

        await saveNamedRecoverySnapshotFn(userId, guestState, 0, 'guest_pre_migration');
        if (!checkGuard()) {
          return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
        }
      } catch (err) {
        return {
          ok: false,
          code: 'RECOVERY_POINT_FAILED',
          message: err instanceof Error ? err.message : '保存双方恢复点失败，已停止迁移',
        };
      }

      if (!checkGuard()) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
      }

      const result = await commitMergedState(mergedState);
      if (!result.ok) {
        return result;
      }

      if (!checkGuard()) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
      }

      markDoneFn(userId);
      return { ok: true, value: undefined };
    }

    // 6. Dedicated atomic migration commit transaction (production standard path)
    if (!checkGuard()) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
    }

    const commitResult = await commitMigrationFn({
      userId,
      expectedRevision: currentLocalVersion,
      mergedState,
      guestState,
      accountState: realAccountState,
      outboxBuilder,
    });

    if (!commitResult.ok) {
      return commitResult;
    }

    if (!checkGuard()) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止迁移' };
    }

    return { ok: true, value: undefined };
  });
}

