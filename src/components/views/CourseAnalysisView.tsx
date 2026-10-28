import React from 'react';
import { useApp } from '../../context/AppContext';
import { Card, ProgressBar } from '../common/UIComponents';
import { SubjectGroups } from '../common/SubjectGroups';
import { getCourseAnalysis } from '../../utils/courseAnalysis';
import type { StudyRecord } from '../../types';
export function CourseAnalysisView({ records }: {records:StudyRecord[]}) {
  const {state}=useApp();const summary=getCourseAnalysis(state.courses,records);
  return <section className="space-y-3" aria-label="网课节数进度">
    <h2 className="text-base font-bold">网课节数进度</h2>
    <div className="grid grid-cols-3 gap-2">{[['本期听课用时',summary.minutes,'分钟'],['本期完成节数',summary.lessons,'节'],['本期听课次数',summary.sessions,'次']].map(([label,value,unit])=><Card key={label} className="p-3 text-center"><p className="text-[11px] text-ink-muted">{label}</p><p className="font-mono text-xl font-bold text-sage mt-1">{value}</p><p className="text-[11px] text-ink-muted">{unit}</p></Card>)}</div>
    <p className="text-xs text-ink-muted">进度条为全部累计节数；本期数据跟随上方统计范围。</p>
    <SubjectGroups items={summary.courses} unit="门网课" progress={items=>({done:items.reduce((n,c)=>n+c.completedLessons,0),total:items.reduce((n,c)=>n+c.totalLessons,0),unit:'节'})} renderItem={course=><Card key={course.id} className="p-3 space-y-2">
      <h3 className="text-sm font-bold break-words">{course.name}</h3>
      {!course.deleted&&<><div className="flex justify-between text-xs"><span>已完成 {course.completedLessons} / {course.totalLessons} 节</span><span className="text-sage font-mono">{course.totalLessons>0?Math.round(course.completedLessons/course.totalLessons*100):0}%</span></div><ProgressBar value={course.totalLessons>0?course.completedLessons/course.totalLessons*100:0}/><p className="text-xs text-ink-muted">累计听课 {course.cumulativeMinutes} 分钟</p></>}
      <p className="text-xs text-ink-muted">本期 {course.minutes} 分钟 · {course.lessons} 节 · {course.sessions} 次</p>
    </Card>}/>
    <details className="bg-paper border border-line rounded-xl p-3"><summary className="text-xs text-sage cursor-pointer">每日听课记录（{summary.days.length}天）</summary><div className="max-h-64 overflow-y-auto mt-3 space-y-2">{summary.days.length?summary.days.map(day=><div key={day.date} className="flex justify-between text-xs"><span>{day.date}</span><span className="font-mono">{day.minutes} 分钟 · {day.lessons} 节</span></div>):<p className="text-xs text-ink-muted">本期暂无已完成的网课登记。</p>}</div></details>
  </section>;
}
