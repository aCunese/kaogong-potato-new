import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Tag } from '../common/UIComponents';
import { Play, Pause, CheckCircle2, X, Clock, Sparkles } from 'lucide-react';
import { Plan } from '../../types';

interface FocusModalProps {
  plan: Plan | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (plan: Plan) => void;
  variantOverride?: 'normal' | 'paused' | 'course' | 'custom';
}

export const FocusModal: React.FC<FocusModalProps> = ({
  plan,
  isOpen,
  onClose,
  onComplete,
  variantOverride,
}) => {
  const { state, startTimer, pauseTimer } = useApp();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen || !plan) return null;

  // Derive live plan state dynamically from context by ID (Fixes A03)
  const livePlan = state.plans.find(p => p.id === plan.id) || plan;

  const isActuallyRunning = livePlan.timerStart > 0 && variantOverride !== 'paused';
  const isPaused = livePlan.timerStart === 0 || variantOverride === 'paused';

  const totalElapsedMs = (livePlan.accumulatedMs || 0) + (isActuallyRunning ? Math.max(0, Date.now() - livePlan.timerStart) : 0);
  const totalSeconds = Math.floor(totalElapsedMs / 1000);
  const displayMinutes = Math.floor(totalSeconds / 60);
  const displaySeconds = totalSeconds % 60;
  const formattedTime = `${String(displayMinutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;
  const currentActual = Math.floor(totalElapsedMs / 60000);

  const poseIndex = livePlan.type === 'course' ? 2 : livePlan.type === 'custom' ? 7 : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="bg-paper border border-line w-full max-w-sm rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
        {/* 背景光效 */}
        <div className="absolute -top-16 -right-16 w-40 h-40 bg-sage-light/50 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-potato-light/50 rounded-full blur-2xl pointer-events-none" />

        {/* 顶部关闭 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-ink-muted hover:text-ink-main hover:bg-black/5 rounded-full"
        >
          <X size={20} />
        </button>

        {/* 标签 */}
        <div className="flex items-center gap-2 mb-3 mt-1">
          <Tag variant={livePlan.type === 'book' ? 'potato' : livePlan.type === 'course' ? 'course' : 'gray'}>
            {livePlan.type === 'book' ? '题本刷题' : livePlan.type === 'course' ? '听网课' : '自定义事项'}
          </Tag>
          <Tag variant="gray">{livePlan.subject}</Tag>
        </div>

        {/* 任务名称 */}
        <h2 className="text-lg font-bold text-ink-main max-w-[260px] truncate mb-4">
          {livePlan.name}
        </h2>

        {/* 土豆吉祥物 */}
        <div className="my-2 py-1">
          <PotatoSprite pose={poseIndex} size={96} />
        </div>

        {/* 状态指示 */}
        <div className="flex items-center gap-1.5 text-xs my-2">
          {isActuallyRunning ? (
            <span className="flex items-center gap-1 text-sage font-medium bg-sage-light px-2.5 py-1 rounded-full animate-pulse">
              <span className="w-2 h-2 rounded-full bg-sage" />
              正向计时中
            </span>
          ) : (
            <span className="flex items-center gap-1 text-ink-muted font-medium bg-[#ECE8DF] px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-ink-muted" />
              计时已暂停
            </span>
          )}
        </div>

        {/* 大时钟数字 */}
        <div className="my-3">
          <div className="text-5xl font-extrabold text-ink-main font-mono tracking-tight">
            {formattedTime}
          </div>
          <div className="text-xs text-ink-muted mt-1.5 flex items-center justify-center gap-2">
            <span>计划 {livePlan.plannedMinutes} 分钟</span>
            <span>·</span>
            <span>累计已学 {currentActual} 分钟</span>
          </div>
        </div>

        {/* 操作按钮组 */}
        <div className="w-full grid grid-cols-2 gap-3 mt-6">
          {isActuallyRunning ? (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => pauseTimer(livePlan.id)}
            >
              <Pause size={18} className="text-sage" />
              暂停
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => startTimer(livePlan.id)}
            >
              <Play size={18} />
              继续计时
            </Button>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={async () => {
              let finalPlan = livePlan;
              if (isActuallyRunning) {
                await pauseTimer(livePlan.id);
                finalPlan = {
                  ...livePlan,
                  timerStart: 0,
                  accumulatedMs: totalElapsedMs,
                  actualMinutes: Math.floor(totalElapsedMs / 60000),
                };
              }
              onComplete(finalPlan);
            }}
          >
            <CheckCircle2 size={18} />
            完成打卡
          </Button>
        </div>
      </div>
    </div>
  );
};
