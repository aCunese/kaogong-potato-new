import { TimeDistribution, AnalysisCategory } from './TimeDistribution';
import { CourseAnalysisView } from './CourseAnalysisView';
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PotatoSprite } from '../common/PotatoSprite';
import { Card, Segment, Tag, Button, ProgressBar } from '../common/UIComponents';
import { SUBJECTS, STUDY_SUBJECTS, StudySubject, AnalysisSubTab, StudyRecord } from '../../types';
import { filterAnalysisRecords } from '../../utils/workflowPresentation';
import { PieChart, TrendingUp, Calendar, Info, ChevronRight } from 'lucide-react';

const SUBJECT_COLORS: Record<StudySubject, string> = {
  '资料分析': '#1F77B4',
  '判断推理': '#FF7F0E',
  '言语理解': '#2CA02C',
  '数量关系': '#D62728',
  '政治理论': '#9467BD',
  '常识判断': '#8C564B',
  '申论': '#C43C8F',
  '面试': '#087F8C',
  '其他': '#8E9685',
};

const TimeBreakdown: React.FC<{ records: StudyRecord[] }> = ({ records }) => <Card className="p-4 space-y-2">
  <h3 className="text-sm font-bold">学习用时明细</h3>
  {([['book', '刷题用时'], ['course', '网课用时'], ['custom', '自定义学习用时']] as const).map(([type, label]) => <div className="flex justify-between text-xs text-ink-muted" key={type}><span>{label}</span><span className="font-mono text-ink-main">{records.filter(r => r.type === type).reduce((sum, r) => sum + r.minutes, 0)} 分钟</span></div>)}
  <div className="flex justify-between border-t border-line pt-2 text-xs font-bold"><span>总学习用时</span><span>{records.reduce((sum, r) => sum + r.minutes, 0)} 分钟</span></div>
</Card>;

interface AnalysisViewProps {
  initialSubTab?: AnalysisSubTab;
  selectedMonth?: string;
  onOpenMonthPicker: () => void;
  onOpenLegendDetail: (records?: StudyRecord[], rangeLabel?: string) => void;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  initialSubTab = 'overall',
  selectedMonth: controlledMonth,
  onOpenMonthPicker,
  onOpenLegendDetail,
}) => {
  const { state, activeDate } = useApp();
  const [subTab, setSubTab] = useState<AnalysisSubTab>(initialSubTab === 'monthly' ? 'monthly' : 'overall');
  const [category, setCategory] = useState<AnalysisCategory>('course');
  const [range, setRange] = useState<'30' | '90' | 'all'>('30');
  const [localMonth, setLocalMonth] = useState<string>(activeDate.slice(0, 7) || '2026-10');

  const selectedMonth = controlledMonth || localMonth;

  // Sync internal subTab whenever initialSubTab prop updates (Fixes A14)
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const overallRecords = filterAnalysisRecords(state.records, range, activeDate);
  const overallTotalMinutes = overallRecords.reduce((sum, r) => sum + r.minutes, 0);

  // Calculate subject minutes for overall
  const subjectTimeDistribution = STUDY_SUBJECTS.map(s => {
    const mins = overallRecords.filter(r => r.subject === s).reduce((sum, r) => sum + r.minutes, 0);
    const pct = overallTotalMinutes > 0 ? (mins / overallTotalMinutes) * 100 : 0;
    return {
      subject: s,
      minutes: mins,
      percent: pct,
      color: SUBJECT_COLORS[s],
    };
  });

  // Unique dates in records with questions for line chart
  const dateMap: Record<string, Record<StudySubject, { q: number; e: number }>> = {};
  overallRecords.filter(r => r.type === 'book' && r.questions > 0).forEach(r => {
    if (!dateMap[r.date]) {
      dateMap[r.date] = {} as any;
    }
    if (!dateMap[r.date][r.subject]) {
      dateMap[r.date][r.subject] = { q: 0, e: 0 };
    }
    dateMap[r.date][r.subject].q += r.questions;
    dateMap[r.date][r.subject].e += r.errors;
  });

  const sortedDates = Object.keys(dateMap).sort();

  // Monthly statistics
  const monthlyRecords = state.records.filter(r => r.date.startsWith(selectedMonth));
  const monthMinutes = monthlyRecords.reduce((sum, r) => sum + r.minutes, 0);
  const monthQuestions = monthlyRecords.filter(r => r.type === 'book').reduce((sum, r) => sum + r.questions, 0);
  const monthErrors = monthlyRecords.filter(r => r.type === 'book').reduce((sum, r) => sum + r.errors, 0);
  const monthAccuracy = monthQuestions > 0 ? Math.round(((monthQuestions - monthErrors) / monthQuestions) * 100) : 0;

  const monthlySubjectStats = STUDY_SUBJECTS.map(s => {
    const sRecords = monthlyRecords.filter(r => r.subject === s);
    const q = sRecords.filter(r => r.type === 'book').reduce((sum, r) => sum + r.questions, 0);
    const e = sRecords.filter(r => r.type === 'book').reduce((sum, r) => sum + r.errors, 0);
    const m = sRecords.reduce((sum, r) => sum + r.minutes, 0);
    const acc = q > 0 ? Math.round(((q - e) / q) * 100) : null;
    return {
      subject: s,
      questions: q,
      errors: e,
      minutes: m,
      accuracy: acc,
      color: SUBJECT_COLORS[s],
    };
  });

  // Conic gradient string for pie chart
  let cumulative = 0;
  const gradientStops = subjectTimeDistribution.map(item => {
    const start = cumulative;
    cumulative += item.percent;
    return `${item.color} ${start.toFixed(2)}% ${cumulative.toFixed(2)}%`;
  }).join(', ');

  return (
    <div className="space-y-4 pb-24">
      {/* 头部与吉祥物 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-2xl font-bold text-ink-main">学情分析复盘</h1>
          <p className="text-xs text-ink-muted mt-1">
            回顾学习进度与投入，掌握专注和休息分配
          </p>
        </div>
        <PotatoSprite pose={subTab === 'overall' ? 4 : 5} size={64} />
      </div>

      {/* 分段控制 */}
      <Segment
        options={[
          { label: '总体分析', value: 'overall' },
          { label: '每月分析', value: 'monthly' },
        ]}
        value={subTab}
        onChange={val => setSubTab(val as AnalysisSubTab)}
      />


      {/* 1. 总体分析 */}
      {subTab === 'overall' && (
        <div className="space-y-4">
          <TimeBreakdown records={overallRecords} />
          {/* 时间跨度切换 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">统计范围</span>
            <div className="flex bg-[#ECE8DF] p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setRange('30')}
                className={`px-3 py-1 rounded-md ${range === '30' ? 'bg-paper text-ink-main font-bold shadow-sm' : 'text-ink-muted'}`}
              >
                近30天
              </button>
              <button
                onClick={() => setRange('90')}
                className={`px-3 py-1 rounded-md ${range === '90' ? 'bg-paper text-ink-main font-bold shadow-sm' : 'text-ink-muted'}`}
              >
                近90天
              </button>
              <button
                onClick={() => setRange('all')}
                className={`px-3 py-1 rounded-md ${range === 'all' ? 'bg-paper text-ink-main font-bold shadow-sm' : 'text-ink-muted'}`}
              >
                全部记录
              </button>
            </div>
          </div>

          <TimeDistribution records={overallRecords} sessions={state.timerSessions ?? []} range={range} today={activeDate} view={category} onViewChange={setCategory} onLegend={() => onOpenLegendDetail(overallRecords.filter(r => r.type === category), range === 'all' ? '全部记录' : `近${range}天`)} />
          {category === 'course' && <CourseAnalysisView records={overallRecords.filter(r => r.type === 'course')} />}

          {/* 各科每日正确率曲线 */}
          {category === 'book' && <Card className="p-4 bg-paper border-line">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-ink-main flex items-center gap-1.5">
                <TrendingUp size={16} className="text-sage" />
                各科目每日正确率走势
              </div>
            </div>

            {sortedDates.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink-muted">
                完成题本刷题登记并记录题量、错题后，将在此绘制趋势折线
              </div>
            ) : (
              <div className="space-y-3">
                {/* SVG 折线图 */}
                <div className="w-full overflow-x-auto">
                  <svg viewBox="0 0 400 180" className="w-full h-44 select-none">
                    {/* Y 轴刻度线 */}
                    {[0, 25, 50, 75, 100].map(val => {
                      const y = 150 - (val / 100) * 120;
                      return (
                        <g key={val}>
                          <line x1="35" y1={y} x2="385" y2={y} stroke="#E4E6D9" strokeDasharray="3 3" />
                          <text x="28" y={y + 3} textAnchor="end" fontSize="9" fill="#8E9685" fontFamily="monospace">
                            {val}%
                          </text>
                        </g>
                      );
                    })}

                    {/* X 轴日期点与折线 */}
                    {SUBJECTS.map(subj => {
                      const color = SUBJECT_COLORS[subj];
                      const points: { x: number; y: number; acc: number }[] = [];

                      sortedDates.forEach((date, i) => {
                        const rec = dateMap[date]?.[subj];
                        if (rec && rec.q > 0) {
                          const acc = Math.round(((rec.q - rec.e) / rec.q) * 100);
                          const x = sortedDates.length === 1 ? 210 : 45 + (i / (sortedDates.length - 1)) * 330;
                          const y = 150 - (acc / 100) * 120;
                          points.push({ x, y, acc });
                        }
                      });

                      if (points.length === 0) return null;

                      const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

                      return (
                        <g key={subj}>
                          {points.length > 1 && (
                            <polyline
                              points={polylinePoints}
                              fill="none"
                              stroke={color}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                          {points.map((p, pIdx) => (
                            <circle
                              key={pIdx}
                              cx={p.x}
                              cy={p.y}
                              r="3.5"
                              fill="#FFFDF8"
                              stroke={color}
                              strokeWidth="2"
                            />
                          ))}
                        </g>
                      );
                    })}

                    {/* X 轴日期标注 */}
                    {sortedDates.map((date, i) => {
                      const x = sortedDates.length === 1 ? 210 : 45 + (i / (sortedDates.length - 1)) * 330;
                      return (
                        <text
                          key={date}
                          x={x}
                          y="168"
                          textAnchor="middle"
                          fontSize="9"
                          fill="#8E9685"
                          fontFamily="monospace"
                        >
                          {date.slice(5)}
                        </text>
                      );
                    })}
                  </svg>
                </div>

                {/* 走势说明 */}
                <div className="flex flex-wrap gap-2 text-[11px] text-ink-muted pt-1 border-t border-line/60">
                  {SUBJECTS.filter(s => sortedDates.some(d => dateMap[d]?.[s]?.q > 0)).map(s => (
                    <div key={s} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SUBJECT_COLORS[s] }} />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>}
        </div>
      )}

      {/* 2. 每月分析 */}
      {subTab === 'monthly' && (
        <div className="space-y-4">
          <TimeBreakdown records={monthlyRecords} />
          {/* 月份选择卡片 */}
          <Card className="p-3 bg-paper border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-sage" />
              <span className="text-sm font-bold text-ink-main">{selectedMonth} 月度报表</span>
            </div>
            <Button variant="secondary" size="sm" onClick={onOpenMonthPicker}>
              切换月份
            </Button>
          </Card>

          {/* 四大核心指标网格 */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3.5 bg-paper border-line">
              <span className="text-xs text-ink-muted">总学习时长</span>
              <div className="text-xl font-bold text-ink-main font-mono mt-1">
                {monthMinutes} <span className="text-xs font-normal text-ink-muted">分钟</span>
              </div>
              <span className="text-[10px] text-ink-muted/80">
                约 {(monthMinutes / 60).toFixed(1)} 小时投入
              </span>
            </Card>

            <Card className="p-3.5 bg-paper border-line">
              <span className="text-xs text-ink-muted">整体正确率 (加权)</span>
              <div className="text-xl font-bold text-sage font-mono mt-1">
                {monthQuestions > 0 ? `${monthAccuracy}%` : '—'}
              </div>
              <span className="text-[10px] text-ink-muted/80">按实际总做题量加权</span>
            </Card>

            <Card className="p-3.5 bg-paper border-line">
              <span className="text-xs text-ink-muted">总刷题量</span>
              <div className="text-xl font-bold text-ink-main font-mono mt-1">
                {monthQuestions} <span className="text-xs font-normal text-ink-muted">题</span>
              </div>
              <span className="text-[10px] text-ink-muted/80">仅统计已完成刷题登记</span>
            </Card>

            <Card className="p-3.5 bg-paper border-line">
              <span className="text-xs text-ink-muted">总错误数</span>
              <div className="text-xl font-bold text-alarm font-mono mt-1">
                {monthErrors} <span className="text-xs font-normal text-ink-muted">题</span>
              </div>
              <span className="text-[10px] text-ink-muted/80">数值错题数 (非照片张数)</span>
            </Card>
          </div>

          {/* 八大模块正确率与用时明细 */}
          <Card className="p-4 bg-paper border-line space-y-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h3 className="text-sm font-bold text-ink-main">各科正确率与用时</h3>
              <span className="text-xs text-ink-muted font-mono">{selectedMonth}</span>
            </div>

            <div className="space-y-3 pt-1">
              {monthlySubjectStats.map(s => (
                <div key={s.subject} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink-main flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.subject}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-ink-muted">{s.minutes} 分钟</span>
                      <span className="font-mono font-bold text-ink-main min-w-[36px] text-right">
                        {s.accuracy !== null ? `${s.accuracy}%` : <span className="text-ink-muted/60 text-[10px]">无题量</span>}
                      </span>
                    </div>
                  </div>
                  <ProgressBar value={s.accuracy ?? 0} />
                </div>
              ))}
            </div>

            <div className="p-2.5 bg-cream/50 rounded-lg text-[11px] text-ink-muted leading-relaxed">
              网课和自定义事项的学习时间已计入对应科目总分钟，因不产出题量，其正确率如实显示为“无题量记录”。
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
