/** Shared validation for cloud sync and portable backups. */
export function validateTimerSessions(state: any): string | null {
  const plans = Array.isArray(state.plans) ? state.plans : [];
  const records = Array.isArray(state.records) ? state.records : [];
  const linked = [...plans, ...records].some((r: any) => r?.sessionId !== undefined);
  if (state.timerSessions === undefined && !linked) return null;
  if (state.version !== 5) return '独立计时会话需要工作区版本5。';
  if (!Array.isArray(state.timerSessions) || state.timerSessions.length > 10000) return '计时会话必须为数组且最多10000条。';
  const ids = new Set<string>(); let unfinished = 0;
  const integer = (n: any) => Number.isSafeInteger(n) && n >= 0;
  for (const s of state.timerSessions) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || s.id.length > 128 || ids.has(s.id)) return '计时会话ID无效或重复。';
    ids.add(s.id);
    if (!['countup', 'countdown', 'pomodoro'].includes(s.timerMode) || !['focus', 'rest'].includes(s.phase) || !['paused', 'running', 'pending', 'registered', 'voided'].includes(s.status)) return '计时会话模式或状态无效。';
    if (![s.focusMinutes, s.restMinutes].every(n => integer(n) && n > 0) || ![s.phaseMs, s.createdAt, s.endedAt, s.runningSince].every(integer)) return '计时会话时长或时间戳无效。';
    if (!Array.isArray(s.segments) || s.segments.length > 20000) return '计时分段无效或过多。';
    let last = s.createdAt;
    for (const segment of s.segments) {
      if (!segment || !['focus', 'rest'].includes(segment.phase) || !integer(segment.start) || !integer(segment.end) || segment.start < last || segment.end < segment.start) return '计时分段时间无效或重叠。';
      last = segment.end;
    }
    if (s.status === 'running' ? s.runningSince <= 0 || s.runningSince < last : s.runningSince !== 0) return '计时运行时间与状态不一致。';
    if (['pending', 'registered', 'voided'].includes(s.status) && (s.endedAt < last || !s.endedAt)) return '计时结束时间无效。';
    if (['paused', 'running'].includes(s.status)) unfinished++;
    if (s.planId !== undefined && (typeof s.planId !== 'string' || !s.planId || s.planId.length > 128)) return '计时关联日程无效。';
    if (s.status === 'registered' && !plans.some((p: any) => p.id === s.planId && p.sessionId === s.id)) return '计时关联日程不存在。';
  }
  if (unfinished > 1) return '只能保留一个尚未结束的独立计时。';
  if (state.timerSessions.some((s: any) => s.status === 'running') && plans.some((p: any) => p.timerStart > 0 || p.restStart > 0)) return '独立计时与日程计时不能同时运行。';
  for (const row of [...plans, ...records]) {
    if (row.sessionId !== undefined && (typeof row.sessionId !== 'string' || !ids.has(row.sessionId))) return '学习记录关联计时不存在。';
  }
  return null;
}
