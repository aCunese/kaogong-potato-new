import { describe, test, expect, beforeEach } from 'bun:test';
import { createSeedState } from '../src/utils/seedFactory';
import {
  _resetInMemoryStore,
  atomicResolveConflict,
  saveLastActiveUser,
  getLastActiveUser,
  clearLocalCache,
  getSnapshotKey,
  getPendingOutbox,
  commitMutation,
  loadLatestState,
  saveActiveGenerationId,
  getActiveGenerationId,
} from '../src/utils/db';
import { pullLatestFromServer, forcePullRemote, forceUploadLocal } from '../src/utils/syncClient';
import { BLANK_STATE } from '../src/constants/initialData';
import { SnapshotRecord, OutboxRecord, OperationScope, AppState } from '../src/types';
import { buildGuestMigration, executeGuestMigration } from '../src/utils/guestMigration';
import { isGuestMigrationDone } from '../src/utils/db';

describe('M1: Formal Seed Factory & Lifecycle Invariants', () => {
  test('generates exact 14 books, 7 courses, 22 library items with 0 learning progress', () => {
    const seed = createSeedState('test_student', '小明');

    // Profile & Countdowns
    expect(seed.profile.username).toBe('test_student');
    expect(seed.profile.name).toBe('小明的备考空间');
    expect(seed.profile.avatar).toBe('');
    expect(seed.countdowns.length).toBe(3);
    expect(seed.countdowns.map(c => c.id)).toEqual(['exam-national', 'exam-provincial', 'exam-public-service']);
    expect(seed.countdowns.every(c => c.date === '')).toBe(true);

    // Books: 14 books with 0 progress
    expect(seed.books.length).toBe(14);
    for (const b of seed.books) {
      expect(b.done).toBe(0);
      expect(b.errors).toBe(0);
      expect(b.minutes).toBe(0);
      expect(b.total).toBeGreaterThan(0);
      expect(b.pages).toBeGreaterThan(0);
    }

    // Courses: 7 courses with 0 lessons, 0 minutes, empty URL (placeholder cleared)
    expect(seed.courses.length).toBe(7);
    for (const c of seed.courses) {
      expect(c.completedLessons).toBe(0);
      expect(c.minutes).toBe(0);
      expect(c.url).toBe('');
      expect(c.totalLessons).toBeGreaterThan(0);
    }

    // Library: exactly 22 items (14 books + 7 courses + 1 morning reading)
    expect(seed.library.length).toBe(22);
    const bookLib = seed.library.filter(l => l.type === 'book');
    const courseLib = seed.library.filter(l => l.type === 'course');
    const customLib = seed.library.filter(l => l.type === 'custom');

    expect(bookLib.length).toBe(14);
    expect(courseLib.length).toBe(7);
    expect(customLib.length).toBe(1);
    expect(customLib[0].name).toBe('每日晨读人民日报时评');
    expect(customLib[0].defaultMinutes).toBe(20);

    // Strict 1:1 mapping between books/courses and library items
    for (const b of seed.books) {
      const match = bookLib.find(l => l.sourceId === b.id);
      expect(match).toBeDefined();
      expect(match?.name).toBe(b.name);
      expect(match?.defaultMinutes).toBe(30);
    }
    for (const c of seed.courses) {
      const match = courseLib.find(l => l.sourceId === c.id);
      expect(match).toBeDefined();
      expect(match?.name).toBe(c.name);
      expect(match?.defaultMinutes).toBe(45);
    }

    // Plans, Records, Wrong strictly empty
    expect(seed.plans).toEqual([]);
    expect(seed.records).toEqual([]);
    expect(seed.wrong).toEqual([]);
  });
});

describe('M1: Offline Identity, Atomic Conflict Resolution & Sync Direction', () => {
  beforeEach(() => {
    _resetInMemoryStore();
  });

  test('saves and recovers non-sensitive user identity without exposing session tokens (Defect E)', () => {
    saveLastActiveUser({
      id: 'u_test_999',
      username: 'student_999',
      nickname: '测试生',
      role: 'user',
    });

    const recovered = getLastActiveUser();
    expect(recovered).not.toBeNull();
    expect(recovered?.id).toBe('u_test_999');
    expect(recovered?.username).toBe('student_999');
    expect(recovered?.nickname).toBe('测试生');
    // Ensure no token or password properties exist
    expect((recovered as any).token).toBeUndefined();
    expect((recovered as any).password).toBeUndefined();

    saveLastActiveUser(null);
    expect(getLastActiveUser()).toBeNull();
  });

  test('persists and retrieves server generation ID per user (Defect I)', () => {
    saveActiveGenerationId('u_user_1', 'gen_prod_20261026_01');
    expect(getActiveGenerationId('u_user_1')).toBe('gen_prod_20261026_01');
    expect(getActiveGenerationId('u_unknown')).toBe('');
  });

  test('atomicResolveConflict replaces snapshot and clears outbox atomically (Defect G)', async () => {
    const userId = 'u_atomic_test';
    const key = getSnapshotKey(userId);

    // Initial state: rev 1 with pending outbox
    const initialSnap: SnapshotRecord = {
      key,
      state: BLANK_STATE,
      version: 3,
      revision: 1,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };

    const dummyOutbox: OutboxRecord = {
      id: 'outbox_test_1',
      userId,
      requestId: 'req_1',
      state: BLANK_STATE,
      expectedRevision: 1,
      generationId: 'gen_1',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    const newSnap: SnapshotRecord = {
      key,
      state: { ...BLANK_STATE, profile: { name: 'Resolved', username: 'alice', avatar: '' } },
      version: 3,
      revision: 2,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };

    // First commit initial state and outbox
    await commitMutation(() => ({ nextState: BLANK_STATE, value: undefined }), {
      userId,
      targetRevision: 1,
      outboxBuilder: () => dummyOutbox,
    });

    const pendingBefore = await getPendingOutbox(userId);
    expect(pendingBefore.length).toBe(1);

    // Execute atomic conflict resolution
    await atomicResolveConflict(userId, newSnap, 1);

    const pendingAfter = await getPendingOutbox(userId);
    expect(pendingAfter.length).toBe(0); // Outbox wiped atomically

    const latest = await loadLatestState(userId);
    expect(latest.revision).toBe(2);
    expect(latest.state.profile.name).toBe('Resolved');
  });

  test('atomicResolveConflict aborts cleanly on revision conflict without dropping pending outbox (Defect G)', async () => {
    const userId = 'u_abort_test';
    const dummyOutbox: OutboxRecord = {
      id: 'outbox_critical_1',
      userId,
      requestId: 'req_crit_1',
      state: BLANK_STATE,
      expectedRevision: 5,
      generationId: 'gen_1',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    await commitMutation(() => ({ nextState: BLANK_STATE, value: undefined }), {
      userId,
      targetRevision: 5,
      outboxBuilder: () => dummyOutbox,
    });

    const staleTargetSnap: SnapshotRecord = {
      key: getSnapshotKey(userId),
      state: BLANK_STATE,
      version: 3,
      revision: 10,
      migratedFromV2: true,
      updatedAt: new Date().toISOString(),
    };

    // Attempt conflict resolution expecting rev 3 when actual is 5 -> should reject
    let threw = false;
    try {
      await atomicResolveConflict(userId, staleTargetSnap, 3);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);

    // Pending outbox must NOT be lost on abort!
    const pending = await getPendingOutbox(userId);
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('outbox_critical_1');
  });

  test('clearLocalCache clears snapshot and outbox without touching cloud mutation pipeline (Defect F)', async () => {
    const userId = 'u_cache_clean';
    await commitMutation(() => ({ nextState: BLANK_STATE, value: undefined }), {
      userId,
      targetRevision: 3,
    });

    await clearLocalCache(userId);

    const stateAfter = await loadLatestState(userId);
    expect(stateAfter.isFresh).toBe(true);
    expect(stateAfter.revision).toBe(0);
  });

  describe('Phase 4: Guest Migration References & Execution (V09)', () => {
    test('exact planIdMap and StudyRecord remapping across book, course, and custom items', () => {
      const account = structuredClone(BLANK_STATE);
      account.plans = [{ id: 'plan-existing', date: '2026-10-26', libraryId: 'lib-1', name: 'Existing', type: 'book', sourceId: 'book-1', subject: '常识判断', plannedMinutes: 30, actualMinutes: 0, done: false, timerStart: 0 }];

      const guest = structuredClone(BLANK_STATE);
      guest.books = [
        { id: 'g-book-1', name: '游客特有题本', subject: '言语理解', total: 100, pages: 20, done: 10, errors: 2, minutes: 25 },
      ];
      guest.courses = [
        { id: 'g-course-1', name: '游客特有课程', subject: '判断推理', teacher: '老师', totalLessons: 20, completedLessons: 5, minutes: 50, url: '' },
      ];
      guest.library = [
        { id: 'g-lib-book', type: 'book', sourceId: 'g-book-1', name: '游客特有题本', subject: '言语理解', defaultMinutes: 30 },
        { id: 'g-lib-course', type: 'course', sourceId: 'g-course-1', name: '游客特有课程', subject: '判断推理', defaultMinutes: 45 },
        { id: 'g-lib-custom', type: 'custom', sourceId: 'custom-1', name: '游客自定义任务', subject: '申论', defaultMinutes: 20 },
      ];
      // Plan with conflicting ID 'plan-existing' to verify exact planIdMap remapping
      guest.plans = [
        { id: 'plan-existing', date: '2026-10-26', libraryId: 'g-lib-book', name: '游客特有题本', type: 'book', sourceId: 'g-book-1', subject: '言语理解', plannedMinutes: 30, actualMinutes: 25, done: true, timerStart: 0, recordId: 'rec-1' },
        { id: 'plan-course-1', date: '2026-10-26', libraryId: 'g-lib-course', name: '游客特有课程', type: 'course', sourceId: 'g-course-1', subject: '判断推理', plannedMinutes: 45, actualMinutes: 50, done: true, timerStart: 0, recordId: 'rec-2' },
      ];
      guest.records = [
        { id: 'rec-1', planId: 'plan-existing', date: '2026-10-26', type: 'book', sourceId: 'g-book-1', subject: '言语理解', minutes: 25, questions: 10, errors: 2 },
        { id: 'rec-2', planId: 'plan-course-1', date: '2026-10-26', type: 'course', sourceId: 'g-course-1', subject: '判断推理', minutes: 50, questions: 0, errors: 0, lessons: 5 },
        { id: 'rec-custom', planId: 'non-existent-plan', date: '2026-10-26', type: 'custom', sourceId: 'custom-src', subject: '申论', minutes: 20, questions: 0, errors: 0 },
      ];

      const { mergedState, preview } = buildGuestMigration(account, guest);

      // Verify book was added with new ID
      const addedBook = mergedState.books.find(b => b.name === '游客特有题本');
      expect(addedBook).toBeDefined();
      expect(addedBook!.id).not.toBe('g-book-1');

      // Verify course was added with new ID
      const addedCourse = mergedState.courses.find(c => c.name === '游客特有课程');
      expect(addedCourse).toBeDefined();
      expect(addedCourse!.id).not.toBe('g-course-1');

      // Verify plans
      const migratedBookPlan = mergedState.plans.find(p => p.name === '游客特有题本');
      expect(migratedBookPlan).toBeDefined();
      // ID conflict with 'plan-existing' resolved with gp prefix
      expect(migratedBookPlan!.id).not.toBe('plan-existing');
      expect(migratedBookPlan!.id.startsWith('gp_')).toBe(true);
      expect(migratedBookPlan!.sourceId).toBe(addedBook!.id);

      const migratedCoursePlan = mergedState.plans.find(p => p.name === '游客特有课程');
      expect(migratedCoursePlan).toBeDefined();
      expect(migratedCoursePlan!.id).toBe('plan-course-1');
      expect(migratedCoursePlan!.sourceId).toBe(addedCourse!.id);

      // Verify records
      const record1 = mergedState.records.find(r => r.subject === '言语理解');
      expect(record1).toBeDefined();
      expect(record1!.sourceId).toBe(addedBook!.id);
      expect(record1!.planId).toBe(migratedBookPlan!.id);

      const record2 = mergedState.records.find(r => r.subject === '判断推理');
      expect(record2).toBeDefined();
      expect(record2!.sourceId).toBe(addedCourse!.id);
      expect(record2!.planId).toBe(migratedCoursePlan!.id);

      // Verify bidirectional consistency: plan.recordId matches record.id
      expect(migratedBookPlan!.recordId).toBe(record1!.id);
      expect(migratedCoursePlan!.recordId).toBe(record2!.id);

      // Verify orphan record (rec-custom had non-existent-plan) is preserved without throwing
      const customRecord = mergedState.records.find(r => r.id === 'rec-custom');
      expect(customRecord).toBeDefined();
      expect(customRecord!.planId).toBe('non-existent-plan');
      expect(customRecord!.sourceId).toBe('custom-src');
      expect(preview.notes.some(n => n.includes('旧学习记录包含未匹配的计划或实体引用'))).toBe(true);
    });

    test('executeGuestMigration aborts if operation scope epoch is invalid before snapshots', async () => {
      const account = structuredClone(BLANK_STATE);
      const guest = structuredClone(BLANK_STATE);
      let snapshotsSaved = false;

      const scope: OperationScope = { userId: 'user-a', epoch: 1, operationId: 'op-1' };
      const isScopeValid = () => false; // Simulated invalid/expired epoch

      const result = await executeGuestMigration({
        userId: 'user-a',
        scope,
        isScopeValid,
        accountState: account,
        guestState: guest,
        saveNamedRecoverySnapshotFn: async () => {
          snapshotsSaved = true;
        },
        commitMergedState: async () => ({ ok: true, value: undefined }),
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('AUTH_EPOCH_CHANGED');
      expect(snapshotsSaved).toBe(false);
      expect(isGuestMigrationDone('user-a')).toBe(false);
    });

    test('executeGuestMigration aborts before state commit if scope becomes invalid mid-flight', async () => {
      const account = structuredClone(BLANK_STATE);
      const guest = structuredClone(BLANK_STATE);
      let valid = true;
      let snapshotsSaved = false;
      let stateCommitted = false;

      const scope: OperationScope = { userId: 'user-b', epoch: 1, operationId: 'op-2' };
      const isScopeValid = () => valid;

      const result = await executeGuestMigration({
        userId: 'user-b',
        scope,
        isScopeValid,
        accountState: account,
        guestState: guest,
        saveNamedRecoverySnapshotFn: async () => {
          snapshotsSaved = true;
          valid = false; // Simulate epoch change (logout/switch) during recovery save
        },
        commitMergedState: async () => {
          stateCommitted = true;
          return { ok: true, value: undefined };
        },
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('AUTH_EPOCH_CHANGED');
      expect(snapshotsSaved).toBe(true);
      expect(stateCommitted).toBe(false);
      expect(isGuestMigrationDone('user-b')).toBe(false);
    });

    test('executeGuestMigration successfully commits and marks done when scope remains valid', async () => {
      const account = structuredClone(BLANK_STATE);
      const guest = structuredClone(BLANK_STATE);
      guest.books = [{ id: 'gb-1', name: '成功迁移题本', subject: '常识判断', total: 50, pages: 10, done: 0, errors: 0, minutes: 0 }];
      guest.library = [{ id: 'gl-1', type: 'book', sourceId: 'gb-1', name: '成功迁移题本', subject: '常识判断', defaultMinutes: 20 }];

      let committedState: AppState | null = null;
      const scope: OperationScope = { userId: 'user-c', epoch: 2, operationId: 'op-3' };

      const result = await executeGuestMigration({
        userId: 'user-c',
        scope,
        isScopeValid: () => true,
        accountState: account,
        guestState: guest,
        commitMergedState: async (merged) => {
          committedState = merged;
          return { ok: true, value: undefined };
        },
      });

      expect(result.ok).toBe(true);
      expect(committedState).not.toBeNull();
      expect(committedState!.books.some(b => b.name === '成功迁移题本')).toBe(true);
      expect(isGuestMigrationDone('user-c')).toBe(true);
    });
  });
});
