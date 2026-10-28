import { parseIntegerDraft } from '../../utils/numericDraft';
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Tag } from '../common/UIComponents';
import { X, CheckCircle2, Award, ArrowRight, AlertCircle, Camera } from 'lucide-react';
import { Plan, StudyRecord } from '../../types';
import { canCorrectStudyRecord, getCompletionMinutes, getCompletionSummary, getPlanCompletion } from '../../utils/workflowPresentation';

interface CompletionModalProps {
  plan: Plan | null;
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  initialSuccess?: boolean; // For 50-screen direct inspection of complete-success variants (Fixes A07)
  onOpenPhotoImport?: (target: { bookId: string; date: string }) => void;
  onEditRecord?: (record: StudyRecord) => void;
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  plan,
  isOpen,
  onClose,
  onToast,
  initialSuccess = false,
  onOpenPhotoImport,
  onEditRecord,
}) => {
  const { state, completePlan, pauseTimer, activeDate } = useApp();
  const livePlan = state.plans.find(item => item.id === plan?.id) || plan;

  // Form states with dynamic per-task reset (Fixes A12)
  const [questions, setQuestions] = useState('0');
  const [errors, setErrors] = useState('0');
  const actualMinutes = livePlan ? getCompletionMinutes(livePlan) : 0;
  const [lessons, setLessons] = useState(String(plan?.plannedLessons ?? 1));
  const liveCourse = state.courses.find(course => course.id === livePlan?.sourceId);
  const remainingLessons = liveCourse ? liveCourse.totalLessons - liveCourse.completedLessons : 0;
  const validLessons = /^\d+$/.test(lessons) && Number.isSafeInteger(Number(lessons)) && Number(lessons) > 0 && Number(lessons) <= remainingLessons;
  const parsedQuestions = parseIntegerDraft(questions), parsedErrors = parseIntegerDraft(errors, 'nonnegative');
  const validQuestions = parsedQuestions !== null && parsedErrors !== null && parsedErrors <= parsedQuestions;
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [preparedPlanId, setPreparedPlanId] = useState('');
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Success view state
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [completedRecord, setCompletedRecord] = useState<StudyRecord | null>(null);
  const [lastCompletedData, setLastCompletedData] = useState<{
    name: string;
    type: string;
    subject: string;
    minutes: number;
    summary: string;
  } | null>(null);

  // Pause before preparing the form; wait for the persisted live plan before deriving minutes.
  useEffect(() => {
    if (!isOpen || !livePlan) return;
    let cancelled = false;
    setPreparedPlanId('');
    setIsSubmitting(false);
    setErrorMsg('');
    setQuestions('0');
    setErrors('0');
    setLessons(String(livePlan.plannedLessons ?? 1));
    setIsSuccess(false);
    setCompletedRecord(null);

    if (livePlan.done || initialSuccess) {
      const display = getPlanCompletion(livePlan, state.records);
      if (display.record) setCompletedRecord(display.record);
      setLastCompletedData({ name: livePlan.name, type: livePlan.type, subject: display.record?.subject || livePlan.subject, minutes: display.minutes, summary: display.summary });
      setIsSuccess(true);
      return;
    }

    if ((livePlan.timerStart > 0 || (livePlan.restStart ?? 0) > 0)) {
      pauseTimer(livePlan.id).then(result => {
        if (!cancelled && !result.ok) setErrorMsg(result.message);
      });
    }
    return () => { cancelled = true; };
  }, [isOpen, plan?.id, initialSuccess, prepareAttempt]);

  useEffect(() => {
    if (!isOpen || !livePlan || livePlan.done || initialSuccess || (livePlan.timerStart > 0 || (livePlan.restStart ?? 0) > 0) || preparedPlanId === livePlan.id) return;
    setPreparedPlanId(livePlan.id);
  }, [isOpen, livePlan, initialSuccess, preparedPlanId]);

  const successRecord = state.records.find(r => r.id === completedRecord?.id)
    ?? (livePlan ? getPlanCompletion(livePlan, state.records).record : undefined);
  if (!isOpen || !plan) return null;

  const handleClose = () => {
    setIsSuccess(false);
    setCompletedRecord(null);
    setErrorMsg('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || preparedPlanId !== plan.id || livePlan?.timerStart || livePlan?.restStart || livePlan?.done) return;
    setErrorMsg('');
    if (!Number.isSafeInteger(actualMinutes) || actualMinutes <= 0) {
      setErrorMsg('学习用时必须为大于0的整数分钟');
      return;
    }

    let res;

    if (plan.type === 'book') {
      if (!validQuestions) {
        setErrorMsg('本次做题数须为正整数，错题数须为不超过做题数的非负整数');
        return;
      }
      if (Number(parsedErrors) > Number(parsedQuestions)) {
        setErrorMsg('错题数不能大于本次做题总数');
        return;
      }
      setIsSubmitting(true);
      res = await completePlan({
        type: 'book',
        planId: plan.id,
        questions: parsedQuestions!,
        errors: parsedErrors!,
        minutes: actualMinutes,
      });
    } else if (plan.type === 'course') {
      if (!validLessons || actualMinutes < 0) {
        setErrorMsg(`本次节数须为正整数，且不能超过剩余 ${Math.max(0, remainingLessons)} 节`);
        return;
      }
      setIsSubmitting(true);
      res = await completePlan({
        type: 'course',
        planId: plan.id,
        lessons: Number(lessons),
        minutes: actualMinutes,
      });
    } else {
      if (actualMinutes < 0) {
        setErrorMsg('学习用时不能为负数');
        return;
      }
      setIsSubmitting(true);
      res = await completePlan({
        type: 'custom',
        planId: plan.id,
        minutes: actualMinutes,
      });
    }

    setIsSubmitting(false);
    if (!res.ok) {
      setErrorMsg(res.message);
      return;
    }

    const record = res.value.record;
    setCompletedRecord(record);
    setLastCompletedData({
      name: plan.name,
      type: plan.type,
      subject: plan.subject,
      minutes: record.minutes,
      summary: getCompletionSummary(record),
    });
    setIsSuccess(true);
    onToast(plan.type === 'book' ? '刷题登记已保存！' : plan.type === 'course' ? '网课登记已保存！' : '自定义事项已登记！');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="完成登记"
        className="bg-paper border border-line w-full max-w-sm rounded-3xl p-5 shadow-2xl relative max-h-[90dvh] overflow-y-auto"
      >
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
                <div className="flex items-center gap-1.5">
                  {plan.date !== activeDate && (
                    <span className="text-[11px] text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded font-normal">
                      计入原计划日期: {plan.date}
                    </span>
                  )}
                  <Tag variant="gray">{lastCompletedData?.subject}</Tag>
                </div>
              </div>
              <div className="text-sm font-bold text-sage">
                {successRecord ? getCompletionSummary(successRecord.type === 'course' ? { ...successRecord, minutes: livePlan?.actualMinutes ?? successRecord.minutes } : successRecord) : lastCompletedData?.summary}
              </div>
            </div>

            {successRecord && onEditRecord && canCorrectStudyRecord(state, successRecord) && <Button fullWidth variant="secondary" onClick={() => onEditRecord(successRecord)}>修改本次登记</Button>}
            {Boolean(
              successRecord &&
              successRecord.type === 'book' &&
              successRecord.errors > 0 &&
              state.books.some(b => b.id === successRecord.sourceId) &&
              onOpenPhotoImport
            ) ? (
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => {
                    if (successRecord) {
                      const target = {
                        bookId: successRecord.sourceId,
                        date: successRecord.date,
                      };
                      handleClose();
                      onOpenPhotoImport?.(target);
                    }
                  }}
                  className="bg-potato/20 border-potato text-ink-main hover:bg-potato/30 flex items-center justify-center gap-2"
                >
                  <Camera size={16} />
                  拍下错题
                </Button>
                <Button variant="primary" size="lg" fullWidth onClick={handleClose}>
                  返回今日工作台
                  <ArrowRight size={16} />
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="lg" fullWidth onClick={handleClose}>
                返回今日工作台
                <ArrowRight size={16} />
              </Button>
            )}
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
              {plan.date !== activeDate && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200 inline-flex items-center gap-1 font-medium">
                  <span>计入原计划日期: {plan.date}</span>
                </div>
              )}
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
                      min="1"
                      aria-label="本次做题数" required step="1" value={questions}
                      onChange={e => setQuestions(e.target.value)}
                      className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted font-medium mb-1">本次错题数</label>
                    <input
                      type="number"
                      min="0"
                      aria-label="本次错题数" required step="1" value={errors}
                      onChange={e => setErrors(e.target.value)}
                      className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage text-alarm font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">实际学习分钟</label>
                  <output aria-label="实际学习分钟（自动记录）" className="block px-3 py-2.5 bg-sage-light/50 rounded-xl text-sm font-mono">{actualMinutes} 分钟 · 自动记录</output>
                </div>
              </div>
            )}

            {plan.type === 'course' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">本次完成节数</label>
                  <input
                    type="number"
                    min="1"
                    max={remainingLessons}
                    value={lessons}
                    onChange={e => setLessons(e.target.value)}
                    aria-label="本次完成节数"
                    required
                    step="1"
                    className="w-full px-3 py-2 bg-cream/60 border border-line rounded-xl text-sm font-mono focus:outline-none focus:border-sage"
                  />
                </div>

                <div>
                  <label className="block text-xs text-ink-muted font-medium mb-1">实际学习分钟</label>
                  <output aria-label="实际学习分钟（自动记录）" className="block px-3 py-2.5 bg-sage-light/50 rounded-xl text-sm font-mono">{actualMinutes} 分钟 · 自动记录</output>
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
                  <output aria-label="实际学习分钟（自动记录）" className="block px-3 py-2.5 bg-sage-light/50 rounded-xl text-sm font-mono">{actualMinutes} 分钟 · 自动记录</output>
                </div>
              </div>
            )}

            <p className="text-xs text-ink-muted">用时来自本次计时，不能手动修改。{actualMinutes <= 0 ? '请先开始计时，学习后再完成登记。' : ''}</p>
            <div className="pt-2">
              {errorMsg && livePlan?.timerStart ? (
                <Button variant="secondary" size="md" fullWidth onClick={() => setPrepareAttempt(value => value + 1)}>
                  重试暂停计时
                </Button>
              ) : null}
              <Button variant="primary" size="md" fullWidth type="submit" disabled={isSubmitting || preparedPlanId !== plan.id || Boolean(livePlan?.timerStart) || actualMinutes <= 0 || (plan.type === 'book' && !validQuestions) || (plan.type === 'course' && !validLessons)}>
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
