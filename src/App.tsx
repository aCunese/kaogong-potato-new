import React, { useState, useEffect, useRef } from 'react';
import { getTimerReminder } from './utils/studyTimers';
import { useApp } from './context/AppContext';
import { TodayView } from './components/views/TodayView';
import { LearningView } from './components/views/LearningView';
import { WrongView } from './components/views/WrongView';
import { AnalysisView } from './components/views/AnalysisView';
import { SettingsView } from './components/views/SettingsView';
import { FocusModal } from './components/views/FocusModal';
import { CompletionModal } from './components/views/CompletionModal';
import { MonthPickerModal } from './components/views/MonthPickerModal';
import { SyncModal } from './components/views/SyncModal';
import { ConflictModal } from './components/views/ConflictModal';
import { BackupModal } from './components/views/BackupModal';
import { ProfileEditModal } from './components/views/ProfileEditModal';
import { AuthView } from './components/views/AuthView';
import { EmptyLibraryChoiceModal, GuestMigrationModal } from './components/views/MigrationModals';
import {
  AddPlanModal,
  BookEditModal,
  CourseEditModal,
  CustomAddModal,
  CountdownModal,
  PhotoImportModal,
  WrongDetailModal,
  AuthModal,
  DownloadApkModal,
  OverallLegendModal,
} from './components/views/EditModals';
import { StatesPreviewView } from './components/views/StatesPreviewView';
import { ConfirmModalsView } from './components/views/ConfirmModalsView';
import { ScreenInspectorModal, ALL_50_SCREENS, ScreenSize } from './components/views/ScreenInspectorModal';
import { ConfirmModal, closeTopModal } from './components/common/UIComponents';
import { getLocalMonthString } from './constants/initialData';
import {
  Calendar,
  BookOpen,
  Camera,
  BarChart3,
  User,
  Smartphone,
  Layers,
  Sparkles,
  CheckCircle2,
  Info,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { MainTab, Plan, Book, Course, WrongRecord, StudyRecord, LearningSubTab, AnalysisSubTab, MutationResult } from './types';

declare global {
  interface Window {
    handleBack?: () => boolean;
  }
}

export const App: React.FC<{ preview?: boolean }> = ({ preview = false }) => {
  const {
    state,
    activeDate,
    corruptedRaw,
    clearCorruptedRaw,
    resetState,
    isLoading,
    authPhase,
    authError,
    retryAuthLoad,
    sessionExpired,
    needsInitChoice,
    guestMigration,
    dismissGuestMigration,
    pendingSyncCount,
    deletePlan,
    deleteBook,
    deleteCourse,
    deleteCustomItem,
    deleteWrongRecord,
    currentUser,
    logout,
    triggerSync,
    forceUpload,
    forcePull,
    conflictData,
    resolveConflict,
    localRevision,
    exportBackup,
    updateInfo,
    dismissUpdate,
    applyUpdate,
    registerUpdateBlocker,
    isAnyTimerRunning,
    offlineReady,
  } = useApp();

  // Navigation state
  const [activeTab, setActiveTab] = useState<MainTab>('today');
  const [learningSubTab, setLearningSubTab] = useState<LearningSubTab>('books');
  const [analysisSubTab, setAnalysisSubTab] = useState<AnalysisSubTab>('overall');
  const [todayForcedMode, setTodayForcedMode] = useState<'normal' | 'empty' | 'multi'>('normal');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getLocalMonthString());
  const [forcedGuestMode, setForcedGuestMode] = useState<boolean>(false);

  // Sub-views
  const [showStatesPreview, setShowStatesPreview] = useState<boolean>(false);
  const [statesPreviewTab, setStatesPreviewTab] = useState<'empty' | 'sync' | 'form'>('empty');
  const [showConfirmModalsView, setShowConfirmModalsView] = useState<boolean>(false);
  const [confirmModalTarget, setConfirmModalTarget] = useState<string | null>(null);
  const [confirmTriggerKey, setConfirmTriggerKey] = useState<number>(0);

  // Modals state
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [focusPlan, setFocusPlan] = useState<Plan | null>(null);
  const [focusVariantOverride, setFocusVariantOverride] = useState<'normal' | 'paused' | 'course' | 'custom'>('normal');
  const [completePlan, setCompletePlan] = useState<Plan | null>(null);
  const [completionInitialSuccess, setCompletionInitialSuccess] = useState<boolean>(false);

  const [bookModalState, setBookModalState] = useState<{ open: boolean; book?: Book }>({ open: false });
  const [courseModalState, setCourseModalState] = useState<{ open: boolean; course?: Course }>({ open: false });
  const [customAddOpen, setCustomAddOpen] = useState(false);
  const [countdownIndex, setCountdownIndex] = useState<number | null>(null);
  const [photoImportOpen, setPhotoImportOpen] = useState(false);
  const [photoImportTarget, setPhotoImportTarget] = useState<{ bookId: string; date: string } | undefined>(undefined);
  const [wrongDetailRecord, setWrongDetailRecord] = useState<WrongRecord | null>(null);
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'login' | 'register' }>({ open: false, mode: 'login' });
  const [downloadApkOpen, setDownloadApkOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendRecords, setLegendRecords] = useState<StudyRecord[] | undefined>();
  const [legendRangeLabel, setLegendRangeLabel] = useState<string | undefined>();

  // Dedicated Modals (Fixes A07, A11, A09)
  const [monthPickerOpen, setMonthPickerOpen] = useState<boolean>(false);
  const [syncModalOpen, setSyncModalOpen] = useState<boolean>(false);
  const [backupModalOpen, setBackupModalOpen] = useState<boolean>(false);
  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);

  // Conflict Deferral State (S09: conflict deferral & recoverable workflow)
  const [dismissedConflictKey, setDismissedConflictKey] = useState<string | null>(null);

  const currentUserId = currentUser?.id ?? '';
  const currentConflictKey = conflictData
    ? `${currentUserId}_${conflictData.serverGenerationId || ''}_${conflictData.serverRevision}_${conflictData.serverContentHash || ''}`
    : null;
  const isConflictDeferred = Boolean(
    conflictData && currentConflictKey && dismissedConflictKey === currentConflictKey
  );
  const isConflictModalOpen = Boolean(
    conflictData && currentConflictKey && dismissedConflictKey !== currentConflictKey
  );

  useEffect(() => {
    if (!conflictData) {
      setDismissedConflictKey(null);
    }
  }, [conflictData]);

  // Register update blockers for active modal/dialog editing states (Task 9 / S11)
  useEffect(() => {
    if (!addPlanOpen) return;
    return registerUpdateBlocker('add_plan_modal', '正在添加日程计划，已暂缓应用更新');
  }, [addPlanOpen, registerUpdateBlocker]);

  useEffect(() => {
    if (!completePlan) return;
    return registerUpdateBlocker('complete_plan_modal', '正在进行学习登记，已暂缓应用更新');
  }, [completePlan, registerUpdateBlocker]);

  useEffect(() => {
    if (!bookModalState.open) return;
    return registerUpdateBlocker('book_edit_modal', '正在编辑题本资料，已暂缓应用更新');
  }, [bookModalState.open, registerUpdateBlocker]);

  useEffect(() => {
    if (!courseModalState.open) return;
    return registerUpdateBlocker('course_edit_modal', '正在编辑课程资料，已暂缓应用更新');
  }, [courseModalState.open, registerUpdateBlocker]);

  useEffect(() => {
    if (!customAddOpen) return;
    return registerUpdateBlocker('custom_add_modal', '正在编辑自定义事项，已暂缓应用更新');
  }, [customAddOpen, registerUpdateBlocker]);

  useEffect(() => {
    if (!focusPlan) return;
    return registerUpdateBlocker('focus_modal', '专注计时器运行中，已暂缓应用更新');
  }, [focusPlan, registerUpdateBlocker]);

  useEffect(() => {
    if (!photoImportOpen) return;
    return registerUpdateBlocker('photo_import_modal', '正在导入错题照片，已暂缓应用更新');
  }, [photoImportOpen, registerUpdateBlocker]);

  useEffect(() => {
    if (!backupModalOpen) return;
    return registerUpdateBlocker('backup_modal', '正在进行数据备份与恢复，已暂缓应用更新');
  }, [backupModalOpen, registerUpdateBlocker]);

  useEffect(() => {
    if (!profileModalOpen) return;
    return registerUpdateBlocker('profile_edit_modal', '正在编辑个人资料，已暂缓应用更新');
  }, [profileModalOpen, registerUpdateBlocker]);

  // Generic Confirm Modal
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    message: string;
    impactText?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // 50-Screen Inspector Modal
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [timerNotice, setTimerNotice] = useState<{ id: string; key: string; message: string } | null>(null);
  const remindedTimers = useRef(new Set<string>());
  useEffect(() => { remindedTimers.current.clear(); setTimerNotice(null); }, [currentUser?.id]);
  useEffect(() => {
    if (preview || !currentUser) return;
    const check = () => {
      setTimerNotice(prev => {
        if (!prev) return null;
        const live = state.plans.find(p => p.id === prev.id);
        return live && getTimerReminder(live)?.key === prev.key ? prev : null;
      });
      for (const plan of state.plans) {
        const notice = getTimerReminder(plan);
        if (!notice || remindedTimers.current.has(notice.key)) continue;
        remindedTimers.current.add(notice.key);
        setTimerNotice({ id: plan.id, key: notice.key, message: notice.message });
      }
    };
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [currentUser?.id, preview, state.plans]);

  // Responsive device frame width (defaults to native full mobile viewport)
  const [screenSize, setScreenSize] = useState<ScreenSize>('full');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev));
    }, 2400);
  };

  const confirmMutation = async (action: () => Promise<MutationResult<unknown>>, successMessage: string) => {
    const result = await action();
    if (!result.ok) throw new Error(result.message);
    showToast(successMessage);
    setConfirmConfig(prev => ({ ...prev, open: false }));
  };

  // Jump to any of the 50 screens (Fixes A07: all 19 misrouted screens properly resolved)
  const handleJumpToScreen = (screenId: string) => {
    if (!preview) return;
    // Reset special states
    setShowStatesPreview(false);
    setShowConfirmModalsView(false);
    setConfirmModalTarget(null);
    setTodayForcedMode('normal');
    setForcedGuestMode(false);
    setCompletionInitialSuccess(false);

    switch (screenId) {
      case 'today':
        setActiveTab('today');
        break;
      case 'today-empty':
        setActiveTab('today');
        setTodayForcedMode('empty');
        break;
      case 'today-multi':
        setActiveTab('today');
        setTodayForcedMode('multi');
        break;
      case 'library':
        setActiveTab('learning');
        setLearningSubTab('library');
        break;
      case 'books':
        setActiveTab('learning');
        setLearningSubTab('books');
        break;
      case 'courses':
        setActiveTab('learning');
        setLearningSubTab('courses');
        break;
      case 'wrong':
        setActiveTab('wrong');
        break;
      case 'overall':
        setActiveTab('analysis');
        setAnalysisSubTab('overall');
        break;
      case 'monthly':
        setActiveTab('analysis');
        setAnalysisSubTab('monthly');
        break;
      case 'settings':
        setActiveTab('settings');
        break;
      case 'guest':
        // Isolated guest preview (Fixes A07: guest)
        setActiveTab('settings');
        setForcedGuestMode(true);
        break;
      case 'sync':
        // Sync management modal (Fixes A07: sync)
        setSyncModalOpen(true);
        break;
      case 'backup':
        // Backup management modal (Fixes A07: backup)
        setBackupModalOpen(true);
        break;
      case 'profile':
        // Profile edit modal (Fixes A07: profile & A11: profile save)
        setProfileModalOpen(true);
        break;
      case 'focus':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'book' && !p.done) || null);
        setFocusVariantOverride('normal');
        break;
      case 'focus-paused':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'book' && !p.done) || null);
        setFocusVariantOverride('paused');
        break;
      case 'focus-course':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'course' && !p.done) || null);
        setFocusVariantOverride('course');
        break;
      case 'focus-custom':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'custom' && !p.done) || null);
        setFocusVariantOverride('custom');
        break;
      case 'add-plan':
        setAddPlanOpen(true);
        break;
      case 'complete-book':
        setCompletePlan(state.plans.find(p => p.type === 'book' && !p.done) || null);
        setCompletionInitialSuccess(false);
        break;
      case 'complete-course':
        setCompletePlan(state.plans.find(p => p.type === 'course' && !p.done) || null);
        setCompletionInitialSuccess(false);
        break;
      case 'complete-custom':
        setCompletePlan(state.plans.find(p => p.type === 'custom' && !p.done) || null);
        setCompletionInitialSuccess(false);
        break;
      case 'complete-success':
        // Fixes A07: Opens book completion success summary directly
        setCompletePlan(state.plans.find(p => p.type === 'book') || state.plans[0]);
        setCompletionInitialSuccess(true);
        break;
      case 'complete-course-success':
        // Fixes A07: Opens course completion success summary directly
        setCompletePlan(state.plans.find(p => p.type === 'course') || state.plans[0]);
        setCompletionInitialSuccess(true);
        break;
      case 'complete-custom-success':
        // Fixes A07: Opens custom item completion success summary directly
        setCompletePlan(state.plans.find(p => p.type === 'custom') || state.plans[0]);
        setCompletionInitialSuccess(true);
        break;
      case 'book-edit':
        setBookModalState({ open: true, book: state.books[0] });
        break;
      case 'book-add':
        setBookModalState({ open: true, book: undefined });
        break;
      case 'course-edit':
        setCourseModalState({ open: true, course: state.courses[0] });
        break;
      case 'course-add':
        setCourseModalState({ open: true, course: undefined });
        break;
      case 'custom-add':
        setCustomAddOpen(true);
        break;
      case 'photo-import':
        setPhotoImportTarget(undefined);
        setPhotoImportOpen(true);
        break;
      case 'wrong-detail':
        setWrongDetailRecord(state.wrong[0] || null);
        break;
      case 'countdown':
        setCountdownIndex(0);
        break;
      case 'login':
        setAuthModal({ open: true, mode: 'login' });
        break;
      case 'register':
        setAuthModal({ open: true, mode: 'register' });
        break;
      case 'download-apk':
        setDownloadApkOpen(true);
        break;
      case 'overall-legend':
        setLegendRecords(undefined);
        setLegendRangeLabel(undefined);
        setLegendOpen(true);
        break;
      case 'month-picker':
        // Fixes A07: Opens real month picker dialog on monthly analysis
        setActiveTab('analysis');
        setAnalysisSubTab('monthly');
        setMonthPickerOpen(true);
        break;
      case 'states-empty':
        setShowStatesPreview(true);
        setStatesPreviewTab('empty');
        break;
      case 'states-sync':
        // Fixes A07: Direct to sync states tab
        setShowStatesPreview(true);
        setStatesPreviewTab('sync');
        break;
      case 'states-form':
        // Fixes A07: Direct to form states tab
        setShowStatesPreview(true);
        setStatesPreviewTab('form');
        break;
      case 'delete-confirm': {
        // Fixes A07: Schedule removal confirm dialog on today view
        setActiveTab('today');
        const targetPlan = state.plans[0] || null;
        if (targetPlan) {
          setConfirmConfig({
            open: true,
            title: '移除这项日程？',
            message: `将「${targetPlan.name}」从今日计划中移除。`,
            impactText: '将撤销本次学习登记，并扣回对应的用时、题量、错题数或网课节数。错题照片保留。',
            danger: true,
            onConfirm: () => confirmMutation(() => deletePlan(targetPlan.id), '已从今日日程中移除'),
          });
        }
        break;
      }
      case 'confirm-book':
      case 'confirm-course':
      case 'confirm-photo':
      case 'confirm-reset':
      case 'confirm-import':
      case 'confirm-upload':
      case 'confirm-pull':
      case 'confirm-logout':
        // Fixes A07: Directly activate the specific target modal in confirm collection
        setShowConfirmModalsView(true);
        setConfirmModalTarget(screenId);
        setConfirmTriggerKey(k => k + 1);
        break;
      default:
        setActiveTab('today');
        break;
    }
    showToast(`已切换至: ${ALL_50_SCREENS.find(s => s.id === screenId)?.name || screenId}`);
  };

  // Dimensions helper: cleans up A06 viewport overflows
  const getContainerClasses = () => {
    switch (screenSize) {
      case '360':
        return 'w-full max-w-[360px] h-[800px] flex flex-col mx-auto overflow-hidden bg-bg relative rounded-[32px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case '393':
        return 'w-full max-w-[393px] h-[873px] flex flex-col mx-auto overflow-hidden bg-bg relative rounded-[36px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case '412':
        return 'w-full max-w-[412px] h-[915px] flex flex-col mx-auto overflow-hidden bg-bg relative rounded-[36px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case 'full':
      default:
        // Native full mobile viewport without artificial outer desktop margins
        return 'w-full max-w-md h-[100dvh] flex flex-col mx-auto overflow-hidden bg-bg relative rounded-none border-0 shadow-none';
    }
  };

  // Android / Browser Back Button Contract
  useEffect(() => {
    window.handleBack = (): boolean => {
      if (closeTopModal()) return true;
      // 1. If any modal is open, close the topmost modal and return true
      if (confirmConfig.open) {
        setConfirmConfig(prev => ({ ...prev, open: false }));
        return true;
      }
      if (inspectorOpen) {
        setInspectorOpen(false);
        return true;
      }
      if (addPlanOpen) {
        setAddPlanOpen(false);
        return true;
      }
      if (focusPlan) {
        setFocusPlan(null);
        return true;
      }
      if (completePlan) {
        setCompletePlan(null);
        return true;
      }
      if (bookModalState.open) {
        setBookModalState({ open: false });
        return true;
      }
      if (courseModalState.open) {
        setCourseModalState({ open: false });
        return true;
      }
      if (customAddOpen) {
        setCustomAddOpen(false);
        return true;
      }
      if (countdownIndex !== null) {
        setCountdownIndex(null);
        return true;
      }
      if (photoImportOpen) {
        setPhotoImportOpen(false);
        return true;
      }
      if (wrongDetailRecord) {
        setWrongDetailRecord(null);
        return true;
      }
      if (authModal.open) {
        setAuthModal({ open: false, mode: 'login' });
        return true;
      }
      if (downloadApkOpen) {
        setDownloadApkOpen(false);
        return true;
      }
      if (legendOpen) {
        setLegendOpen(false);
        return true;
      }
      if (monthPickerOpen) {
        setMonthPickerOpen(false);
        return true;
      }
      if (syncModalOpen) {
        setSyncModalOpen(false);
        return true;
      }
      if (backupModalOpen) {
        setBackupModalOpen(false);
        return true;
      }
      if (profileModalOpen) {
        setProfileModalOpen(false);
        return true;
      }
      if (isConflictModalOpen) {
        if (currentConflictKey) {
          setDismissedConflictKey(currentConflictKey);
        }
        return true;
      }

      // 2. If showStatesPreview or showConfirmModalsView is open, close it and return true
      if (showStatesPreview) {
        setShowStatesPreview(false);
        return true;
      }
      if (showConfirmModalsView) {
        setShowConfirmModalsView(false);
        return true;
      }

      // 3. If activeTab !== 'today', set activeTab('today') and return true
      if (activeTab !== 'today') {
        setActiveTab('today');
        return true;
      }

      // 4. Return false otherwise
      return false;
    };

    return () => {
      delete window.handleBack;
    };
  }, [
    confirmConfig.open,
    inspectorOpen,
    addPlanOpen,
    focusPlan,
    completePlan,
    bookModalState.open,
    courseModalState.open,
    customAddOpen,
    countdownIndex,
    photoImportOpen,
    wrongDetailRecord,
    authModal.open,
    downloadApkOpen,
    legendOpen,
    monthPickerOpen,
    syncModalOpen,
    backupModalOpen,
    profileModalOpen,
    isConflictModalOpen,
    currentConflictKey,
    showStatesPreview,
    showConfirmModalsView,
    activeTab,
  ]);

  if (!preview && authPhase === 'error') {
    return (
      <div className="w-full min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-center p-6 selection:bg-sage-light">
        <div className="w-full max-w-sm bg-paper border border-line rounded-3xl p-6 text-center shadow-soft">
          <div className="w-16 h-16 rounded-2xl bg-alarm/10 border border-alarm/20 flex items-center justify-center mx-auto mb-3">
            <AlertCircle size={28} className="text-alarm" />
          </div>
          <h1 className="text-base font-bold text-ink-main">云端工作区加载失败</h1>
          <p className="text-xs text-ink-muted mt-2 leading-relaxed">
            {authError || '暂时无法加载你的学习资料库。为避免覆盖服务器数据，已暂停进入编辑界面。'}
          </p>
          <button
            onClick={() => { retryAuthLoad().catch(() => {}); }}
            className="mt-4 w-full py-2.5 bg-sage text-white font-bold rounded-xl text-sm hover:bg-sage-dark transition-colors"
          >
            重新加载云端工作区
          </button>
          <button
            onClick={() => { logout().catch(() => {}); }}
            className="mt-2 w-full py-2 text-xs text-ink-muted"
          >
            退出当前账号
          </button>
        </div>
      </div>
    );
  }

  if (!preview && (isLoading || authPhase === 'checking')) {
    return (
      <div className="w-full min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-center p-4 selection:bg-sage-light">
        <div className="flex flex-col items-center text-center animate-pulse">
          <div className="w-20 h-20 rounded-2xl bg-cream border-2 border-line/80 flex items-center justify-center p-2 shadow-soft mb-3">
            <img
              src="/branding/logo-transparent.png"
              alt="考公工作台"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-base font-bold text-ink-main">考公工作台</h1>
          <p className="text-xs text-ink-muted mt-1">
            {pendingSyncCount > 0 ? '正在载入学员空间并同步待处理学情…' : '正在载入学员空间并同步学情…'}
          </p>
        </div>
      </div>
    );
  }

  if (!preview && (authPhase === 'unauthenticated' || !currentUser)) {
    return (
      <AuthView
        initialMode="login"
        sessionNotice={sessionExpired ? '登录状态已失效，请重新登录。未同步的学情与照片仍安全保留在本机。' : null}
        onToast={showToast}
        onLoginSuccess={() => setActiveTab('today')}
      />
    );
  }

  return (
    <div className={`w-full min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-center p-0 ${screenSize === 'full' ? '' : 'lg:py-6'} text-ink-main selection:bg-sage-light overflow-x-hidden`}>
      {/* 桌面端外围工具条（当 screenSize !== 'full' 时在桌面端呈现） */}
      {preview && screenSize !== 'full' && (
        <header className="w-full max-w-2xl px-4 py-2 hidden lg:flex items-center justify-between text-xs text-ink-muted mb-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-ink-main flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-potato inline-block" />
              考公工作台 · 土豆陪伴新版
            </span>
            <span className="text-[11px] text-sage font-medium bg-sage-light px-2 py-0.5 rounded-md">
              独立演示预览
            </span>
          </div>

          {/* 屏幕尺寸切换器 */}
          <div className="flex items-center gap-3">
            <div className="flex bg-paper border border-line rounded-lg p-0.5 shadow-sm">
              <button
                onClick={() => setScreenSize('412')}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  screenSize === '412' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main text-ink-muted'
                }`}
                title="主设计尺寸 412×915 (Google Pixel)"
              >
                412px
              </button>
              <button
                onClick={() => setScreenSize('393')}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  screenSize === '393' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main text-ink-muted'
                }`}
                title="校核尺寸 393×873 (iPhone)"
              >
                393px
              </button>
              <button
                onClick={() => setScreenSize('360')}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  screenSize === '360' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main text-ink-muted'
                }`}
                title="紧凑尺寸 360×800 (Compact Android)"
              >
                360px
              </button>
              <button
                onClick={() => setScreenSize('full')}
                className="px-2 py-1 rounded text-xs transition-colors hover:text-ink-main text-ink-muted"
              >
                100%
              </button>
            </div>

            {/* 50 屏直达检查器 */}
            <button
              onClick={() => setInspectorOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-paper border border-sage/50 text-sage hover:bg-sage-light font-bold rounded-lg shadow-sm transition-all"
            >
              <Layers size={14} />
              <span>50 屏画板矩阵</span>
            </button>
          </div>
        </header>
      )}

      {/* 手机界面容器 (主视口画布，严格修复横向溢出与首屏导航可见性，Fixes A06) */}
      <main
        className={`${getContainerClasses()} transition-all duration-300`}
      >
        {/* 新版本发布热更新通知横条（绝不打断正在计时的任务） */}
        {updateInfo && (
          <div className="flex-none bg-potato/20 border-b border-potato/30 px-3.5 py-2 flex items-center justify-between z-40 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-potato shrink-0 animate-pulse" />
              <span className="font-bold text-ink-main shrink-0">发现新版本 {updateInfo.version}</span>
              <span className="text-[11px] text-ink-muted truncate hidden sm:inline">({updateInfo.summary})</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  if (isAnyTimerRunning()) {
                    showToast('当前有正在运行的计时器，请先暂停计时再更新');
                    return;
                  }
                  applyUpdate().then(ok => {
                    if (ok) {
                      showToast('新版本已激活，正在刷新页面…');
                      setTimeout(() => window.location.reload(), 400);
                    } else {
                      showToast('更新暂未完成，请检查计时器或版本冲突后重试');
                    }
                  }).catch(() => showToast('更新暂未完成，请稍后重试'));
                }}
                className="px-2.5 py-1 bg-potato text-ink-main font-bold rounded-lg text-xs hover:bg-potato-dark hover:text-white transition-all shadow-sm"
              >
                立即更新
              </button>
              <button
                onClick={dismissUpdate}
                className="p-1 text-ink-muted hover:text-ink-main text-xs"
                title="稍后更新"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 冲突待处理常驻通知横条 (S09: 暂缓后在顶部常驻提醒并提供处理入口) */}
        {isConflictDeferred && (
          <div className="flex-none bg-amber-500/15 border-b border-amber-500/30 px-3.5 py-2 flex items-center justify-between z-40 text-xs text-ink-main">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              <span className="font-bold text-ink-main truncate">数据版本冲突待处理</span>
              <span className="text-[11px] text-ink-muted hidden sm:inline">（已暂缓，可在设置中随时重新处理）</span>
            </div>
            <button
              onClick={() => setDismissedConflictKey(null)}
              className="px-2.5 py-1 bg-amber-600 text-white font-bold rounded-lg text-xs hover:bg-amber-700 transition-all shadow-sm shrink-0"
            >
              立即处理
            </button>
          </div>
        )}

        {/* 顶部移动端小工具条（屏幕宽度较小时提供轻量直达入口） */}
        {preview && <div className="flex-none flex items-center justify-between px-3.5 py-1.5 bg-paper/90 border-b border-line text-xs shrink-0 z-30">
          <span className="font-bold text-ink-main flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-potato inline-block" />
            土豆考公工作台
          </span>
          <button
            onClick={() => setInspectorOpen(true)}
            className="flex items-center gap-1 px-2 py-0.5 bg-sage-light text-sage font-medium rounded-md text-[11px]"
          >
            <Layers size={11} />
            <span>50屏矩阵</span>
          </button>
        </div>}

        {/* 视图主体内容区：独立平滑内部滚动，底部留出足够 padding 防止导航遮挡 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 pt-3 pb-4">
          {corruptedRaw && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs text-amber-900 shadow-sm animate-fade-in">
              <AlertCircle size={16} className="shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-bold">检测到受损的历史缓存数据</div>
                <div className="mt-0.5 leading-relaxed text-[11px] text-amber-800">
                  已将原始异常数据安全归档至受损缓存库，当前使用空白安全状态，未覆盖初始数据。您可以前往“设置”导入标准备份或重置。
                </div>
              </div>
              <button
                onClick={clearCorruptedRaw}
                className="text-[11px] font-medium text-amber-700 underline shrink-0 hover:text-amber-900"
              >
                我知道了
              </button>
            </div>
          )}
          {isLoading ? (
            <div role="status" className="py-16 text-center text-sm text-ink-muted">正在载入本地工作台…</div>
          ) : showStatesPreview ? (
            <StatesPreviewView
              initialTab={statesPreviewTab}
              onBack={() => setShowStatesPreview(false)}
            />
          ) : showConfirmModalsView ? (
            <ConfirmModalsView
              initialActiveModal={confirmModalTarget}
              triggerKey={confirmTriggerKey}
              onCloseActiveModal={() => setConfirmModalTarget(null)}
              onBack={() => setShowConfirmModalsView(false)}
            />
          ) : activeTab === 'today' ? (
            <TodayView
              forcedMode={todayForcedMode}
              onOpenAddPlan={() => setAddPlanOpen(true)}
              onOpenFocus={plan => {
                setFocusPlan(plan);
                setFocusVariantOverride('normal');
              }}
              onOpenComplete={plan => {
                setCompletePlan(plan);
                setCompletionInitialSuccess(false);
              }}
              onOpenCountdownEdit={idx => setCountdownIndex(idx)}
              onOpenDeleteConfirm={plan => {
                setConfirmConfig({
                  open: true,
                  title: '移除这项日程？',
                  message: `确定从今日计划中移除「${plan.name}」吗？`,
                  impactText: '将撤销本次学习登记，并扣回对应的用时、题量、错题数或网课节数。错题照片保留。',
                  danger: true,
                  onConfirm: () => confirmMutation(() => deletePlan(plan.id), '已从今日日程中移除'),
                });
              }}
            />
          ) : activeTab === 'learning' ? (
            <LearningView
              initialSubTab={learningSubTab}
              onOpenBookEdit={book => setBookModalState({ open: true, book })}
              onOpenCourseEdit={course => setCourseModalState({ open: true, course })}
              onOpenCustomAdd={() => setCustomAddOpen(true)}
              onOpenDeleteConfirm={(type, id, name) => {
                setConfirmConfig({
                  open: true,
                  title: `删除${type === 'book' ? '题本' : type === 'course' ? '网课' : '自定义事项'}确认`,
                  message: `确定删除“${name}”吗？`,
                  impactText:
                    type === 'book'
                      ? '移除该题本及其在事项库中的对应条目，但已经产生的历史做题记录仍会完整保留。'
                      : type === 'course'
                      ? '移除该网课及其事项库对应条目，历史听课记录仍会保留。'
                      : '将从自定义事项库中移除该项。',
                  danger: true,
                  onConfirm: () => confirmMutation(
                    () => type === 'book' ? deleteBook(id) : type === 'course' ? deleteCourse(id) : deleteCustomItem(id),
                    '已安全删除并同步更新事项库'
                  ),
                });
              }}
              onToast={showToast}
            />
          ) : activeTab === 'wrong' ? (
            <WrongView
              onOpenImportModal={() => {
                setPhotoImportTarget(undefined);
                setPhotoImportOpen(true);
              }}
              onOpenDetailModal={rec => setWrongDetailRecord(rec)}
              onOpenDeleteConfirm={(recId, bookName) => {
                setConfirmConfig({
                  open: true,
                  title: '删除错题照片确认',
                  message: `确定从“${bookName}”中删除该错题照片吗？`,
                  impactText: '注意：删除照片仅移除图片记录与笔记，不会擅自减少题本中累计统计的错题总数。',
                  danger: true,
                  onConfirm: () => confirmMutation(() => deleteWrongRecord(recId), '已删除错题照片记录'),
                });
              }}
            />
          ) : activeTab === 'analysis' ? (
            <AnalysisView
              initialSubTab={analysisSubTab}
              selectedMonth={selectedMonth}
              onOpenMonthPicker={() => setMonthPickerOpen(true)}
              onOpenLegendDetail={(records, rangeLabel) => {
                setLegendRecords(records);
                setLegendRangeLabel(rangeLabel);
                setLegendOpen(true);
              }}
            />
          ) : (
            <SettingsView
              onOpenConflict={() => setDismissedConflictKey(null)}
              onOpenProfile={() => setProfileModalOpen(true)}
              onOpenBackup={() => setBackupModalOpen(true)}
              onOpenResetConfirm={() => {
                setConfirmConfig({
                  open: true,
                  title: '恢复初始数据危险确认',
                  message: '确定清空当前工作台并恢复空白状态吗？',
                  impactText: '题本、网课、日程、学习记录与错题将被清空，系统将自动先持久化紧急恢复快照。',
                  danger: true,
                  onConfirm: () => confirmMutation(resetState, '已清空工作台数据'),
                });
              }}
              onOpenLogoutConfirm={() => {
                setConfirmConfig({
                  open: true,
                  title: '退出账号登录确认',
                  message: '确定退出当前账号登录吗？',
                  impactText: '退出后未同步至云端的数据仍将安全保留在当前设备，重新登录后可继续使用。',
                  danger: true,
                  onConfirm: () => {
                    logout().then(() => {
                      showToast('已安全退出登录');
                      setConfirmConfig(prev => ({ ...prev, open: false }));
                    });
                  },
                });
              }}
              onToast={showToast}
            />
          )}
        </div>

        {/* 底部固定 5 大入口导航栏：flex-none sticky bottom-0 z-30 */}
        <nav aria-label="主导航" className="flex-none sticky bottom-0 z-30 bg-paper/95 backdrop-blur-md border-t border-line px-2 py-2 flex items-center justify-around shadow-sheet pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {[
            { id: 'today', label: '今日', icon: Calendar },
            { id: 'learning', label: '学习', icon: BookOpen },
            { id: 'wrong', label: '错题', icon: Camera },
            { id: 'analysis', label: '分析', icon: BarChart3 },
            { id: 'settings', label: '我的', icon: User },
          ].map(tab => {
            const active = activeTab === tab.id && !showStatesPreview && !showConfirmModalsView;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                disabled={isLoading}
                onClick={() => {
                  setShowStatesPreview(false);
                  setShowConfirmModalsView(false);
                  setTodayForcedMode('normal');
                  setForcedGuestMode(false);
                  setActiveTab(tab.id as MainTab);
                }}
                className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
                  active ? 'text-sage font-bold scale-105' : 'text-ink-muted hover:text-ink-main'
                }`}
              >
                <Icon size={20} className={active ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
                <span className="text-[11px] mt-1">{tab.label}</span>
                {tab.id === 'settings' && isConflictDeferred && (
                  <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>

        {timerNotice && !focusPlan && <div role="status" aria-live="polite" className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm z-40 bg-paper border border-sage rounded-xl p-3 shadow-lg text-xs">
          <p>{timerNotice.message}</p><div className="flex justify-end gap-4 mt-2"><button aria-label="关闭到点提醒" onClick={() => setTimerNotice(null)}>关闭</button><button className="text-sage font-bold" onClick={() => { const plan = state.plans.find(p => p.id === timerNotice.id); if (plan) { setFocusVariantOverride('normal'); setFocusPlan(plan); } setTimerNotice(null); }}>查看计时</button></div>
        </div>}

        {/* 轻量 Toast 提示条 */}
        {toastMsg && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#343C2F] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-bounce-short pointer-events-none">
            <CheckCircle2 size={14} className="text-potato" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* 各类功能弹窗挂载 */}
        <AddPlanModal
          onOpenCustomAdd={() => setCustomAddOpen(true)}
          isOpen={addPlanOpen}
          onClose={() => setAddPlanOpen(false)}
          onToast={showToast}
        />

        <FocusModal
          plan={focusPlan}
          isOpen={Boolean(focusPlan)}
          variantOverride={focusVariantOverride}
          onClose={() => setFocusPlan(null)}
          onComplete={plan => {
            setFocusPlan(null);
            setCompletePlan(plan);
            setCompletionInitialSuccess(false);
          }}
        />

        <CompletionModal
          plan={completePlan}
          isOpen={Boolean(completePlan)}
          initialSuccess={completionInitialSuccess}
          onClose={() => {
            setCompletePlan(null);
            setCompletionInitialSuccess(false);
          }}
          onOpenPhotoImport={(target) => {
            setCompletePlan(null);
            setCompletionInitialSuccess(false);
            setPhotoImportTarget(target);
            setPhotoImportOpen(true);
          }}
          onToast={showToast}
        />

        <BookEditModal
          isOpen={bookModalState.open}
          book={bookModalState.book}
          onClose={() => setBookModalState({ open: false })}
          onToast={showToast}
        />

        <CourseEditModal
          isOpen={courseModalState.open}
          course={courseModalState.course}
          onClose={() => setCourseModalState({ open: false })}
          onToast={showToast}
        />

        <CustomAddModal
          isOpen={customAddOpen}
          onClose={() => setCustomAddOpen(false)}
          onToast={showToast}
        />

        {countdownIndex !== null && (
          <CountdownModal
            isOpen={true}
            cdIndex={countdownIndex}
            onClose={() => setCountdownIndex(null)}
            onToast={showToast}
          />
        )}

        <PhotoImportModal
          isOpen={photoImportOpen}
          initialTarget={photoImportTarget}
          onClose={() => {
            setPhotoImportOpen(false);
            setPhotoImportTarget(undefined);
          }}
          onToast={showToast}
        />

        <WrongDetailModal
          record={wrongDetailRecord}
          isOpen={Boolean(wrongDetailRecord)}
          onClose={() => setWrongDetailRecord(null)}
        />

        <AuthModal
          isOpen={authModal.open}
          mode={authModal.mode}
          onClose={() => setAuthModal({ open: false, mode: 'login' })}
          onToast={showToast}
        />

        <DownloadApkModal
          isOpen={downloadApkOpen}
          onClose={() => setDownloadApkOpen(false)}
        />

        <OverallLegendModal
          isOpen={legendOpen}
          records={legendRecords}
          rangeLabel={legendRangeLabel}
          onClose={() => setLegendOpen(false)}
        />

        {/* 新增月度选择、云端同步、备份管理与资料编辑弹窗 (Fixes A07, A09, A11) */}
        <MonthPickerModal
          isOpen={monthPickerOpen}
          selectedMonth={selectedMonth}
          onSelectMonth={m => {
            setSelectedMonth(m);
            showToast(`已切换至 ${m} 月度分析报表`);
          }}
          onClose={() => setMonthPickerOpen(false)}
        />

        <SyncModal
          isOpen={syncModalOpen}
          onClose={() => setSyncModalOpen(false)}
          onOpenUploadConfirm={() => {
            setConfirmConfig({
              open: true,
              title: '以本机记录为准？',
              message: '确定将当前手机所有学习记录上传覆盖云端存档吗？',
              impactText: '上传后云端旧数据将被本机记录完全覆盖。',
              danger: false,
              onConfirm: () => {
                if (currentUser) {
                  forceUpload().then(r => {
                    showToast(r.ok ? '云端已更新至本机状态' : r.message || '上传同步失败');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  });
                } else {
                  showToast('当前未登录云端账号，数据已保存在本机');
                  setConfirmConfig(prev => ({ ...prev, open: false }));
                }
              },
            });
          }}
          onOpenPullConfirm={() => {
            setConfirmConfig({
              open: true,
              title: '用云端记录替换本机？',
              message: '确定从云端拉取存档并替换本机当前数据吗？',
              impactText: '拉取后本机未同步的改动将被云端记录覆盖。',
              danger: true,
              onConfirm: () => {
                if (currentUser) {
                  forcePull().then(r => {
                    showToast(r.ok ? '已从云端拉取最新数据覆盖本机' : r.message || '拉取失败');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  });
                } else {
                  showToast('当前未登录云端账号，无法拉取');
                  setConfirmConfig(prev => ({ ...prev, open: false }));
                }
              },
            });
          }}
          onToast={showToast}
        />

        <ConflictModal
          isOpen={isConflictModalOpen}
          onClose={() => {
            if (currentConflictKey) {
              setDismissedConflictKey(currentConflictKey);
            }
          }}
          localState={state}
          localRevision={localRevision}
          serverState={conflictData?.serverState ?? null}
          serverRevision={conflictData?.serverRevision ?? 0}
          onKeepLocal={async () => {
            const r = await resolveConflict('keep_local');
            if (r.ok) {
              showToast('已保留本机记录并更新云端');
              setDismissedConflictKey(null);
            }
            return r;
          }}
          onKeepRemote={async () => {
            const r = await resolveConflict('keep_remote');
            if (r.ok) {
              showToast('已采用云端最新数据覆盖本机');
              setDismissedConflictKey(null);
            }
            return r;
          }}
        />

        <EmptyLibraryChoiceModal
          isOpen={!preview && needsInitChoice}
          onClose={() => {}}
          onToast={showToast}
        />

        <GuestMigrationModal
          isOpen={!preview && Boolean(guestMigration?.available)}
          onClose={dismissGuestMigration}
          onToast={showToast}
        />

        <BackupModal
          isOpen={backupModalOpen}
          onClose={() => setBackupModalOpen(false)}
          onOpenResetConfirm={() => {
            setConfirmConfig({
              open: true,
              title: '恢复初始数据危险确认',
              message: '确定清空当前工作台并恢复空白状态吗？',
              impactText: '学习记录、错题照片与进度将被清空（保留题本/网课资料）。执行前会自动保存恢复点，可在“账号与数据设置”中还原。',
              danger: true,
              onConfirm: () => confirmMutation(resetState, '已清空工作台数据'),
            });
          }}
          onToast={showToast}
        />

        <ProfileEditModal
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          onToast={showToast}
        />

        <ConfirmModal
          isOpen={confirmConfig.open}
          title={confirmConfig.title}
          message={confirmConfig.message}
          impactText={confirmConfig.impactText}
          danger={confirmConfig.danger}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirmConfig(prev => ({ ...prev, open: false }))}
        />

        <ScreenInspectorModal
          isOpen={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          onJumpToScreen={handleJumpToScreen}
          screenSize={screenSize}
          onSelectScreenSize={setScreenSize}
        />
      </main>
    </div>
  );
};
