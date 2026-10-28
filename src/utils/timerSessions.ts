import type { AppState, TimerConfig, TimerSession, SessionRegistration } from '../types';
import type { MutatorReturn } from './workflowMutators';
import { applyAddPlan, applyCompletePlan } from './workflowMutators';

export function localDay(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function liveEnd(session: TimerSession, now: number): number {
  return session.phase === 'rest'
    ? Math.min(now, session.runningSince + Math.max(0, session.restMinutes * 60000 - session.phaseMs)) : now;
}
export function sessionSegments(session: TimerSession, now = Date.now()) {
  const segments = session.segments.slice();
  if (session.status === 'running' && session.runningSince > 0) {
    segments.push({ phase: session.phase, start: session.runningSince, end: Math.max(session.runningSince, liveEnd(session, now)) });
  }
  return segments;
}
export function sessionTotals(session: TimerSession, now = Date.now()) {
  const totals = { focusMs: 0, restMs: 0 };
  for (const segment of sessionSegments(session, now)) totals[segment.phase === 'focus' ? 'focusMs' : 'restMs'] += segment.end - segment.start;
  return totals;
}
export function sessionDays(session: TimerSession, now = Date.now()) {
  const days = new Map<string, { date: string; focusMs: number; restMs: number }>();
  for (const segment of sessionSegments(session, now)) {
    let cursor = segment.start;
    while (cursor < segment.end) {
      const boundary = new Date(cursor); boundary.setHours(24, 0, 0, 0);
      const end = Math.min(segment.end, boundary.getTime());
      const date = localDay(cursor), day = days.get(date) ?? { date, focusMs: 0, restMs: 0 };
      day[segment.phase === 'focus' ? 'focusMs' : 'restMs'] += end - cursor;
      days.set(date, day); cursor = end;
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
const error = (code: string, message: string) => ({ error: { code, message } });
const validConfig = (config: TimerConfig) => ['countup', 'countdown', 'pomodoro'].includes(config.timerMode) &&
  [config.focusMinutes, config.restMinutes].every(n => Number.isSafeInteger(n) && n > 0);
function settle(session: TimerSession, now: number) {
  if (session.status !== 'running') return;
  const end = Math.max(session.runningSince, liveEnd(session, now));
  if (end > session.runningSince) session.segments.push({ phase: session.phase, start: session.runningSince, end });
  session.phaseMs += end - session.runningSince;
  session.runningSince = 0; session.status = 'paused';
}
export function applyCreateSession(draft: AppState, config: TimerConfig, now = Date.now()): MutatorReturn<TimerSession> {
  if (!validConfig(config)) return error('INVALID_TIMER', '专注与休息时长必须为大于0的整数分钟。');
  const existing = draft.timerSessions?.find(s => s.status === 'running' || s.status === 'paused');
  if (existing) return { nextState: draft, value: existing };
  const session: TimerSession = { id: `session-${now}-${Math.random().toString(36).slice(2, 9)}`, ...config,
    phase: 'focus', phaseMs: 0, status: 'paused', createdAt: now, endedAt: 0, runningSince: 0, segments: [] };
  draft.timerSessions = [...(draft.timerSessions ?? []), session]; draft.version = 5;
  return { nextState: draft, value: session };
}
export function applySessionConfig(draft: AppState, id: string, config: TimerConfig): MutatorReturn<void> {
  const session = draft.timerSessions?.find(s => s.id === id);
  if (!session || session.status !== 'paused') return error('TIMER_BUSY', '请先暂停计时再设置。');
  if (!validConfig(config)) return error('INVALID_TIMER', '专注与休息时长必须为大于0的整数分钟。');
  Object.assign(session, config); draft.version = 5;
  return { nextState: draft, value: undefined };
}
export function applySessionAction(draft: AppState, id: string, action: 'focus' | 'rest' | 'pause' | 'finish', now = Date.now()): MutatorReturn<void> {
  const session = draft.timerSessions?.find(s => s.id === id);
  if (!session) return error('NOT_FOUND', '计时会话不存在。');
  if (['pending', 'registered', 'voided'].includes(session.status)) {
    return action === 'finish' ? { nextState: draft, value: undefined } : error('SESSION_ENDED', '本次计时已结束。');
  }
  if (action === 'focus' || action === 'rest') {
    if (draft.plans.some(p => !p.done && (p.timerStart > 0 || (p.restStart ?? 0) > 0)) ||
      draft.timerSessions?.some(s => s.id !== id && s.status === 'running')) return error('TIMER_BUSY', '请先暂停其他正在运行的计时。');
    if (session.status === 'running' && session.phase === action) return { nextState: draft, value: undefined };
  }
  settle(session, now);
  if (action === 'finish') { session.status = 'pending'; session.endedAt = now; }
  else if (action === 'focus' || action === 'rest') {
    if (session.phase !== action || (action === 'rest' && session.phaseMs >= session.restMinutes * 60000)) session.phaseMs = 0;
    session.phase = action; session.runningSince = now; session.status = 'running';
  }
  draft.version = 5;
  return { nextState: draft, value: undefined };
}
export function maintainSessionTimers(draft: AppState, now = Date.now()) {
  for (const session of draft.timerSessions ?? []) {
    if (session.status === 'running' && session.phase === 'rest' && now >= liveEnd(session, now)) {
      if (session.runningSince + Math.max(0, session.restMinutes * 60000 - session.phaseMs) <= now) settle(session, now);
    }
  }
}
export function applyRegisterSession(draft: AppState, id: string, input: SessionRegistration, now = Date.now()): MutatorReturn<string> {
  const session = draft.timerSessions?.find(s => s.id === id);
  if (!session) return error('NOT_FOUND', '计时会话不存在。');
  if (session.status === 'registered') return { nextState: draft, value: session.planId! };
  if (session.status !== 'pending') return error('SESSION_NOT_ENDED', '请先结束计时，再关联学习事项。');
  const focusMs = sessionTotals(session).focusMs;
  if (focusMs <= 0) return error('EMPTY_SESSION', '本次仅记录了休息时间，暂无学习用时可登记。');
  // Validate and complete on a copy: a bad source/lesson count cannot leave a half-created plan.
  const next = structuredClone(draft), copy = next.timerSessions!.find(s => s.id === id)!;
  const minutes = Math.max(1, Math.round(focusMs / 60000)), date = localDay(session.endedAt);
  const added = applyAddPlan(next, input.libraryId, date, minutes, input.lessons);
  if ('error' in added) return added;
  const plan = added.value;
  const completion = plan.type === 'book' ? { type: 'book' as const, planId: plan.id, minutes, questions: input.questions ?? 0, errors: input.errors ?? 0 }
    : plan.type === 'course' ? { type: 'course' as const, planId: plan.id, minutes, lessons: input.lessons ?? 0 }
    : { type: 'custom' as const, planId: plan.id, minutes };
  const completed = applyCompletePlan(next, completion, now);
  if ('error' in completed) return completed;
  const record = completed.value.record;
  const days = sessionDays(session).filter(d => d.focusMs > 0);
  let allocated = 0;
  const daily = days.map((day, index) => {
    const part = index === days.length - 1 ? minutes - allocated : Math.floor(day.focusMs / 60000);
    allocated += part;
    return { ...record, id: `${record.id}-${index}`, date: day.date, minutes: part, questions: 0, errors: 0, lessons: plan.type === 'course' ? 0 : undefined, sessionId: id };
  });
  let last = daily.find(r => r.date === date);
  if (!last) { last = { ...record, id: `${record.id}-end`, date, minutes: 0, questions: 0, errors: 0, lessons: undefined, sessionId: id }; daily.push(last); }
  last.questions = record.questions; last.errors = record.errors; last.lessons = record.lessons;
  next.records = next.records.filter(r => r.id !== record.id).concat(daily);
  plan.recordId = last.id; plan.sessionId = id; plan.accumulatedMs = focusMs;
  copy.status = 'registered'; copy.planId = plan.id; next.version = 5;
  Object.assign(draft, next);
  return { nextState: draft, value: plan.id };
}
