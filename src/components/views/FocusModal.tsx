import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, CheckCircle2, X, Coffee } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Button, Tag } from '../common/UIComponents';
import { Plan, MutationResult, TimerMode } from '../../types';
import { getPlanElapsedMs } from '../../utils/workflowPresentation';
import { isPlanRunning, phaseElapsedMs } from '../../utils/studyTimers';

interface FocusModalProps {
  plan: Plan | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (plan: Plan) => void;
  initialTimerMode?: TimerMode;
  variantOverride?: 'normal' | 'paused' | 'course' | 'custom';
}
const format = (ms: number) => {
  const sec = Math.floor(Math.abs(ms) / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

export const FocusModal: React.FC<FocusModalProps> = ({ plan, isOpen, onClose, onComplete, variantOverride, initialTimerMode }) => {
  const { state, startTimer, pauseTimer, configureTimer, switchTimerPhase } = useApp();
  const [, tick] = useState(0);
  const [mode, setMode] = useState<TimerMode>('countup');
  const [focus, setFocus] = useState('25');
  const [rest, setRest] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reminded = useRef('');
  const live = state.plans.find(p => p.id === plan?.id) ?? plan;
  useEffect(() => {
    if (!isOpen || !live) return;
    const desired = isPlanRunning(live) ? live.timerMode ?? 'countup' : initialTimerMode ?? live.timerMode ?? 'countup';
    setMode(desired);
    setFocus(String(desired === 'pomodoro' && live.timerMode !== 'pomodoro' ? 25 : live.focusMinutes ?? live.plannedMinutes));
    setRest(String(live.restMinutes ?? 5)); setError('');
  }, [isOpen, plan?.id, initialTimerMode]);
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);
  const elapsed = live ? getPlanElapsedMs(live) : 0;
  const isRest = live?.timerPhase === 'rest';
  const phaseElapsed = live ? phaseElapsedMs(live) : 0;
  const target = (isRest ? live?.restMinutes ?? 5 : live?.focusMinutes ?? live?.plannedMinutes ?? 25) * 60000;
  const phaseTime = live?.timerMode === 'pomodoro' || isRest ? phaseElapsed : elapsed;
  const timed = live?.timerMode === 'pomodoro' || live?.timerMode === 'countdown';
  const reached = Boolean(timed && phaseTime >= target);
  if (!isOpen || !live) return null;
  const running = isPlanRunning(live) && variantOverride !== 'paused';
  const dirty = mode !== (live.timerMode ?? 'countup') || Number(focus) !== (live.focusMinutes ?? (live.timerMode === 'pomodoro' ? 25 : live.plannedMinutes)) || Number(rest) !== (live.restMinutes ?? 5);
  const valid = [focus, rest].every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0);
  const run = async (action: () => Promise<MutationResult<void>>) => {
    if (busy) return false;
    setBusy(true); setError('');
    try { const result = await action(); if (!result.ok) setError(result.message); return result.ok; }
    catch { setError('操作未保存，请重试。'); return false; }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
    <div role="dialog" aria-modal="true" aria-label="专注计时" className="relative bg-paper w-full max-w-sm rounded-3xl p-6 max-h-[90dvh] overflow-y-auto text-center">
      <button aria-label="关闭计时面板" onClick={onClose} className="absolute top-3 right-3 p-2 text-ink-muted"><X size={20} /></button>
      <Tag variant={live.type === 'course' ? 'course' : 'potato'}>{live.type === 'book' ? '题本刷题' : live.type === 'course' ? '听网课' : '自定义事项'}</Tag>
      <h2 className="text-lg font-bold mt-3 mb-2 break-words">{live.name}</h2>
      {!live.archived && <fieldset disabled={running || busy} className="text-left space-y-2 mt-4 disabled:opacity-60">
        <p className="text-xs text-ink-muted">计时模式（暂停后可设置）</p>
        <div role="group" aria-label="计时模式" className="grid grid-cols-3 gap-1 rounded-xl bg-cream p-1">
          {([['countup', '正计时'], ['countdown', '倒计时'], ['pomodoro', '专注时间']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setFocus(String(value === 'pomodoro' ? 25 : live.plannedMinutes)); }} className={`rounded-lg py-2 text-xs ${mode === value ? 'bg-sage text-white font-bold' : 'text-ink-muted'}`}>{label}</button>)}
        </div>
        {mode !== 'countup' && <div className="flex gap-2">
          <label className="flex-1 min-w-0 text-xs text-ink-muted">专注分钟<input aria-label="专注分钟" type="number" min="1" step="1" value={focus} onChange={e => setFocus(e.target.value)} className="mt-1 w-full border border-line rounded-lg p-2 bg-paper" /></label>
          {mode === 'pomodoro' && <label className="flex-1 min-w-0 text-xs text-ink-muted">休息分钟<input aria-label="休息分钟" type="number" min="1" step="1" value={rest} onChange={e => setRest(e.target.value)} className="mt-1 w-full border border-line rounded-lg p-2 bg-paper" /></label>}
        </div>}
        {dirty && <Button size="sm" disabled={!valid || busy} onClick={() => void run(() => configureTimer(live.id, { timerMode: mode, focusMinutes: Number(focus), restMinutes: Number(rest) }))}>应用计时设置</Button>}
      </fieldset>}
      <div className="flex justify-center"><PotatoSprite pose={isRest ? 7 : live.type === 'course' ? 2 : 1} size={88} /></div>
      <p className="text-xs text-sage my-2">{isRest ? '休息阶段 · 不计学习用时' : running ? `${live.timerMode === 'countdown' ? '倒计时' : live.timerMode === 'pomodoro' ? '番茄专注' : '正计时'}进行中` : '计时已暂停'}</p>
      <div className="text-5xl font-extrabold font-mono my-3">{timed ? `${!isRest && reached ? '+' : ''}${format(target - phaseTime)}` : format(elapsed)}</div>
      <p role="status" aria-live="polite" className="text-xs text-sage min-h-5">{isRest && reached ? '休息结束，点击开始下一轮专注' : reached ? '时间到，正在继续累计；完成后请手动登记' : running ? '专注当下，按自己的节奏完成' : '准备好后继续'}</p>
      <p className="text-xs text-ink-muted my-3">计划 {live.plannedMinutes} 分钟 · 累计已学 {Math.floor(elapsed / 60000)} 分钟</p>
      {live.archived && <p className="text-xs text-alarm">这项日程已归入 {live.date}，可补登记，继续学习请新建今日日程。</p>}
      {error && <p role="alert" className="text-xs text-alarm mt-3">{error}</p>}
      <div className="grid grid-cols-2 gap-2 mt-5">
        {!live.archived && <Button variant="secondary" disabled={busy || (!running && (dirty || !valid))} onClick={() => void run(() => running ? pauseTimer(live.id) : isRest && reached ? switchTimerPhase(live.id, 'focus') : startTimer(live.id))}>{running ? <Pause size={16} /> : <Play size={16} />}{running ? '暂停' : isRest && reached ? '开始专注' : '开始计时'}</Button>}
        <Button disabled={busy} onClick={async () => { if (isPlanRunning(live) && !await run(() => pauseTimer(live.id))) return; onComplete(live); }}><CheckCircle2 size={16} />完成登记</Button>
      </div>
      {live.timerMode === 'pomodoro' && !live.archived && <Button variant="light" fullWidth className="mt-2" disabled={busy || dirty} onClick={() => void run(() => switchTimerPhase(live.id, isRest ? 'focus' : 'rest'))}><Coffee size={16} />{isRest ? '开始下一轮专注' : '进入休息'}</Button>}
    </div>
  </div>;
};
