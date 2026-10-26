import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Avatar } from '../common/Avatar';
import { Card, Button, Tag } from '../common/UIComponents';
import { Plus, Play, Pause, CheckCircle2, Clock, Trash2, MoreHorizontal, Sparkles } from 'lucide-react';
import { Plan, MutationResult } from '../../types';
import { getPlanElapsedMs } from '../../utils/workflowPresentation';

interface TodayViewProps {
  forcedMode?: 'normal' | 'empty' | 'multi';
  onOpenAddPlan: () => void;
  onOpenFocus: (plan: Plan) => void;
  onOpenComplete: (plan: Plan) => void;
  onOpenCountdownEdit: (index: number) => void;
  onOpenDeleteConfirm?: (plan: Plan) => void;
  onOpenProfile?: () => void;
  showProfileBar?: boolean;
}

export const TodayView: React.FC<TodayViewProps> = ({
  forcedMode = 'normal',
  onOpenAddPlan,
  onOpenFocus,
  onOpenComplete,
  onOpenCountdownEdit,
  onOpenDeleteConfirm,
  onOpenProfile,
  showProfileBar = false,
}) => {
  const { state, activeDate, startTimer, pauseTimer, deletePlan } = useApp();
  const [, setTick] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const runTimerAction = async (action: () => Promise<MutationResult<void>>) => {
    setErrorMsg('');
    const result = await action();
    if (!result.ok) setErrorMsg(result.message);
  };

  // Keep live timer tick
  useEffect(() => {
    const hasRunning = state.plans.some(p => p.timerStart > 0 && !p.done);
    if (!hasRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [state.plans]);

  // Filter plans for today, PLUS any unfinished cross-day plans
  const relevantPlans = state.plans.filter(
    p => p.date === activeDate || (!p.done && p.date < activeDate && (p.timerStart > 0 || (p.accumulatedMs && p.accumulatedMs > 0)))
  );

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
  const totalElapsedMs = displayedPlans.reduce((sum, p) => {
    const elapsed = getPlanElapsedMs(p);
    return sum + elapsed;
  }, 0);
  const totalMinutes = Math.floor(totalElapsedMs / 60000);

  // Calculate days left for countdowns
  const getDaysLeft = (targetDate: string) => {
    if (!targetDate) return '--';
    const today = new Date(activeDate + 'T00:00:00');
    const target = new Date(targetDate + 'T00:00:00');
    const diff = target.getTime() - today.getTime();
    const days = Math.ceil(diff / (1000 * 3600 * 24));
    return days >= 0 ? days : 0;
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

      {/* 2. 原设计次序：倒计时轻量网格紧随大汇总卡下方 (Fixes A08) */}
      <div className="bg-paper border border-line rounded-2xl p-2.5 shadow-sm grid grid-cols-3 divide-x divide-line/70">
        {state.countdowns.map((cd, idx) => {
          const days = getDaysLeft(cd.date);
          return (
            <div
              key={cd.id}
              onClick={() => onOpenCountdownEdit(idx)}
              className="px-2 py-1 text-center cursor-pointer hover:bg-cream/50 rounded-xl transition-colors"
            >
              <div className="text-[11px] text-ink-muted font-medium">{cd.name}</div>
              <div className="text-lg font-extrabold text-sage font-mono my-0.5">
                {days} <span className="text-[11px] font-normal text-ink-muted">天</span>
              </div>
              <div className="text-[10px] text-ink-muted/80 truncate">
                {cd.date || '设置日期'}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. 待执行日程列表头部 */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-base font-bold text-ink-main flex items-center gap-1.5">
          <span>今日日程</span>
          <span className="text-xs font-normal text-ink-muted">({displayedPlans.length})</span>
        </h2>
        <Button variant="primary" size="sm" onClick={onOpenAddPlan}>
          <Plus size={14} />
          从事项库挑选
        </Button>
      </div>

      {/* 4. 计划列表 */}
      {displayedPlans.length === 0 ? (
        <Card className="py-12 text-center bg-paper/80 border-dashed border-line">
          <div className="flex justify-center mb-3">
            <PotatoSprite pose={7} size={84} />
          </div>
          <div className="text-base font-bold text-ink-main mb-1">今天还没有日程</div>
          <p className="text-xs text-ink-muted max-w-[240px] mx-auto mb-4 leading-relaxed">
            从题本、网课或自定义事项库中挑选一项加入今天吧
          </p>
          <Button variant="primary" size="md" onClick={onOpenAddPlan}>
            <Plus size={16} />
            挑选今日事项
          </Button>
        </Card>
      ) : (
        <div className="space-y-3.5">
          {displayedPlans.map(plan => {
            const isRunning = plan.timerStart > 0;
            return (
              <Card
                key={plan.id}
                className={`p-4 border transition-all rounded-[20px] ${
                  plan.done
                    ? 'bg-[#F8FAF5] border-sage-light opacity-90'
                    : isRunning
                    ? 'border-sage shadow-md bg-paper ring-1 ring-sage/30'
                    : 'bg-paper border-line'
                }`}
              >
                {/* 顶栏：标签 + 标题 + 右上角操作 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <Tag variant={plan.type === 'book' ? 'potato' : plan.type === 'course' ? 'course' : 'gray'}>
                        {plan.type === 'book' ? '刷题' : plan.type === 'course' ? '网课' : '自定义'}
                      </Tag>
                      <Tag variant="gray">{plan.subject}</Tag>
                      {plan.date !== activeDate && (
                        <Tag variant="danger">跨日 · {plan.date}</Tag>
                      )}
                      {plan.done && <Tag variant="sage">已完成</Tag>}
                    </div>

                    <h3
                      onClick={() => !plan.done && onOpenFocus(plan)}
                      className={`text-base font-bold truncate cursor-pointer hover:text-sage transition-colors ${
                        plan.done ? 'line-through text-ink-muted' : 'text-ink-main'
                      }`}
                    >
                      {plan.name}
                    </h3>
                  </div>

                  {/* 右上角更多操作按钮 */}
                  <button
                    onClick={() => {
                      if (onOpenDeleteConfirm) {
                        onOpenDeleteConfirm(plan);
                      } else {
                        deletePlan(plan.id);
                      }
                    }}
                    className="p-1.5 text-ink-muted hover:text-alarm rounded-lg hover:bg-black/5 shrink-0"
                    title="移除日程"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>

                {/* 次行：计划与累计指标 */}
                <div className="text-xs text-ink-muted mt-1.5 flex items-center gap-2">
                  <span>计划 {plan.plannedMinutes} 分钟</span>
                  <span>·</span>
                  <span>已累计 {Math.floor(getPlanElapsedMs(plan) / 60000)} 分钟</span>
                </div>

                {/* 正在计时状态：原版大数字行展示 (Fixes A08) */}
                {isRunning && (
                  <div
                    onClick={() => !plan.done && onOpenFocus(plan)}
                    className="mt-3 p-2.5 bg-sage-light/70 rounded-xl flex items-center justify-between cursor-pointer hover:bg-sage-light transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-sage-dark">
                      <span className="w-2.5 h-2.5 rounded-full bg-sage animate-ping" />
                      <span>正在专注进行中</span>
                    </div>
                    <div className="text-xl font-mono font-extrabold text-sage-dark tracking-tight">
                      {formatTimer(plan.timerStart, plan.accumulatedMs ?? plan.actualMinutes * 60000)}
                    </div>
                  </div>
                )}

                {/* 底部操作区：原版 1:1 双大按钮铺满卡片底部 (Fixes A08) */}
                {!plan.done ? (
                  <div className="grid grid-cols-2 gap-2.5 mt-3.5 pt-2 border-t border-line/50">
                    {isRunning ? (
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        onClick={() => runTimerAction(() => pauseTimer(plan.id))}
                      >
                        <Pause size={16} className="text-sage" />
                        暂停计时
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        onClick={() => runTimerAction(() => startTimer(plan.id))}
                      >
                        <Play size={16} className="text-sage" />
                        开始计时
                      </Button>
                    )}

                    <Button
                      variant="primary"
                      size="md"
                      fullWidth
                      onClick={() => onOpenComplete(plan)}
                    >
                      <CheckCircle2 size={16} />
                      完成登记
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 pt-2 border-t border-line/40 flex items-center justify-between text-xs text-sage font-medium">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={14} />
                      今日学习目标已达成
                    </span>
                    <button
                      onClick={() => onOpenComplete(plan)}
                      className="text-ink-muted hover:text-ink-main underline text-[11px]"
                    >
                      查看登记总结
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
