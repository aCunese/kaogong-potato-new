import React, { useEffect, useState } from 'react';
import { AppState, StudyRecord } from '../../types';
import { getStudyRecordName } from '../../utils/workflowPresentation';
import { ChevronDown } from 'lucide-react';

export const DailyBookPractice: React.FC<{ state: AppState; records: StudyRecord[] }> = ({ state, records }) => {
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
  const dates = [...days.keys()].sort().reverse();
  const latest = dates[0];
  const [expanded, setExpanded] = useState<string[]>(latest ? [latest] : []);
  useEffect(() => { setExpanded(latest ? [latest] : []); }, [latest]);
  return <section aria-label="每日刷题记录" className="rounded-2xl border border-line bg-paper p-4 space-y-3">
    <h3 className="text-sm font-bold text-ink-main">每日刷题记录</h3>
    {dates.length === 0 ? <p className="py-5 text-center text-xs text-ink-muted">登记题本刷题后，将在这里显示每天的刷题与正确数量</p> : dates.map(date => {
      const rows = [...days.get(date)!.entries()];
      const total = rows.reduce((sum, [, row]) => ({ questions: sum.questions + row.questions, correct: sum.correct + row.correct }), { questions: 0, correct: 0 });
      const open = expanded.includes(date);
      return <div key={date} className="rounded-xl border border-line/80 overflow-hidden">
        <button type="button" aria-expanded={open} onClick={() => setExpanded(prev => open ? prev.filter(day => day !== date) : [...prev, date])} className="w-full flex items-center justify-between gap-2 p-3 bg-cream/60 text-xs text-ink-muted">
          <span className="font-mono font-bold text-ink-main">{date}</span>
          <span className="flex items-center gap-2"><span>刷题 <b className="font-mono">{total.questions}</b> · 正确 <b className="font-mono text-sage">{total.correct}</b></span><ChevronDown size={14} className={open ? 'rotate-180' : ''} /></span>
        </button>
        {open && <div className="divide-y divide-line/60 px-3">{rows.map(([id, row]) => <div key={id} data-testid={`practice-${date}-${id}`} className="flex items-center justify-between gap-3 py-3 text-xs">
          <span className="min-w-0 break-words font-medium text-ink-main">{row.name}</span>
          <div className="flex shrink-0 gap-4 text-right">
            <div><div className="text-[10px] text-ink-muted">刷题</div><span data-testid="questions" className="font-mono font-bold">{row.questions}</span></div>
            <div><div className="text-[10px] text-ink-muted">正确</div><span data-testid="correct" className="font-mono font-bold text-sage">{row.correct}</span></div>
          </div>
        </div>)}</div>}
      </div>;
    })}
  </section>;
};
