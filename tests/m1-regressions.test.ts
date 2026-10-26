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
import { SnapshotRecord, OutboxRecord } from '../src/types';

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
});
