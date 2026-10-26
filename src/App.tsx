import React, { useState } from 'react';
import { useApp } from './context/AppContext';
import { TodayView } from './components/views/TodayView';
import { LearningView } from './components/views/LearningView';
import { WrongView } from './components/views/WrongView';
import { AnalysisView } from './components/views/AnalysisView';
import { SettingsView } from './components/views/SettingsView';
import { FocusModal } from './components/views/FocusModal';
import { CompletionModal } from './components/views/CompletionModal';
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
  const { state, resetState, exportBackup, deleteBook, deleteCourse, deleteCustomItem, deleteWrongRecord } = useApp();

  // Navigation state
  const [activeTab, setActiveTab] = useState<MainTab>('today');
  const [learningSubTab, setLearningSubTab] = useState<LearningSubTab>('books');
  const [analysisSubTab, setAnalysisSubTab] = useState<AnalysisSubTab>('overall');
  const [todayForcedMode, setTodayForcedMode] = useState<'normal' | 'empty' | 'multi'>('normal');

  // Sub-views
  const [showStatesPreview, setShowStatesPreview] = useState<boolean>(false);
  const [showConfirmModalsView, setShowConfirmModalsView] = useState<boolean>(false);

  // Modals state
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [focusPlan, setFocusPlan] = useState<Plan | null>(null);
  const [focusVariantOverride, setFocusVariantOverride] = useState<'normal' | 'paused' | 'course' | 'custom'>('normal');
  const [completePlan, setCompletePlan] = useState<Plan | null>(null);

  const [bookModalState, setBookModalState] = useState<{ open: boolean; book?: Book }>({ open: false });
  const [courseModalState, setCourseModalState] = useState<{ open: boolean; course?: Course }>({ open: false });
  const [customAddOpen, setCustomAddOpen] = useState(false);
  const [countdownIndex, setCountdownIndex] = useState<number | null>(null);
  const [photoImportOpen, setPhotoImportOpen] = useState(false);
  const [wrongDetailRecord, setWrongDetailRecord] = useState<WrongRecord | null>(null);
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'login' | 'register' }>({ open: false, mode: 'login' });
  const [downloadApkOpen, setDownloadApkOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

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

  // Jump to any of the 50 screens
  const handleJumpToScreen = (screenId: string) => {
    // Reset special states
    setShowStatesPreview(false);
    setShowConfirmModalsView(false);
    setTodayForcedMode('normal');

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
      case 'guest':
        setActiveTab('settings');
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
        break;
      case 'complete-course':
        setCompletePlan(state.plans.find(p => p.type === 'course') || state.plans[0]);
        break;
      case 'complete-custom':
        setCompletePlan(state.plans.find(p => p.type === 'custom') || state.plans[0]);
        break;
      case 'complete-success':
      case 'complete-course-success':
      case 'complete-custom-success':
        setCompletePlan(state.plans[0]);
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
        setActiveTab('analysis');
        setAnalysisSubTab('monthly');
        showToast('已进入每月分析月份视图');
        break;
      case 'states-empty':
      case 'states-sync':
      case 'states-form':
        setShowStatesPreview(true);
        break;
      case 'delete-confirm':
      case 'confirm-book':
      case 'confirm-course':
      case 'confirm-photo':
      case 'confirm-reset':
      case 'confirm-import':
      case 'confirm-upload':
      case 'confirm-pull':
      case 'confirm-logout':
        setShowConfirmModalsView(true);
        break;
      default:
        setActiveTab('today');
        break;
    }
    showToast(`已切换至: ${ALL_50_SCREENS.find(s => s.id === screenId)?.name || screenId}`);
  };

  const getContainerWidth = () => {
    switch (screenSize) {
      case '360':
        return 'max-w-[360px] min-h-[800px]';
      case '393':
        return 'max-w-[393px] min-h-[873px]';
      case '412':
        return 'max-w-[412px] min-h-[915px]';
      case 'full':
        return 'max-w-md w-full min-h-screen';
    }
  };

  return (
    <div className="min-h-screen bg-[#ECEAE1] flex flex-col items-center justify-start py-0 md:py-6 text-ink-main selection:bg-sage-light">
      {/* 桌面端外围工具条（尺寸切换 & 50屏矩阵直达） */}
      <header className="w-full max-w-2xl px-4 py-2 hidden md:flex items-center justify-between text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span className="font-bold text-ink-main flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-potato inline-block" />
            考公工作台 · 土豆新版
          </span>
          <span className="text-[11px] text-sage font-medium bg-sage-light px-2 py-0.5 rounded-md">
            React+TS+Vite 独立工程
          </span>
        </div>

        {/* 屏幕尺寸切换器 */}
        <div className="flex items-center gap-3">
          <div className="flex bg-paper border border-line rounded-lg p-0.5 shadow-sm">
            <button
              onClick={() => setScreenSize('412')}
              className={`px-2 py-1 rounded text-xs font-mono ${screenSize === '412' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main'}`}
              title="主设计尺寸 412×915 (Google Pixel)"
            >
              412px
            </button>
            <button
              onClick={() => setScreenSize('393')}
              className={`px-2 py-1 rounded text-xs font-mono ${screenSize === '393' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main'}`}
              title="校核尺寸 393×873 (iPhone)"
            >
              393px
            </button>
            <button
              onClick={() => setScreenSize('360')}
              className={`px-2 py-1 rounded text-xs font-mono ${screenSize === '360' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main'}`}
              title="紧凑尺寸 360×800 (Compact Android)"
            >
              360px
            </button>
            <button
              onClick={() => setScreenSize('full')}
              className={`px-2 py-1 rounded text-xs ${screenSize === 'full' ? 'bg-sage text-white font-bold' : 'hover:text-ink-main'}`}
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
            <span>50 屏矩阵直达</span>
          </button>
        </div>
      </header>

      {/* 手机界面容器 (主画布) */}
      <main
        className={`w-full ${getContainerWidth()} bg-cream flex flex-col relative md:rounded-[36px] shadow-2xl border-0 md:border-[8px] md:border-[#343C2F]/10 overflow-hidden transition-all duration-300`}
        style={{ minHeight: screenSize === 'full' ? '100vh' : '915px' }}
      >
        {/* 顶部移动端小工具条（随时打开50屏全览） */}
        <div className="md:hidden flex items-center justify-between px-4 py-2 bg-paper/80 border-b border-line text-xs">
          <span className="font-bold text-ink-main">土豆考公工作台</span>
          <button
            onClick={() => setInspectorOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-sage-light text-sage-dark font-medium rounded-md text-[11px]"
          >
            <Layers size={12} />
            <span>50 屏直达</span>
          </button>
        </div>

        {/* 视图主体内容区 */}
        <div className="flex-1 px-4 pt-3 overflow-y-auto">
          {showStatesPreview ? (
            <StatesPreviewView onBack={() => setShowStatesPreview(false)} />
          ) : showConfirmModalsView ? (
            <ConfirmModalsView onBack={() => setShowConfirmModalsView(false)} />
          ) : activeTab === 'today' ? (
            <TodayView
              forcedMode={todayForcedMode}
              onOpenAddPlan={() => setAddPlanOpen(true)}
              onOpenFocus={plan => {
                setFocusPlan(plan);
                setFocusVariantOverride('normal');
              }}
              onOpenComplete={plan => setCompletePlan(plan)}
              onOpenCountdownEdit={idx => setCountdownIndex(idx)}
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
                  impactText: type === 'book'
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
              onOpenMonthPicker={() => showToast('当前固定展示基准月份 2026-10，包含1260分钟与420题量')}
              onOpenLegendDetail={() => setLegendOpen(true)}
            />
          ) : (
            <SettingsView
              onOpenLogin={() => setAuthModal({ open: true, mode: 'login' })}
              onOpenRegister={() => setAuthModal({ open: true, mode: 'register' })}
              onOpenSync={() => {
                setConfirmConfig({
                  open: true,
                  title: '云端同步操作',
                  message: '准备同步当前工作台数据到专属服务器。',
                  impactText: '采用 Bearer 认证与原子写写入，若云端为空将直接上传当前数据。',
                  danger: false,
                  onConfirm: () => {
                    showToast('模拟同步成功：当前本地数据已与服务端保持一致');
                    setConfirmConfig(prev => ({ ...prev, open: false }));
                  },
                });
              }}
              onOpenBackup={exportBackup}
              onOpenProfile={() => {
                const newName = prompt('输入学员空间名称', state.profile.name);
                if (newName && newName.trim()) {
                  showToast('空间名称已更新');
                }
              }}
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
            />
          )}
        </div>

        {/* 底部固定 5 大入口导航栏 */}
        <nav className="sticky bottom-0 inset-x-0 bg-paper/95 backdrop-blur-md border-t border-line px-2 py-2 flex items-center justify-around z-40 shadow-sheet">
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
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#343C2F] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-bounce-short">
            <CheckCircle2 size={14} className="text-potato" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* 各类弹窗组件挂载 */}
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
          }}
        />

        <CompletionModal
          plan={completePlan}
          isOpen={Boolean(completePlan)}
          onClose={() => setCompletePlan(null)}
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
