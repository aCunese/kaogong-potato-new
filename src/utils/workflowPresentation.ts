import { AppState, Plan, StudyRecord } from '../types';
import { learningElapsedMs } from './studyTimers';

export function getPlanElapsedMs(plan: Plan, now = Date.now()): number {
  return learningElapsedMs(plan, now);
}

export function getCompletionMinutes(plan: Plan): number {
  const elapsed = getPlanElapsedMs(plan);
  return elapsed > 0 ? Math.max(1, Math.round(elapsed / 60000)) : 0;
}

/** Human date label for a study record ("今天", "昨天", "10月28日", "2025年12月31日"). */
export function studyDateLabel(date: string, today: string): string {
  if (date === today) return '今天';
  const parse = (value: string) => new Date(`${value}T12:00:00`);
  const current = parse(today);
  const target = parse(date);
  if (Number.isFinite(current.getTime()) && Number.isFinite(target.getTime())
    && Math.round((current.getTime() - target.getTime()) / 86_400_000) === 1) return '昨天';
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const sameYear = String(year) === today.slice(0, 4);
  return `${sameYear ? '' : `${year}年`}${month}月${day}日`;
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

/** Display name of the book/course/custom item that produced a study record. */
export function getStudyRecordName(state: AppState, record: StudyRecord): string {
  if (record.type === 'book') return state.books.find(book => book.id === record.sourceId)?.name ?? '题本已删除';
  if (record.type === 'course') return state.courses.find(course => course.id === record.sourceId)?.name ?? '网课已删除';
  return state.plans.find(plan => plan.id === record.planId)?.name
    ?? state.library.find(item => item.id === record.sourceId)?.name
    ?? '自定义学习';
}

export function canCorrectStudyRecord(state: AppState, record: StudyRecord): boolean {
  return (record.type === 'book' || record.type === 'course') && (!record.sessionId ||
    state.plans.some(p => p.sessionId === record.sessionId && p.recordId === record.id));
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

/** Shift a YYYY-MM-DD date by whole days without timezone drift. */
export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(base.getTime())) return date;
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}
