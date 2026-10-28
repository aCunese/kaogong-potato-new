import { StandaloneTimerModal } from './StandaloneTimerModal';
import { StudyRecordsModal } from './StudyRecordsModal';
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Avatar } from '../common/Avatar';
import { StudyRecordItem } from '../common/StudyRecordItem';
import { Card, Button, Tag } from '../common/UIComponents';
import { Plus, Play, Pause, CheckCircle2, Clock, Trash2, MoreHorizontal, Sparkles, ChevronRight, ClipboardList } from 'lucide-react';
import { Plan, StudyRecord, MutationResult, TimerMode } from '../../types';
import { isPlanRunning } from '../../utils/studyTimers';
import { canCorrectStudyRecord, getPlanCompletion, getPlanElapsedMs, getStudyRecordName, studyDateLabel } from '../../utils/workflowPresentation';

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
  showProfileBar?: boolean;
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
  showProfileBar = false,
}) => {
  const { state, activeDate, startTimer, pauseTimer, deletePlan, currentUser } = useApp();
  const [, setTick] = useState(0);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsDate, setRecordsDate] = useState<string | undefined>(undefined);
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);
  const [pomodoroOpen, setPomodoroOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const runTimerAction = async (action: () => Promise<MutationResult<void>>) => {
    setErrorMsg('');
    const result = await action();
    if (!result.ok) setErrorMsg(result.message);
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
  const openRecordLog = (date?: string) => { setRecordsDate(date); setRecordsOpen(true); };
  const deleteHistoryPlan = (plan: Plan) => {
    if (onOpenDeleteConfirm) onOpenDeleteConfirm(plan);
    else void runTimerAction(() => deletePlan(plan.id));
  };

  // Determine display list based on forcedMode
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
    <div className="space-y-4 pb-24">
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
              onClick={() => setOnlyUnfinished(value => !value)}
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
                      <Tag variant="gray">{plan.subject}</Tag>
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
                      <Tag variant="gray">{plan.subject}</Tag>
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
      <StudyRecordsModal
        isOpen={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        initialDate={recordsDate}
        onEditRecord={onEditRecord}
        onOpenComplete={onOpenComplete}
        onDeletePlan={deleteHistoryPlan}
      />
      <StandaloneTimerModal key={currentUser?.id ?? 'preview'} isOpen={pomodoroOpen} onClose={() => setPomodoroOpen(false)} />
    </div>
  );
};
