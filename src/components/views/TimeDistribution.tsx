import React from 'react';
import { Card } from '../common/UIComponents';
import { SUBJECTS, STUDY_SUBJECTS, StudyRecord, TimerSession } from '../../types';
import { AnalysisRange } from '../../utils/workflowPresentation';
import { getSessionAnalysis } from '../../utils/sessionAnalysis';
export const SUBJECT_COLORS = ['#1F77B4','#FF7F0E','#2CA02C','#D62728','#9467BD','#8C564B','#C43C8F','#087F8C','#8E9685'];
export type AnalysisCategory = 'course' | 'book' | 'custom' | 'sessions';
export function TimeDistribution({ records, sessions, range, today, onLegend, view, onViewChange }: { records:StudyRecord[]; sessions:TimerSession[]; range:AnalysisRange; today:string; onLegend:()=>void; view:AnalysisCategory; onViewChange:(view:AnalysisCategory)=>void }) {
  const session = getSessionAnalysis(sessions, range, today);
  const subjects = view === 'custom' ? STUDY_SUBJECTS : SUBJECTS;
  const data = view !== 'sessions' ? subjects.map((label, index) => ({ label, color: SUBJECT_COLORS[index], minutes: records.filter(r => r.type === view && r.subject === label).reduce((n, r) => n + r.minutes, 0) }))
    : [{label:'专注时间',minutes:session.focusMs/60000,color:'#607C4E'},{label:'休息时间',minutes:session.restMs/60000,color:'#DEA64A'}];
  const total = data.reduce((n, d) => n + d.minutes, 0);
  let cumulative = 0;
  const gradient = data.map(d => { const start = cumulative; cumulative += total ? d.minutes / total * 100 : 0; return `${d.color} ${start}% ${cumulative}%`; }).join(',');
  const number = (n: number) => Number(n.toFixed(1));
  const title = view === 'sessions' ? '专注与休息分配' : view === 'custom' ? '自定义学习用时分布' : view === 'course' ? '网课八科用时分布' : '题本八科用时分布';
  const label = view === 'sessions' ? '专注与休息' : view === 'custom' ? '自定义学习' : view === 'course' ? '网课学习' : '题本学习';
  const unitLabel = view === 'sessions' ? '专注＋休息' : view === 'custom' ? '自定义用时' : view === 'course' ? '网课用时' : '题本用时';
  return <section aria-label="用时分布"><Card className="p-4 space-y-4">
    <div className="flex justify-between gap-2"><h3 className="text-sm font-bold">{title}</h3>{view !== 'sessions' && <button onClick={onLegend} className="text-xs text-sage shrink-0">图例与明细</button>}</div>
    <div role="group" aria-label="用时分布维度" className="grid grid-cols-2 bg-cream rounded-xl p-1 gap-1">{([['course','网课学习'],['book','题本学习'],['custom','自定义学习'],['sessions','专注与休息']] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => onViewChange(value)} className={`rounded-lg py-2 text-xs ${view === value ? 'bg-paper text-sage font-bold shadow-sm' : 'text-ink-muted'}`}>{text}</button>)}</div>
    {!total ? <p className="text-xs text-ink-muted text-center py-8">{view === 'sessions' ? '结束一次计时后生成专注与休息统计' : view === 'custom' ? '完成自定义事项登记后，将在此展示学习用时' : '暂无已登记学习用时'}</p>
      : <div className="flex flex-col sm:flex-row items-center gap-5"><div role="img" aria-label={`${label}时间分布，共${number(total)}分钟`} className="relative h-36 w-36 shrink-0 rounded-full flex items-center justify-center" style={{background:`conic-gradient(${gradient})`}}><div className="absolute inset-4 rounded-full bg-paper flex flex-col items-center justify-center text-center"><span className="text-[10px] text-ink-muted">{unitLabel}</span><strong className="font-mono text-xl">{number(total)}</strong><span className="text-[10px] text-ink-muted">分钟</span></div></div><div className="w-full flex-1 grid grid-cols-2 gap-x-4 gap-y-2">{data.map(d => <div key={d.label} className="flex gap-1.5 items-start text-xs min-w-0"><span className="h-2 w-2 mt-1 rounded-sm shrink-0" style={{background:d.color}}/><span className="flex-1">{d.label}</span><span className="font-mono text-ink-muted text-right shrink-0">{number(d.minutes)}分{view === 'custom' && <span className="block text-[10px]">{number(d.minutes / total * 100)}%</span>}</span></div>)}</div></div>}
    {view === 'sessions' && <p className="text-xs text-ink-muted">仅统计本功能启用后已结束的计时会话（含待登记）；休息不计入学习用时，历史休息时间不推算。</p>}
  </Card></section>;
}
