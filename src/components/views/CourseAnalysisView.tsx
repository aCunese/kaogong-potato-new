import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Button, ProgressBar } from '../common/UIComponents';
import { filterAnalysisRecords, AnalysisRange } from '../../utils/workflowPresentation';
import { getCourseAnalysis } from '../../utils/courseAnalysis';

export const CourseAnalysisView: React.FC = () => {
  const { state, activeDate } = useApp();
  const [range, setRange] = useState<AnalysisRange>('30');
  const [visibleDays, setVisibleDays] = useState(14);
  const summary = getCourseAnalysis(state.courses, filterAnalysisRecords(state.records, range, activeDate));
  const maximum = Math.max(1, ...summary.subjects.map(item => item.minutes));
  return <section className="space-y-4" aria-label="网课独立分析">
    <div><h2 className="text-base font-bold text-ink-main">网课分析</h2><p className="text-xs text-ink-muted mt-1">独立统计听课用时、完成节数与课程进度</p></div>
    <div className="flex rounded-xl bg-[#ECE8DF] p-1 gap-1" role="group" aria-label="网课分析范围">
      {([['30', '近30天'], ['90', '近90天'], ['all', '全部记录']] as const).map(([value, label]) => <button key={value} aria-pressed={range === value} onClick={() => { setRange(value); setVisibleDays(14); }} className={`flex-1 rounded-lg py-2 text-xs ${range === value ? 'bg-paper text-sage font-bold shadow-sm' : 'text-ink-muted'}`}>{label}</button>)}
    </div>
    <div className="grid grid-cols-3 gap-2">
      {([['本期听课用时', `${summary.minutes}`, '分钟'], ['本期完成节数', `${summary.lessons}`, '节'], ['本期听课次数', `${summary.sessions}`, '次']] as const).map(([label, value, unit]) => <Card key={label} className="p-3 text-center"><p className="text-[11px] text-ink-muted">{label}</p><p className="text-xl font-bold font-mono text-sage mt-2">{value}</p><p className="text-[11px] text-ink-muted">{unit}</p></Card>)}
    </div>
    <Card className="p-4 space-y-3"><h3 className="text-sm font-bold">网课科目投入</h3>
      {summary.subjects.map(item => <div key={item.subject}><div className="flex justify-between text-xs mb-1"><span>{item.subject}</span><span className="text-ink-muted font-mono">{item.minutes} 分钟</span></div><ProgressBar value={item.minutes / maximum * 100} /></div>)}
    </Card>
    <section className="space-y-3"><h3 className="text-sm font-bold">课程进度</h3><p className="text-xs text-ink-muted">进度为全部已完成节数；本期用时和节数按上方范围统计。</p>
      {!summary.courses.length && <Card className="text-xs text-ink-muted">暂无课程，添加网课并完成日程后可在这里查看。</Card>}
      {summary.courses.map(course => <Card key={course.id} className="p-4 space-y-2">
        <h4 className="text-sm font-bold break-words">{course.name}</h4><p className="text-xs text-ink-muted">{course.subject}</p>
        {!course.deleted && <><div className="flex justify-between text-xs"><span>已完成 {course.completedLessons} / {course.totalLessons} 节</span><span className="text-sage font-mono">{course.totalLessons > 0 ? Math.round(course.completedLessons / course.totalLessons * 100) : 0}%</span></div><ProgressBar value={course.totalLessons > 0 ? course.completedLessons / course.totalLessons * 100 : 0} /><p className="text-xs text-ink-muted">全部累计听课 {course.cumulativeMinutes} 分钟</p></>}
        <div className="flex justify-between text-xs border-t border-line pt-2"><span>本期 {course.minutes} 分钟</span><span>完成 {course.lessons} 节 · {course.sessions} 次</span></div>
      </Card>)}
    </section>
    <Card className="p-4 space-y-3"><h3 className="text-sm font-bold">每日听课记录</h3>
      {!summary.days.length && <p className="text-xs text-ink-muted">本期暂无已完成的网课登记。正在计时的日程完成后会自动计入。</p>}
      {summary.days.slice(0, visibleDays).map(day => <div key={day.date} className="flex justify-between gap-2 text-xs"><span>{day.date}</span><span className="font-mono">{day.minutes} 分钟 · {day.lessons} 节</span></div>)}
      {summary.days.length > visibleDays && <Button variant="light" size="sm" fullWidth onClick={() => setVisibleDays(count => count + 14)}>显示更多日期</Button>}
    </Card>
  </section>;
};
