import { Plan, StudyRecord } from '../types';
import { learningElapsedMs } from './studyTimers';

export function getPlanElapsedMs(plan: Plan, now = Date.now()): number {
  return learningElapsedMs(plan, now);
}

export function getCompletionMinutes(plan: Plan): number {
  const elapsed = getPlanElapsedMs(plan);
  return elapsed > 0 ? Math.max(1, Math.round(elapsed / 60000)) : 0;
}

export function getCompletionSummary(record: StudyRecord): string {
  if (record.type === 'book') {
    const accuracy = record.questions > 0 ? Math.round(((record.questions - record.errors) / record.questions) * 100) : 0;
    return `完成 ${record.questions} 题 · 错题 ${record.errors} 道 · 正确率 ${accuracy}%`;
  }
  if (record.type === 'course') {
    return `听完 ${record.lessons ?? 0} 节 · 用时 ${record.minutes} 分钟`;
  }
  return `完成自定义事项 · 累计投入 ${record.minutes} 分钟`;
}

export type AnalysisRange = '30' | '90' | 'all';

export function filterAnalysisRecords<T extends { date: string }>(records: T[], range: AnalysisRange, today: string): T[] {
  if (range === 'all') return records;
  // Use local calendar dates so midnight and daylight-saving changes cannot shift the range.
  const start = new Date(`${today}T12:00:00`);
  start.setDate(start.getDate() - (Number(range) - 1));
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return records.filter(record => record.date >= startDate && record.date <= today);
}

/** A cross-day session has per-day records, but its completion summary describes the whole plan. */
export function getPlanCompletion(plan: Plan, records: StudyRecord[]) {
  const record = records.find(r => r.id === plan.recordId) ?? records.find(r => r.planId === plan.id);
  const minutes = plan.sessionId ? plan.actualMinutes : record?.minutes ?? plan.actualMinutes;
  return { record, minutes, summary: record ? getCompletionSummary({ ...record, minutes }) : '该计划未关联可用的学习记录' };
}
