import { StandaloneTimerModal } from './StandaloneTimerModal';
import { StudyRecordsView } from './StudyRecordsView';
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Avatar } from '../common/Avatar';
import { StudyRecordItem } from '../common/StudyRecordItem';
import { Card, Button, Tag, useModalBack } from '../common/UIComponents';
import { Plus, Play, Pause, CheckCircle2, Clock, Trash2, MoreHorizontal, Sparkles, ChevronRight, ClipboardList, ChevronUp, Zap, Archive } from 'lucide-react';
import { Plan, StudyRecord, MutationResult, TimerMode, getSubjectLabel } from '../../types';
import { isPlanRunning } from '../../utils/studyTimers';
import { canCorrectStudyRecord, getPlanCompletion, getPlanElapsedMs, getStudyRecordName, studyDateLabel } from '../../utils/workflowPresentation';
import { CompanionNoteDetailModal } from './CompanionNoteDetailModal';
import { EditCompanionNoteModal } from './EditCompanionNoteModal';
import { SharingModal } from './SharingModal';
import { PokeCustomModal } from './PokeCustomModal';
import { CompanionNotesHistoryModal } from './CompanionNotesHistoryModal';
import { getCompanionDisplayName } from '../../utils/companionRemarks';
import type { CompanionNote } from '../../types/companionNote';
import type { SharedGrant } from '../../types/sharing';

interface TodayViewProps {
  forcedMode?: 'normal' | 'empty' | 'multi';
  onOpenAddPlan: () => void;
  onOpenFocus: (plan: Plan, mode?: TimerMode) => void;
  onOpenComplete: (plan: Plan) => void;
  onEditRecord?: (record: StudyRecord) => void;
  onOpenCountdownEdit: (id: string) => void;
  onAddCountdown: () => void;
  onOpenDeleteConfirm?: (plan: Plan) => void;
  onOpenProfile?: () => void;
  onOpenSharing?: () => void;
  showProfileBar?: boolean;
  onToast?: (msg: string) => void;
  initialCompanionNote?: CompanionNote | null;
}

export const TodayView: React.FC<TodayViewProps> = ({
  forcedMode = 'normal',
  onOpenAddPlan,
  onOpenFocus,
  onOpenComplete,
  onEditRecord,
  onOpenCountdownEdit,
  onAddCountdown,
  onOpenDeleteConfirm,
  onOpenProfile,
  onOpenSharing,
  showProfileBar = false,
  onToast,
  initialCompanionNote,
}) => {
  const { state, activeDate, startTimer, pauseTimer, deletePlan, currentUser, csrfToken } = useApp();
  const [, setTick] = useState(0);
  const [subView, setSubView] = useState<'main' | 'study-records'>('main');
  const [recordsDate, setRecordsDate] = useState<string | undefined>(undefined);

  useModalBack(subView === 'study-records', () => setSubView('main'));
  const [onlyUnfinished, setOnlyUnfinished] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('kaogong_today_only_unfinished') === 'true';
    } catch {
      return false;
    }
  });

  const toggleOnlyUnfinished = () => {
    setOnlyUnfinished(prev => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('kaogong_today_only_unfinished', String(next));
        }
      } catch {}
      return next;
    });
  };
  const [pomodoroOpen, setPomodoroOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const runTimerAction = async (action: () => Promise<MutationResult<void>>) => {
    setErrorMsg('');
    const result = await action();
    if (!result.ok) setErrorMsg(result.message);
  };

  const DEFAULT_NOTE: CompanionNote = {
    id: 'default-note',
    fromUserId: 'demo-atu',
    fromNickname: '阿土同学',
    fromAvatar: 'pose-1',
    message: '今天行测刷满100题，谁先放弃谁是小狗🐶！晚上对答案，一起冲上岸！🥔✨',
    imageUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" rx="32" fill="%23EBF1E6"/><circle cx="100" cy="90" r="50" fill="%23DFE9D7"/><text x="100" y="98" font-size="52" text-anchor="middle" dominant-baseline="middle">🥔</text><rect x="40" y="145" width="120" height="28" rx="14" fill="%234B6240"/><text x="100" y="163" font-size="13" font-weight="bold" fill="%23FFFFFF" text-anchor="middle" dominant-baseline="middle">一起上岸必胜</text></svg>',
    hearts: 3,
    createdAt: new Date().toISOString(),
  };

  const userStorageKey = currentUser?.id ? `kaogong_active_note_${currentUser.id}` : 'kaogong_active_note';

  const getDismissedKey = (noteId: string) => `kaogong_dismissed_note_${currentUser?.id || 'guest'}_${noteId}`;
  const isNoteDismissed = (noteId: string) => {
    try {
      if (typeof window === 'undefined') return false;
      const uid = currentUser?.id;
      if (uid && localStorage.getItem(`kaogong_dismissed_note_${uid}_${noteId}`) === 'true') return true;
      if (localStorage.getItem(`kaogong_dismissed_note_guest_${noteId}`) === 'true') return true;
      if (localStorage.getItem(`kaogong_dismissed_note_${noteId}`) === 'true') return true;
      return false;
    } catch {
      return false;
    }
  };

  const getInitialActiveNote = (): CompanionNote | null => {
    if (initialCompanionNote !== undefined) return initialCompanionNote;
    try {
      const cached = typeof window !== 'undefined' ? localStorage.getItem(userStorageKey) : null;
      if (cached) return JSON.parse(cached);
    } catch {}
    return DEFAULT_NOTE;
  };

  const [activeNote, setActiveNote] = useState<CompanionNote | null>(getInitialActiveNote);
  const [allNotes, setAllNotes] = useState<CompanionNote[]>(() => [DEFAULT_NOTE]);

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    const note = getInitialActiveNote();
    return note ? isNoteDismissed(note.id) : false;
  });
  const [, setRemarkTick] = useState(0);

  useEffect(() => {
    const handleRemarkChange = () => setRemarkTick(t => t + 1);
    window.addEventListener('companion_remark_changed', handleRemarkChange);
    return () => window.removeEventListener('companion_remark_changed', handleRemarkChange);
  }, []);
  const [isDismissing, setIsDismissing] = useState(false);
  const [swipeOffsetY, setSwipeOffsetY] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number>(0);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [pokeModalOpen, setPokeModalOpen] = useState(false);

  const [partner, setPartner] = useState<SharedGrant | null>(null);
  const [poking, setPoking] = useState(false);
  const [pokeCooldown, setPokeCooldown] = useState(0);
  const [localSharingOpen, setLocalSharingOpen] = useState(false);
  const openSharing = () => {
    if (!currentUser) {
      onToast?.('请先登录账号后再管理学习伙伴');
      return;
    }
    if (onOpenSharing) onOpenSharing();
    else setLocalSharingOpen(true);
  };

  useEffect(() => {
    if (pokeCooldown <= 0) return;
    const interval = setInterval(() => {
      setPokeCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [pokeCooldown]);

  useEffect(() => {
    if (!currentUser) {
      setPartner(null);
      return;
    }

    const refreshGrants = () => {
      fetch('/api/sharing/grants')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (Array.isArray(data?.received) && data.received.length > 0) {
            setPartner(data.received[0]);
          } else {
            // Default demo partner for companion experience
            setPartner({
              id: 'demo-atu',
              nickname: '阿土同学',
              avatar: 'pose-1',
              createdAt: new Date().toISOString(),
              liveStatus: {
                state: 'focusing',
                focusTitle: '行测真题 5000 题',
                focusMinutes: 34,
                scheduledTime: '14:00',
                canPoke: false,
              },
            });
          }
        })
        .catch(() => {});
    };

    refreshGrants();
    const interval = setInterval(refreshGrants, 12000);
    const onFocus = () => refreshGrants();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [currentUser]);

  const handleCustomPokeSend = async (data: { customMessage: string; checkItems: string[] }) => {
    if (!partner || poking || pokeCooldown > 0) return;
    setPoking(true);
    try {
      if (partner.id.startsWith('demo-')) {
        await new Promise(r => setTimeout(r, 400));
        setPokeCooldown(1800);
        onToast?.(`⚡️ 已向「${getCompanionDisplayName(partner.id, partner.nickname)}」发送小猫催学信！`);
        setPokeModalOpen(false);
        return;
      }
      const res = await fetch('/api/sharing/nudge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({
          grantId: partner.id,
          customMessage: data.customMessage,
          checkItems: data.checkItems,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.message || '催学提醒发送失败');
      setPokeCooldown(resData.cooldownSeconds || 1800);
      onToast?.(resData.message || `⚡️ 已向「${getCompanionDisplayName(partner.id, partner.nickname)}」发送小猫催学信！`);
      setPokeModalOpen(false);
    } catch (err: any) {
      onToast?.(err.message || '催学提醒发送失败');
    } finally {
      setPoking(false);
    }
  };

  useEffect(() => {
    if (activeNote) {
      setBannerDismissed(isNoteDismissed(activeNote.id));
    }
  }, [activeNote?.id, currentUser?.id]);

  useEffect(() => {
    if (currentUser) {
      fetch('/api/sharing/notes')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (Array.isArray(data?.notes) && data.notes.length > 0) {
            setAllNotes(data.notes);
            const incoming = data.notes.find((n: CompanionNote) => n.fromUserId !== currentUser.id);
            if (incoming) {
              setActiveNote(incoming);
              setBannerDismissed(isNoteDismissed(incoming.id));
              try { localStorage.setItem(userStorageKey, JSON.stringify(incoming)); } catch {}
            } else {
              const cached = typeof window !== 'undefined' ? localStorage.getItem(userStorageKey) : null;
              if (cached) {
                try {
                  const parsed = JSON.parse(cached);
                  if (parsed && parsed.fromUserId !== currentUser.id) {
                    setActiveNote(parsed);
                    setBannerDismissed(isNoteDismissed(parsed.id));
                  } else {
                    setActiveNote(null);
                    localStorage.removeItem(userStorageKey);
                  }
                } catch {
                  setActiveNote(null);
                }
              } else {
                setActiveNote(null);
              }
            }
          } else {
            setAllNotes([DEFAULT_NOTE]);
            setActiveNote(null);
            try { localStorage.removeItem(userStorageKey); } catch {}
          }
        })
        .catch(() => {});
    } else {
      setAllNotes([DEFAULT_NOTE]);
      setActiveNote(DEFAULT_NOTE);
      setBannerDismissed(isNoteDismissed(DEFAULT_NOTE.id));
    }
  }, [currentUser, userStorageKey]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY < 0) {
      setSwipeOffsetY(deltaY);
    }
  };

  const dismissBanner = () => {
    setIsDismissing(true);
    if (activeNote) {
      try {
        const uid = currentUser?.id;
        if (uid) {
          localStorage.setItem(`kaogong_dismissed_note_${uid}_${activeNote.id}`, 'true');
        }
        localStorage.setItem(`kaogong_dismissed_note_guest_${activeNote.id}`, 'true');
        localStorage.setItem(`kaogong_dismissed_note_${activeNote.id}`, 'true');
      } catch {}
    }
    setTimeout(() => {
      setBannerDismissed(true);
      setIsDismissing(false);
      setSwipeOffsetY(0);
    }, 250);
  };

  const restoreBanner = () => {
    setBannerDismissed(false);
    if (activeNote) {
      try {
        const uid = currentUser?.id;
        if (uid) {
          localStorage.removeItem(`kaogong_dismissed_note_${uid}_${activeNote.id}`);
        }
        localStorage.removeItem(`kaogong_dismissed_note_guest_${activeNote.id}`);
        localStorage.removeItem(`kaogong_dismissed_note_${activeNote.id}`);
      } catch {}
    }
  };

  const handlePinNoteToTop = (note: CompanionNote) => {
    setActiveNote(note);
    try {
      const uid = currentUser?.id;
      if (uid) {
        localStorage.removeItem(`kaogong_dismissed_note_${uid}_${note.id}`);
      }
      localStorage.removeItem(`kaogong_dismissed_note_guest_${note.id}`);
      localStorage.removeItem(`kaogong_dismissed_note_${note.id}`);
      localStorage.setItem(userStorageKey, JSON.stringify(note));
    } catch {}
    setBannerDismissed(false);
    onToast?.('📌 已将此便签设为今日置顶展示！');
  };

  const handleSendHeartFromHistory = async (noteId: string) => {
    try {
      const res = await fetch(`/api/sharing/notes/${noteId}/heart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
      });
      if (res.ok) {
        setAllNotes(prev => prev.map(n => n.id === noteId ? { ...n, hearts: (n.hearts || 0) + 1 } : n));
        if (activeNote?.id === noteId) {
          setActiveNote(prev => prev ? { ...prev, hearts: (prev.hearts || 0) + 1 } : null);
        }
        onToast?.('❤️ 已回赠爱心！');
      }
    } catch {
      onToast?.('爱心发送失败，请稍后重试');
    }
  };

  const handleTouchEnd = () => {
    if (touchStartY.current === null) return;
    const duration = Date.now() - touchStartTime.current;
    if (swipeOffsetY < -35 || (swipeOffsetY < -18 && duration < 250)) {
      dismissBanner();
    } else {
      setSwipeOffsetY(0);
    }
    touchStartY.current = null;
  };

  const handleBannerClick = () => {
    if (Math.abs(swipeOffsetY) < 10) {
      setDetailModalOpen(true);
    }
  };

  // Keep live timer tick
  useEffect(() => {
    const hasRunning = state.plans.some(isPlanRunning);
    if (!hasRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [state.plans]);

  const relevantPlans = state.plans.filter(p => p.date === activeDate);
  const recentRecords = [...state.records]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 3);
  const pendingHistoryDates = [...new Set(state.plans.filter(plan => plan.date < activeDate && !plan.done).map(plan => plan.date))].sort().reverse();
  const pendingHistoryCount = state.plans.filter(plan => plan.date < activeDate && !plan.done).length;
  const openRecordLog = (date?: string) => { setRecordsDate(date); setSubView('study-records'); };
  const deleteHistoryPlan = (plan: Plan) => {
    if (onOpenDeleteConfirm) onOpenDeleteConfirm(plan);
    else void runTimerAction(() => deletePlan(plan.id));
  };

  // Determine display list based on forcedMode
  if (subView === 'study-records') {
    return (
      <div className="space-y-4 pb-12">
        <StudyRecordsView
          onBack={() => setSubView('main')}
          initialDate={recordsDate}
          onEditRecord={onEditRecord}
          onOpenComplete={onOpenComplete}
          onDeletePlan={deleteHistoryPlan}
          onToast={onToast}
        />
        <StandaloneTimerModal key={currentUser?.id ?? 'preview'} isOpen={pomodoroOpen} onClose={() => setPomodoroOpen(false)} />
      </div>
    );
  }

  let displayedPlans = relevantPlans;
  if (forcedMode === 'empty') {
    displayedPlans = [];
  } else if (forcedMode === 'multi') {
    displayedPlans = relevantPlans.map((p, idx) => {
      if (idx === 0 || idx === 1) {
        return {
          ...p,
          done: false,
          timerStart: p.timerStart > 0 ? p.timerStart : Date.now() - (idx + 1) * 320000,
        };
      }
      return p;
    });
  }

  const doneCount = displayedPlans.filter(p => p.done).length;
  const visiblePlans = onlyUnfinished ? displayedPlans.filter(plan => !plan.done) : displayedPlans;
  const totalElapsedMs = displayedPlans.reduce((sum, p) => {
    const elapsed = getPlanElapsedMs(p);
    return sum + elapsed;
  }, 0);
  const totalMinutes = Math.floor(totalElapsedMs / 60000);

  // 倒数日展示：未设置日期 / 今天 / N 天 / 已结束
  const countdownState = (targetDate: string) => {
    if (!targetDate) return { text: '--', ended: false, unset: true };
    const today = new Date(activeDate + 'T00:00:00');
    const target = new Date(targetDate + 'T00:00:00');
    const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 3600 * 24));
    if (days < 0) return { text: '已结束', ended: true, unset: false };
    if (days === 0) return { text: '今天', ended: false, unset: false };
    return { text: String(days), ended: false, unset: false };
  };

  const formatTimer = (start: number, accumulatedMs: number = 0) => {
    const elapsed = accumulatedMs + (start > 0 ? Math.max(0, Date.now() - start) : 0);
    const sec = Math.floor(elapsed / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="relative space-y-4 pb-24">
      {/* 悬浮打气便签 (Floating Banner) - 顶部自然排版，不覆盖下方 0 分钟卡片 */}
      {!bannerDismissed && activeNote && (
        <div
          role="banner"
          aria-label="研友打气便签"
          className={`transition-all duration-300 ease-out select-none mb-2 ${
            isDismissing ? '-translate-y-4 opacity-0 max-h-0 pointer-events-none' : 'translate-y-0 opacity-100'
          }`}
          style={
            swipeOffsetY < 0
              ? { transform: `translateY(${swipeOffsetY}px)`, opacity: Math.max(0, 1 + swipeOffsetY / 90) }
              : undefined
          }
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleBannerClick}
        >
          <div className="mx-0.5 bg-gradient-to-r from-[#FFFDF9] via-[#FAF7EE] to-[#F2F7EB] border border-[#DEE7D4] rounded-2xl p-2.5 shadow-md backdrop-blur-md flex items-center justify-between gap-2.5 cursor-pointer hover:shadow-lg transition-all active:scale-[0.99]">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                avatar={
                  (partner && (partner.partnerId === activeNote.fromUserId || partner.id === activeNote.fromUserId || !activeNote.fromUserId))
                    ? (partner.avatar || activeNote.fromAvatar || 'pose-0')
                    : (activeNote.fromAvatar || partner?.avatar || 'pose-0')
                }
                size={38}
                className="shrink-0 rounded-full border border-[#D5E1CB] shadow-2xs"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-ink-main truncate">
                    {getCompanionDisplayName(
                      activeNote.fromUserId,
                      activeNote.fromNickname || partner?.nickname || '研友',
                      partner?.id
                    )}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#E5ECD9] text-[#4F6344] font-semibold shrink-0">
                    打气便签
                  </span>
                </div>
                <p className="text-xs text-ink-muted truncate mt-0.5 max-w-[200px]">
                  {activeNote.message || '给你贴了一张考公打气表情包！'}
                </p>
              </div>
              {activeNote.imageUrl && (
                <img
                  src={activeNote.imageUrl}
                  alt="表情包"
                  className="w-7 h-7 rounded-lg object-contain bg-white border border-[#D5E1CB] shrink-0 p-0.5 ml-1 hidden sm:block shadow-2xs"
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDetailModalOpen(true); }}
                className="px-2.5 py-1.5 rounded-xl bg-sage/15 text-sage text-xs font-bold hover:bg-sage/25 transition-colors"
              >
                查看
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditModalOpen(true); }}
                className="px-2.5 py-1.5 rounded-xl bg-[#EBF1E6] text-sage-dark text-xs font-bold hover:bg-[#DEE8D6] transition-colors flex items-center gap-1"
                title="我也贴一张打气便签"
              >
                <span>💌</span>
                <span>贴便签</span>
              </button>
              <button
                type="button"
                aria-label="向上收起便签"
                onClick={(e) => { e.stopPropagation(); dismissBanner(); }}
                className="p-1 text-ink-muted hover:text-ink-main rounded-lg hover:bg-cream/80 transition-colors"
                title="上滑收起"
              >
                <ChevronUp size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 研友胶囊状态栏与便签箱/贴便签入口 */}
      <div className="flex items-center justify-between gap-2 px-0.5 mb-1">
        {partner ? (
          <div
            onClick={openSharing}
            className="flex-1 min-w-0 flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-2xl bg-cream/70 border border-line/80 hover:bg-cream hover:border-sage/40 transition active:scale-[0.99] cursor-pointer"
            title="点击进入学习伙伴查看学情"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                partner.liveStatus?.state === 'focusing'
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-ink-muted/30'
              }`} />
              <span className="text-xs font-bold text-ink-main shrink-0">
                {getCompanionDisplayName(partner.id, partner.nickname)}
              </span>
              <span className="text-[11px] text-ink-muted truncate">
                {partner.liveStatus?.state === 'focusing'
                  ? `🟢 正在专注《${partner.liveStatus.focusTitle || '备考'}》${partner.liveStatus.focusMinutes ?? 0}m`
                  : '未在学习'}
              </span>
            </div>

            {partner.liveStatus?.state === 'focusing' ? (
              <span
                className="shrink-0 px-2 py-0.5 rounded-lg bg-cream/80 text-ink-muted/60 font-medium text-[10px] flex items-center gap-0.5 border border-line/50"
                title="研友正在专注学习中，请勿打扰"
              >
                <span>专注中</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPokeModalOpen(true);
                }}
                disabled={poking || pokeCooldown > 0}
                className="shrink-0 px-2 py-0.5 rounded-lg bg-sage hover:bg-sage-dark text-white font-bold text-[10px] flex items-center gap-0.5 shadow-2xs transition active:scale-95 disabled:opacity-50"
                title="向研友发送小猫催学信"
              >
                <Zap size={11} className="fill-current text-potato" />
                <span>{poking ? '发送中' : pokeCooldown > 0 ? `${Math.ceil(pokeCooldown / 60)}分` : '戳一下'}</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={openSharing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-2xl bg-cream/70 border border-line/80 text-xs text-sage font-bold hover:bg-cream transition"
          >
            <span>👥</span>
            <span>添加学习伙伴</span>
          </button>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setHistoryModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-paper border border-[#DEE7D4] text-xs font-bold text-ink-main hover:bg-[#F2F7EB] shadow-2xs transition active:scale-95"
            title="打开便签箱 · 查看今日与往常所有便签"
          >
            <Archive size={13} className="text-sage" />
            <span>便签箱</span>
          </button>

          <button
            type="button"
            onClick={() => setEditModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-paper border border-[#DEE7D4] text-xs font-bold text-sage hover:bg-[#F2F7EB] shadow-2xs transition active:scale-95"
            title="给研友写打气便签"
          >
            <span>💌</span>
            <span>写便签</span>
          </button>
          {bannerDismissed && activeNote && (
            <button
              type="button"
              onClick={restoreBanner}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-[#FAF7EE] border border-[#DEE7D4] text-xs font-medium text-sage hover:bg-[#F2F7EB] shadow-2xs transition active:scale-95"
              aria-label="重新展开打气便签"
              title="重新展开置顶打气便签"
            >
              <span>展开便签</span>
              {activeNote.hearts > 0 && <span className="text-[#C04940] text-[10px]">❤️{activeNote.hearts}</span>}
            </button>
          )}
        </div>
      </div>

      {errorMsg && <div role="alert" className="p-3 text-xs text-alarm bg-alarm-light rounded-xl">{errorMsg}</div>}
      {/* 顶部个人状态条（如开启展示） */}
      {showProfileBar && (
        <div className="flex items-center justify-between px-1 py-0.5">
          <div className="flex items-center gap-2 cursor-pointer" onClick={onOpenProfile}>
            <Avatar avatar={state.profile.avatar} size={32} />
            <div>
              <div className="text-xs font-bold text-ink-main">{state.profile.name || '备考学员'}</div>
              <div className="text-[10px] text-ink-muted">今日专注备考中</div>
            </div>
          </div>
        </div>
      )}

      {/* 1. 1:1 还原原设计：浅鼠尾草绿 65分钟大汇总卡 + 右下角读书土豆 (Pose 1) (Fixes A08) */}
      <div className="relative bg-[#E5ECD9] border border-[#DDE5CE] rounded-[24px] p-5 overflow-hidden shadow-soft">
        {/* 背景大圆形底斑 */}
        <div
          className="absolute -top-10 -right-10 w-44 h-44 rounded-full pointer-events-none"
          style={{ background: '#EDF1E2' }}
        />

        {/* 左侧内容区 */}
        <div className="relative z-10 max-w-[210px]">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#69785B] mb-1">
            <Sparkles size={13} className="text-sage" />
            <span>今日已累计学习</span>
          </div>

          <div className="flex items-baseline gap-1 my-0.5">
            <span className="text-5xl font-extrabold text-ink-main font-mono tracking-tight">
              {totalMinutes}
            </span>
            <span className="text-sm font-semibold text-[#69785B]">分钟</span>
          </div>

          <div className="text-xs text-[#657657] mt-1.5 font-medium">
            <strong>{doneCount} / {displayedPlans.length}</strong> 项日程已完成
          </div>
        </div>

        {/* 右侧摆放读书土豆 (Pose 1) */}
        <div className="absolute right-3 -bottom-2 z-10 pointer-events-none select-none">
          <PotatoSprite pose={1} size={106} />
        </div>
      </div>

      {/* 2. 倒数日：用户自定义，最多 6 个，上下纵向排列 */}
      <div className="bg-paper border border-line rounded-2xl p-2 shadow-sm" role="group" aria-label="倒数日">
        {state.countdowns.length === 0 ? (
          <button
            onClick={onAddCountdown}
            className="w-full flex items-center justify-center gap-1 py-3 rounded-xl text-xs text-sage hover:bg-cream/50 transition-colors"
            aria-label="添加倒数日"
          >
            ＋ 添加倒数日（考试或目标日期）
          </button>
        ) : (
          <div className="divide-y divide-line/60">
            {state.countdowns.map(cd => {
              const info = countdownState(cd.date);
              return (
                <button
                  key={cd.id}
                  onClick={() => onOpenCountdownEdit(cd.id)}
                  aria-label={`${cd.name} 倒数日`}
                  className="w-full flex items-center justify-between gap-2 px-1.5 py-2 hover:bg-cream/50 rounded-lg transition-colors"
                >
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="text-xs font-medium text-ink-main truncate max-w-[10rem]">{cd.name}</span>
                    <span className="text-[10px] text-ink-muted/80 font-mono">{cd.date || '设置日期'}</span>
                  </span>
                  <span className="flex items-baseline gap-1 shrink-0 pr-1">
                    {info.ended ? (
                      <span className="text-xs font-bold text-ink-muted">已结束</span>
                    ) : info.unset ? (
                      <span className="text-sm font-bold text-ink-muted/60">--</span>
                    ) : info.text === '今天' ? (
                      <span className="text-sm font-extrabold text-sage">今天</span>
                    ) : (
                      <>
                        <span className="text-base font-extrabold text-sage font-mono">{info.text}</span>
                        <span className="text-[10px] text-ink-muted">天</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
            {state.countdowns.length < 6 && (
              <button
                onClick={onAddCountdown}
                aria-label="添加倒数日"
                className="w-full py-2 text-center text-xs text-sage hover:bg-cream/40 rounded-lg"
              >
                ＋ 添加倒数日
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. 待执行日程列表头部 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <h2 className="text-base font-bold text-ink-main flex items-center gap-1.5">
          <span>今日日程</span>
          <span className="text-xs font-normal text-ink-muted">({visiblePlans.length})</span>
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {doneCount > 0 && (
            <button
              type="button"
              aria-pressed={onlyUnfinished}
              onClick={toggleOnlyUnfinished}
              className={`inline-flex h-8 items-center rounded-full border px-2.5 text-[11px] transition-colors ${onlyUnfinished ? 'border-sage bg-sage-light font-medium text-sage-dark' : 'border-line bg-paper text-ink-muted'}`}
            >
              只看未完成
            </button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setPomodoroOpen(true)}><Clock size={14} />番茄钟</Button>
          <Button variant="primary" size="sm" onClick={onOpenAddPlan}><Plus size={14} />添加日程</Button>
        </div>
      </div>

      {/* 4. 计划列表 */}
      {displayedPlans.length === 0 ? (
        <Card className="py-12 text-center bg-paper/80 border-dashed border-line">
          <div className="flex justify-center mb-3">
            <PotatoSprite pose={7} size={84} />
          </div>
          <div className="text-base font-bold text-ink-main mb-1">今天还没有日程</div>
          <p className="text-xs text-ink-muted max-w-[240px] mx-auto mb-4 leading-relaxed">
            从题本、网课或自定义学习事项中挑选一项加入今天吧
          </p>
          <Button variant="primary" size="md" onClick={onOpenAddPlan}>
            <Plus size={16} />
            挑选今日事项
          </Button>
        </Card>
      ) : onlyUnfinished && visiblePlans.length === 0 ? (
        <Card className="py-8 text-center bg-paper/80 border-dashed border-line">
          <CheckCircle2 size={30} className="mx-auto mb-2 text-sage" />
          <p className="text-sm font-bold text-ink-main">今天没有未完成的日程了</p>
          <p className="mt-1 text-xs text-ink-muted">已完成的 {doneCount} 项日程都还在。</p>
          <Button variant="light" size="sm" onClick={() => setOnlyUnfinished(false)} className="mt-3">显示全部日程</Button>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visiblePlans.map(plan => {
            const isRunning = isPlanRunning(plan);
            const elapsedMinutes = Math.floor(getPlanElapsedMs(plan) / 60000);
            const record = getPlanCompletion(plan, state.records).record;
            const removePlan = () => {
              if (onOpenDeleteConfirm) {
                onOpenDeleteConfirm(plan);
              } else {
                void runTimerAction(() => deletePlan(plan.id));
              }
            };
            if (plan.done) return (
              <Card key={plan.id} className="rounded-2xl border border-sage-light bg-[#F8FAF5] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Tag variant={plan.type === 'book' ? 'potato' : plan.type === 'course' ? 'course' : 'gray'}>
                        {plan.type === 'book' ? '刷题' : plan.type === 'course' ? '网课' : '自定义'}
                      </Tag>
                      <Tag variant="gray">{getSubjectLabel(plan.subject, state.subjectLabels)}</Tag>
                      {plan.date !== activeDate && <Tag variant="danger">跨日 · {plan.date}</Tag>}
                      <span className="ml-0.5 inline-flex items-center gap-0.5 text-[10px] text-sage-dark"><CheckCircle2 size={11} />已完成</span>
                    </div>
                    <h3 className="mt-1 truncate text-sm font-medium text-ink-muted line-through">{plan.name}</h3>
                  </div>
                  <button onClick={removePlan} className="shrink-0 rounded-lg p-1 text-ink-muted hover:bg-black/5 hover:text-alarm" title="移除日程" aria-label="移除日程">
                    <MoreHorizontal size={16} />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-ink-muted">
                  <span>已学 {elapsedMinutes} / 计划 {plan.plannedMinutes} 分钟</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button onClick={() => onOpenComplete(plan)} className="text-sage underline decoration-sage/40 underline-offset-2">查看登记总结</button>
                    {record && onEditRecord && canCorrectStudyRecord(state, record) && <button onClick={() => onEditRecord(record)} className="text-sage underline decoration-sage/40 underline-offset-2">修改登记</button>}
                  </span>
                </div>
              </Card>
            );
            return (
              <Card key={plan.id} className={`rounded-[20px] border p-3.5 transition-all ${isRunning ? 'border-sage bg-paper shadow-md ring-1 ring-sage/30' : 'border-line bg-paper'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Tag variant={plan.type === 'book' ? 'potato' : plan.type === 'course' ? 'course' : 'gray'}>
                        {plan.type === 'book' ? '刷题' : plan.type === 'course' ? '网课' : '自定义'}
                      </Tag>
                      <Tag variant="gray">{getSubjectLabel(plan.subject, state.subjectLabels)}</Tag>
                      {plan.date !== activeDate && <Tag variant="danger">跨日 · {plan.date}</Tag>}
                    </div>
                    <h3 onClick={() => onOpenFocus(plan)} className="cursor-pointer truncate text-base font-bold text-ink-main transition-colors hover:text-sage">
                      {plan.name}
                    </h3>
                  </div>
                  <button onClick={removePlan} className="shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-black/5 hover:text-alarm" title="移除日程" aria-label="移除日程">
                    <MoreHorizontal size={18} />
                  </button>
                </div>

                <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                  <span>计划 {plan.plannedMinutes} 分钟{plan.type === 'course' && plan.plannedLessons ? ` · ${plan.plannedLessons}节` : ''}</span>
                  <span>·</span>
                  <span>已累计 {elapsedMinutes} 分钟</span>
                </div>

                {isRunning && (
                  <div onClick={() => onOpenFocus(plan)} className="mt-2 flex cursor-pointer items-center justify-between rounded-xl bg-sage-light/70 p-2.5 transition-colors hover:bg-sage-light">
                    <div className="flex items-center gap-2 text-xs font-bold text-sage-dark">
                      <span className="h-2.5 w-2.5 animate-ping rounded-full bg-sage" />
                      <span>{plan.timerPhase === 'rest' ? '正在休息 · 不计学习时长' : '正在专注进行中'}</span>
                    </div>
                    <div className="font-mono text-xl font-extrabold tracking-tight text-sage-dark">
                      {formatTimer(0, getPlanElapsedMs(plan))}
                    </div>
                  </div>
                )}

                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line/50 pt-2">
                  {isRunning ? (
                    <Button variant="secondary" size="md" fullWidth onClick={() => runTimerAction(() => pauseTimer(plan.id))}>
                      <Pause size={16} className="text-sage" />
                      暂停计时
                    </Button>
                  ) : (
                    <Button variant="secondary" size="md" fullWidth onClick={() => onOpenFocus(plan)}>
                      <Play size={16} className="text-sage" />
                      开始计时
                    </Button>
                  )}
                  <Button variant="primary" size="md" fullWidth onClick={() => onOpenComplete(plan)}>
                    <CheckCircle2 size={16} />
                    完成登记
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <section className="pt-3 border-t border-line space-y-3" aria-label="学习登记记录">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-baseline gap-1.5 text-sm font-bold text-ink-main">
            学习登记记录
            <span className="text-xs font-normal text-ink-muted">{state.records.length} 条</span>
          </h2>
          <button
            type="button"
            onClick={() => openRecordLog()}
            className="flex shrink-0 items-center gap-0.5 rounded-lg px-1 py-1 text-xs text-sage active:opacity-70"
          >
            查看全部<ChevronRight size={13} />
          </button>
        </div>

        {recentRecords.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="divide-y divide-line/60">
              {recentRecords.map(record => <StudyRecordItem
                key={record.id}
                record={record}
                name={getStudyRecordName(state, record)}
                dateLabel={studyDateLabel(record.date, activeDate)}
                onEdit={onEditRecord && canCorrectStudyRecord(state, record) ? () => onEditRecord(record) : undefined}
              />)}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-cream/35 px-4 py-6 text-center">
            <ClipboardList size={24} className="mx-auto mb-2 text-sage" />
            <p className="text-xs leading-relaxed text-ink-muted">完成日程并登记后，学习记录会显示在这里。</p>
          </div>
        )}

        {pendingHistoryCount > 0 && (
          <button
            type="button"
            onClick={() => openRecordLog(pendingHistoryDates[0])}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-potato/40 bg-potato-light/20 px-3.5 py-2.5 text-left active:scale-[0.99]"
          >
            <span className="text-xs text-ink-main">有 {pendingHistoryCount} 项历史日程还没登记</span>
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-sage">去补登记<ChevronRight size={13} /></span>
          </button>
        )}
      </section>
      <StandaloneTimerModal key={currentUser?.id ?? 'preview'} isOpen={pomodoroOpen} onClose={() => setPomodoroOpen(false)} />
      <CompanionNoteDetailModal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        note={activeNote}
        partnerAvatar={partner?.avatar}
        onReply={() => setEditModalOpen(true)}
        onPoke={() => {
          setDetailModalOpen(false);
          setPokeModalOpen(true);
        }}
        isPartnerFocusing={partner?.liveStatus?.state === 'focusing'}
        pokeCooldown={pokeCooldown}
        onOpenSharing={openSharing}
        onOpenHistory={() => setHistoryModalOpen(true)}
        onToast={onToast}
      />
      <CompanionNotesHistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        notes={allNotes}
        partnerAvatar={partner?.avatar}
        todayStr={activeDate}
        currentUserId={currentUser?.id}
        onSendHeart={handleSendHeartFromHistory}
        onReply={() => setEditModalOpen(true)}
        onPinNoteToTop={handlePinNoteToTop}
        onToast={onToast}
      />
      {partner && (
        <PokeCustomModal
          isOpen={pokeModalOpen}
          onClose={() => setPokeModalOpen(false)}
          partner={{
            id: partner.id,
            nickname: getCompanionDisplayName(partner.id, partner.nickname),
            avatar: partner.avatar,
          }}
          onSend={handleCustomPokeSend}
          isSending={poking}
          cooldownSeconds={pokeCooldown}
          onToast={onToast}
        />
      )}
      <EditCompanionNoteModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        defaultRecipientNickname={partner?.nickname || activeNote?.fromNickname || '学习伙伴'}
        defaultRecipientId={partner?.partnerId || (partner?.id?.startsWith('demo-') ? partner.id : activeNote?.fromUserId)}
        defaultGrantId={partner?.id || activeNote?.grantId}
        onNoteSent={note => {
          onToast?.(`已成功为 ${partner?.nickname || activeNote?.fromNickname || '研友'} 贴上打气便签！💌`);
        }}
        onToast={onToast}
      />
      <SharingModal
        key={`today-sharing:${currentUser?.id ?? 'guest'}`}
        isOpen={localSharingOpen && Boolean(currentUser)}
        onClose={() => setLocalSharingOpen(false)}
        onToast={onToast}
      />
    </div>
  );
};
