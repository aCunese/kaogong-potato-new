import type { AppState, Plan } from '../types';

export const PLAN_EXTENSION_KEYS = ['plannedLessons', 'timerMode', 'focusMinutes', 'restMinutes', 'timerPhase', 'phaseAccumulatedMs', 'restStart', 'archived'] as const;

/** Shared by server sync and portable backup import, so new fields cannot disappear in either path. */
export function validateStudyExtensions(state: any): string | null {
  const records = Array.isArray(state.records) ? state.records : [];
  const hasFields = records.some((r: any) => r && r.sourceApplied !== undefined) || state.todos !== undefined || (Array.isArray(state.plans) && state.plans.some((p: any) => p && PLAN_EXTENSION_KEYS.some(k => p[k] !== undefined)));
  if (hasFields && state.version !== 4) return '待办和新版计时字段需要工作区版本4，请更新客户端。';
  if (state.todos !== undefined) {
    if (!Array.isArray(state.todos) || state.todos.length > 5000) return '待办必须为数组且最多5000条。';
    const ids = new Set<string>();
    for (const todo of state.todos) {
      if (!todo || typeof todo !== 'object' || typeof todo.id !== 'string' || !todo.id || todo.id.length > 128 || ids.has(todo.id)) return '待办ID无效或重复。';
      ids.add(todo.id);
      if (typeof todo.text !== 'string' || !todo.text.trim() || todo.text.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(todo.date) || typeof todo.done !== 'boolean') return '待办内容、日期或完成状态无效。';
      if (![todo.createdAt, todo.completedAt].every(v => Number.isSafeInteger(v) && v >= 0)) return '待办时间戳无效。';
    }
  }
  for (const record of records) {
    if (record?.sourceApplied !== undefined && typeof record.sourceApplied !== 'boolean') return '学习记录来源增量标记无效。';
  }
  for (const plan of Array.isArray(state.plans) ? state.plans : []) {
    if (!plan || typeof plan !== 'object') continue;
    if (plan.timerMode !== undefined && !['countup', 'countdown', 'pomodoro'].includes(plan.timerMode)) return '计时模式无效。';
    if (plan.timerPhase !== undefined && !['focus', 'rest'].includes(plan.timerPhase)) return '计时阶段无效。';
    if (plan.archived !== undefined && typeof plan.archived !== 'boolean') return '日程归档状态无效。';
    for (const k of ['plannedLessons', 'focusMinutes', 'restMinutes']) {
      if (plan[k] !== undefined && (!Number.isSafeInteger(plan[k]) || plan[k] <= 0)) return `${k} 必须为正整数。`;
    }
    for (const k of ['phaseAccumulatedMs', 'restStart']) {
      if (plan[k] !== undefined && (typeof plan[k] !== 'number' || !Number.isFinite(plan[k]) || plan[k] < 0)) return `${k} 必须为有限非负数。`;
    }
  }
  return null;
}

export function planExtensions(plan: Plan): Partial<Plan> {
  return Object.fromEntries(PLAN_EXTENSION_KEYS.filter(k => plan[k] !== undefined).map(k => [k, plan[k]]));
}
