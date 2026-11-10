import React from 'react';
import { AppState, StudyRecord } from '../../types';
import { getStudyRecordName } from '../../utils/workflowPresentation';
import { DailyRecordHistory } from '../common/DailyRecordHistory';

const formatAccuracy = (correct: number, total: number) => {
  if (total === 0) return '0%';
  const acc = (correct / total) * 100;
  return acc.toFixed(1).replace(/.0$/, '') + '%';
};

export const renderPracticeDetail = ({ date, rows }: { date: string; rows: [string, { name: string; questions: number; correct: number }][] }) => (
  <div className="divide-y divide-line/60 rounded-xl bg-cream/50 px-3">
    {rows.map(([id, row]) => (
      <div key={id} data-testid={`practice-${date}-${id}`} className="flex items-center justify-between gap-3 py-2 text-xs">
        <span className="min-w-0 break-words font-medium text-ink-main">{row.name}</span>
        <div className="flex shrink-0 gap-4 text-right">
          <div><div className="text-[10px] text-ink-muted">刷题</div><span data-testid="questions" className="font-mono font-bold">{row.questions}</span></div>
          <div><div className="text-[10px] text-ink-muted">正确</div><span data-testid="correct" className="font-mono font-bold text-sage">{row.correct}</span></div>
          <div><div className="text-[10px] text-ink-muted">正确率</div><span data-testid="accuracy" className="font-mono font-bold text-sage">{formatAccuracy(row.correct, row.questions)}</span></div>
        </div>
      </div>
    ))}
  </div>
);

export const DailyBookPractice: React.FC<{ state: AppState; records: StudyRecord[]; rangeKey: string }> = ({ state, records, rangeKey }) => {
  const days = new Map<string, Map<string, { name: string; questions: number; correct: number }>>();
  for (const record of records) {
    if (record.type !== 'book') continue;
    if (!days.has(record.date)) days.set(record.date, new Map());
    const books = days.get(record.date)!;
    const row = books.get(record.sourceId) ?? { name: getStudyRecordName(state, record), questions: 0, correct: 0 };
    row.questions += record.questions;
    row.correct += record.questions - record.errors;
    books.set(record.sourceId, row);
  }
  const summaries = [...days.keys()].sort().reverse().map(date => {
    const rows = [...days.get(date)!.entries()];
    const total = rows.reduce((sum, [, row]) => ({ questions: sum.questions + row.questions, correct: sum.correct + row.correct }), { questions: 0, correct: 0 });
    return { date, rows, ...total };
  });
  return <DailyRecordHistory
    title="每日刷题记录"
    days={summaries}
    rangeKey={rangeKey}
    emptyMessage="登记题本刷题后，将在这里显示每天的刷题与正确数量"
    renderSummary={day => <><span>刷题 <b className="font-mono">{day.questions}</b></span><span>正确 <b className="font-mono text-sage">{day.correct}</b></span><span>正确率 <b className="font-mono text-sage">{formatAccuracy(day.correct, day.questions)}</b></span></>}
    renderDetail={renderPracticeDetail}
  />;
};