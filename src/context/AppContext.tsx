import { applyCreateSession, applySessionAction, applySessionConfig, applyRegisterSession, applyFinishAndAutoRegister, applySessionSubject, maintainSessionTimers } from '../utils/timerSessions';
import type { TimerSession, SessionRegistration, Countdown } from '../types';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  AppState,
  TodoItem,
  TimerConfig,
  Book,
  Course,
  LibraryItem,
  Plan,
  StudyRecord,
  StudyRecordCorrectionInput,
  WrongRecord,
  StudySubject,
  Profile,
  MutationResult,
  CompletionInput,
  User,
  SyncState,
  OperationScope,
  OperationContext,
  ExecuteMutationOptions,
  BackupExportReceipt,
} from '../types';
import { INITIAL_STATE, BLANK_STATE, DEMO_STATE, getLocalDateString } from '../constants/initialData';
import { validateAndMigrateBackup, MAX_BACKUP_SIZE_BYTES } from '../utils/backupValidator';
import { saveBackupFile } from '../utils/backupExport';
import {
  loadLatestState,
  commitMutation,
  resetDatabase,
  createPortableBackupState,
  parseServerMediaRef,
  getMedia,
  setActiveUserPartition,
  saveLastActiveUser,
  getLastActiveUser,
  getUnresolvedLocalChanges,
  getConflictRecord,
  loadSnapshot,
  saveRecoverySnapshot,
  saveNamedRecoverySnapshot,
  getLatestRecoverySnapshot,
  saveActiveGenerationId,
  clearSafeCaches,
  setExplicitLogoutMarker,
  hasExplicitLogoutMarker,
  readLegacyGuestRaw,
  isGuestMigrationDone,
  checkGuestMigrationCredential,
  markGuestMigrationDone,
  clearConflictRecord,
  installConfirmedServerState,
} from '../utils/db';
import {
  syncNormal,
  initialHydrate,
  forcePullRemote,
  forceUploadLocal,
  fetchServerSnapshot,
  SyncResult,
} from '../utils/syncClient';
import {
  checkAppUpdate,
  applyWebUpdate,
  markUpdateBannerDismissed,
  isUpdateBannerDismissed,
  UpdateCheckResult,
} from '../utils/versionCheck';
import { mergeSeedIntoState } from '../utils/seedMerge';
import { buildGuestMigration, executeGuestMigration, GuestMigrationPreview } from '../utils/guestMigration';
import {
  applyStartTimer,
  applyAddTodo,
  applyAddTodayTodo,
  applyToggleTodo,
  applyDeleteTodo,
  applyMoveTodosToDate,
  applyConfigureTimer,
  applySwitchTimerPhase,
  applyMaintainTimers,
  applyPauseTimer,
  applyCompletePlan,
  applyStudyRecordCorrection,
  applyAddPlan,
  applyAddCustomPlan,
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
  applyAddCountdown,
  applyDeleteCountdown,
  MutatorReturn,
} from '../utils/workflowMutators';

export type AuthPhase = 'checking' | 'authenticated' | 'unauthenticated' | 'error';

export interface ConflictData {
  serverRevision: number;
  serverState: AppState | null;
  serverGenerationId?: string;
  serverContentHash?: string;
}

export interface GuestMigrationState {
  available: boolean;
  preview?: GuestMigrationPreview;
  guestState?: AppState;
}

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
  addCountdown: (name: string, date: string) => Promise<MutationResult<Countdown>>;
  updateCountdown: (id: string, date: string, name?: string) => Promise<MutationResult<void>>;
  deleteCountdown: (id: string) => Promise<MutationResult<void>>;

  // Plans & Timers
  addPlan: (libraryId: string, plannedMinutes?: number, plannedLessons?: number) => Promise<MutationResult<Plan>>;
  addCustomPlan: (name: string, subject: StudySubject, plannedMinutes: number) => Promise<MutationResult<Plan>>;
  quickAddPlan: (libraryId: string) => Promise<MutationResult<Plan>>;
  startTimer: (planId: string) => Promise<MutationResult<void>>;
  pauseTimer: (planId: string) => Promise<MutationResult<void>>;
  deletePlan: (planId: string) => Promise<MutationResult<void>>;

  addTodo: (text: string, date?: string) => Promise<MutationResult<TodoItem>>;
  toggleTodo: (id: string) => Promise<MutationResult<void>>;
  deleteTodo: (id: string) => Promise<MutationResult<void>>;
  moveTodosToDate: (ids: string[], targetDate: string) => Promise<MutationResult<void>>;
  configureTimer: (id: string, config: TimerConfig) => Promise<MutationResult<void>>;
  switchTimerPhase: (id: string, phase: 'focus' | 'rest') => Promise<MutationResult<void>>;

  beginTimerSession: (config: TimerConfig, phase: 'focus' | 'rest', subject?: StudySubject) => Promise<MutationResult<TimerSession>>;
  sessionAction: (id: string, action: 'focus' | 'rest' | 'pause' | 'finish') => Promise<MutationResult<void>>;
  configureSession: (id: string, config: TimerConfig) => Promise<MutationResult<void>>;
  setSessionSubject: (id: string, subject: StudySubject) => Promise<MutationResult<void>>;
  /** 番茄钟结束：已选类别时原子完成「结束 + 自动登记」，返回登记生成的日程 ID。 */
  finishSession: (id: string) => Promise<MutationResult<string>>;
  registerSession: (id: string, input: SessionRegistration) => Promise<MutationResult<string>>;

  // Unified Atomic Completion
  completePlan: (input: CompletionInput) => Promise<MutationResult<{ recordId: string; record: StudyRecord }>>;
  updateStudyRecord: (input: StudyRecordCorrectionInput) => Promise<MutationResult<StudyRecord>>;

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
  addCustomItem: (name: string, subject: StudySubject, defaultMinutes: number) => Promise<MutationResult<LibraryItem>>;
  updateLibraryMinutes: (id: string, defaultMinutes: number) => Promise<MutationResult<void>>;
  deleteCustomItem: (id: string) => Promise<MutationResult<void>>;

  // Wrong records
  addWrongRecords: (bookId: string, note: string, images: string[], date?: string) => Promise<MutationResult<WrongRecord[]>>;
  deleteWrongRecord: (id: string) => Promise<MutationResult<void>>;

  // Profile
  updateProfile: (name: string, avatar?: string) => Promise<MutationResult<Profile>>;

  // System
  applyDefaultSeed: () => Promise<MutationResult<void>>;
  resetState: () => Promise<MutationResult<void>>;
  exportBackup: () => Promise<MutationResult<BackupExportReceipt>>;
  importBackup: (jsonContent: string) => Promise<MutationResult<{ summary: string }>>;
  selfCheck: () => { ok: boolean; message: string; details: string[] };

  // Auth & Cloud Sync
  authPhase: AuthPhase;
  authError: string | null;
  retryAuthLoad: () => Promise<void>;
  sessionExpired: boolean;
  currentUser: User | null;
  csrfToken: string | null;
  syncStatus: SyncState;
  syncMessage: string | null;
  conflictData: ConflictData | null;
  localRevision: number;
  pendingSyncCount: number;
  hasUnsyncedChanges: boolean;
  needsInitChoice: boolean;
  initChoice: 'default' | 'blank' | null;
  chooseEmptyLibrary: (choice: 'default' | 'blank') => Promise<MutationResult<void>>;
  login: (username: string, password: string) => Promise<MutationResult<User>>;
  register: (username: string, password: string, nickname: string, inviteCode: string) => Promise<MutationResult<User>>;
  logout: () => Promise<void>;
  triggerSync: () => Promise<SyncResult>;
  forceUpload: () => Promise<SyncResult>;
  forcePull: () => Promise<SyncResult>;
  resolveConflict: (choice: 'keep_local' | 'keep_remote') => Promise<MutationResult<void>>;
  clearLocalData: () => Promise<void>;
  clearSafeCache: () => Promise<{ ok: boolean; message: string }>;
  restoreLatestRecovery: () => Promise<MutationResult<void>>;
  importSeedTemplate: () => Promise<MutationResult<void>>;
  guestMigration: GuestMigrationState | null;
  refreshGuestMigration: (targetState?: AppState) => Promise<void> | void;
  migrateLegacyGuestData: () => Promise<MutationResult<void>>;
  dismissGuestMigration: () => void;

  // Offline & Auto-Update
  offlineReady: boolean;
  updateInfo: { version: string; build: string; summary: string } | null;
  updateCheckState: UpdateCheckResult | null;
  isCheckingUpdate: boolean;
  checkForUpdate: (manual?: boolean) => Promise<UpdateCheckResult | null>;
  dismissUpdate: () => void;
  applyUpdate: () => Promise<boolean>;
  /** Guard used by update UI: blocks install/activate while timers run, conflict is unresolved, sync pending, or editing is active. */
  updateGuard: () => { ok: boolean; reason?: string };
  registerUpdateBlocker: (id: string, reason: string) => () => void;
  isAnyTimerRunning: () => boolean;
}

export const AppContext = createContext<AppContextType | null>(null);

function createPreviewState(): AppState {
  const demo = structuredClone(DEMO_STATE);
  const sampleDay = demo.plans.map(p => p.date).sort().at(-1);
  demo.plans = demo.plans.map(p => p.date === sampleDay && !p.done ? { ...p, date: getLocalDateString() } : p);
  const course = demo.library.find(item => item.type === 'course');
  if (course && !demo.plans.some(plan => plan.type === 'course' && !plan.done)) {
    demo.plans.push({
      id: 'preview-course-plan', date: getLocalDateString(), libraryId: course.id,
      name: course.name, type: course.type, sourceId: course.sourceId, subject: course.subject,
      plannedMinutes: course.defaultMinutes, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0,
    });
  }
  return demo;
}

const NETWORK_FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = NETWORK_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const [authPhase, setAuthPhase] = useState<AuthPhase>(preview ? 'authenticated' : 'checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncState>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [needsInitChoice, setNeedsInitChoice] = useState(false);
  const [initChoice, setInitChoice] = useState<'default' | 'blank' | null>(null);
  const [guestMigration, setGuestMigration] = useState<GuestMigrationState | null>(null);

  // Offline & Auto-Update States
  const [offlineReady, setOfflineReady] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; build: string; summary: string } | null>(null);
  const [updateCheckState, setUpdateCheckState] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Local Date Management: Initialize with getLocalDateString()
  const [activeDate, setActiveDate] = useState<string>(() => getLocalDateString());

  const clearStorageError = useCallback(() => {
    setStorageError(null);
  }, []);

  const clearCorruptedRaw = useCallback(() => {
    setCorruptedRaw(null);
  }, []);

  const [localRevision, setLocalRevision] = useState<number>(1);
  const localRevisionRef = useRef<number>(1);
  const authEpochRef = useRef<number>(0);
  const currentUserRef = useRef<User | null>(null);
  const csrfTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef<Promise<SyncResult> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const lastFocusSyncAtRef = useRef(0);
  const bootRanRef = useRef(false);
  const authQueueRef = useRef<Promise<any>>(Promise.resolve());

  const serializeAuth = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    const next = authQueueRef.current.then(action, action);
    authQueueRef.current = next.catch(() => {});
    return next;
  }, []);

  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const abortActiveOperations = useCallback(() => {
    for (const c of activeControllersRef.current) {
      try { c.abort(); } catch {}
    }
    activeControllersRef.current.clear();
  }, []);

  const bumpAuthEpoch = useCallback(() => {
    authEpochRef.current += 1;
    abortActiveOperations();
  }, [abortActiveOperations]);

  const createOperationScope = useCallback((userId?: string | null, customSignal?: AbortSignal): OperationScope => {
    const uid = userId !== undefined ? userId : (currentUserRef.current?.id ?? null);
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    if (customSignal) {
      if (customSignal.aborted) {
        controller.abort();
      } else {
        customSignal.addEventListener('abort', () => {
          controller.abort();
        }, { once: true });
      }
    }
    return {
      userId: uid,
      epoch: authEpochRef.current,
      operationId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      signal: controller.signal,
    };
  }, []);

  const isOperationScopeValid = useCallback((scope: OperationScope): boolean => {
    return (
      mountedRef.current &&
      authEpochRef.current === scope.epoch &&
      (currentUserRef.current?.id ?? null) === scope.userId &&
      !scope.signal?.aborted
    );
  }, []);

  const isCurrent = useCallback((userId: string, epoch: number): boolean => {
    return mountedRef.current && Boolean(currentUserRef.current) && currentUserRef.current!.id === userId && authEpochRef.current === epoch;
  }, []);

  const applyLocalState = useCallback((nextState: AppState, revision: number) => {
    setState(nextState);
    localRevisionRef.current = revision;
    setLocalRevision(revision);
  }, []);

  const refreshPendingCount = useCallback(async (userId: string | null): Promise<number> => {
    if (!userId) {
      setPendingSyncCount(0);
      return 0;
    }
    try {
      const unresolved = await getUnresolvedLocalChanges(userId);
      setPendingSyncCount(unresolved.total);
      return unresolved.total;
    } catch {
      return 0;
    }
  }, []);

  const refreshConflictState = useCallback(async (userId: string): Promise<ConflictData | null> => {
    try {
      const record = await getConflictRecord(userId);
      if (!record) {
        setConflictData(null);
        return null;
      }
      const data: ConflictData = {
        serverRevision: record.serverRevision,
        serverState: record.serverState,
        serverGenerationId: record.serverGenerationId,
        serverContentHash: record.serverContentHash,
      };
      setConflictData(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshSession = useCallback(async (scopeToUse?: OperationScope): Promise<{ ok: boolean; unauthorized: boolean }> => {
    const user = currentUserRef.current;
    const scope = scopeToUse ?? createOperationScope(user?.id ?? null);
    if (!user || !scope.userId) {
      return { ok: false, unauthorized: false };
    }
    try {
      const res = await fetchWithTimeout('/api/auth/me', {
        cache: 'no-store',
        headers: { 'x-workspace-user': user.id },
      }, 8000);

      if (!isOperationScopeValid(scope)) {
        return { ok: false, unauthorized: false };
      }

      if (res.status === 401 || res.status === 403 || res.status === 409) return { ok: false, unauthorized: true };
      if (!res.ok) return { ok: false, unauthorized: false };
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return { ok: false, unauthorized: false };

      const data = await res.json().catch(() => ({}));

      if (!isOperationScopeValid(scope)) {
        return { ok: false, unauthorized: false };
      }

      if (!data?.ok || !data.user) return { ok: false, unauthorized: false };
      if (data.user.id !== user.id) return { ok: false, unauthorized: true };

      currentUserRef.current = data.user;
      csrfTokenRef.current = typeof data.csrfToken === 'string' ? data.csrfToken : null;
      if (mountedRef.current && isOperationScopeValid(scope)) {
        setCurrentUser(data.user);
        setCsrfToken(csrfTokenRef.current);
      }
      return { ok: true, unauthorized: false };
    } catch {
      // Network failure / offline: NOT a session expiry.
      return { ok: false, unauthorized: false };
    }
  }, [createOperationScope, isOperationScopeValid]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const handleSessionExpired = useCallback(() => {
    bumpAuthEpoch();
    clearRetryTimer();
    syncInFlightRef.current = null;
    currentUserRef.current = null;
    csrfTokenRef.current = null;
    setCurrentUser(null);
    setCsrfToken(null);
    setActiveUserPartition(null);
    setSessionExpired(true);
    setAuthPhase('unauthenticated');
    setSyncStatus('idle');
    setSyncMessage('登录状态已失效，请重新登录；未同步数据仍保留在本机');
    setConflictData(null);
  }, [bumpAuthEpoch, clearRetryTimer]);

  const scheduleRetry = useCallback((performSync: () => Promise<void>, targetRetryAt?: string) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    let delayMs: number;
    if (targetRetryAt) {
      const parsed = Date.parse(targetRetryAt);
      if (!isNaN(parsed)) {
        delayMs = Math.max(100, parsed - Date.now() + 50);
      } else {
        const attempt = retryAttemptRef.current;
        const base = Math.min(1500 * Math.pow(2, attempt), 60000);
        const jitter = Math.floor(Math.random() * Math.min(base * 0.25, 5000));
        retryAttemptRef.current = Math.min(attempt + 1, 6);
        delayMs = base + jitter;
      }
    } else {
      const attempt = retryAttemptRef.current;
      const base = Math.min(1500 * Math.pow(2, attempt), 60000);
      const jitter = Math.floor(Math.random() * Math.min(base * 0.25, 5000));
      retryAttemptRef.current = Math.min(attempt + 1, 6);
      delayMs = base + jitter;
    }
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!currentUserRef.current) return;
      performSync().catch(() => {});
    }, delayMs);
  }, []);

  // Forward declaration of triggerSync for background calls
  const triggerSyncRef = useRef<() => Promise<SyncResult>>(async () => ({ ok: false, status: 'offline' }));

  // The one and only sync executor (in-flight dedup + bounded backoff scheduling).
  const triggerSync = useCallback(async (): Promise<SyncResult> => {
    if (preview) return { ok: false, status: 'offline', message: '预览模式不同步' };
    const user = currentUserRef.current;
    if (!user) return { ok: false, status: 'offline', message: '未登录云端账号' };
    if (syncInFlightRef.current) return syncInFlightRef.current;

    const epoch = authEpochRef.current;
    clearRetryTimer();

    const task = (async (): Promise<SyncResult> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (mountedRef.current) {
          setSyncStatus('idle');
          setSyncMessage('当前处于离线状态，修改已安全保存在本机，联网后将自动同步');
        }
        return { ok: false, status: 'offline', message: '离线保存', pendingCount: undefined };
      }

      let csrf = csrfTokenRef.current || '';
      if (!csrf) {
        const refreshed = await refreshSession();
        if (!mountedRef.current || authEpochRef.current !== epoch) {
          return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
        }
        if (!refreshed.ok) {
          if (refreshed.unauthorized) {
            handleSessionExpired();
            return { ok: false, status: 'failed', code: 'SESSION_EXPIRED', message: '登录状态已失效，请重新登录', needsRelogin: true };
          }
          // Session/CSRF could not be re-established because the network/server is
          // unavailable — keep the account + queue and retry with backoff.
          if (mountedRef.current) {
            setSyncStatus('failed');
            setSyncMessage('暂时无法验证登录状态，修改已安全保留在本机，正在自动重试');
          }
          scheduleRetry(async () => { await triggerSyncRef.current(); });
          return { ok: false, status: 'failed', code: 'SESSION_REFRESH_UNAVAILABLE', message: '暂时无法验证登录状态，已保留本机待同步数据' };
        }
        csrf = csrfTokenRef.current || '';
      }

      setSyncStatus('syncing');
      setSyncMessage('正在同步学情与照片...');

      let result = await syncNormal(user.id, csrf, { guard: () => isCurrent(user.id, epoch) });
      if (!isCurrent(user.id, epoch)) {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
      }

      if (result.needsSessionRefresh) {
        const refreshed = await refreshSession();
        if (refreshed.ok && isCurrent(user.id, epoch)) {
          result = await syncNormal(user.id, csrfTokenRef.current || '', { guard: () => isCurrent(user.id, epoch) });
        }
        if (!isCurrent(user.id, epoch)) {
          return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消本次同步' };
        }
      }

      if (result.needsRelogin) {
        handleSessionExpired();
        return result;
      }

      if (mountedRef.current) {
        if (result.status === 'synced') {
          retryAttemptRef.current = 0;
          setSyncStatus('synced');
          setSyncMessage(result.message || '全部学情与照片已保存到服务器');
          setConflictData(null);
          if (!preview) {
            const latest = await loadLatestState(user.id);
            if (isCurrent(user.id, epoch)) applyLocalState(latest.state, latest.revision);
          }
        } else if (result.status === 'conflict') {
          setSyncStatus('conflict');
          setSyncMessage(result.message || '需要处理版本冲突');
          setConflictData({
            serverRevision: result.serverRevision || 0,
            serverState: result.serverState ?? null,
            serverGenerationId: result.serverGenerationId,
            serverContentHash: result.serverContentHash,
          });
        } else if (result.status === 'offline') {
          setSyncStatus('idle');
          setSyncMessage(result.message || '离线保存');
        } else if (result.status === 'waiting') {
          setSyncStatus('idle');
          setSyncMessage(result.message || (result.waitingReason === 'lease' ? '另一标签页正在同步中' : '正在等待重试'));
          setConflictData(null);
        } else {
          setSyncStatus('failed');
          setSyncMessage(result.message || '同步暂未完成，正在自动重试');
        }
      }

      const pending = result.pendingCount ?? await refreshPendingCount(user.id);
      if (mountedRef.current) setPendingSyncCount(pending);

      if ((result.status === 'failed' || result.status === 'waiting') && !result.needsRelogin && result.code !== 'AUTH_EPOCH_CHANGED') {
        scheduleRetry(async () => {
          await triggerSyncRef.current();
        }, result.retryAt);
      }
      return result;
    })();

    syncInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (syncInFlightRef.current === task) syncInFlightRef.current = null;
    }
  }, [preview, applyLocalState, clearRetryTimer, handleSessionExpired, isCurrent, refreshPendingCount, refreshSession, scheduleRetry]);

  triggerSyncRef.current = triggerSync;

  // ----------------------------------------------------------------------
  // Boot / cold-start session validation (R09, R11)
  // ----------------------------------------------------------------------
  const finalizeUnauthenticated = useCallback(async () => {
    currentUserRef.current = null;
    csrfTokenRef.current = null;
    setCurrentUser(null);
    setCsrfToken(null);
    setActiveUserPartition(null);
    setAuthPhase('unauthenticated');
    setSyncStatus('idle');
    setSyncMessage(null);
    setConflictData(null);
    setNeedsInitChoice(false);
    setInitChoice(null);
    setGuestMigration(null);
    const guest = await loadLatestState(null);
    if (!mountedRef.current) return;
    readyRef.current = true;
    applyLocalState(guest.state, guest.revision || 1);
    setIsLoading(false);
  }, [applyLocalState]);

  const applyHydrateResult = useCallback(async (
    user: User,
    csrf: string,
    hydrate: Awaited<ReturnType<typeof initialHydrate>>,
    epoch: number
  ): Promise<void> => {
    if (!isCurrent(user.id, epoch)) return;
    if (hydrate.ok) {
      const latest = await loadLatestState(user.id);
      if (!isCurrent(user.id, epoch)) return;
      readyRef.current = true;
      applyLocalState(hydrate.localState ?? latest.state, hydrate.localRevision ?? latest.revision);
      setAuthPhase('authenticated');
      setAuthError(null);
      setSessionExpired(false);
      setNeedsInitChoice(Boolean(hydrate.needsInitChoice));
      setInitChoice(hydrate.initChoice ?? null);
      if (hydrate.status === 'synced') {
        setSyncStatus('synced');
        setSyncMessage(hydrate.message || '已载入云端工作区');
      } else {
        setSyncStatus('failed');
        setSyncMessage(hydrate.message || '当前无法连接云端，已载入本机可靠缓存，联网后将自动同步');
        scheduleRetry(async () => { await triggerSyncRef.current(); });
      }
      await refreshPendingCount(user.id);
      await refreshConflictState(user.id);
      setIsLoading(false);
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        triggerSyncRef.current().catch(() => {});
      }
      return;
    }
    if (hydrate.status === 'conflict') {
      const latest = await loadLatestState(user.id);
      if (!isCurrent(user.id, epoch)) return;
      readyRef.current = true;
      applyLocalState(hydrate.localState ?? latest.state, hydrate.localRevision ?? latest.revision);
      setAuthPhase('authenticated');
      setAuthError(null);
      setSessionExpired(false);
      setSyncStatus('conflict');
      setSyncMessage(hydrate.message || '检测到数据版本冲突待处理');
      await refreshPendingCount(user.id);
      await refreshConflictState(user.id);
      setIsLoading(false);
      return;
    }
    if (hydrate.needsRelogin) {
      handleSessionExpired();
      setIsLoading(false);
      return;
    }
    // Accurate error + retry state. Never enter an editable empty library.
    readyRef.current = false;
    setAuthPhase('error');
    setAuthError(hydrate.message || '加载云端工作区失败，请重试');
    setSyncStatus('failed');
    setSyncMessage(hydrate.message || '加载云端工作区失败');
    setIsLoading(false);
  }, [applyLocalState, handleSessionExpired, isCurrent, refreshConflictState, refreshPendingCount, scheduleRetry]);

  const boot = useCallback(async () => {
    if (preview) return;
    const epoch = authEpochRef.current;
    setIsLoading(true);
    setAuthError(null);
    setAuthPhase('checking');
    try {
      // R11: an explicit logout marker wins over a still-valid server cookie.
      if (hasExplicitLogoutMarker()) {
        await finalizeUnauthenticated();
        return;
      }

      let meStatus = 0;
      let meData: any = null;
      try {
        const res = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, 12000);
        meStatus = res.status;
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) meData = await res.json();
        }
      } catch {
        meStatus = 0;
      }
      if (!mountedRef.current || authEpochRef.current !== epoch) return;

      if (meData?.ok && meData.user) {
        const user = meData.user as User;
        const csrf = typeof meData.csrfToken === 'string' ? meData.csrfToken : '';
        currentUserRef.current = user;
        csrfTokenRef.current = csrf;
        setCurrentUser(user);
        setCsrfToken(csrf);
        saveLastActiveUser(user);
        setActiveUserPartition(user.id);
        const hydrate = await initialHydrate(user.id, csrf, { guard: () => isCurrent(user.id, epoch) });
        await applyHydrateResult(user, csrf, hydrate, epoch);
        return;
      }

      if (meStatus === 401 || meStatus === 403) {
        await finalizeUnauthenticated();
        return;
      }

      // Network / server unavailable: reliable local cache for the last account may be used offline.
      const cachedUser = getLastActiveUser();
      if (cachedUser) {
        const user: User = { id: cachedUser.id, username: cachedUser.username, nickname: cachedUser.nickname, role: cachedUser.role };
        const local = await loadLatestState(cachedUser.id);
        if (!mountedRef.current || authEpochRef.current !== epoch) return;
        if (!local.isFresh) {
          readyRef.current = true;
          currentUserRef.current = user;
          csrfTokenRef.current = null;
          setCurrentUser(user);
          setCsrfToken(null);
          setActiveUserPartition(user.id);
          applyLocalState(local.state, local.revision);
          setAuthPhase('authenticated');
          setSyncStatus('failed');
          setSyncMessage('当前离线：已载入本机可靠缓存，联网后将自动恢复会话并补传');
          await refreshPendingCount(user.id);
          await refreshConflictState(user.id);
          setIsLoading(false);
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            triggerSyncRef.current().catch(() => {});
          }
          return;
        }
      }
      await finalizeUnauthenticated();
      setSyncMessage('当前离线：请联网后登录');
    } catch (err) {
      if (!mountedRef.current) return;
      setAuthPhase('error');
      setAuthError(err instanceof Error ? err.message : '启动加载失败，请重试');
      setIsLoading(false);
    }
  }, [applyHydrateResult, applyLocalState, finalizeUnauthenticated, isCurrent, preview, refreshConflictState, refreshPendingCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      bumpAuthEpoch();
      clearRetryTimer();
    };
  }, [bumpAuthEpoch, clearRetryTimer]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('kaogong_auth');
      bc.onmessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'logout') {
          if (currentUserRef.current) {
            handleSessionExpired();
          }
        } else if (data.type === 'login' && data.userId) {
          if (!currentUserRef.current || currentUserRef.current.id !== data.userId) {
            bumpAuthEpoch();
            refreshSession().catch(() => {});
          }
        }
      };
    } catch {}
    return () => {
      if (bc) {
        try { bc.close(); } catch {}
      }
    };
  }, [handleSessionExpired, refreshSession]);

  useEffect(() => {
    if (preview) return;
    if (bootRanRef.current) return;
    bootRanRef.current = true;
    boot().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const retryAuthLoad = useCallback(async () => {
    setAuthError(null);
    setIsLoading(true);
    try {
      const refreshed = await refreshSession();
      const user = currentUserRef.current;
      if (refreshed.ok && user) {
        const hydrate = await initialHydrate(user.id, csrfTokenRef.current || '', { guard: () => Boolean(currentUserRef.current) && currentUserRef.current!.id === user.id });
        await applyHydrateResult(user, csrfTokenRef.current || '', hydrate, authEpochRef.current);
        return;
      }
      await boot();
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [applyHydrateResult, boot, refreshSession]);

  // ----------------------------------------------------------------------
  // Cross-tab / retry / update listeners
  // ----------------------------------------------------------------------
  const checkForUpdate = useCallback(async (manual = false): Promise<UpdateCheckResult | null> => {
    if (preview || typeof window === 'undefined') return null;
    setIsCheckingUpdate(true);
    try {
      const result = await checkAppUpdate({ manual });
      if (!mountedRef.current) return result;
      setUpdateCheckState(result);
      if (result.status === 'update_available') {
        const version = result.remoteInfo?.version || result.installedVersionName || '';
        const build = result.remoteInfo?.build || '';
        const bannerKey = `${version}-${build}`;
        // R17: a dismissed update banner stays dismissed for the same release.
        if (!isUpdateBannerDismissed(bannerKey)) {
          setUpdateInfo({
            version,
            build,
            summary: result.remoteInfo?.summary || '发现新版本发布',
          });
        }
      }
      return result;
    } catch {
      return null;
    } finally {
      if (mountedRef.current) setIsCheckingUpdate(false);
    }
  }, [preview]);

  const dismissUpdate = useCallback(() => {
    if (updateInfo) markUpdateBannerDismissed(`${updateInfo.version}-${updateInfo.build}`);
    setUpdateInfo(null);
  }, [updateInfo]);

  const updateBlockersRef = useRef<Map<string, string>>(new Map());

  const registerUpdateBlocker = useCallback((id: string, reason: string): (() => void) => {
    updateBlockersRef.current.set(id, reason);
    let unregistered = false;
    return () => {
      if (unregistered) return;
      unregistered = true;
      updateBlockersRef.current.delete(id);
    };
  }, []);

  const isAnyTimerRunning = useCallback((): boolean => {
    return state.plans.some(p => !p.done && (p.timerStart > 0 || (p.restStart ?? 0) > 0)) || Boolean(state.timerSessions?.some(s => s.status === 'running'));
  }, [state.plans, state.timerSessions]);

  const updateGuard = useCallback((): { ok: boolean; reason?: string } => {
    if (updateBlockersRef.current.size > 0) {
      return { ok: false, reason: '正在进行数据编辑或操作，已暂缓应用更新' };
    }
    if (pendingSyncCount > 0) {
      return { ok: false, reason: '本地有尚未保存到服务器的内容，请先完成同步再更新' };
    }
    if (conflictData) {
      return { ok: false, reason: '存在待处理的版本冲突，请先完成冲突处理再更新' };
    }
    if (isAnyTimerRunning()) {
      return { ok: false, reason: '当前有正在运行的计时器，请先暂停或完成计时' };
    }
    return { ok: true };
  }, [conflictData, isAnyTimerRunning, pendingSyncCount]);

  const applyUpdate = useCallback(async (): Promise<boolean> => {
    const guard = updateGuard();
    if (!guard.ok) return false;
    const result = await applyWebUpdate({ canActivate: updateGuard });
    if (result.ok) {
      setUpdateInfo(null);
      return true;
    }
    return false;
  }, [updateGuard]);

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
    const checkMidnightRollover = () => {
      const today = getLocalDateString();
      setActiveDate(prev => (prev !== today ? today : prev));
    };

    const maybeSync = () => {
      if (preview) return;
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 10000) return;
      lastFocusSyncAtRef.current = now;
      if (currentUserRef.current) triggerSyncRef.current().catch(() => {});
      checkForUpdate(false).catch(() => {});
    };

    const handleWindowFocus = () => {
      checkMidnightRollover();
      maybeSync();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkMidnightRollover();
        maybeSync();
      }
    };

    const handleOnline = async () => {
      checkMidnightRollover();
      if (preview) return;
      // R05: reconnect must first restore session + CSRF, then auto-flush.
      if (currentUserRef.current) {
        const refreshed = await refreshSession();
        if (refreshed.unauthorized) {
          handleSessionExpired();
        } else if (currentUserRef.current) {
          triggerSyncRef.current().catch(() => {});
        }
      }
      checkForUpdate(false).catch(() => {});
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = setInterval(checkMidnightRollover, 30000);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [checkForUpdate, preview, refreshSession]);

  // Auto update check once after the app becomes usable.
  useEffect(() => {
    if (preview || authPhase !== 'authenticated') return;
    checkForUpdate(false).catch(() => {});
  }, [authPhase, checkForUpdate, preview]);

  // ----------------------------------------------------------------------
  // Mutations
  // ----------------------------------------------------------------------
  const executeMutation = useCallback(
    async <T,>(
      mutator: (draft: AppState) => Promise<MutatorReturn<T>> | MutatorReturn<T>,
      reason?: string,
      options?: ExecuteMutationOptions
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

      const context: OperationContext =
        options?.context ??
        (() => {
          const owner = currentUserRef.current;
          const s = createOperationScope(owner?.id ?? null);
          return {
            scope: s,
            isCurrent: () => isOperationScopeValid(s),
            abortSignal: s.signal,
          };
        })();
      const scope = context.scope;
      const targetUserId = scope.userId;

      if (!context.isCurrent() || !isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
      }

      let appliedNextState: AppState | null = null;
      const result = await commitMutation<T>(async draft => {
        const previousFormat = draft.version;
        const res = await mutator(draft);
        if ('nextState' in res) {
          res.nextState.version = Math.max(previousFormat, res.nextState.version) as AppState['version'];
          appliedNextState = res.nextState;
        }
        return res;
      }, {
        userId: targetUserId,
        reason,
        recoveryBeforeWrite: options?.recoveryBeforeWrite,
        outboxBuilder: targetUserId
          ? (nextState, meta) => ({
              id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              userId: targetUserId,
              requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              state: nextState,
              expectedRevision: meta.confirmedRevision,
              generationId: meta.generationId,
              createdAt: new Date().toISOString(),
              status: 'pending',
              reason: reason || 'mutation',
            })
          : undefined,
        scope,
        context,
        guard: () => context.isCurrent() && isOperationScopeValid(scope),
        signal: scope.signal || context.abortSignal,
      });

      if (!context.isCurrent() || !isOperationScopeValid(scope) || (!result.ok && result.code === 'AUTH_EPOCH_CHANGED')) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消写入' };
      }

      if (result.ok && appliedNextState) {
        const appliedRevision = result.revision ?? localRevisionRef.current + 1;
        if (mountedRef.current && context.isCurrent() && isOperationScopeValid(scope)) {
          applyLocalState(appliedNextState, appliedRevision);
        }
        if (targetUserId && mountedRef.current && context.isCurrent() && isOperationScopeValid(scope)) {
          await refreshPendingCount(targetUserId);
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            triggerSyncRef.current().catch(() => {});
          }
        }
      } else if (!result.ok && (result.code === 'COMMIT_FAILED' || result.code === 'REVISION_CONFLICT')) {
        if (mountedRef.current && context.isCurrent() && isOperationScopeValid(scope)) {
          setStorageError(result.message);
        }
        if (result.code === 'REVISION_CONFLICT') {
          try {
            const refreshed = await loadLatestState(currentUserRef.current?.id ?? null);
            if (mountedRef.current && context.isCurrent() && isOperationScopeValid(scope)) {
              applyLocalState(refreshed.state, refreshed.revision);
            }
          } catch {
            readyRef.current = false;
          }
        }
      }
      return result;
    },
    [applyLocalState, createOperationScope, isOperationScopeValid, preview, refreshPendingCount]
  );

  // ----------------------------------------------------------------------
  // Countdowns / Plans / Timers / Completion
  // ----------------------------------------------------------------------
  const addCountdown = useCallback(
    async (name: string, date: string): Promise<MutationResult<Countdown>> => {
      return executeMutation(draft => applyAddCountdown(draft, name, date), 'add_countdown');
    },
    [executeMutation]
  );

  const updateCountdown = useCallback(
    async (id: string, date: string, name?: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyUpdateCountdown(draft, id, date, name), 'update_countdown');
    },
    [executeMutation]
  );

  const deleteCountdown = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteCountdown(draft, id), 'delete_countdown');
    },
    [executeMutation]
  );

  const addPlan = useCallback(
    async (libraryId: string, plannedMinutes?: number, plannedLessons?: number): Promise<MutationResult<Plan>> => {
      return executeMutation(draft => applyAddPlan(draft, libraryId, activeDate, plannedMinutes, plannedLessons), 'add_plan');
    },
    [activeDate, executeMutation]
  );

  const addTodo = useCallback(
    (text: string, date?: string) =>
      executeMutation(draft => applyAddTodo(draft, text, date || activeDate), 'add_todo'),
    [activeDate, executeMutation]
  );
  const toggleTodo = useCallback((id: string) => executeMutation(draft => applyToggleTodo(draft, id), 'toggle_todo'), [executeMutation]);
  const deleteTodo = useCallback((id: string) => executeMutation(draft => applyDeleteTodo(draft, id), 'delete_todo'), [executeMutation]);
  const moveTodosToDate = useCallback((ids: string[], targetDate: string) => executeMutation(draft => applyMoveTodosToDate(draft, ids, targetDate), 'move_todos'), [executeMutation]);
  const configureTimer = useCallback((id: string, config: TimerConfig) => executeMutation(draft => applyConfigureTimer(draft, id, config), 'configure_timer'), [executeMutation]);
  const switchTimerPhase = useCallback((id: string, phase: 'focus' | 'rest') => executeMutation(draft => applySwitchTimerPhase(draft, id, phase), 'timer_phase'), [executeMutation]);

  const beginTimerSession = useCallback((config: TimerConfig, phase: 'focus' | 'rest', subject?: StudySubject) => executeMutation(draft => {
    const created = applyCreateSession(draft, config, Date.now(), subject);
    if ('error' in created) return created;
    const changed = applySessionAction(draft, created.value.id, phase);
    return 'error' in changed ? changed : { nextState: draft, value: created.value };
  }, 'begin_session'), [executeMutation]);
  const setSessionSubject = useCallback((id: string, subject: StudySubject) => executeMutation(draft => applySessionSubject(draft, id, subject), 'session_subject'), [executeMutation]);
  const finishSession = useCallback((id: string) => executeMutation(draft => applyFinishAndAutoRegister(draft, id), 'finish_session'), [executeMutation]);
  const sessionAction = useCallback((id: string, action: 'focus' | 'rest' | 'pause' | 'finish') => executeMutation(draft => applySessionAction(draft, id, action), 'session_action'), [executeMutation]);
  const configureSession = useCallback((id: string, config: TimerConfig) => executeMutation(draft => applySessionConfig(draft, id, config), 'configure_session'), [executeMutation]);
  const registerSession = useCallback((id: string, input: SessionRegistration) => executeMutation(draft => applyRegisterSession(draft, id, input), 'register_session'), [executeMutation]);
  useEffect(() => {
    if (isLoading || !readyRef.current || (!preview && authPhase !== 'authenticated')) return;
    let busy = false;
    const maintain = async () => {
      if (busy || !state.timerSessions?.some(s => s.status === 'running' && s.phase === 'rest' && Date.now() >= s.runningSince + Math.max(0, s.restMinutes * 60000 - s.phaseMs))) return;
      busy = true;
      try { await executeMutation(draft => { maintainSessionTimers(draft); return { nextState: draft, value: undefined }; }, 'session_maintenance'); }
      finally { busy = false; }
    };
    void maintain();
    const interval = setInterval(() => void maintain(), 1000);
    const foreground = () => { if (document.visibilityState === 'visible') void maintain(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', foreground); };
  }, [state.timerSessions, isLoading, preview, authPhase, executeMutation]);

  // Reconcile absolute deadlines on boot, foreground, and while the page is open.
  useEffect(() => {
    if (preview || isLoading || !readyRef.current || authPhase !== 'authenticated') return;
    let busy = false;
    const maintain = async () => {
      if (busy) return;
      const today = getLocalDateString();
      const archive = state.plans.some(p => p.date < today && !p.archived);
      const expiredRests = state.plans.filter(p => (p.restStart ?? 0) > 0 &&
        Date.now() >= (p.restStart ?? 0) + Math.max(0, (p.restMinutes ?? 5) * 60000 - (p.phaseAccumulatedMs ?? 0)));
      if (!archive && !expiredRests.length) return;
      busy = true;
      try {
        await executeMutation(draft => applyMaintainTimers(draft, getLocalDateString()), 'timer_maintenance');
      } finally { busy = false; }
    };
    void maintain();
    const interval = setInterval(() => { void maintain(); }, 1000);
    const foreground = () => { if (document.visibilityState === 'visible') void maintain(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', foreground); };
  }, [authPhase, executeMutation, isLoading, preview, state.plans]);

  const addCustomPlan = useCallback(
    async (name: string, subject: StudySubject, plannedMinutes: number): Promise<MutationResult<Plan>> => {
      return executeMutation(draft => applyAddCustomPlan(draft, name, subject, activeDate, plannedMinutes), 'add_custom_plan');
    },
    [activeDate, executeMutation]
  );

  const quickAddPlan = useCallback(
    async (libraryId: string): Promise<MutationResult<Plan>> => {
      return executeMutation(draft => applyQuickAddPlan(draft, libraryId, activeDate), 'quick_add_plan');
    },
    [activeDate, executeMutation]
  );

  const startTimer = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyStartTimer(draft, planId), 'start_timer');
    },
    [executeMutation]
  );

  const pauseTimer = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyPauseTimer(draft, planId), 'pause_timer');
    },
    [executeMutation]
  );

  const deletePlan = useCallback(
    async (planId: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeletePlan(draft, planId), 'delete_plan');
    },
    [executeMutation]
  );

  const completePlan = useCallback(
    async (
      input: CompletionInput
    ): Promise<MutationResult<{ recordId: string; record: StudyRecord }>> => {
      return executeMutation(draft => applyCompletePlan(draft, input), 'complete_plan');
    },
    [executeMutation]
  );

  const updateStudyRecord = useCallback(
    (input: StudyRecordCorrectionInput): Promise<MutationResult<StudyRecord>> =>
      executeMutation(draft => applyStudyRecordCorrection(draft, input), 'correct_study_record'),
    [executeMutation]
  );

  const completeBookPlan = useCallback(
    async (planId: string, questions: number, errors: number, actualMinutes: number) => {
      const res = await completePlan({ type: 'book', planId, questions, errors, minutes: actualMinutes });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  const completeCoursePlan = useCallback(
    async (planId: string, completedLessons: number, actualMinutes: number) => {
      const res = await completePlan({ type: 'course', planId, lessons: completedLessons, minutes: actualMinutes });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  const completeCustomPlan = useCallback(
    async (planId: string, actualMinutes: number) => {
      const res = await completePlan({ type: 'custom', planId, minutes: actualMinutes });
      return { success: res.ok, error: res.ok ? undefined : res.message };
    },
    [completePlan]
  );

  // ----------------------------------------------------------------------
  // Books / Courses / Library / Wrong / Profile
  // ----------------------------------------------------------------------
  const addBook = useCallback(
    async (bookData: Omit<Book, 'id'>): Promise<MutationResult<string>> => {
      return executeMutation(draft => applyAddBook(draft, bookData), 'add_book');
    },
    [executeMutation]
  );

  const editBook = useCallback(
    async (id: string, updates: Partial<Book>): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyEditBook(draft, id, updates), 'edit_book');
    },
    [executeMutation]
  );

  const deleteBook = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteBook(draft, id), 'delete_book');
    },
    [executeMutation]
  );

  const addCourse = useCallback(
    async (courseData: Omit<Course, 'id'>): Promise<MutationResult<string>> => {
      return executeMutation(draft => applyAddCourse(draft, courseData), 'add_course');
    },
    [executeMutation]
  );

  const editCourse = useCallback(
    async (id: string, updates: Partial<Course>): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyEditCourse(draft, id, updates), 'edit_course');
    },
    [executeMutation]
  );

  const deleteCourse = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteCourse(draft, id), 'delete_course');
    },
    [executeMutation]
  );

  const addCustomItem = useCallback(
    async (name: string, subject: StudySubject, defaultMinutes: number): Promise<MutationResult<LibraryItem>> => {
      return executeMutation(draft => applyAddCustomItem(draft, name, subject, defaultMinutes), 'add_custom_item');
    },
    [executeMutation]
  );

  const updateLibraryMinutes = useCallback(
    async (id: string, defaultMinutes: number): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyUpdateLibraryMinutes(draft, id, defaultMinutes), 'update_library_minutes');
    },
    [executeMutation]
  );

  const deleteCustomItem = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteCustomItem(draft, id), 'delete_custom_item');
    },
    [executeMutation]
  );

  const addWrongRecords = useCallback(
    async (bookId: string, note: string, images: string[], date?: string): Promise<MutationResult<WrongRecord[]>> => {
      const recordDate = date || activeDate;
      return executeMutation(draft => applyAddWrongRecords(draft, bookId, recordDate, note, images), 'add_wrong_records');
    },
    [activeDate, executeMutation]
  );

  const deleteWrongRecord = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      return executeMutation(draft => applyDeleteWrongRecord(draft, id), 'delete_wrong_record');
    },
    [executeMutation]
  );

  const updateProfile = useCallback(
    async (name: string, avatar?: string): Promise<MutationResult<Profile>> => {
      return executeMutation(draft => applyUpdateProfile(draft, name, avatar), 'update_profile');
    },
    [executeMutation]
  );

  // ----------------------------------------------------------------------
  // System: seed / reset / recovery / backup / import
  // ----------------------------------------------------------------------
  const applyDefaultSeed = useCallback(async (): Promise<MutationResult<void>> => {
    return executeMutation(draft => {
      const merged = mergeSeedIntoState(draft);
      return { nextState: merged, value: undefined };
    }, 'apply_default_seed');
  }, [executeMutation]);

  const importSeedTemplate = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未就绪' };
    const user = currentUserRef.current;
    const scope = createOperationScope(user?.id ?? null);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止操作' };
    }
    return applyDefaultSeed();
  }, [applyDefaultSeed, createOperationScope, isOperationScopeValid]);

  const chooseEmptyLibrary = useCallback(async (choice: 'default' | 'blank'): Promise<MutationResult<void>> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录' };
    const scope = createOperationScope(user.id);

    if (!csrfTokenRef.current) {
      const refreshed = await refreshSession(scope);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变' };
      }
      if (!refreshed.ok) {
        return { ok: false, code: refreshed.unauthorized ? 'SESSION_EXPIRED' : 'NETWORK', message: refreshed.unauthorized ? '会话已失效，请重新登录' : '网络不可用，请稍后重试' };
      }
    }
    const csrf = csrfTokenRef.current || '';
    try {
      const res = await fetchWithTimeout('/api/workspace/init-choice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf,
          'x-workspace-user': user.id,
        },
        body: JSON.stringify({ choice }),
      }, 20000);

      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变' };
      }

      const data = await res.json().catch(() => ({}));
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变' };
      }

      if (res.status === 401) {
        handleSessionExpired();
        return { ok: false, code: 'SESSION_EXPIRED', message: '会话已失效，请重新登录' };
      }
      if (!res.ok || !data.ok) {
        return { ok: false, code: data.code || 'INIT_CHOICE_FAILED', message: data.message || '保存选择失败，请重试' };
      }
      if (data.state) {
        if (!isOperationScopeValid(scope)) {
          return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变' };
        }
        const installed = await installConfirmedServerState(user.id, data.state, {
          revision: typeof data.revision === 'number' ? data.revision : 0,
          generationId: typeof data.generationId === 'string' ? data.generationId : '',
          contentHash: typeof data.contentHash === 'string' ? data.contentHash : '',
        }, { force: true, saveRecovery: true, guard: () => isOperationScopeValid(scope) });
        if (!installed.ok) {
          return { ok: false, code: installed.code || 'INSTALL_FAILED', message: installed.message || '保存选择后载入数据失败' };
        }
        if (!isOperationScopeValid(scope)) {
          return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变' };
        }
        const latest = await loadLatestState(user.id);
        if (mountedRef.current && isOperationScopeValid(scope)) {
          applyLocalState(latest.state, latest.revision);
        }
        if (typeof data.generationId === 'string') saveActiveGenerationId(user.id, data.generationId);
      }
      if (isOperationScopeValid(scope)) {
        setNeedsInitChoice(false);
        setInitChoice(choice);
        setSyncStatus('synced');
        setSyncMessage(choice === 'default' ? '已载入系统默认学习资料库' : '已保留空白工作台，可自行创建资料');
      }
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, code: 'NETWORK', message: '网络连接中断，请联网后重试' };
    }
  }, [applyLocalState, createOperationScope, handleSessionExpired, isOperationScopeValid, refreshSession]);

  const resetState = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未成功加载，无法重置。' };
    if (preview) return executeMutation(() => ({ nextState: createPreviewState(), value: undefined }), 'preview_reset');

    const user = currentUserRef.current;
    const scope = createOperationScope(user?.id ?? null);

    if (!user) {
      try {
        const reset = await resetDatabase(null);
        if (!reset) throw new Error('重置未成功，原数据已保留。');
        if (!isOperationScopeValid(scope)) {
          return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止重置' };
        }
        const refreshed = await loadLatestState(null);
        if (mountedRef.current && isOperationScopeValid(scope)) {
          applyLocalState(refreshed.state, refreshed.revision || 1);
        }
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: 'RESET_FAILED', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // R08: persist a real recovery point BEFORE the destructive reset; abort if it fails.
    const snapshot = await loadSnapshot(user.id);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止重置' };
    }
    try {
      await saveRecoverySnapshot(user.id, snapshot?.state ?? state, snapshot?.revision ?? localRevisionRef.current);
    } catch (err) {
      return {
        ok: false,
        code: 'RECOVERY_POINT_FAILED',
        message: err instanceof Error ? err.message : '保存恢复点失败，已停止重置以保护现有数据',
      };
    }

    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止重置' };
    }

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
    }, 'reset_workspace');
  }, [applyLocalState, createOperationScope, executeMutation, isOperationScopeValid, preview, state]);

  const restoreLatestRecovery = useCallback(async (): Promise<MutationResult<void>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未加载完成' };
    if (preview) return { ok: false, code: 'PREVIEW_MODE', message: '预览模式不可用' };
    const user = currentUserRef.current;
    if (!user) return { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录' };
    const scope = createOperationScope(user.id);

    const recovery = await getLatestRecoverySnapshot(user.id);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止还原' };
    }
    if (!recovery || !recovery.state) {
      return { ok: false, code: 'NO_RECOVERY', message: '暂无可用恢复快照' };
    }
    // Keep the current content recoverable too (reversible restore).
    try {
      await saveNamedRecoverySnapshot(user.id, state, localRevisionRef.current, 'pre_restore');
    } catch {
      return { ok: false, code: 'RECOVERY_POINT_FAILED', message: '保存当前数据恢复点失败，已停止还原' };
    }

    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止还原' };
    }

    const result = await executeMutation(() => ({ nextState: structuredClone(recovery.state), value: undefined }), 'restore_recovery');
    if (!isOperationScopeValid(scope) || (!result.ok && result.code === 'AUTH_EPOCH_CHANGED')) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止还原' };
    }
    if (result.ok && mountedRef.current && isOperationScopeValid(scope)) {
      setSyncMessage('已还原所选恢复快照，正在同步到云端');
    }
    return result;
  }, [createOperationScope, executeMutation, isOperationScopeValid, preview, state]);

  const clearSafeCache = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const user = currentUserRef.current;
    const result = await clearSafeCaches(user?.id ?? null);
    if (user) await refreshPendingCount(user.id);
    setSyncMessage(result.message);
    return { ok: result.ok, message: result.message };
  }, [refreshPendingCount]);

  const clearLocalData = useCallback(async (): Promise<void> => {
    if (preview) {
      setState(createPreviewState());
      return;
    }
    const result = await clearSafeCache();
    setSyncMessage(result.message);
  }, [clearSafeCache, preview]);

  const exportBackup = useCallback(async (): Promise<MutationResult<BackupExportReceipt>> => {
    if (!readyRef.current) return { ok: false, code: 'STORAGE_NOT_READY', message: '本地数据尚未成功加载，无法导出备份。' };
    const user = currentUserRef.current;
    const scope = createOperationScope(user?.id ?? null);
    const context: OperationContext = {
      scope,
      isCurrent: () => isOperationScopeValid(scope),
      abortSignal: scope.signal,
    };
    try {
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '用户已切换，已取消导出。' };
      }
      const latest = preview ? previewStateRef.current : (await loadLatestState()).state;
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '用户已切换，已取消导出。' };
      }
      const portable = await createPortableBackupState(latest, {
        isPreview: preview,
        isScopeValid: () => isOperationScopeValid(scope),
      });
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '用户已切换，已取消导出。' };
      }
      const backupObj = {
        app: '考公工作台·土豆新版',
        version: portable.version,
        exportedAt: new Date().toISOString(),
        state: portable,
      };
      const jsonString = JSON.stringify(backupObj, null, 2);
      const utf8Bytes = new TextEncoder().encode(jsonString).byteLength;
      if (utf8Bytes > MAX_BACKUP_SIZE_BYTES) {
        return {
          ok: false,
          code: 'BACKUP_TOO_LARGE',
          message: `备份文件大小 (${utf8Bytes} 字节) 超过 50MB 限制，已停止导出。`,
        };
      }
      const blob = new Blob([jsonString], { type: 'application/json' });
      const filename = `考公工作台-土豆新版备份-${new Date().toISOString().slice(0, 10)}.json`;
      const receipt = await saveBackupFile(blob, filename, context);
      return { ok: true, value: receipt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'AUTH_SCOPE_INVALID') {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '导出期间用户身份已切换，已取消导出。' };
      }
      setStorageError(message);
      return { ok: false, code: 'EXPORT_FAILED', message };
    }
  }, [createOperationScope, isOperationScopeValid, preview]);

  const importBackup = useCallback(
    async (jsonContent: string): Promise<MutationResult<{ summary: string }>> => {
      const user = currentUserRef.current;
      const scope = createOperationScope(user?.id ?? null);
      const context: OperationContext = {
        scope,
        isCurrent: () => isOperationScopeValid(scope),
        abortSignal: scope.signal,
      };

      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
      }

      const validated = validateAndMigrateBackup(jsonContent);
      if (!validated.valid || !validated.migratedState) {
        return { ok: false, code: 'INVALID_BACKUP', message: validated.error || '备份文件校验失败' };
      }
      const nextState = validated.migratedState;

      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
      }

      // A07: 校验备份中的旧云端媒体引用（离线无法证明的旧云端引用明确拒绝）
      const cloudRefs: string[] = [];
      const addRefIfCloud = (ref: unknown) => {
        if (typeof ref === 'string') {
          const id = parseServerMediaRef(ref);
          if (id) cloudRefs.push(id);
        }
      };
      if (nextState.profile?.avatar) addRefIfCloud(nextState.profile.avatar);
      for (const w of nextState.wrong ?? []) {
        if (w.image) addRefIfCloud(w.image);
        if (Array.isArray(w.images)) {
          for (const img of w.images) addRefIfCloud(img);
        }
      }

      if (cloudRefs.length > 0) {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
        for (const id of cloudRefs) {
          if (!isOperationScopeValid(scope)) {
            return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
          }
          const local = await getMedia(id);
          if (!isOperationScopeValid(scope)) {
            return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
          }
          if (!local) {
            if (!user || preview || !isOnline) {
              return {
                ok: false,
                code: 'UNPROVEN_CLOUD_MEDIA',
                message: `离线状态下无法证明备份中的云端媒体引用 (${id})，已拒绝恢复。请联网后重试或使用包含完整图片的备份。`,
              };
            }
            try {
              const probe = await fetch(`/api/media/${id}`, {
                credentials: 'same-origin',
                signal: context.abortSignal,
              });
              if (!isOperationScopeValid(scope)) {
                return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
              }
              if (!probe.ok) {
                return {
                  ok: false,
                  code: 'INVALID_MEDIA_REF',
                  message: `备份引用的云端媒体附件 (${id}) 不存在或不属于当前账号，无法恢复。`,
                };
              }
            } catch {
              if (!isOperationScopeValid(scope)) {
                return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
              }
              return {
                ok: false,
                code: 'MEDIA_PROBE_FAILED',
                message: `无法验证媒体引用 (${id})，已拒绝恢复。`,
              };
            }
          }
        }
      }

      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已取消导入' };
      }

      return executeMutation(
        async () => {
          return {
            nextState,
            value: {
              summary: `成功恢复备份，含 ${nextState.plans.length} 条日程与 ${nextState.records.length} 条做题记录`,
            },
          };
        },
        'import_backup',
        {
          context,
          recoveryBeforeWrite: Boolean(user && !preview),
        }
      );
    },
    [createOperationScope, executeMutation, isOperationScopeValid, preview]
  );

  const selfCheck = useCallback(() => {
    const bookIds = new Set(state.books.map(b => b.id));
    const courseIds = new Set(state.courses.map(c => c.id));
    const libBookSources = state.library.filter(l => l.type === 'book' && bookIds.has(l.sourceId));
    const libCourseSources = state.library.filter(l => l.type === 'course' && courseIds.has(l.sourceId));

    const books1to1 = libBookSources.length === state.books.length;
    const courses1to1 = libCourseSources.length === state.courses.length;
    const cdOk = (state.countdowns?.length ?? 0) <= 6 &&
      state.countdowns.every(cd => Boolean(cd.id) && Boolean(cd.name?.trim()) && (cd.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(cd.date)));
    const ok = books1to1 && courses1to1 && cdOk;

    const details = [
      `题本映射: ${libBookSources.length}/${state.books.length} 正常一对一`,
      `网课映射: ${libCourseSources.length}/${state.courses.length} 正常一对一`,
      `倒数日: ${state.countdowns.length} 个配置正常（上限6个）`,
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

  // ----------------------------------------------------------------------
  // Auth: login / register / logout
  // ----------------------------------------------------------------------
  const login = useCallback(async (username: string, password: string): Promise<MutationResult<User>> => {
    return serializeAuth(async () => {
      bumpAuthEpoch();
      const currentEpoch = authEpochRef.current;
      setIsLoading(true);
      try {
        const res = await fetchWithTimeout('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setIsLoading(false);
          return { ok: false, code: data.code || 'LOGIN_FAILED', message: data.message || '登录失败' };
        }
        if (authEpochRef.current !== currentEpoch) {
          setIsLoading(false);
          return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
        }

        setExplicitLogoutMarker(false);
        const user = data.user as User;
        const csrf = typeof data.csrfToken === 'string' ? data.csrfToken : '';
        currentUserRef.current = user;
        csrfTokenRef.current = csrf;
        setCurrentUser(user);
        setCsrfToken(csrf);
        saveLastActiveUser(user);
        setActiveUserPartition(user.id);

        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const bc = new BroadcastChannel('kaogong_auth');
            bc.postMessage({ type: 'login', userId: user.id });
            bc.close();
          }
        } catch {}

        const hydrateScope = createOperationScope(user.id);

        const hydrate = await initialHydrate(user.id, csrf, {
          guard: () => isOperationScopeValid(hydrateScope),
          scope: hydrateScope,
          signal: hydrateScope.signal,
        });
        if (!isOperationScopeValid(hydrateScope)) {
          setIsLoading(false);
          return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
        }

        if (!hydrate.ok) {
          if (hydrate.needsRelogin) {
            handleSessionExpired();
            setIsLoading(false);
            return { ok: false, code: 'SESSION_EXPIRED', message: '登录状态校验失败，请重新登录' };
          }
          setAuthPhase('error');
          setAuthError(hydrate.message || '登录成功但云端工作区加载失败');
          setSyncStatus('failed');
          setSyncMessage(hydrate.message || '云端工作区加载失败');
          setIsLoading(false);
          return { ok: false, code: hydrate.code || 'WORKSPACE_LOAD_FAILED', message: hydrate.message || '云端工作区加载失败，请重试' };
        }

        await applyHydrateResult(user, csrf, hydrate, currentEpoch);
        return { ok: true, value: user };
      } catch (err) {
        setIsLoading(false);
        return { ok: false, code: 'NETWORK_ERROR', message: '无法连接登录服务，请检查网络' };
      }
    });
  }, [applyHydrateResult, bumpAuthEpoch, createOperationScope, handleSessionExpired, isOperationScopeValid, serializeAuth]);

  const register = useCallback(async (
    username: string,
    password: string,
    nickname: string,
    inviteCode: string
  ): Promise<MutationResult<User>> => {
    return serializeAuth(async () => {
      bumpAuthEpoch();
      const currentEpoch = authEpochRef.current;
      setIsLoading(true);
      try {
        const res = await fetchWithTimeout('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, nickname, inviteCode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setIsLoading(false);
          return { ok: false, code: data.code || 'REGISTER_FAILED', message: data.message || '注册失败' };
        }
        if (authEpochRef.current !== currentEpoch) {
          setIsLoading(false);
          return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
        }

        setExplicitLogoutMarker(false);
        const user = data.user as User;
        const csrf = typeof data.csrfToken === 'string' ? data.csrfToken : '';
        currentUserRef.current = user;
        csrfTokenRef.current = csrf;
        setCurrentUser(user);
        setCsrfToken(csrf);
        saveLastActiveUser(user);
        setActiveUserPartition(user.id);

        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const bc = new BroadcastChannel('kaogong_auth');
            bc.postMessage({ type: 'login', userId: user.id });
            bc.close();
          }
        } catch {}

        const hydrateScope = createOperationScope(user.id);

        const hydrate = await initialHydrate(user.id, csrf, {
          guard: () => isOperationScopeValid(hydrateScope),
          scope: hydrateScope,
          signal: hydrateScope.signal,
        });
        if (!isOperationScopeValid(hydrateScope)) {
          setIsLoading(false);
          return { ok: false, code: 'AUTH_STALE', message: '操作已取消' };
        }

        if (!hydrate.ok) {
          if (hydrate.needsRelogin) {
            handleSessionExpired();
            setIsLoading(false);
            return { ok: false, code: 'SESSION_EXPIRED', message: '注册成功后会话校验失败，请重新登录' };
          }
          setAuthPhase('error');
          setAuthError(hydrate.message || '注册成功但云端工作区加载失败');
          setSyncStatus('failed');
          setSyncMessage(hydrate.message || '云端工作区加载失败');
          setIsLoading(false);
          return { ok: false, code: hydrate.code || 'WORKSPACE_LOAD_FAILED', message: hydrate.message || '云端工作区加载失败，请重试' };
        }

        await applyHydrateResult(user, csrf, hydrate, currentEpoch);
        setNeedsInitChoice(false);
        setInitChoice('default');
        return { ok: true, value: user };
      } catch (err) {
        setIsLoading(false);
        return { ok: false, code: 'NETWORK_ERROR', message: '无法连接注册服务，请检查网络' };
      }
    });
  }, [applyHydrateResult, bumpAuthEpoch, createOperationScope, handleSessionExpired, isOperationScopeValid, serializeAuth]);

  const logout = useCallback(async (): Promise<void> => {
    return serializeAuth(async () => {
      bumpAuthEpoch();
      clearRetryTimer();
      syncInFlightRef.current = null;
      setExplicitLogoutMarker(true);

      const user = currentUserRef.current;
      const csrf = csrfTokenRef.current;

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('kaogong_auth');
          bc.postMessage({ type: 'logout' });
          bc.close();
        }
      } catch {}

      try {
        await fetchWithTimeout('/api/auth/logout', {
          method: 'POST',
          headers: {
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
            ...(user ? { 'x-workspace-user': user.id } : {}),
          },
        }, 8000);
      } catch {
        // Offline / failed logout: the marker already prevents silent re-entry.
      }
      currentUserRef.current = null;
      csrfTokenRef.current = null;
      setCurrentUser(null);
      setCsrfToken(null);
      setActiveUserPartition(null);
      setSyncStatus('idle');
      setSyncMessage(null);
      setConflictData(null);
      setNeedsInitChoice(false);
      setInitChoice(null);
      setGuestMigration(null);
      setSessionExpired(false);
      setAuthPhase('unauthenticated');
      const guestState = await loadLatestState(null);
      if (mountedRef.current && !currentUserRef.current) {
        readyRef.current = true;
        applyLocalState(guestState.state, guestState.revision || 1);
      }
    });
  }, [applyLocalState, bumpAuthEpoch, clearRetryTimer, serializeAuth]);

  // ----------------------------------------------------------------------
  // Conflict resolution (R05/R12: real content, review-time re-verification)
  // ----------------------------------------------------------------------
  const resolveConflict = useCallback(async (choice: 'keep_local' | 'keep_remote'): Promise<MutationResult<void>> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, code: 'NO_CONFLICT', message: '当前没有待解决的冲突' };

    const scope = createOperationScope(user.id);
    const context: OperationContext = {
      scope,
      isCurrent: () => isOperationScopeValid(scope),
      abortSignal: scope.signal,
    };
    const syncOptions = {
      context,
      scope,
      signal: scope.signal,
      guard: () => isOperationScopeValid(scope),
    };

    const record = await getConflictRecord(user.id);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }
    if (!record) {
      if (mountedRef.current && isOperationScopeValid(scope)) setConflictData(null);
      return { ok: false, code: 'NO_CONFLICT', message: '当前没有待解决的冲突' };
    }

    if (!csrfTokenRef.current) {
      const refreshed = await refreshSession(scope);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
      }
      if (!refreshed.ok) {
        return {
          ok: false,
          code: refreshed.unauthorized ? 'SESSION_EXPIRED' : 'NETWORK',
          message: refreshed.unauthorized ? '会话已失效，请联网并重新登录后处理冲突' : '网络暂不可用，请恢复连接后处理冲突',
        };
      }
    }
    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }

    let csrf = csrfTokenRef.current || '';
    if (!csrf) return { ok: false, code: 'CSRF_INVALID', message: '安全令牌缺失，请重新登录后处理冲突' };

    const reviewed = {
      serverRevision: record.serverRevision,
      serverGenerationId: record.serverGenerationId,
      serverContentHash: record.serverContentHash,
    };

    let result = choice === 'keep_remote'
      ? await forcePullRemote(user.id, record.serverState as AppState, record.serverRevision, localRevisionRef.current, reviewed, undefined, csrf, syncOptions)
      : await forceUploadLocal(user.id, csrf, reviewed, localRevisionRef.current, undefined, syncOptions);

    if (!isOperationScopeValid(scope) || result.code === 'AUTH_EPOCH_CHANGED') {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }

    if (result.needsSessionRefresh) {
      const refreshed = await refreshSession(scope);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
      }
      if (refreshed.ok) {
        csrf = csrfTokenRef.current || '';
        result = choice === 'keep_remote'
          ? await forcePullRemote(user.id, record.serverState as AppState, record.serverRevision, localRevisionRef.current, reviewed, undefined, csrf, syncOptions)
          : await forceUploadLocal(user.id, csrf, reviewed, localRevisionRef.current, undefined, syncOptions);
      }
      if (!isOperationScopeValid(scope) || result.code === 'AUTH_EPOCH_CHANGED') {
        return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
      }
    }

    if (result.needsRelogin) {
      if (isOperationScopeValid(scope)) handleSessionExpired();
      return { ok: false, code: 'SESSION_EXPIRED', message: result.message || '会话已失效，请重新登录' };
    }

    if (result.status === 'conflict') {
      if (mountedRef.current && isOperationScopeValid(scope)) {
        setConflictData({
          serverRevision: result.serverRevision || 0,
          serverState: result.serverState ?? null,
          serverGenerationId: result.serverGenerationId,
          serverContentHash: result.serverContentHash,
        });
        setSyncStatus('conflict');
        setSyncMessage(result.message || '云端内容已变化，请重新核对');
      }
      return { ok: false, code: result.code || 'CONFLICT_STILL_OPEN', message: result.message || '云端内容已变化，请重新核对后选择' };
    }

    if (!result.ok) {
      return { ok: false, code: result.code || 'CONFLICT_RESOLVE_FAILED', message: result.message || '冲突处理失败，请重试' };
    }

    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }

    await clearConflictRecord(user.id, syncOptions);

    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }

    const latest = await loadLatestState(user.id);

    if (!isOperationScopeValid(scope)) {
      return { ok: false, code: 'AUTH_EPOCH_CHANGED', message: '账号状态已改变，已终止冲突处理' };
    }

    if (mountedRef.current && isOperationScopeValid(scope)) {
      applyLocalState(latest.state, latest.revision);
      setConflictData(null);
      setSyncStatus('synced');
      setSyncMessage(choice === 'keep_remote' ? '已采用云端最新数据，本机恢复点已保留' : '已保留本机内容并更新云端');
      await refreshPendingCount(user.id);
    }
    return { ok: true, value: undefined };
  }, [applyLocalState, createOperationScope, handleSessionExpired, isOperationScopeValid, refreshPendingCount, refreshSession]);

  const forceUpload = useCallback(async (): Promise<SyncResult> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, status: 'offline', message: '未登录云端账号' };
    const scope = createOperationScope(user.id);
    const context: OperationContext = {
      scope,
      isCurrent: () => isOperationScopeValid(scope),
      abortSignal: scope.signal,
    };
    const syncOptions = {
      context,
      scope,
      signal: scope.signal,
      guard: () => isOperationScopeValid(scope),
    };

    const record = await getConflictRecord(user.id);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止上传' };
    }

    const resolution = await resolveConflict('keep_local');
    if (!isOperationScopeValid(scope)) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止上传' };
    }

    if (resolution.ok) {
      const latest = await loadLatestState(user.id);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止上传' };
      }
      return { ok: true, status: 'synced', message: '云端已更新为本机当前状态', serverRevision: latest.confirmedRevision, serverState: latest.state };
    }
    if (!record) {
      // No prior conflict: upload local as-is after fresh verification.
      const server = await fetchServerSnapshot(user.id, scope.signal);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止上传' };
      }
      if (!server.ok || !server.hasCloudData) return { ok: false, status: 'failed', message: server.message || '云端暂无数据' };
      return forceUploadLocal(user.id, csrfTokenRef.current || '', {
        serverRevision: server.revision,
        serverGenerationId: server.generationId,
        serverContentHash: server.contentHash,
      }, localRevisionRef.current, undefined, syncOptions);
    }
    return { ok: false, status: 'failed', code: resolution.code, message: resolution.message };
  }, [createOperationScope, isOperationScopeValid, resolveConflict]);

  const forcePull = useCallback(async (): Promise<SyncResult> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, status: 'offline', message: '未登录云端账号' };
    const scope = createOperationScope(user.id);
    const context: OperationContext = {
      scope,
      isCurrent: () => isOperationScopeValid(scope),
      abortSignal: scope.signal,
    };
    const syncOptions = {
      context,
      scope,
      signal: scope.signal,
      guard: () => isOperationScopeValid(scope),
    };

    const record = await getConflictRecord(user.id);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止拉取' };
    }

    if (record) {
      const resolution = await resolveConflict('keep_remote');
      if (!isOperationScopeValid(scope)) {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止拉取' };
      }
      const latest = await loadLatestState(user.id);
      if (!isOperationScopeValid(scope)) {
        return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止拉取' };
      }
      return resolution.ok
        ? { ok: true, status: 'synced', message: '已从云端拉取最新数据覆盖本机', serverRevision: latest.confirmedRevision, serverState: latest.state }
        : { ok: false, status: 'failed', code: resolution.code, message: resolution.message };
    }
    const server = await fetchServerSnapshot(user.id, scope.signal);
    if (!isOperationScopeValid(scope)) {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止拉取' };
    }
    if (!server.ok || !server.hasCloudData || !server.state) {
      return { ok: false, status: 'failed', message: server.message || '云端暂无可用数据' };
    }
    const result = await forcePullRemote(user.id, server.state, server.revision, localRevisionRef.current, {
      serverRevision: server.revision,
      serverGenerationId: server.generationId,
      serverContentHash: server.contentHash,
    }, undefined, undefined, syncOptions);
    if (!isOperationScopeValid(scope) || result.code === 'AUTH_EPOCH_CHANGED') {
      return { ok: false, status: 'failed', code: 'AUTH_EPOCH_CHANGED', message: '账号状态已变化，已终止拉取' };
    }
    if (result.ok) {
      const latest = await loadLatestState(user.id);
      if (mountedRef.current && isOperationScopeValid(scope)) applyLocalState(latest.state, latest.revision);
    }
    return result;
  }, [applyLocalState, createOperationScope, isOperationScopeValid, resolveConflict]);

  // ----------------------------------------------------------------------
  // Guest migration (R10)
  // ----------------------------------------------------------------------
  // Legacy guest data (v2) -> account migration (R10 / Issue A01)
  // React state is only used for migration preview. When executed:
  // 1. Re-reads real snapshot under user lock.
  // 2. Aborts with LOCAL_CHANGED if local revision changed since preview.
  // 3. Atomically commits recovery points, snapshot, outbox and sync_state credential.
  // ----------------------------------------------------------------------
  const refreshGuestMigration = useCallback(async (targetState?: AppState) => {
    const user = currentUserRef.current;
    if (!user || preview) {
      setGuestMigration(null);
      return;
    }
    const alreadyDone = await checkGuestMigrationCredential(user.id);
    if (alreadyDone) {
      if (mountedRef.current) setGuestMigration(null);
      return;
    }
    const raw = readLegacyGuestRaw();
    if (!raw) {
      if (mountedRef.current) setGuestMigration(null);
      return;
    }
    const validated = validateAndMigrateBackup(raw);
    if (!validated.valid || !validated.migratedState) {
      if (mountedRef.current) setGuestMigration(null);
      return;
    }
    try {
      const stateToPreview = targetState ?? state;
      const { preview: migrationPreview } = buildGuestMigration(stateToPreview, validated.migratedState);
      if (mountedRef.current && currentUserRef.current?.id === user.id) {
        setGuestMigration({ available: true, preview: migrationPreview, guestState: validated.migratedState });
      }
    } catch {
      if (mountedRef.current) {
        setGuestMigration(null);
      }
    }
  }, [preview, state]);

  useEffect(() => {
    if (preview || authPhase !== 'authenticated') return;
    refreshGuestMigration();
  }, [authPhase, preview, refreshGuestMigration]);

  const migrateLegacyGuestData = useCallback(async (): Promise<MutationResult<void>> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录' };
    const guestState = guestMigration?.guestState;
    if (!guestState) return { ok: false, code: 'NO_GUEST_DATA', message: '未检测到可迁移的旧版本地数据' };

    const scope = createOperationScope(user.id);
    const expectedRevision = localRevisionRef.current;
    const result = await executeGuestMigration({
      userId: user.id,
      scope,
      isScopeValid: isOperationScopeValid,
      accountState: state,
      guestState,
      expectedRevision,
      outboxBuilder: (nextState, meta) => ({
        id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        userId: user.id,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        state: nextState,
        expectedRevision: meta.confirmedRevision,
        generationId: meta.generationId,
        createdAt: new Date().toISOString(),
        status: 'pending',
      }),
    });

    if (!result.ok) {
      if (result.code === 'LOCAL_CHANGED') {
        const latest = await loadLatestState(user.id);
        if (mountedRef.current && currentUserRef.current?.id === user.id) {
          applyLocalState(latest.state, latest.revision);
          await refreshGuestMigration(latest.state);
        }
      }
      return result;
    }

    const latest = await loadLatestState(user.id);
    if (mountedRef.current && currentUserRef.current?.id === user.id) {
      applyLocalState(latest.state, latest.revision);
      setGuestMigration(null);
      setSyncMessage('旧版本地数据已迁移到当前账号，正在同步到云端');
      triggerSync();
    }
    return { ok: true, value: undefined };
  }, [applyLocalState, createOperationScope, guestMigration, isOperationScopeValid, refreshGuestMigration, state, triggerSync]);

  const dismissGuestMigration = useCallback(() => {
    setGuestMigration(null);
  }, []);

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
        addCountdown,
        updateCountdown,
        deleteCountdown,
        addPlan,
        quickAddPlan,
        addCustomPlan,
        addTodo,
        toggleTodo,
        deleteTodo,
        moveTodosToDate,
        configureTimer,
        beginTimerSession,
        sessionAction,
        setSessionSubject,
        finishSession,
        configureSession,
        registerSession,
        switchTimerPhase,
        startTimer,
        pauseTimer,
        deletePlan,
        completePlan,
        updateStudyRecord,
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
        applyDefaultSeed,
        resetState,
        exportBackup,
        importBackup,
        selfCheck,
        authPhase,
        authError,
        retryAuthLoad,
        sessionExpired,
        currentUser,
        csrfToken,
        syncStatus,
        syncMessage,
        conflictData,
        localRevision,
        pendingSyncCount,
        hasUnsyncedChanges: pendingSyncCount > 0 || Boolean(conflictData),
        needsInitChoice,
        initChoice,
        chooseEmptyLibrary,
        login,
        register,
        logout,
        triggerSync,
        forceUpload,
        forcePull,
        resolveConflict,
        clearLocalData,
        clearSafeCache,
        restoreLatestRecovery,
        importSeedTemplate,
        guestMigration,
        refreshGuestMigration,
        migrateLegacyGuestData,
        dismissGuestMigration,
        offlineReady,
        updateInfo,
        updateCheckState,
        isCheckingUpdate,
        checkForUpdate,
        dismissUpdate,
        applyUpdate,
        updateGuard,
        registerUpdateBlocker,
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
