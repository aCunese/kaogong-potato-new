import type { Plan } from '../types';

export function planDayEnd(plan: Pick<Plan, 'date'>): number {
  const boundary = new Date(`${plan.date}T00:00:00`);
  boundary.setDate(boundary.getDate() + 1);
  return boundary.getTime();
}

export function learningElapsedMs(plan: Plan, now = Date.now()): number {
  const accumulated = plan.accumulatedMs ?? plan.actualMinutes * 60000;
  if (plan.timerPhase === 'rest' || !plan.timerStart) return accumulated;
  return accumulated + Math.max(0, Math.min(now, planDayEnd(plan)) - plan.timerStart);
}

export function phaseElapsedMs(plan: Plan, now = Date.now()): number {
  const resting = plan.timerPhase === 'rest';
  const start = resting ? plan.restStart : plan.timerStart;
  const elapsed = (plan.phaseAccumulatedMs ?? 0) + (start ? Math.max(0, Math.min(now, planDayEnd(plan)) - start) : 0);
  return resting ? Math.min(elapsed, (plan.restMinutes ?? 5) * 60000) : elapsed;
}

export function isPlanRunning(plan: Plan): boolean {
  return !plan.done && (plan.timerStart > 0 || (plan.restStart ?? 0) > 0);
}

export function getTimerReminder(plan: Plan, now = Date.now()): { key: string; message: string } | undefined {
  if (plan.done || plan.archived || !plan.timerMode || plan.timerMode === 'countup' || now >= planDayEnd(plan)) return;
  const rest = plan.timerPhase === 'rest';
  if (!rest && plan.timerMode === 'pomodoro') return;
  const target = (rest ? plan.restMinutes ?? 5 : plan.focusMinutes ?? plan.plannedMinutes) * 60000;
  const elapsed = rest || plan.timerMode === 'pomodoro' ? phaseElapsedMs(plan, now) : learningElapsedMs(plan, now);
  if (elapsed < target || (!rest && !plan.timerStart)) return;
  return rest
    ? { key: `${plan.id}:rest:${plan.accumulatedMs ?? 0}:${plan.restMinutes}`, message: `“${plan.name}”休息到点，等待手动开始下一轮专注。` }
    : { key: `${plan.id}:focus:${plan.timerStart}`, message: `“${plan.name}”专注到点，已继续累计；完成后请手动登记。` };
}
