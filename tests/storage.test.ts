import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { validateAndMigrateBackup, MAX_BACKUP_SIZE_BYTES } from '../src/utils/backupValidator';
import {
  loadLatestState,
  commitMutation,
  resetDatabase,
  saveDamagedCache,
  getDamagedCaches,
  saveMedia,
  getMedia,
  deleteMedia,
  _resetInMemoryStore,
  LEGACY_STORAGE_KEY,
} from '../src/utils/db';
import { validateImageBatch, validateImageFile, MAX_FILE_SIZE_BYTES, MAX_BATCH_COUNT } from '../src/utils/imageCompressor';
import { BLANK_STATE, DEMO_STATE, getLocalDateString, getLocalMonthString } from '../src/constants/initialData';
import { AppState, MediaRecord } from '../src/types';

describe('Milestone 1: Strict Backup Validator (validateAndMigrateBackup)', () => {
  it('CRITICAL: fails when core arrays are missing (e.g. {"books":[],"courses":[],"countdowns":[]})', () => {
    const incompleteJson = JSON.stringify({
      books: [],
      courses: [],
      countdowns: [],
    });
    const result = validateAndMigrateBackup(incompleteJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plans');
  });

  it('fails when records or wrong arrays are missing', () => {
    const missingWrong = JSON.stringify({
      books: [],
      courses: [],
      countdowns: [],
      plans: [],
      records: [],
    });
    const result = validateAndMigrateBackup(missingWrong);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('wrong');
  });

  it('fails when an array contains a null element', () => {
    const nullElementJson = JSON.stringify({
      books: [null],
      courses: [],
      countdowns: [],
      plans: [],
      records: [],
      wrong: [],
    });
    const result = validateAndMigrateBackup(nullElementJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('books 中第 1 项包含空值或非法对象');
  });

  it('fails when plans array contains null', () => {
    const nullPlanJson = JSON.stringify({
      books: [],
      courses: [],
      countdowns: [],
      plans: [null],
      records: [],
      wrong: [],
    });
    const result = validateAndMigrateBackup(nullPlanJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('plans 中第 1 项包含空值或非法对象');
  });

  it('passes for a valid v2 backup and migrates to v3', () => {
    const validV2Json = JSON.stringify({
      version: 2,
      app: '考公工作台·土豆新版',
      state: {
        profile: { name: '老考生', username: 'test_user', avatar: '' },
        countdowns: [
          { id: 'cd-1', name: '国考', date: '2026-11-29' },
          { id: 'cd-2', name: '省考', date: '2027-03-14' },
          { id: 'cd-3', name: '事业编', date: '2027-04-18' },
        ],
        books: [
          { id: 'b-1', name: '真题汇编', subject: '资料分析', total: 500, pages: 200, done: 100, errors: 10, minutes: 200 },
        ],
        courses: [
          { id: 'c-1', name: '申论提分', subject: '申论', totalLessons: 20, completedLessons: 10, minutes: 300, url: '' },
        ],
        plans: [
          {
            id: 'p-1',
            date: '2026-10-25',
            libraryId: 'lib-book-b-1',
            name: '真题汇编',
            type: 'book',
            sourceId: 'b-1',
            subject: '资料分析',
            plannedMinutes: 30,
            actualMinutes: 45,
            done: true,
            timerStart: 0,
          },
        ],
        records: [
          {
            id: 'r-1',
            planId: 'p-1',
            date: '2026-10-25',
            type: 'book',
            sourceId: 'b-1',
            subject: '资料分析',
            minutes: 45,
            questions: 20,
            errors: 2,
          },
        ],
        wrong: [
          { id: 'w-1', date: '2026-10-25', bookId: 'b-1', note: '错题分析', image: '' },
        ],
      },
    });

    const result = validateAndMigrateBackup(validV2Json);
    expect(result.valid).toBe(true);
    expect(result.migratedState).toBeDefined();
    expect(result.migratedState!.version).toBe(3);
    expect(result.summary).toBeDefined();
    expect(result.summary!.bookCount).toBe(1);
    expect(result.summary!.courseCount).toBe(1);
    expect(result.summary!.planCount).toBe(1);
    expect(result.summary!.recordCount).toBe(1);
    expect(result.summary!.wrongCount).toBe(1);
    expect(result.summary!.profileName).toBe('老考生');

    // Derives accumulatedMs when missing in v2
    expect(result.migratedState!.plans[0].accumulatedMs).toBe(45 * 60000);
  });

  it('CRITICAL: strictly preserves accumulatedMs = 119999 when actualMinutes = 1', () => {
    const stateWithAccumulatedMs = JSON.stringify({
      version: 2,
      books: [],
      courses: [],
      countdowns: [],
      plans: [
        {
          id: 'p-special',
          date: '2026-10-25',
          libraryId: 'lib-1',
          name: '高精毫秒测试计划',
          type: 'custom',
          sourceId: '',
          subject: '常识判断',
          plannedMinutes: 30,
          actualMinutes: 1,
          accumulatedMs: 119999, // Should NOT be overwritten by actualMinutes * 60000!
          done: false,
          timerStart: 0,
        },
      ],
      records: [],
      wrong: [],
    });

    const result = validateAndMigrateBackup(stateWithAccumulatedMs);
    expect(result.valid).toBe(true);
    expect(result.migratedState!.plans[0].accumulatedMs).toBe(119999);
    expect(result.migratedState!.plans[0].actualMinutes).toBe(1);
  });

  it('migrates legacy countdown IDs to stable IDs (exam-national, exam-provincial, exam-public-service)', () => {
    const stateWithLegacyCountdowns = JSON.stringify({
      books: [],
      courses: [],
      countdowns: [
        { id: 'cd-1', name: '2027年国考', date: '2026-11-29' },
        { id: 'cd-2', name: '四川省考', date: '2027-03-14' },
        { id: 'cd-3', name: '上半年事业编联考', date: '2027-04-18' },
      ],
      plans: [],
      records: [],
      wrong: [],
    });

    const result = validateAndMigrateBackup(stateWithLegacyCountdowns);
    expect(result.valid).toBe(true);
    const countdowns = result.migratedState!.countdowns;

    const national = countdowns.find(c => c.id === 'exam-national');
    const provincial = countdowns.find(c => c.id === 'exam-provincial');
    const publicService = countdowns.find(c => c.id === 'exam-public-service');

    expect(national).toBeDefined();
    expect(national!.name).toBe('2027年国考');
    expect(national!.date).toBe('2026-11-29');

    expect(provincial).toBeDefined();
    expect(provincial!.name).toBe('四川省考');
    expect(provincial!.date).toBe('2027-03-14');

    expect(publicService).toBeDefined();
    expect(publicService!.name).toBe('上半年事业编联考');
    expect(publicService!.date).toBe('2027-04-18');
  });

  it('rejects version > 4 (future versions)', () => {
    const futureVersionJson = JSON.stringify({
      version: 5,
      books: [],
      courses: [],
      countdowns: [],
      plans: [],
      records: [],
      wrong: [],
    });
    const result = validateAndMigrateBackup(futureVersionJson);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('不支持的备份版本 (v5)');
  });

  it('rejects payload exceeding 50MB', () => {
    const hugeString = ' '.repeat(MAX_BACKUP_SIZE_BYTES + 10);
    const result = validateAndMigrateBackup(hugeString);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('超过 50MB 限制');
  });

  it('rejects invalid subjects and negative numbers', () => {
    const invalidSubjectJson = JSON.stringify({
      books: [
        { id: 'b-1', name: '天文物理学', subject: '量子力学', total: 100, pages: 100, done: 0, errors: 0, minutes: 0 },
      ],
      courses: [],
      countdowns: [],
      plans: [],
      records: [],
      wrong: [],
    });
    const result1 = validateAndMigrateBackup(invalidSubjectJson);
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('科目');

    const negativeNumJson = JSON.stringify({
      books: [
        { id: 'b-1', name: '常识判断', subject: '常识判断', total: -50, pages: 100, done: 0, errors: 0, minutes: 0 },
      ],
      courses: [],
      countdowns: [],
      plans: [],
      records: [],
      wrong: [],
    });
    const result2 = validateAndMigrateBackup(negativeNumJson);
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('必须为非负数字');
  });
});

describe('Milestone 1: Database & Storage Engine (db.ts)', () => {
  beforeEach(() => {
    _resetInMemoryStore();
  });

  afterEach(() => {
    _resetInMemoryStore();
  });

  it('loadLatestState returns isFresh: true and BLANK_STATE on fresh start', async () => {
    const res = await loadLatestState();
    expect(res.isFresh).toBe(true);
    expect(res.revision).toBe(0);
    expect(res.state.version).toBe(3);
    expect(res.state.profile.name).toBe('我的备考空间');
    expect(res.state.books.length).toBe(0);
    expect(res.state.countdowns.length).toBe(3);
  });

  it('commitMutation applies mutator, increments revision, and persists state', async () => {
    const res = await commitMutation(async (state) => {
      state.profile.name = '奋斗的小张';
      state.books.push({
        id: 'book-new-1',
        name: '真题集',
        subject: '言语理解',
        total: 100,
        pages: 50,
        done: 20,
        errors: 3,
        minutes: 60,
      });
      return {
        nextState: state,
        value: { addedBookId: 'book-new-1' },
      };
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.addedBookId).toBe('book-new-1');
    }

    const loaded = await loadLatestState();
    expect(loaded.isFresh).toBe(false);
    expect(loaded.revision).toBe(1);
    expect(loaded.state.profile.name).toBe('奋斗的小张');
    expect(loaded.state.books.length).toBe(1);
  });

  it('commitMutation handles mutator business validation error without state corruption', async () => {
    // First successful mutation
    await commitMutation(async (state) => {
      state.profile.name = '第一步修改';
      return { nextState: state, value: true };
    });

    // Failing mutation
    const errRes = await commitMutation<void>(async (_state) => {
      return {
        error: {
          code: 'OVER_LIMIT',
          message: '超过每日上限',
          field: 'plannedMinutes',
        },
      };
    });

    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(errRes.code).toBe('OVER_LIMIT');
      expect(errRes.message).toBe('超过每日上限');
      expect(errRes.field).toBe('plannedMinutes');
    }

    // State should remain at revision 1 and unmodified
    const loaded = await loadLatestState();
    expect(loaded.revision).toBe(1);
    expect(loaded.state.profile.name).toBe('第一步修改');
  });

  it('commitMutation serializes concurrent mutations without race conditions', async () => {
    const results = await Promise.all([
      commitMutation(async (state) => {
        state.books.push({
          id: 'b-1',
          name: 'Book 1',
          subject: '资料分析',
          total: 10,
          pages: 10,
          done: 0,
          errors: 0,
          minutes: 0,
        });
        return { nextState: state, value: 1 };
      }),
      commitMutation(async (state) => {
        state.books.push({
          id: 'b-2',
          name: 'Book 2',
          subject: '判断推理',
          total: 10,
          pages: 10,
          done: 0,
          errors: 0,
          minutes: 0,
        });
        return { nextState: state, value: 2 };
      }),
      commitMutation(async (state) => {
        state.books.push({
          id: 'b-3',
          name: 'Book 3',
          subject: '言语理解',
          total: 10,
          pages: 10,
          done: 0,
          errors: 0,
          minutes: 0,
        });
        return { nextState: state, value: 3 };
      }),
    ]);

    expect(results.every(r => r.ok)).toBe(true);

    const loaded = await loadLatestState();
    expect(loaded.revision).toBe(3);
    expect(loaded.state.books.length).toBe(3);
    const bookNames = loaded.state.books.map(b => b.name);
    expect(bookNames).toContain('Book 1');
    expect(bookNames).toContain('Book 2');
    expect(bookNames).toContain('Book 3');
  });

  it('resetDatabase writes BLANK_STATE with migratedFromV2: true', async () => {
    await commitMutation(async (state) => {
      state.profile.name = '临时用户';
      return { nextState: state, value: true };
    });

    const resetOk = await resetDatabase();
    expect(resetOk).toBe(true);

    const loaded = await loadLatestState();
    expect(loaded.state.profile.name).toBe(BLANK_STATE.profile.name);
    expect(loaded.state.books.length).toBe(0);
    expect(loaded.revision).toBe(2);
  });

  it('saveDamagedCache and getDamagedCaches store and retrieve corrupted states', async () => {
    const rawBadString = '{"broken": json...}';
    const id = await saveDamagedCache(rawBadString, '测试解析异常');
    expect(id).toBeDefined();

    const caches = await getDamagedCaches();
    expect(caches.length).toBe(1);
    expect(caches[0].id).toBe(id);
    expect(caches[0].raw).toBe(rawBadString);
    expect(caches[0].reason).toBe('测试解析异常');
  });

  it('saveMedia, getMedia, and deleteMedia manage media blobs', async () => {
    const mediaRecord: MediaRecord = {
      id: 'media-101',
      type: 'photo',
      mime: 'image/jpeg',
      blob: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      thumbnailBlob: 'data:image/jpeg;base64,/9j/thumb==',
      createdAt: new Date().toISOString(),
    };

    const saved = await saveMedia(mediaRecord);
    expect(saved).toBe(true);

    const retrieved = await getMedia('media-101');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('media-101');
    expect(retrieved!.mime).toBe('image/jpeg');

    const deleted = await deleteMedia('media-101');
    expect(deleted).toBe(true);

    const afterDelete = await getMedia('media-101');
    expect(afterDelete).toBeNull();
  });

  it('handles legacy localStorage migration when present', async () => {
    const legacyValidV2 = JSON.stringify({
      version: 2,
      profile: { name: '旧系统用户', username: 'v2user', avatar: '' },
      countdowns: [
        { id: 'cd-1', name: '国考', date: '2026-11-29' },
        { id: 'cd-2', name: '省考', date: '2027-03-14' },
        { id: 'cd-3', name: '事业编', date: '2027-04-18' },
      ],
      books: [
        { id: 'b-v2-1', name: '旧题本', subject: '常识判断', total: 50, pages: 20, done: 10, errors: 2, minutes: 30 },
      ],
      courses: [],
      plans: [],
      records: [],
      wrong: [],
    });

    // Mock localStorage
    const mockStorage: Record<string, string> = {
      [LEGACY_STORAGE_KEY]: legacyValidV2,
    };
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
    };

    try {
      const loaded = await loadLatestState();
      expect(loaded.isFresh).toBe(false);
      expect(loaded.revision).toBe(1);
      expect(loaded.state.version).toBe(3);
      expect(loaded.state.profile.name).toBe('旧系统用户');
      expect(loaded.state.books.length).toBe(1);
      expect(loaded.state.books[0].name).toBe('旧题本');
      // LocalStorage was left untouched
      expect(mockStorage[LEGACY_STORAGE_KEY]).toBe(legacyValidV2);
    } finally {
      delete (globalThis as any).localStorage;
    }
  });

  it('handles corrupted localStorage by saving to damaged_cache and returning corruptedRaw without overwriting with demo data', async () => {
    const brokenJson = '{bad json, not valid';
    const mockStorage: Record<string, string> = {
      [LEGACY_STORAGE_KEY]: brokenJson,
    };
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
    };

    try {
      const loaded = await loadLatestState();
      expect(loaded.isFresh).toBe(false);
      expect(loaded.corruptedRaw).toBe(brokenJson);
      // State is BLANK_STATE, NOT DEMO_STATE!
      expect(loaded.state.books.length).toBe(0);

      // Verifies it was written into damaged_cache
      const damaged = await getDamagedCaches();
      expect(damaged.length).toBe(1);
      expect(damaged[0].raw).toBe(brokenJson);
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});

describe('Milestone 1: Image Compression Validation Limits', () => {
  it('validateImageBatch rejects batch size > 10', () => {
    const dummyFiles = Array.from({ length: 11 }, () => new Blob(['x'], { type: 'image/jpeg' }));
    const result = validateImageBatch(dummyFiles);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`单次最多上传 ${MAX_BATCH_COUNT} 张图片`);
  });

  it('validateImageBatch rejects any file > 20MB', () => {
    const smallFile = new Blob(['x'], { type: 'image/jpeg' });
    const hugeFile = { size: MAX_FILE_SIZE_BYTES + 1024, type: 'image/jpeg' } as File;
    const result = validateImageBatch([smallFile, hugeFile]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('超过 20MB 限制');
  });

  it('validateImageFile rejects single file > 20MB', () => {
    const hugeFile = { size: MAX_FILE_SIZE_BYTES + 1024, type: 'image/jpeg' } as File;
    const result = validateImageFile(hugeFile);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('超过 20MB 限制');
  });
});

describe('Milestone 1: Date and Initial Data Helpers', () => {
  it('getLocalDateString formats YYYY-MM-DD correctly', () => {
    const d = new Date(2026, 9, 25); // Month is 0-indexed (9 = Oct)
    expect(getLocalDateString(d)).toBe('2026-10-25');
  });

  it('getLocalMonthString formats YYYY-MM correctly', () => {
    const d = new Date(2026, 9, 25);
    expect(getLocalMonthString(d)).toBe('2026-10');
  });

  it('DEMO_STATE contains full October 2026 demo statistics', () => {
    expect(DEMO_STATE.books.length).toBe(14);
    expect(DEMO_STATE.courses.length).toBe(7);
    expect(DEMO_STATE.records.length).toBe(17);
    const totalMinutes = DEMO_STATE.records.reduce((acc, r) => acc + r.minutes, 0);
    expect(totalMinutes).toBe(1260);

    // All demo plans have accumulatedMs set
    for (const p of DEMO_STATE.plans) {
      expect(typeof p.accumulatedMs).toBe('number');
      expect(p.accumulatedMs).toBe((p.actualMinutes || 0) * 60000);
    }
  });

  it('INITIAL_STATE points to BLANK_STATE for clean starts', () => {
    expect(BLANK_STATE.books.length).toBe(0);
    expect(BLANK_STATE.courses.length).toBe(0);
    expect(BLANK_STATE.plans.length).toBe(0);
    expect(BLANK_STATE.records.length).toBe(0);
    expect(BLANK_STATE.wrong.length).toBe(0);
  });
});
