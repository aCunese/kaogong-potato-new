import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Tag } from '../common/UIComponents';
import { X, CheckCircle2, Award, ArrowRight, AlertCircle } from 'lucide-react';
import { Plan } from '../../types';

interface CompletionModalProps {
  plan: Plan | null;
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  initialSuccess?: boolean; // For 50-screen direct inspection of complete-success variants (Fixes A07)
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  plan,
  isOpen,
  onClose,
  onToast,
  initialSuccess = false,
}) => {
  const { completeBookPlan, completeCoursePlan, completeCustomPlan } = useApp();

  // Form states with dynamic per-task reset (Fixes A12)
  const [questions, setQuestions] = useState<number>(30);
  const [errors, setErrors] = useState<number>(0);
  const [actualMinutes, setActualMinutes] = useState<number>(30);
  const [lessons, setLessons] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Success view state
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [lastCompletedData, setLastCompletedData] = useState<{
    name: string;
    type: string;
    subject: string;
    minutes: number;
    summary: string;
  } | null>(null);

  // Sync form inputs to current plan on open to eliminate cross-task residue (Fixes A12)
  useEffect(() => {
    if (!isOpen || !plan) return;

    if (initialSuccess) {
      setIsSuccess(true);
      setLastCompletedData({
        name: plan.name,
        type: plan.type,
        subject: plan.subject,
        minutes: plan.actualMinutes || plan.plannedMinutes || 40,
        summary: plan.type === 'book'
          ? '完成 30 题 · 错题 6 道 · 正确率 80%'
          : plan.type === 'course'
          ? '完成 1 讲课时 · 重点笔记已标记'
          : '今日自定义事项已完成 · 投入专注 30 分钟',
      });
      return;
    }

    const defaultMins = plan.actualMinutes > 0 ? plan.actualMinutes : (plan.plannedMinutes || 30);
    setActualMinutes(defaultMins);
    setQuestions(plan.type === 'book' ? 20 : 0);
    setErrors(0);
    setLessons(1);
    setIsSuccess(false);
    setErrorMsg('');
  }, [isOpen, plan?.id, initialSuccess]);

  if (!isOpen || !plan) return null;

  const handleClose = () => {
    setIsSuccess(false);
    setErrorMsg('');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (plan.type === 'book') {
      if (questions < 0 || errors < 0 || actualMinutes < 0) {
        setErrorMsg('题量与用时不能为负数');
        return;
      }
      if (errors > questions) {
        setErrorMsg('错题数不能大于本次做题总数');
        return;
      }
      const res = completeBookPlan(plan.id, questions, errors, actualMinutes);
      if (!res.success) {
        setErrorMsg(res.error || '登记失败');
        return;
      }
      setLastCompletedData({
        name: plan.name,
        type: 'book',
        subject: plan.subject,
        minutes: actualMinutes,
        summary: `完成 ${questions} 题 · 错题 ${errors} 道 · 正确率 ${questions > 0 ? Math.round(((questions - errors) / questions) * 100) : 0}%`,
      });
      setIsSuccess(true);
      onToast('刷题登记已保存！');
    } else if (plan.type === 'course') {
      if (lessons <= 0 || actualMinutes < 0) {
        setErrorMsg('课时数必须大于0，用时不能为负数');
        return;
      }
      const res = completeCoursePlan(plan.id, lessons, actualMinutes);
      if (!res.success) {
        setErrorMsg(res.error || '登记失败');
        return;
      }
      setLastCompletedData({
        name: plan.name,
        type: 'course',
        subject: plan.subject,
        minutes: actualMinutes,
        summary: `听完 ${lessons} 讲课时 · 用时 ${actualMinutes} 分钟`,
      });
      setIsSuccess(true);
      onToast('网课登记已保存！');
    } else {
      if (actualMinutes < 0) {
        setErrorMsg('学习用时不能为负数');
        return;
      }
      const res = completeCustomPlan(plan.id, actualMinutes);
      if (!res.success) {
        setErrorMsg(res.error || '登记失败');
        return;
      }
      setLastCompletedData({
        name: plan.name,
        type: 'custom',
        subject: plan.subject,
        minutes: actualMinutes,
        summary: `完成自定义事项 · 累计投入 ${actualMinutes} 分钟`,
      });
      setIsSuccess(true);
      onToast('自定义事项已登记！');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-paper border border-line w-full max-w-sm rounded-3xl p-5 shadow-2xl relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-ink-muted hover:text-ink-main hover:bg-black/5 rounded-full"
        >
          <X size={18} />
        </button>

        {isSuccess ? (
          /* =========================================================================
             成功反馈页 (complete-success / complete-course-success / complete-custom-success)
             ========================================================================= */
          <div className="text-center py-3 space-y-4">
            <div className="my-2">
              <PotatoSprite pose={6} size={90} />
            </div>

            <div className="space-y-1">
              <Tag variant="sage" className="mb-1">
                <CheckCircle2 size={12} className="mr-1 inline" />
                登记成功
              </Tag>
              <h2 className="text-xl font-bold text-ink-main">又踏实进步了一步！</h2>
              <p className="text-xs text-ink-muted">数据已同步计入今日日程与学情分析库</p>
            </div>

            <div className="p-3.5 bg-cream/70 rounded-2xl border border-line text-left space-y-1.5">
              <div className="text-xs text-ink-muted font-medium flex items-center justify-between">
                <span>{lastCompletedData?.name}</span>
                <Tag variant="gray">{lastCompletedData?.subject}</Tag>
              </div>
              <div className="text-sm font-bold text-sage">
                {lastCompletedData?.summary}
              </div>
            </div>

            <Button variant="primary" size="lg" fullWidth onClick={handleClose}>
              返回今日工作台
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : (
          /* =========================================================================
             表单录入页 (complete-book / complete-course / complete-custom)
             ========================================================================= */
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <div className="flex items-center gap-2">
              <Tag variant={plan.type === 'book' ? 'potato' : plan.type === 'course' ? 'course' : 'gray'}>
                {plan.type === 'book' ? '刷题登记' : plan.type === 'course' ? '网课登记' : '事项登记'}
              </Tag>
              <Tag variant="gray">{plan.subject}</Tag>
            </div>

            <div>
              <h3 className="text-base font-bold text-ink-main truncate">{plan.name}</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                记录本次实际投入的题量与时间，供后续复盘
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-alarm-light text-alarm rounded-xl text-xs flex items-center gap-1.5 border border-red-200">
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {plan.type === 'book' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-ink-muted font-medium mb-1">本次做题数</label>
                    <input
                      type="number"
                      min="0"
                      value={questions}
                      onChange={e => setQuestions(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted font-medium mb-1">本次错题数</label>
                    <input
                      type="number"
                      min="0"
                      value={errors}
                      onChange={e => setErrors(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage text-alarm font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">实际学习分钟</label>
                  <input
                    type="number"
                    min="1"
                    value={actualMinutes}
                    onChange={e => setActualMinutes(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                  />
                </div>
              </div>
            )}

            {plan.type === 'course' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">本次完成课时</label>
                  <input
                    type="number"
                    min="1"
                    value={lessons}
                    onChange={e => setLessons(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">实际学习分钟</label>
                  <input
                    type="number"
                    min="1"
                    value={actualMinutes}
                    onChange={e => setActualMinutes(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                  />
                </div>
              </div>
            )}

            {plan.type === 'custom' && (
              <div className="space-y-3">
                <div className="p-3 bg-cream/40 rounded-xl border border-line/70 text-xs text-ink-muted space-y-1">
                  <div>事项：<span className="font-bold text-ink-main">{plan.name}</span></div>
                  <div>科目：<span className="font-bold text-ink-main">{plan.subject}</span></div>
                </div>

                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">实际学习用时 (分钟)</label>
                  <input
                    type="number"
                    min="1"
                    value={actualMinutes}
                    onChange={e => setActualMinutes(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                  />
                </div>
              </div>
            )}

            <div className="pt-2">
              <Button variant="primary" size="md" fullWidth type="submit">
                <CheckCircle2 size={16} />
                保存并完成
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
