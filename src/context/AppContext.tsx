import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
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
  MutationResult,
  CompletionInput,
  User,
  SyncState,
} from '../types';
import { INITIAL_STATE, BLANK_STATE, DEMO_STATE, getLocalDateString } from '../constants/initialData';
import { validateAndMigrateBackup } from '../utils/backupValidator';
import {
  loadLatestState,
  commitMutation,
  resetDatabase,
  createPortableBackupState,
  setActiveUserPartition,
  clearOutbox,
  saveLastActiveUser,
  getLastActiveUser,
  clearLocalCache,
  getActiveGenerationId,
} from '../utils/db';
import {
  syncNormal,
  syncOutboxWithServer,
  pullLatestFromServer,
  forcePullRemote,
  forceUploadLocal,
  SyncResult,
} from '../utils/syncClient';
import { createSeedState } from '../utils/seedFactory';
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
  applyUpdateLibraryMinutes,
  applyDeleteCustomItem,
  applyAddWrongRecords,
  applyDeleteWrongRecord,
  applyUpdateProfile,
  applyUpdateCountdown,
  MutatorReturn,
} from '../utils/workflowMutators';

export interface AppContextType {
  state: AppState;
  activeDate: string;
  setActiveDate: (d: string) => void;
  storageError: string | null;
  clearStorageError: () => void;
  isLoading: boolean;
  corruptedRaw: string | null;
  clearCorruptedRaw: () => void;

  // Countdowns
  updateCountdown: (id: string, date: string) => Promise<MutationResult<void>>;

  // Plans & Timers
  addPlan: (libraryId: string, plannedMinutes?: number) => Promise<MutationResult<Plan>>;
  quickAddPlan: (libraryId: string) => Promise<MutationResult<Plan>>;
  startTimer: (planId: string) => Promise<MutationResult<void>>;
  pauseTimer: (planId: string) => Promise<MutationResult<void>>;
  deletePlan: (planId: string) => Promise<MutationResult<void>>;

  // Unified Atomic Completion
  completePlan: (input: CompletionInput) => Promise<MutationResult<{ recordId: string; record: StudyRecord }>>;

  // Backward-compatible Completion Wrappers
  completeBookPlan: (planId: string, questions: number, errors: number, actualMinutes: number) => Promise<{ success: boolean; error?: string }>;
  completeCoursePlan: (planId: string, completedLessons: number, actualMinutes: number) => Promise<{ success: boolean; error?: string }>;
  completeCustomPlan: (planId: string, actualMinutes: number) => Promise<{ success: boolean; error?: string }>;

  // Books
  addBook: (book: Omit<Book, 'id'>) => Promise<MutationResult<string>>;
  editBook: (id: string, updates: Partial<Book>) => Promise<MutationResult<void>>;
  deleteBook: (id: string) => Promise<MutationResult<void>>;

  // Courses
  addCourse: (course: Omit<Course, 'id'>) => Promise<MutationResult<string>>;
  editCourse: (id: string, updates: Partial<Course>) => Promise<MutationResult<void>>;
  deleteCourse: (id: string) => Promise<MutationResult<void>>;

  // Library
  addCustomItem: (name: string, subject: Subject, defaultMinutes: number) => Promise<MutationResult<LibraryItem>>;
  updateLibraryMinutes: (id: string, defaultMinutes: number) => Promise<MutationResult<void>>;
  deleteCustomItem: (id: string) => Promise<MutationResult<void>>;

  // Wrong records
  addWrongRecords: (bookId: string, note: string, images: string[]) => Promise<MutationResult<WrongRecord[]>>;
  deleteWrongRecord: (id: string) => Promise<MutationResult<void>>;

  // Profile
  updateProfile: (name: string, avatar?: string) => Promise<MutationResult<Profile>>;

  // System
  resetState: () => Promise<MutationResult<void>>;
  exportBackup: () => Promise<MutationResult<void>>;
  importBackup: (jsonContent: string) => Promise<MutationResult<{ summary: string }>>;
  selfCheck: () => { ok: boolean; message: string; details: string[] };

  // Auth & Cloud Sync
  currentUser: User | null;
  csrfToken: string | null;
  syncStatus: SyncState;
  syncMessage: string | null;
  conflictData: { serverRevision: number; serverState: AppState | null } | null;
  localRevision: number;
  login: (username: string, password: string) => Promise<MutationResult<User>>;
  register: (username: string, password: string, nickname: string, inviteCode: string) => Promise<MutationResult<User>>;
  logout: () => Promise<void>;
  triggerSync: () => Promise<SyncResult>;
  forceUpload: () => Promise<SyncResult>;
  forcePull: () => Promise<SyncResult>;
  clearLocalData: () => Promise<void>;
  importSeedTemplate: () => Promise<MutationResult<void>>;
  resolveConflict: (choice: 'keep_local' | 'keep_remote') => Promise<MutationResult<void>>;

  // Offline & Auto-Update
  offlineReady: boolean;
  updateInfo: { version: string; build: string; summary: string } | null;
  dismissUpdate: () => void;
  applyUpdate: () => boolean;
  isAnyTimerRunning: () => boolean;
}

const AppContext = createContext<AppContextType | null>(null);

function createPreviewState(): AppState {
  const demo = structuredClone(DEMO_STATE);
  const course = demo.library.find(item => item.type === 'course');
  if (course && !demo.plans.some(plan => plan.type === 'course' && !plan.done)) {
    demo.plans.push({
      id: 'preview-course-plan', date: '2026-10-25', libraryId: course.id,
      name: course.name, type: course.type, sourceId: course.sourceId, subject: course.subject,
      plannedMinutes: course.defaultMinutes, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0,
    });
  }
  return demo;
}

export const AppProvider: React.FC<{ children: ReactNode; preview?: boolean }> = ({ children, preview = false }) => {
  const [state, setState] = useState<AppState>(() => preview ? createPreviewState() : INITIAL_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(!preview);
  const readyRef = useRef(preview);
  const previewStateRef = useRef(state);
  const previewQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [corruptedRaw, setCorruptedRaw] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Auth & Cloud Sync States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncState>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<{ serverRevision: number; serverState: AppState | null } | null>(null);

  // Offline & Auto-Update States
  const [offlineReady, setOfflineReady] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; build: string; summary: string } | null>(null);

  // Local Date Management: Initialize with getLocalDateString()
  const [activeDate, setActiveDate] = useState<string>(() => preview ? '2026-10-25' : getLocalDateString());

  const clearStorageError = useCallback(() => {
    setStorageError(null);
  }, []);

  const clearCorruptedRaw = useCallback(() => {
    setCorruptedRaw(null);
  }, []);

  const [localRevision, setLocalRevision] = useState<number>(1);
  const localRevisionRef = useRef<number>(1);
  const authEpochRef = useRef<number>(0);

  // Forward declaration of triggerSync for background calls
  const triggerSyncRef = useRef<() => Promise<SyncResult>>(async () => ({ ok: false, status: 'offline' }));

  // 1. Initial State Load: check current authenticated session and load partitioned IndexedDB
  useEffect(() => {
    if (preview) return;
    let mounted = true;
    const epoch = authEpochRef.current;

    fetch('/api/auth/me')
      .then(async r => {
        if (r.ok) {
          const authData = await r.json();
          if (authData.ok && authData.user) {
            if (mounted && authEpochRef.current === epoch) {
              setCurrentUser(authData.user);
              setCsrfToken(authData.csrfToken);
              saveLastActiveUser(authData.user);
            }
            setActiveUserPartition(authData.user.id);
            return loadLatestState(authData.user.id);
          }
        }
        // Explicit 401 or 403: session expired / invalid
        saveLastActiveUser(null);
        setActiveUserPartition(null);
        return loadLatestState(null);
      })
      .catch(() => {
        // Network error during cold start -> fallback to cached non-sensitive user identity (Defect E)
        const cachedUser = getLastActiveUser();
        if (cachedUser) {
          if (mounted && authEpochRef.current === epoch) {
            setCurrentUser({
              id: cachedUser.id,
              username: cachedUser.username,
              nickname: cachedUser.nickname,
              role: cachedUser.role,
            });
            setSyncStatus('idle');
            setSyncMessage('离线模式：已加载本机备考空间');
          }
          setActiveUserPartition(cachedUser.id);
          return loadLatestState(cachedUser.id);
        }
        setActiveUserPartition(null);
        return loadLatestState(null);
      })
      .then(res => {
        if (!mounted || authEpochRef.current !== epoch) return;
        readyRef.current = true;
        setLocalRevision(res.revision);
        localRevisionRef.current = res.revision;
        setState(res.state);
        if (res.corruptedRaw) {
          setCorruptedRaw(res.corruptedRaw);
          setStorageError('检测到受损的旧版数据缓存，已安全隔离至受损数据表，未覆盖初始空白状态。');
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error('加载本地数据库异常:', err);
        if (mounted && authEpochRef.current === epoch) {
          readyRef.current = false;
          setStorageError('加载本地数据失败，已暂停保存以保护原数据。请刷新页面重试。');
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [preview]);

  // 2. Cross-day, Midnight Rollover, Network Sync, and Auto-Update Check Listeners
  const checkVersion = useCallback(async () => {
    if (preview || typeof window === 'undefined') return;
    try {
      const res = await fetch('/version.json?_t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const currentBuild = '20261026.02';
      if (data.build && data.build > currentBuild) {
        setUpdateInfo({
          version: data.version || '1.0.1',
          build: data.build,
          summary: data.summary || '发现新版本发布',
        });
      }
    } catch {}
  }, [preview]);

  const dismissUpdate = useCallback(() => {
    setUpdateInfo(null);
  }, []);

  const isAnyTimerRunning = useCallback((): boolean => {
    return state.plans.some(p => !p.done && p.timerStart > 0);
  }, [state.plans]);

  const applyUpdate = useCallback((): boolean => {
    if (isAnyTimerRunning()) {
      return false;
    }
    window.location.reload();
    return true;
  }, [isAnyTimerRunning]);

  // Offline Readiness Check: lights up when IndexedDB is loaded and SW is controlling the page
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isLoading || storageError) {
      setOfflineReady(false);
      return;
    }

    if (preview) {
      setOfflineReady(true);
      return;
    }

    if ('serviceWorker' in navigator) {
      const checkReady = () => {
        if (navigator.serviceWorker.controller && !isLoading && !storageError) {
          setOfflineReady(true);
        }
      };

      if (navigator.serviceWorker.controller) {
        setOfflineReady(true);
      }

      navigator.serviceWorker.ready
        .then(() => {
          setOfflineReady(true);
        })
        .catch(() => {});

      navigator.serviceWorker.addEventListener('controllerchange', checkReady);
      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', checkReady);
      };
    } else {
      setOfflineReady(true);
    }
  }, [isLoading, storageError, preview]);

  useEffect(() => {
    if (preview) return;
    const checkMidnightRollover = () => {
      const today = getLocalDateString();
      setActiveDate(prev => {
        if (prev !== today) {
          return today;
        }
        return prev;
      });
    };

    const handleWindowFocus = () => {
      checkMidnightRollover();
      triggerSyncRef.current().catch(() => {});
      checkVersion().catch(() => {});
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkMidnightRollover();
        triggerSyncRef.current().catch(() => {});
        checkVersion().catch(() => {});
      }
    };

    const handleOnline = () => {
      triggerSyncRef.current().catch(() => {});
      checkVersion().catch(() => {});
    };

    // Run initial version check
    checkVersion().catch(() => {});

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = setInterval(checkMidnightRollover, 30000);
    const updateInterval = setInterval(() => checkVersion().catch(() => {}), 30 * 60 * 1000);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
      clearInterval(updateInterval);
    };
  }, [preview, checkVersion]);

  // 3. Trigger Sync implementation
  const triggerSync = useCallback(async (): Promise<SyncResult> => {
    if (preview || !currentUser) {
      return { ok: false, status: 'offline', message: '未登录云端账号' };
    }
    setSyncStatus('syncing');
    setSyncMessage('正在同步最新学情...');
    const result = await syncOutboxWithServer(currentUser.id, csrfToken || '');
    if (result.status === 'conflict') {
      setSyncStatus('conflict');
      setConflictData({
        serverRevision: result.serverRevision || 0,
        serverState: result.serverState || null,
      });
      setSyncMessage(result.message || '检测到版本冲突');
    } else if (result.status === 'synced') {
      setSyncStatus('synced');
      setSyncMessage('已完成云端同步');
      setConflictData(null);
      if (result.serverState) {
        setState(result.serverState);
      }
    } else if (result.status === 'offline') {
      setSyncStatus('idle');
      setSyncMessage('已离线保存');
    } else {
      setSyncStatus('failed');
      setSyncMessage(result.message || '同步失败');
    }
    return result;
  }, [preview, currentUser, csrfToken]);

  triggerSyncRef.current = triggerSync;

  // Serial transaction executor via commitMutation (db.ts)
  const executeMutation = useCallback(
    async <T,>(
      mutator: (draft: AppState) => Promise<MutatorReturn<T>> | MutatorReturn<T>
    ): Promise<MutationResult<T>> => {
      if (!readyRef.current) {
        return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未成功加载，已阻止保存。请刷新页面重试。' };
      }
      if (preview) {
        const task = previewQueueRef.current.then(async (): Promise<MutationResult<T>> => {
          try {
            const result = await mutator(structuredClone(previewStateRef.current));
            if ('error' in result) return { ok: false, ...result.error };
            previewStateRef.current = result.nextState;
            setState(result.nextState);
            return { ok: true, value: result.value };
          } catch (err) {
            return { ok: false, code: 'COMMIT_FAILED', message: err instanceof Error ? err.message : String(err) };
          }
        });
        previewQueueRef.current = task.catch(() => {});
        return task;
      }
      let appliedNextState: AppState | null = null;
      const result = await commitMutation<T>(async draft => {
        const res = await mutator(draft);
        if ('nextState' in res) {
          appliedNextState = res.nextState;
        }
        return res;
      }, {
        userId: currentUser?.id ?? null,
        outboxBuilder: currentUser ? (nextState, nextRevision) => ({
          id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          userId: currentUser.id,
          requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          state: nextState,
          expectedRevision: nextRevision - 1,
          generationId: getActiveGenerationId(currentUser.id),
          createdAt: new Date().toISOString(),
          status: 'pending',
        }) : undefined,
      });

      if (result.ok && appliedNextState) {
        localRevisionRef.current += 1;
        setLocalRevision(localRevisionRef.current);
        setState(appliedNextState);
        if (currentUser && navigator.onLine) {
          triggerSync().catch(() => {});
        }
      } else if (!result.ok && (result.code === 'COMMIT_FAILED' || result.code === 'REVISION_CONFLICT')) {
        setStorageError(result.message);
        if (result.code === 'REVISION_CONFLICT') {
          try { setState((await loadLatestState(currentUser?.id ?? null)).state); } catch { readyRef.current = false; }
        }
      }
      return result;
    },
    [preview, currentUser, triggerSync]
  );

  // ----------------------------------------------------------------------
  // Countdowns
  // ----------------------------------------------------------------------
  const updateCountdown = useCallback(
    async (id: string, date: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyUpdateCountdown(draft, id, date));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Plans & Timers
  // ----------------------------------------------------------------------
  const addPlan = useCallback(
    async (libraryId: string, plannedMinutes?: number): Promise<MutationResult<Plan>> => {
      return executeMutation(draft => applyAddPlan(draft, libraryId, activeDate, plannedMinutes));
    },
    [activeDate, executeMutation]
  );

  const quickAddPlan = useCallback(
    async (libraryId: string): Promise<MutationResult<Plan>> => {
      return executeMutation(draft => applyQuickAddPlan(draft, libraryId, activeDate));
    },
    [activeDate, executeMutation]
  );

  const startTimer = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyStartTimer(draft, planId));
    },
    [executeMutation]
  );

  const pauseTimer = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyPauseTimer(draft, planId));
    },
    [executeMutation]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeletePlan(draft, planId));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Unified Atomic Completion
  // ----------------------------------------------------------------------
  const completePlan = useCallback(
    async (
      input: CompletionInput
    ): Promise<MutationResult<{ recordId: string; record: StudyRecord }>> => {
      return executeMutation(draft => applyCompletePlan(draft, input));
    },
    [executeMutation]
  );

  // Backward-compatible delegates
  const completeBookPlan = useCallback(
    async (planId: string, questions: number, errors: number, actualMinutes: number) => {
      const res = await completePlan({
        type: 'book',
        planId,
        questions,
        errors,
        minutes: actualMinutes,
      });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  const completeCoursePlan = useCallback(
    async (planId: string, completedLessons: number, actualMinutes: number) => {
      const res = await completePlan({
        type: 'course',
        planId,
        lessons: completedLessons,
        minutes: actualMinutes,
      });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  const completeCustomPlan = useCallback(
    async (planId: string, actualMinutes: number) => {
      const res = await completePlan({
        type: 'custom',
        planId,
        minutes: actualMinutes,
      });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  // ----------------------------------------------------------------------
  // Books
  // ----------------------------------------------------------------------
  const addBook = useCallback(
    async (bookData: Omit<Book, 'id'>): Promise<MutationResult<string>> => {
      return executeMutation(draft => applyAddBook(draft, bookData));
    },
    [executeMutation]
  );

  const editBook = useCallback(
    async (id: string, updates: Partial<Book>): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyEditBook(draft, id, updates));
    },
    [executeMutation]
  );

  const deleteBook = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteBook(draft, id));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Courses
  // ----------------------------------------------------------------------
  const addCourse = useCallback(
    async (courseData: Omit<Course, 'id'>): Promise<MutationResult<string>> => {
      return executeMutation(draft => applyAddCourse(draft, courseData));
    },
    [executeMutation]
  );

  const editCourse = useCallback(
    async (id: string, updates: Partial<Course>): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyEditCourse(draft, id, updates));
    },
    [executeMutation]
  );

  const deleteCourse = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteCourse(draft, id));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Library
  // ----------------------------------------------------------------------
  const addCustomItem = useCallback(
    async (name: string, subject: Subject, defaultMinutes: number): Promise<MutationResult<LibraryItem>> => {
      return executeMutation(draft => applyAddCustomItem(draft, name, subject, defaultMinutes));
    },
    [executeMutation]
  );

  const updateLibraryMinutes = useCallback(
    async (id: string, defaultMinutes: number): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyUpdateLibraryMinutes(draft, id, defaultMinutes));
    },
    [executeMutation]
  );

  const deleteCustomItem = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteCustomItem(draft, id));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Wrong records
  // ----------------------------------------------------------------------
  const addWrongRecords = useCallback(
    async (bookId: string, note: string, images: string[]): Promise<MutationResult<WrongRecord[]>> => {
      return executeMutation(draft => applyAddWrongRecords(draft, bookId, activeDate, note, images));
    },
    [activeDate, executeMutation]
  );

  const deleteWrongRecord = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteWrongRecord(draft, id));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // Profile
  // ----------------------------------------------------------------------
  const updateProfile = useCallback(
    async (name: string, avatar?: string): Promise<MutationResult<Profile>> => {
      return executeMutation(draft => applyUpdateProfile(draft, name, avatar));
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // System: Reset, Clear Local Cache, Import Seed Template, Backup, Import
  // ----------------------------------------------------------------------
  const clearLocalData = useCallback(async (): Promise<void> => {
    if (preview) {
      setState(createPreviewState());
      return;
    }
    await clearLocalCache(currentUser?.id ?? null);
    const refreshed = await loadLatestState(currentUser?.id ?? null);
    setState(refreshed.state);
    localRevisionRef.current = refreshed.revision;
    setLocalRevision(refreshed.revision);
    setSyncStatus('idle');
    setSyncMessage('已清除本机缓存，下次联网将重新拉取云端数据');
  }, [preview, currentUser]);

  const resetState = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未成功加载，无法重置。' };
    if (preview) return executeMutation(() => ({ nextState: createPreviewState(), value: undefined }));

    if (!currentUser) {
      // Guest mode reset
      try {
        const reset = await resetDatabase(null);
        if (!reset) throw new Error('重置未成功，原数据已保留。');
        setState(structuredClone(BLANK_STATE));
        localRevisionRef.current = 1;
        setLocalRevision(1);
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          code: 'RESET_FAILED',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Authenticated user reset: business mutation (Defect F)
    // 1. Clear study plans, records and wrong entries
    // 2. Reset progress on books and courses to 0
    // 3. Keep profile and countdown configurations intact
    // 4. Commits through standard mutation pipeline to enqueue sync to cloud
    return executeMutation(draft => {
      draft.plans = [];
      draft.records = [];
      draft.wrong = [];
      for (const b of draft.books) {
        b.done = 0;
        b.errors = 0;
        b.minutes = 0;
      }
      for (const c of draft.courses) {
        c.completedLessons = 0;
        c.minutes = 0;
      }
      return { nextState: draft, value: undefined };
    });
  }, [preview, currentUser, executeMutation]);

  const importSeedTemplate = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未就绪' };
    const seed = createSeedState(currentUser?.username || 'user', currentUser?.nickname || '同学');
    return executeMutation(draft => {
      draft.books = seed.books;
      draft.courses = seed.courses;
      draft.library = seed.library;
      return { nextState: draft, value: undefined };
    });
  }, [currentUser, executeMutation]);

  const exportBackup = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未成功加载，无法导出备份。' };
    try {
      const latest = preview ? previewStateRef.current : (await loadLatestState()).state;
      const portable = await createPortableBackupState(latest, { isPreview: preview });
      const backupObj = {
        app: '考公工作台·土豆新版',
        version: 3,
        exportedAt: new Date().toISOString(),
        state: portable,
      };
      const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `考公工作台-土豆新版备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { ok: true, value: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStorageError(message);
      return { ok: false, code: 'EXPORT_FAILED', message };
    }
  }, [preview]);

  const importBackup = useCallback(
    async (jsonContent: string): Promise<MutationResult<{ summary: string }>> => {
      const validated = validateAndMigrateBackup(jsonContent);
      if (!validated.valid || !validated.migratedState) {
        return {
          ok: false,
          code: 'INVALID_BACKUP',
          message: validated.error || '备份文件校验失败',
        };
      }
      const nextState = validated.migratedState;
      return executeMutation(async () => {
        return {
          nextState,
          value: {
            summary: `成功恢复备份，含 ${nextState.plans.length} 条日程与 ${nextState.records.length} 条做题记录`,
          },
        };
      });
    },
    [executeMutation]
  );

  const selfCheck = useCallback(() => {
    const bookIds = new Set(state.books.map(b => b.id));
    const courseIds = new Set(state.courses.map(c => c.id));
    const libBookSources = state.library.filter(l => l.type === 'book' && bookIds.has(l.sourceId));
    const libCourseSources = state.library.filter(l => l.type === 'course' && courseIds.has(l.sourceId));

    const books1to1 = libBookSources.length === state.books.length;
    const courses1to1 = libCourseSources.length === state.courses.length;
    const cdOk = state.countdowns.length === 3;
    const ok = books1to1 && courses1to1 && cdOk;

    const details = [
      `题本映射: ${libBookSources.length}/${state.books.length} 正常一对一`,
      `网课映射: ${libCourseSources.length}/${state.courses.length} 正常一对一`,
      `倒计时: ${state.countdowns.length} 个考试配置正常`,
      `事项库总项数: ${state.library.length} 项`,
    ];

    return {
      ok,
      message: ok
        ? '自检通过：题本与网课均与事项库一对一绑定，3个倒计时完整。'
        : '检测到映射异常，建议执行自检修复。',
      details,
    };
  }, [state]);

  const login = useCallback(async (username: string, password: string): Promise<MutationResult<User>> => {
    authEpochRef.current += 1;
    const currentEpoch = authEpochRef.current;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, code: data.code || 'LOGIN_FAILED', message: data.message || '登录失败' };
      }
      if (authEpochRef.current !== currentEpoch) {
        return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
      }

      setCurrentUser(data.user);
      setCsrfToken(data.csrfToken);
      saveLastActiveUser(data.user);
      setActiveUserPartition(data.user.id);

      const userState = await loadLatestState(data.user.id);
      if (userState.isFresh) {
        const pullRes = await pullLatestFromServer(data.user.id);
        if (pullRes.ok && pullRes.serverState) {
          setState(pullRes.serverState);
          localRevisionRef.current = pullRes.serverRevision || 1;
          setLocalRevision(localRevisionRef.current);
        } else {
          setState(userState.state);
          localRevisionRef.current = userState.revision || 1;
          setLocalRevision(localRevisionRef.current);
        }
      } else {
        setState(userState.state);
        localRevisionRef.current = userState.revision || 1;
        setLocalRevision(localRevisionRef.current);
        // Background check server for remote updates
        pullLatestFromServer(data.user.id).then(pullRes => {
          if (pullRes.ok && pullRes.serverState && authEpochRef.current === currentEpoch) {
            setState(pullRes.serverState);
            localRevisionRef.current = pullRes.serverRevision || localRevisionRef.current;
            setLocalRevision(localRevisionRef.current);
          }
        }).catch(() => {});
      }
      return { ok: true, value: data.user };
    } catch (err) {
      return { ok: false, code: 'NETWORK_ERROR', message: '无法连接登录服务，请检查网络' };
    }
  }, []);

  const register = useCallback(async (
    username: string,
    password: string,
    nickname: string,
    inviteCode: string
  ): Promise<MutationResult<User>> => {
    authEpochRef.current += 1;
    const currentEpoch = authEpochRef.current;
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, nickname, inviteCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, code: data.code || 'REGISTER_FAILED', message: data.message || '注册失败' };
      }
      if (authEpochRef.current !== currentEpoch) {
        return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
      }

      setCurrentUser(data.user);
      setCsrfToken(data.csrfToken);
      saveLastActiveUser(data.user);
      setActiveUserPartition(data.user.id);

      // Clean registration flow: server already seeded 14 books, 7 courses, 22 library items at rev 1.
      // Hydrate server workspace directly into local IndexedDB without pushing blank snapshot (Defect D & Seed Req)
      const pullRes = await pullLatestFromServer(data.user.id);
      if (pullRes.ok && pullRes.serverState) {
        setState(pullRes.serverState);
        localRevisionRef.current = pullRes.serverRevision || 1;
        setLocalRevision(localRevisionRef.current);
      } else {
        // Fallback: create fresh seed state locally
        const freshSeed = createSeedState(data.user.username, data.user.nickname);
        await commitMutation<void>(() => ({ nextState: freshSeed, value: undefined }), {
          userId: data.user.id,
          targetRevision: 1,
        });
        setState(freshSeed);
        localRevisionRef.current = 1;
        setLocalRevision(1);
      }

      return { ok: true, value: data.user };
    } catch (err) {
      return { ok: false, code: 'NETWORK_ERROR', message: '无法连接注册服务，请检查网络' };
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    authEpochRef.current += 1;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
      });
    } catch {}
    saveLastActiveUser(null);
    setCurrentUser(null);
    setCsrfToken(null);
    setActiveUserPartition(null);
    const guestState = await loadLatestState(null);
    setState(guestState.state);
    localRevisionRef.current = guestState.revision || 1;
    setLocalRevision(localRevisionRef.current);
    setSyncStatus('idle');
    setSyncMessage(null);
    setConflictData(null);
  }, [csrfToken]);

  const forceUpload = useCallback(async (): Promise<SyncResult> => {
    if (!currentUser) return { ok: false, status: 'offline', message: '未登录云端账号' };
    setSyncStatus('syncing');
    setSyncMessage('正在将当前手机记录上传覆盖云端...');
    const result = await forceUploadLocal(
      currentUser.id,
      csrfToken || '',
      conflictData?.serverRevision ?? localRevisionRef.current,
      localRevisionRef.current
    );
    if (result.ok) {
      setSyncStatus('synced');
      setSyncMessage('云端记录已更新为本机当前状态');
      setConflictData(null);
    } else {
      setSyncStatus('failed');
      setSyncMessage(result.message || '上传云端失败');
    }
    return result;
  }, [currentUser, csrfToken, conflictData]);

  const forcePull = useCallback(async (): Promise<SyncResult> => {
    if (!currentUser) return { ok: false, status: 'offline', message: '未登录云端账号' };
    setSyncStatus('syncing');
    setSyncMessage('正在从云端拉取存档...');
    const remoteCheck = await pullLatestFromServer(currentUser.id);
    if (remoteCheck.status === 'conflict') {
      setSyncStatus('conflict');
      setConflictData({
        serverRevision: remoteCheck.serverRevision || 0,
        serverState: remoteCheck.serverState || null,
      });
      return remoteCheck;
    }
    if (remoteCheck.ok && remoteCheck.serverState) {
      setState(remoteCheck.serverState);
      localRevisionRef.current = remoteCheck.serverRevision || localRevisionRef.current;
      setLocalRevision(localRevisionRef.current);
      setSyncStatus('synced');
      setSyncMessage('已从云端拉取最新数据覆盖本机');
      setConflictData(null);
      return remoteCheck;
    }
    return remoteCheck;
  }, [currentUser]);

  const resolveConflict = useCallback(async (choice: 'keep_local' | 'keep_remote'): Promise<MutationResult<void>> => {
    if (!currentUser || !conflictData) return { ok: false, code: 'NO_CONFLICT', message: '当前没有待解决的冲突' };

    if (choice === 'keep_remote') {
      if (!conflictData.serverState) return { ok: false, code: 'NO_SERVER_STATE', message: '云端无有效状态' };
      const res = await forcePullRemote(
        currentUser.id,
        conflictData.serverState,
        conflictData.serverRevision,
        localRevisionRef.current
      );
      if (res.ok) {
        setState(conflictData.serverState);
        localRevisionRef.current = conflictData.serverRevision;
        setLocalRevision(conflictData.serverRevision);
        setConflictData(null);
        setSyncStatus('synced');
        setSyncMessage('已采用云端最新数据覆盖本地');
        return { ok: true, value: undefined };
      }
      return { ok: false, code: 'CONFLICT_RESOLVE_FAILED', message: res.message || '采用云端失败' };
    } else {
      const res = await forceUploadLocal(
        currentUser.id,
        csrfToken || '',
        conflictData.serverRevision,
        localRevisionRef.current
      );
      if (res.ok) {
        localRevisionRef.current = conflictData.serverRevision + 1;
        setLocalRevision(localRevisionRef.current);
        setConflictData(null);
        setSyncStatus('synced');
        setSyncMessage('已保留本机记录并更新云端');
        return { ok: true, value: undefined };
      }
      return { ok: false, code: 'CONFLICT_RESOLVE_FAILED', message: res.message || '上传云端失败' };
    }
  }, [currentUser, csrfToken, conflictData]);

  return (
    <AppContext.Provider
      value={{
        state,
        activeDate,
        setActiveDate,
        storageError,
        clearStorageError,
        isLoading,
        corruptedRaw,
        clearCorruptedRaw,
        updateCountdown,
        addPlan,
        quickAddPlan,
        startTimer,
        pauseTimer,
        deletePlan,
        completePlan,
        completeBookPlan,
        completeCoursePlan,
        completeCustomPlan,
        addBook,
        editBook,
        deleteBook,
        addCourse,
        editCourse,
        deleteCourse,
        addCustomItem,
        updateLibraryMinutes,
        deleteCustomItem,
        addWrongRecords,
        deleteWrongRecord,
        updateProfile,
        resetState,
        exportBackup,
        importBackup,
        selfCheck,
        currentUser,
        csrfToken,
        syncStatus,
        syncMessage,
        conflictData,
        localRevision,
        login,
        register,
        logout,
        triggerSync,
        forceUpload,
        forcePull,
        clearLocalData,
        importSeedTemplate,
        resolveConflict,
        offlineReady,
        updateInfo,
        dismissUpdate,
        applyUpdate,
        isAnyTimerRunning,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
