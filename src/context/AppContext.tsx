import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AppState, Book, Course, LibraryItem, Plan, StudyRecord, WrongRecord, Subject } from '../types';
import { INITIAL_STATE, buildLibraryFromSources } from '../constants/initialData';

const STORAGE_KEY = 'potato_study_v2';

interface AppContextType {
  state: AppState;
  activeDate: string;
  setActiveDate: (d: string) => void;
  // Countdowns
  updateCountdown: (id: string, date: string) => void;
  // Plans & Timers
  addPlan: (libraryId: string, plannedMinutes: number) => void;
  quickAddPlan: (libraryId: string) => void;
  startTimer: (planId: string) => void;
  pauseTimer: (planId: string) => void;
  deletePlan: (planId: string) => void;
  completeBookPlan: (planId: string, questions: number, errors: number, actualMinutes: number) => void;
  completeCoursePlan: (planId: string, completedLessons: number, actualMinutes: number) => void;
  completeCustomPlan: (planId: string, actualMinutes: number) => void;
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
  addWrongRecords: (bookId: string, note: string, images: string[]) => void;
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
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.books) && Array.isArray(parsed.courses)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load local state, using demo data', e);
    }
    return INITIAL_STATE;
  });

  const [activeDate, setActiveDate] = useState<string>('2026-10-25');

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to persist state', e);
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

  const updateCountdown = useCallback((id: string, date: string) => {
    setState(prev => ({
      ...prev,
      countdowns: prev.countdowns.map(cd => cd.id === id ? { ...cd, date } : cd),
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
        done: false,
        timerStart: 0,
      };
      return {
        ...prev,
        plans: [...prev.plans, newPlan],
      };
    });
  }, [activeDate]);

  const startTimer = useCallback((planId: string) => {
    setState(prev => ({
      ...prev,
      plans: prev.plans.map(p => {
        if (p.id === planId && !p.done) {
          return { ...p, timerStart: Date.now() };
        }
        return p;
      }),
    }));
  }, []);

  const pauseTimer = useCallback((planId: string) => {
    setState(prev => ({
      ...prev,
      plans: prev.plans.map(p => {
        if (p.id === planId && p.timerStart > 0) {
          const elapsedMin = Math.max(1, Math.round((Date.now() - p.timerStart) / 60000));
          return {
            ...p,
            actualMinutes: (p.actualMinutes || 0) + elapsedMin,
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

  const completeBookPlan = useCallback((planId: string, questions: number, errors: number, actualMinutes: number) => {
    setState(prev => {
      const plan = prev.plans.find(p => p.id === planId);
      if (!plan || plan.done) return prev;

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

      return {
        ...prev,
        books: updatedBooks,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
  }, []);

  const completeCoursePlan = useCallback((planId: string, completedLessons: number, actualMinutes: number) => {
    setState(prev => {
      const plan = prev.plans.find(p => p.id === planId);
      if (!plan || plan.done) return prev;

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

      return {
        ...prev,
        courses: updatedCourses,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
  }, []);

  const completeCustomPlan = useCallback((planId: string, actualMinutes: number) => {
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

      return {
        ...prev,
        plans: updatedPlans,
        records: [...prev.records, newRecord],
      };
    });
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

  const addWrongRecords = useCallback((bookId: string, note: string, images: string[]) => {
    const date = activeDate;
    const newRecords: WrongRecord[] = images.map(img => ({
      id: `wrong-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      bookId,
      note,
      image: img,
    }));
    setState(prev => ({
      ...prev,
      wrong: [...newRecords, ...prev.wrong],
    }));
  }, [activeDate]);

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
      version: 2,
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

  const importBackup = useCallback((jsonContent: string) => {
    try {
      const data = JSON.parse(jsonContent);
      const targetState = data.state || data;
      if (!Array.isArray(targetState.books) || !Array.isArray(targetState.courses) || !Array.isArray(targetState.countdowns)) {
        return { success: false, error: '备份文件结构不完整，缺少必要的 books/courses 列表' };
      }
      setState(reconcileState(targetState));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'JSON 解析失败' };
    }
  }, [reconcileState]);

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
