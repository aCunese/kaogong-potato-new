import React, { useState } from 'react';
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
import { BackupModal } from './components/views/BackupModal';
import { ProfileEditModal } from './components/views/ProfileEditModal';
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
import { ScreenInspectorModal, ALL_50_SCREENS } from './components/views/ScreenInspectorModal';
import { ConfirmModal, Tag } from './components/common/UIComponents';
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
} from 'lucide-react';
import { MainTab, Plan, Book, Course, WrongRecord, LearningSubTab, AnalysisSubTab } from './types';

type ScreenSize = '412' | '393' | '360' | 'full';

export const App: React.FC = () => {
  const {
    state,
    resetState,
    exportBackup,
    deletePlan,
    deleteBook,
    deleteCourse,
    deleteCustomItem,
    deleteWrongRecord,
  } = useApp();

  // Navigation state
  const [activeTab, setActiveTab] = useState<MainTab>('today');
  const [learningSubTab, setLearningSubTab] = useState<LearningSubTab>('books');
  const [analysisSubTab, setAnalysisSubTab] = useState<AnalysisSubTab>('overall');
  const [todayForcedMode, setTodayForcedMode] = useState<'normal' | 'empty' | 'multi'>('normal');
  const [selectedMonth, setSelectedMonth] = useState<string>('2026-10');
  const [forcedGuestMode, setForcedGuestMode] = useState<boolean>(false);

  // Sub-views
  const [showStatesPreview, setShowStatesPreview] = useState<boolean>(false);
  const [statesPreviewTab, setStatesPreviewTab] = useState<'empty' | 'sync' | 'form'>('empty');
  const [showConfirmModalsView, setShowConfirmModalsView] = useState<boolean>(false);
  const [confirmModalTarget, setConfirmModalTarget] = useState<string | null>(null);

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
  const [wrongDetailRecord, setWrongDetailRecord] = useState<WrongRecord | null>(null);
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'login' | 'register' }>({ open: false, mode: 'login' });
  const [downloadApkOpen, setDownloadApkOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  // Dedicated Modals (Fixes A07, A11, A09)
  const [monthPickerOpen, setMonthPickerOpen] = useState<boolean>(false);
  const [syncModalOpen, setSyncModalOpen] = useState<boolean>(false);
  const [backupModalOpen, setBackupModalOpen] = useState<boolean>(false);
  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);

  // Generic Confirm Modal
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    message: string;
    impactText?: string;
    danger?: boolean;
    onConfirm: () => void;
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

  // Responsive device frame width
  const [screenSize, setScreenSize] = useState<ScreenSize>('412');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev));
    }, 2400);
  };

  // Jump to any of the 50 screens (Fixes A07: all 19 misrouted screens properly resolved)
  const handleJumpToScreen = (screenId: string) => {
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
        setFocusPlan(state.plans[0] || null);
        setFocusVariantOverride('normal');
        break;
      case 'focus-paused':
        setActiveTab('today');
        setFocusPlan(state.plans[0] || null);
        setFocusVariantOverride('paused');
        break;
      case 'focus-course':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'course') || state.plans[0]);
        setFocusVariantOverride('course');
        break;
      case 'focus-custom':
        setActiveTab('today');
        setFocusPlan(state.plans.find(p => p.type === 'custom') || state.plans[0]);
        setFocusVariantOverride('custom');
        break;
      case 'add-plan':
        setAddPlanOpen(true);
        break;
      case 'complete-book':
        setCompletePlan(state.plans.find(p => p.type === 'book') || state.plans[0]);
        setCompletionInitialSuccess(false);
        break;
      case 'complete-course':
        setCompletePlan(state.plans.find(p => p.type === 'course') || state.plans[0]);
        setCompletionInitialSuccess(false);
        break;
      case 'complete-custom':
        setCompletePlan(state.plans.find(p => p.type === 'custom') || state.plans[0]);
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
            impactText: '已经登记的学习记录和题本累计进度会安全保留。',
            danger: true,
            onConfirm: () => {
              deletePlan(targetPlan.id);
              showToast('已从今日日程中移除');
              setConfirmConfig(prev => ({ ...prev, open: false }));
            },
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
        return 'w-full max-w-[360px] h-[800px] rounded-[32px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case '393':
        return 'w-full max-w-[393px] h-[873px] rounded-[36px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case '412':
        return 'w-full max-w-[412px] h-[915px] rounded-[36px] border-[6px] border-[#343C2F]/15 shadow-2xl';
      case 'full':
      default:
        // Native full mobile viewport without artificial outer desktop margins
        return 'w-full max-w-md h-[100dvh] rounded-none border-0 shadow-none';
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-center p-0 lg:py-6 text-ink-main selection:bg-sage-light overflow-x-hidden">
      {/* 桌面端外围工具条（仅在 >=1024px 屏幕呈现，真机移动设备完全隐藏，Fixes A06） */}
      <header className="w-full max-w-2xl px-4 py-2 hidden lg:flex items-center justify-between text-xs text-ink-muted mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-ink-main flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-potato inline-block" />
            考公工作台 · 土豆陪伴新版
          </span>
          <span className="text-[11px] text-sage font-medium bg-sage-light px-2 py-0.5 rounded-md">
            React+TS+Vite 1:1还原版
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
              className={`px-2 py-1 rounded text-xs transition-colors ${
                screenSize === 'full' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main text-ink-muted'
              }`}
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

      {/* 手机界面容器 (主视口画布，严格修复横向溢出与首屏导航可见性，Fixes A06) */}
      <main
        className={`${getContainerClasses()} bg-cream flex flex-col relative overflow-hidden transition-all duration-300`}
      >
        {/* 顶部移动端小工具条（屏幕宽度较小时提供轻量直达入口） */}
        <div className="lg:hidden flex items-center justify-between px-3.5 py-1.5 bg-paper/90 border-b border-line text-xs shrink-0 z-30">
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
        </div>

        {/* 视图主体内容区：独立平滑内部滚动，底部留出足够 padding 防止导航遮挡 */}
        <div className="flex-1 px-4 pt-3 pb-4 overflow-y-auto">
          {showStatesPreview ? (
            <StatesPreviewView
              initialTab={statesPreviewTab}
              onBack={() => setShowStatesPreview(false)}
            />
          ) : showConfirmModalsView ? (
            <ConfirmModalsView
              initialActiveModal={confirmModalTarget}
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
                  impactText: '已经登记的学习记录和题本累计进度会安全保留。',
                  danger: true,
                  onConfirm: () => {
                    deletePlan(plan.id);
                    showToast('已从今日日程中移除');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
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
                  onConfirm: () => {
                    if (type === 'book') deleteBook(id);
                    else if (type === 'course') deleteCourse(id);
                    else deleteCustomItem(id);
                    showToast('已安全删除并同步更新事项库');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
                });
              }}
              onToast={showToast}
            />
          ) : activeTab === 'wrong' ? (
            <WrongView
              onOpenImportModal={() => setPhotoImportOpen(true)}
              onOpenDetailModal={rec => setWrongDetailRecord(rec)}
              onOpenDeleteConfirm={(recId, bookName) => {
                setConfirmConfig({
                  open: true,
                  title: '删除错题照片确认',
                  message: `确定从“${bookName}”中删除该错题照片吗？`,
                  impactText: '注意：删除照片仅移除图片记录与笔记，不会擅自减少题本中累计统计的错题总数。',
                  danger: true,
                  onConfirm: () => {
                    deleteWrongRecord(recId);
                    showToast('已删除错题照片记录');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
                });
              }}
            />
          ) : activeTab === 'analysis' ? (
            <AnalysisView
              initialSubTab={analysisSubTab}
              selectedMonth={selectedMonth}
              onOpenMonthPicker={() => setMonthPickerOpen(true)}
              onOpenLegendDetail={() => setLegendOpen(true)}
            />
          ) : (
            <SettingsView
              onOpenLogin={() => setAuthModal({ open: true, mode: 'login' })}
              onOpenRegister={() => setAuthModal({ open: true, mode: 'register' })}
              onOpenSync={() => setSyncModalOpen(true)}
              onOpenBackup={() => setBackupModalOpen(true)}
              onOpenProfile={() => setProfileModalOpen(true)}
              onOpenDownloadApk={() => setDownloadApkOpen(true)}
              onOpenResetConfirm={() => {
                setConfirmConfig({
                  open: true,
                  title: '恢复初始数据危险确认',
                  message: '确定要将工作台恢复为全新初始预设吗？',
                  impactText: '重要提示：当前添加的自定义题本、新日程和错题照片将被重置！建议先点击“导出备份”。',
                  danger: true,
                  onConfirm: () => {
                    resetState();
                    showToast('已恢复初始演示基准数据');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
                });
              }}
              onOpenLogoutConfirm={() => {
                setConfirmConfig({
                  open: true,
                  title: '退出账号登录确认',
                  message: '确定退出当前学员账号吗？',
                  impactText: '退出后转为单机离线模式，本地数据不会丢失，随时可重新登录接续。',
                  danger: true,
                  onConfirm: () => {
                    showToast('已退出账号，当前处于单机离线模式');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
                });
              }}
              onToast={showToast}
              forcedGuestMode={forcedGuestMode}
            />
          )}
        </div>

        {/* 底部固定 5 大入口导航栏：shrink-0 绝对固定在视口底部，首屏 100% 可见 (Fixes A06) */}
        <nav className="shrink-0 bg-paper/95 backdrop-blur-md border-t border-line px-2 py-2 flex items-center justify-around z-40 shadow-sheet pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
                onClick={() => {
                  setShowStatesPreview(false);
                  setShowConfirmModalsView(false);
                  setActiveTab(tab.id as MainTab);
                }}
                className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${
                  active ? 'text-sage font-bold scale-105' : 'text-ink-muted hover:text-ink-main'
                }`}
              >
                <Icon size={20} className={active ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
                <span className="text-[11px] mt-1">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 轻量 Toast 提示条 */}
        {toastMsg && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#343C2F] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-bounce-short pointer-events-none">
            <CheckCircle2 size={14} className="text-potato" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* 各类功能弹窗挂载 */}
        <AddPlanModal
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
          onClose={() => setPhotoImportOpen(false)}
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
                showToast('已上传并覆盖云端存档');
                setConfirmConfig(prev => ({ ...prev, open: false }));
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
                showToast('已从云端拉取最新记录并覆盖本机');
                setConfirmConfig(prev => ({ ...prev, open: false }));
              },
            });
          }}
          onToast={showToast}
        />

        <BackupModal
          isOpen={backupModalOpen}
          onClose={() => setBackupModalOpen(false)}
          onOpenResetConfirm={() => {
            setConfirmConfig({
              open: true,
              title: '恢复初始数据危险确认',
              message: '确定要将工作台恢复为全新初始预设吗？',
              impactText: '重要提示：当前添加的自定义题本、新日程和错题照片将被重置！建议先点击“导出备份”。',
              danger: true,
              onConfirm: () => {
                resetState();
                showToast('已恢复初始演示基准数据');
                setConfirmConfig(prev => ({ ...prev, open: false }));
              },
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
        />
      </main>
    </div>
  );
};
