import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AppState, Book, Course, LibraryItem, Plan, StudyRecord, WrongRecord, Subject } from '../types';
import { INITIAL_STATE, buildLibraryFromSources } from '../constants/initialData';
import { validateAndMigrateBackup } from '../utils/backupValidator';
import { safeSaveState } from '../utils/imageCompressor';

const STORAGE_KEY = 'potato_study_v2';

interface AppContextType {
  state: AppState;
  activeDate: string;
  setActiveDate: (d: string) => void;
  storageError: string | null;
  clearStorageError: () => void;
  // Countdowns
  updateCountdown: (id: string, date: string) => void;
  // Plans & Timers
  addPlan: (libraryId: string, plannedMinutes: number) => void;
  quickAddPlan: (libraryId: string) => void;
  startTimer: (planId: string) => void;
  pauseTimer: (planId: string) => void;
  deletePlan: (planId: string) => void;
  completeBookPlan: (planId: string, questions: number, errors: number, actualMinutes: number) => { success: boolean; error?: string };
  completeCoursePlan: (planId: string, completedLessons: number, actualMinutes: number) => { success: boolean; error?: string };
  completeCustomPlan: (planId: string, actualMinutes: number) => { success: boolean; error?: string };
  // Books
  addBook: (book: Omit<Book, 'id'>) => string;
  editBook: (id: string, updates: Partial<Book>) => void;
  deleteBook: (id: string) => void;
  // Courses
  addCourse: (course: Omit<Course, 'id'>) => string;
  editCourse: (id: string, updates: Partial<Course>) => void;
  deleteCourse: (id: string) => void;
  // Library
  addCustomItem: (name: string, subject: Subject, defaultMinutes: number) => void;
  updateLibraryMinutes: (id: string, defaultMinutes: number) => void;
  deleteCustomItem: (id: string) => void;
  // Wrong records
  addWrongRecords: (bookId: string, note: string, images: string[]) => { success: boolean; error?: string };
  deleteWrongRecord: (id: string) => void;
  // Profile
  updateProfile: (name: string, avatar?: string) => void;
  // System
  resetState: () => void;
  exportBackup: () => void;
  importBackup: (jsonContent: string) => { success: boolean; error?: string };
  selfCheck: () => { ok: boolean; message: string; details: string[] };
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Robust migration & schema check (Fixes A02)
        const validated = validateAndMigrateBackup(saved);
        if (validated.valid && validated.migratedState) {
          return validated.migratedState;
        }
      }
    } catch (e) {
      console.warn('Failed to load local state, using initial state', e);
    }
    return INITIAL_STATE;
  });

  // Dynamic system date instead of hardcoded demo date (Fixes A09)
  const getTodayDate = () => new Date().toISOString().slice(0, 10);
  const [activeDate, setActiveDate] = useState<string>(getTodayDate);
  const [storageError, setStorageError] = useState<string | null>(null);

  const clearStorageError = useCallback(() => {
    setStorageError(null);
  }, []);

  // Sync to localStorage safely with quota overflow detection (Fixes A01)
  useEffect(() => {
    const res = safeSaveState(STORAGE_KEY, state);
    if (!res.success && res.error) {
      setStorageError(res.error);
    } else {
      setStorageError(null);
    }
  }, [state]);

  // Reconcile helper ensuring 1-1 library mapping
  const reconcileState = useCallback((prev: AppState): AppState => {
    const updatedLib = buildLibraryFromSources(prev.books, prev.courses, prev.library);
    return {
      ...prev,
      library: updatedLib,
    };
  }, []);

  // Update countdown with strict ID check to prevent updating all undefined IDs (Fixes A04)
  const updateCountdown = useCallback((id: string, date: string) => {
    if (!id) return;
    setState(prev => ({
      ...prev,
      countdowns: prev.countdowns.map(cd => (cd.id && cd.id === id) ? { ...cd, date } : cd),
    }));
  }, []);

  const addPlan = useCallback((libraryId: string, plannedMinutes: number) => {
    setState(prev => {
      const item = prev.library.find(l => l.id === libraryId);
      if (!item) return prev;
      const newPlan: Plan = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: activeDate,
        libraryId: item.id,
        name: item.name,
        type: item.type,
        sourceId: item.sourceId,
        subject: item.subject,
        plannedMinutes: plannedMinutes > 0 ? plannedMinutes : item.defaultMinutes,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: 0,
      };
      return {
        ...prev,
        plans: [...prev.plans, newPlan],
      };
    });
  }, [activeDate]);

  const quickAddPlan = useCallback((libraryId: string) => {
    setState(prev => {
      const item = prev.library.find(l => l.id === libraryId);
      if (!item) return prev;
      const newPlan: Plan = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: activeDate,
        libraryId: item.id,
        name: item.name,
        type: item.type,
        sourceId: item.sourceId,
        subject: item.subject,
        plannedMinutes: item.defaultMinutes,
        actualMinutes: 0,
        accumulatedMs: 0,
        done: false,
        timerStart: 0,
      };
      return {
        ...prev,
        plans: [...prev.plans, newPlan],
      };
    });
  }, [activeDate]);

  // Idempotent startTimer: does not overwrite starting timestamp if already running (Fixes A03)
  const startTimer = useCallback((planId: string) => {
    setState(prev => ({
      ...prev,
      plans: prev.plans.map(p => {
        if (p.id === planId && !p.done) {
          if (p.timerStart > 0) return p;
          return { ...p, timerStart: Date.now() };
        }
        return p;
      }),
    }));
  }, []);

  // Precise millisecond accumulation without fragment 1-minute inflation (Fixes A10)
  const pauseTimer = useCallback((planId: string) => {
    setState(prev => ({
      ...prev,
      plans: prev.plans.map(p => {
        if (p.id === planId && p.timerStart > 0) {
          const elapsedMs = Math.max(0, Date.now() - p.timerStart);
          const prevAccumulated = typeof p.accumulatedMs === 'number'
            ? p.accumulatedMs
            : (p.actualMinutes || 0) * 60000;
          const newAccumulated = prevAccumulated + elapsedMs;
          const actualMinutes = Math.floor(newAccumulated / 60000);
          return {
            ...p,
            accumulatedMs: newAccumulated,
            actualMinutes,
            timerStart: 0,
          };
        }
        return p;
      }),
    }));
  }, []);

  const deletePlan = useCallback((planId: string) => {
    setState(prev => ({
      ...prev,
      plans: prev.plans.filter(p => p.id !== planId),
    }));
  }, []);

  // Complete book plan with source existence check (Fixes A05)
  const completeBookPlan = useCallback((planId: string, questions: number, errors: number, actualMinutes: number) => {
    let outcome: { success: boolean; error?: string } = { success: false, error: '计划未找到或已完成' };
    setState(prev => {
      const plan = prev.plans.find(p => p.id === planId);
      if (!plan || plan.done) return prev;

      // Check if source book still exists before adding record
      const sourceBook = prev.books.find(b => b.id === plan.sourceId);
      if (!sourceBook) {
        console.warn(`[Data Integrity] Cannot complete plan ${planId}: source book ${plan.sourceId} has been deleted.`);
        outcome = { success: false, error: '关联题本已被删除，无法生成学习记录。建议直接移除该计划。' };
        return prev;
      }

      const recordId = `rec-${Date.now()}`;
      const q = Math.max(0, questions);
      const e = Math.min(q, Math.max(0, errors));
      const m = Math.max(0, actualMinutes);

      // Update book totals
      const updatedBooks = prev.books.map(b => {
        if (b.id === plan.sourceId) {
          return {
            ...b,
            done: b.done + q,
            errors: b.errors + e,
            minutes: b.minutes + m,
          };
        }
        return b;
      });

      // Update plan
      const updatedPlans = prev.plans.map(p => {
        if (p.id === planId) {
          return {
            ...p,
            done: true,
            timerStart: 0,
            actualMinutes: m,
            accumulatedMs: m * 60000,
            recordId,
          };
        }
        return p;
      });

      // Add record
      const newRecord: StudyRecord = {
        id: recordId,
        planId,
        date: plan.date,
        type: 'book',
        sourceId: plan.sourceId,
        subject: plan.subject,
        minutes: m,
        questions: q,
        errors: e,
      };

      outcome = { success: true };
      return {
        ...prev,
        books: updatedBooks,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
    return outcome;
  }, []);

  // Complete course plan with source existence check (Fixes A05)
  const completeCoursePlan = useCallback((planId: string, completedLessons: number, actualMinutes: number) => {
    let outcome: { success: boolean; error?: string } = { success: false, error: '计划未找到或已完成' };
    setState(prev => {
      const plan = prev.plans.find(p => p.id === planId);
      if (!plan || plan.done) return prev;

      // Check if source course still exists
      const sourceCourse = prev.courses.find(c => c.id === plan.sourceId);
      if (!sourceCourse) {
        console.warn(`[Data Integrity] Cannot complete plan ${planId}: source course ${plan.sourceId} has been deleted.`);
        outcome = { success: false, error: '关联课程已被删除，无法生成学习记录。建议直接移除该计划。' };
        return prev;
      }

      const recordId = `rec-${Date.now()}`;
      const l = Math.max(0, completedLessons);
      const m = Math.max(0, actualMinutes);

      const updatedCourses = prev.courses.map(c => {
        if (c.id === plan.sourceId) {
          return {
            ...c,
            completedLessons: Math.min(c.totalLessons, c.completedLessons + l),
            minutes: c.minutes + m,
          };
        }
        return c;
      });

      const updatedPlans = prev.plans.map(p => {
        if (p.id === planId) {
          return {
            ...p,
            done: true,
            timerStart: 0,
            actualMinutes: m,
            accumulatedMs: m * 60000,
            recordId,
          };
        }
        return p;
      });

      const newRecord: StudyRecord = {
        id: recordId,
        planId,
        date: plan.date,
        type: 'course',
        sourceId: plan.sourceId,
        subject: plan.subject,
        minutes: m,
        questions: 0,
        errors: 0,
      };

      outcome = { success: true };
      return {
        ...prev,
        courses: updatedCourses,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
    return outcome;
  }, []);

  const completeCustomPlan = useCallback((planId: string, actualMinutes: number) => {
    let outcome: { success: boolean; error?: string } = { success: false, error: '计划未找到或已完成' };
    setState(prev => {
      const plan = prev.plans.find(p => p.id === planId);
      if (!plan || plan.done) return prev;

      const recordId = `rec-${Date.now()}`;
      const m = Math.max(0, actualMinutes);

      const updatedPlans = prev.plans.map(p => {
        if (p.id === planId) {
          return {
            ...p,
            done: true,
            timerStart: 0,
            actualMinutes: m,
            accumulatedMs: m * 60000,
            recordId,
          };
        }
        return p;
      });

      const newRecord: StudyRecord = {
        id: recordId,
        planId,
        date: plan.date,
        type: 'custom',
        sourceId: plan.sourceId || '',
        subject: plan.subject,
        minutes: m,
        questions: 0,
        errors: 0,
      };

      outcome = { success: true };
      return {
        ...prev,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
    return outcome;
  }, []);

  const addBook = useCallback((bookData: Omit<Book, 'id'>) => {
    const id = `book-${Date.now()}`;
    const newBook: Book = { ...bookData, id };
    setState(prev => reconcileState({
      ...prev,
      books: [...prev.books, newBook],
    }));
    return id;
  }, [reconcileState]);

  const editBook = useCallback((id: string, updates: Partial<Book>) => {
    setState(prev => reconcileState({
      ...prev,
      books: prev.books.map(b => b.id === id ? { ...b, ...updates } : b),
    }));
  }, [reconcileState]);

  const deleteBook = useCallback((id: string) => {
    setState(prev => reconcileState({
      ...prev,
      books: prev.books.filter(b => b.id !== id),
    }));
  }, [reconcileState]);

  const addCourse = useCallback((courseData: Omit<Course, 'id'>) => {
    const id = `course-${Date.now()}`;
    const newCourse: Course = { ...courseData, id };
    setState(prev => reconcileState({
      ...prev,
      courses: [...prev.courses, newCourse],
    }));
    return id;
  }, [reconcileState]);

  const editCourse = useCallback((id: string, updates: Partial<Course>) => {
    setState(prev => reconcileState({
      ...prev,
      courses: prev.courses.map(c => c.id === id ? { ...c, ...updates } : c),
    }));
  }, [reconcileState]);

  const deleteCourse = useCallback((id: string) => {
    setState(prev => reconcileState({
      ...prev,
      courses: prev.courses.filter(c => c.id !== id),
    }));
  }, [reconcileState]);

  const addCustomItem = useCallback((name: string, subject: Subject, defaultMinutes: number) => {
    const newItem: LibraryItem = {
      id: `lib-custom-${Date.now()}`,
      type: 'custom',
      sourceId: '',
      name,
      subject,
      defaultMinutes: Math.max(1, defaultMinutes),
    };
    setState(prev => ({
      ...prev,
      library: [...prev.library, newItem],
    }));
  }, []);

  const updateLibraryMinutes = useCallback((id: string, defaultMinutes: number) => {
    setState(prev => ({
      ...prev,
      library: prev.library.map(l => l.id === id ? { ...l, defaultMinutes: Math.max(1, defaultMinutes) } : l),
    }));
  }, []);

  const deleteCustomItem = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      library: prev.library.filter(l => l.id !== id),
    }));
  }, []);

  // Add wrong records with storage capacity verification (Fixes A01)
  const addWrongRecords = useCallback((bookId: string, note: string, images: string[]) => {
    const date = activeDate;
    const newRecords: WrongRecord[] = images.map(img => ({
      id: `wrong-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      bookId,
      note,
      image: img,
    }));

    const nextWrong = [...newRecords, ...state.wrong];
    const nextState = { ...state, wrong: nextWrong };
    const checkSave = safeSaveState(STORAGE_KEY, nextState);
    if (!checkSave.success) {
      setStorageError(checkSave.error || '本地存储容量不足，无法保存照片');
      return { success: false, error: checkSave.error || '本地存储容量不足，无法保存照片' };
    }

    setState(nextState);
    setStorageError(null);
    return { success: true };
  }, [activeDate, state]);

  const deleteWrongRecord = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      wrong: prev.wrong.filter(w => w.id !== id),
    }));
  }, []);

  const updateProfile = useCallback((name: string, avatar?: string) => {
    setState(prev => ({
      ...prev,
      profile: {
        ...prev.profile,
        name: name.trim() || prev.profile.name,
        avatar: avatar !== undefined ? avatar : prev.profile.avatar,
      },
    }));
  }, []);

  const resetState = useCallback(() => {
    setState(INITIAL_STATE);
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

  // Robust importBackup using complete schema validator & migration (Fixes A02, A04)
  const importBackup = useCallback((jsonContent: string) => {
    const validated = validateAndMigrateBackup(jsonContent);
    if (!validated.valid || !validated.migratedState) {
      return { success: false, error: validated.error || '备份文件校验失败' };
    }
    setState(validated.migratedState);
    return { success: true };
  }, []);

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
      message: ok ? '自检通过：题本与网课均与事项库一对一绑定，3个倒计时完整。' : '检测到映射异常，建议执行自检修复。',
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
        updateCountdown,
        addPlan,
        quickAddPlan,
        startTimer,
        pauseTimer,
        deletePlan,
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
