import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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
} from '../types';
import { INITIAL_STATE, BLANK_STATE, getLocalDateString } from '../constants/initialData';
import { validateAndMigrateBackup } from '../utils/backupValidator';
import {
  loadLatestState,
  commitMutation,
  resetDatabase,
} from '../utils/db';
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
  exportBackup: () => void;
  importBackup: (jsonContent: string) => Promise<MutationResult<{ summary: string }>>;
  selfCheck: () => { ok: boolean; message: string; details: string[] };
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [corruptedRaw, setCorruptedRaw] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Local Date Management: Initialize with getLocalDateString()
  const [activeDate, setActiveDate] = useState<string>(() => getLocalDateString());

  const clearStorageError = useCallback(() => {
    setStorageError(null);
  }, []);

  const clearCorruptedRaw = useCallback(() => {
    setCorruptedRaw(null);
  }, []);

  // 1. Initial State Load from IndexedDB (loadLatestState)
  useEffect(() => {
    let mounted = true;
    loadLatestState()
      .then(res => {
        if (!mounted) return;
        setState(res.state);
        if (res.corruptedRaw) {
          setCorruptedRaw(res.corruptedRaw);
          setStorageError('检测到受损的旧版数据缓存，已安全隔离至受损数据表，未覆盖初始空白状态。');
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error('加载本地数据库异常:', err);
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // 2. Cross-day and Midnight Rollover Listener
  useEffect(() => {
    const checkMidnightRollover = () => {
      const today = getLocalDateString();
      setActiveDate(prev => {
        if (prev !== today) {
          return today;
        }
        return prev;
      });
    };

    window.addEventListener('focus', checkMidnightRollover);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkMidnightRollover();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = setInterval(checkMidnightRollover, 30000);

    return () => {
      window.removeEventListener('focus', checkMidnightRollover);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, []);

  // Serial transaction executor via commitMutation (db.ts)
  const executeMutation = useCallback(
    async <T,>(
      mutator: (draft: AppState) => Promise<MutatorReturn<T>> | MutatorReturn<T>
    ): Promise<MutationResult<T>> => {
      let appliedNextState: AppState | null = null;
      const result = await commitMutation<T>(async draft => {
        const res = await mutator(draft);
        if ('nextState' in res) {
          appliedNextState = res.nextState;
        }
        return res;
      });

      if (result.ok && appliedNextState) {
        setState(appliedNextState);
      }
      return result;
    },
    []
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
  // System: Reset, Backup, Import
  // ----------------------------------------------------------------------
  const resetState = useCallback(async (): Promise<MutationResult<void>> => {
    try {
      await resetDatabase();
      setState(BLANK_STATE);
      return { ok: true, value: undefined };
    } catch (err) {
      return {
        ok: false,
        code: 'RESET_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

  const exportBackup = useCallback(() => {
    const backupObj = {
      app: '考公工作台·土豆新版',
      version: 3,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `考公工作台-土豆新版备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

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
