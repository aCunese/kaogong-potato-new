import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Button, Tag } from '../common/UIComponents';
import { Plus, Play, Pause, CheckCircle2, Trash2, Calendar, Clock, ChevronRight } from 'lucide-react';
import { Plan } from '../../types';

interface TodayViewProps {
  onOpenAddPlan: () => void;
  onOpenFocus: (plan: Plan) => void;
  onOpenComplete: (plan: Plan) => void;
  onOpenCountdownEdit: (cdIndex: number) => void;
  forcedMode?: 'normal' | 'empty' | 'multi';
}

export const TodayView: React.FC<TodayViewProps> = ({
  onOpenAddPlan,
  onOpenFocus,
  onOpenComplete,
  onOpenCountdownEdit,
  forcedMode = 'normal',
}) => {
  const { state, activeDate, startTimer, pauseTimer, deletePlan } = useApp();
  const [, setTick] = useState(0);

  // Re-render every second to update running timer displays
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const todayPlans = state.plans.filter(p => p.date === activeDate);
  const doneCount = todayPlans.filter(p => p.done).length;
  const totalMinutes = todayPlans.reduce((sum, p) => {
    const running = p.timerStart > 0 ? Math.floor((Date.now() - p.timerStart) / 60000) : 0;
    return sum + (p.actualMinutes || 0) + running;
  }, 0);

  // Calculate days remaining
  const getDaysLeft = (dateStr: string) => {
    if (!dateStr) return '--';
    const target = new Date(dateStr + 'T00:00:00').getTime();
    const today = new Date(activeDate + 'T00:00:00').getTime();
    return Math.max(0, Math.ceil((target - today) / (1000 * 60 * 60 * 24)));
  };

  const formatTimer = (startMs: number) => {
    const sec = Math.floor((Date.now() - startMs) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Determine display list based on forcedMode
  let displayedPlans = todayPlans;
  if (forcedMode === 'empty') {
    displayedPlans = [];
  } else if (forcedMode === 'multi') {
    // Multi mode shows at least two running tasks for demonstration of multi-tasking
    displayedPlans = todayPlans.map((p, idx) => {
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

  return (
    <div className="space-y-4 pb-24">
      {/* 顶部打招呼与土豆吉祥物 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main flex items-center gap-2">
            今日日程
          </h1>
          <p className="text-xs text-ink-muted mt-1">
            从事项库挑选今天要完成的任务，正向累计学习用时
          </p>
        </div>
        <div className="cursor-pointer active:scale-95 transition-transform">
          <PotatoSprite pose={0} size={70} />
        </div>
      </div>

      {/* 三考试倒计时横排卡片 */}
      <div className="grid grid-cols-3 gap-2">
        {state.countdowns.map((cd, idx) => {
          const days = getDaysLeft(cd.date);
          return (
            <Card
              key={cd.id}
              onClick={() => onOpenCountdownEdit(idx)}
              className="p-3 bg-paper border-line text-center hover:border-sage transition-colors"
            >
              <div className="text-xs text-ink-muted font-medium">{cd.name}</div>
              <div className="text-xl font-bold text-sage my-0.5 font-mono">
                {days} <span className="text-xs font-normal text-ink-muted">天</span>
              </div>
              <div className="text-[10px] text-ink-muted/80 truncate">
                {cd.date || '点击设置'}
              </div>
            </Card>
          );
        })}
      </div>

      {/* 今日进度概览卡片 */}
      <Card className="p-4 bg-gradient-to-br from-paper to-cream/60">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-ink-main">今日备考概览</div>
          <Tag variant="sage">
            {doneCount}/{displayedPlans.length} 完成
          </Tag>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-cream/50 rounded-xl p-3 border border-line/70">
            <div className="text-xs text-ink-muted flex items-center gap-1">
              <CheckCircle2 size={13} className="text-sage" />
              已完成任务
            </div>
            <div className="text-xl font-bold text-ink-main mt-1 font-mono">
              {doneCount} <span className="text-xs font-normal text-ink-muted">/ {displayedPlans.length} 项</span>
            </div>
          </div>
          <div className="bg-cream/50 rounded-xl p-3 border border-line/70">
            <div className="text-xs text-ink-muted flex items-center gap-1">
              <Clock size={13} className="text-potato-dark" />
              实际学习用时
            </div>
            <div className="text-xl font-bold text-ink-main mt-1 font-mono">
              {totalMinutes} <span className="text-xs font-normal text-ink-muted">分钟</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 计划列表头部与操作 */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-base font-bold text-ink-main flex items-center gap-1.5">
          <span>待执行日程</span>
          <span className="text-xs font-normal text-ink-muted">({displayedPlans.length})</span>
        </h2>
        <Button variant="primary" size="sm" onClick={onOpenAddPlan}>
          <Plus size={14} />
          从事项库添加
        </Button>
      </div>

      {/* 计划列表 */}
      {displayedPlans.length === 0 ? (
        <Card className="py-12 text-center bg-paper/80 border-dashed border-line">
          <div className="flex justify-center mb-3">
            <PotatoSprite pose={7} size={84} />
          </div>
          <div className="text-base font-bold text-ink-main mb-1">今天还没有日程</div>
          <p className="text-xs text-ink-muted max-w-[240px] mx-auto mb-4">
            从题本、网课或自定义事项库中挑选一项加入今天吧
          </p>
          <Button variant="primary" size="md" onClick={onOpenAddPlan}>
            <Plus size={16} />
            挑选今日事项
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayedPlans.map(plan => {
            const isRunning = plan.timerStart > 0;
            return (
              <Card
                key={plan.id}
                className={`p-3.5 border transition-all ${
                  plan.done
                    ? 'bg-[#F8FAF5] border-sage-light opacity-90'
                    : isRunning
                    ? 'border-sage shadow-md bg-paper ring-1 ring-sage/30'
                    : 'bg-paper border-line'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <Tag variant={plan.type === 'book' ? 'potato' : plan.type === 'course' ? 'course' : 'gray'}>
                        {plan.type === 'book' ? '刷题' : plan.type === 'course' ? '网课' : '自定义'}
                      </Tag>
                      <Tag variant="gray">{plan.subject}</Tag>
                      {plan.done && (
                        <Tag variant="sage">已完成</Tag>
                      )}
                    </div>
                    <h3
                      onClick={() => !plan.done && onOpenFocus(plan)}
                      className={`text-sm font-bold truncate cursor-pointer hover:text-sage transition-colors ${
                        plan.done ? 'line-through text-ink-muted' : 'text-ink-main'
                      }`}
                    >
                      {plan.name}
                    </h3>
                    <div className="text-xs text-ink-muted mt-1 flex items-center gap-2">
                      <span>计划 {plan.plannedMinutes} 分钟</span>
                      <span>·</span>
                      <span>已累计 {plan.actualMinutes} 分钟</span>
                    </div>

                    {/* 运行中即时计时提示 */}
                    {isRunning && (
                      <div className="mt-2.5 inline-flex items-center gap-2 bg-sage-light px-2.5 py-1 rounded-md text-sage-dark font-mono text-xs font-bold animate-pulse">
                        <Clock size={12} />
                        <span>正向计时中: {formatTimer(plan.timerStart)}</span>
                      </div>
                    )}
                  </div>

                  {/* 快捷按钮操作区 */}
                  <div className="flex items-center gap-1.5 shrink-0 self-center">
                    {!plan.done ? (
                      <>
                        {isRunning ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => pauseTimer(plan.id)}
                            title="暂停计时"
                          >
                            <Pause size={14} className="text-sage" />
                            暂停
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => startTimer(plan.id)}
                            title="开始计时"
                          >
                            <Play size={14} className="text-sage" />
                            计时
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => onOpenComplete(plan)}
                        >
                          完成
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-sage font-medium flex items-center gap-1 py-1 px-2 bg-sage-light rounded-md">
                        <CheckCircle2 size={13} />
                        已登记
                      </span>
                    )}
                    <button
                      onClick={() => deletePlan(plan.id)}
                      className="p-2 text-ink-muted hover:text-alarm rounded-lg hover:bg-black/5"
                      title="删除日程"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
