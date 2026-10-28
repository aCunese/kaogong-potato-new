import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SUBJECTS, Subject } from '../../types';
import { ProgressBar } from './UIComponents';
export function SubjectGroups<T extends { subject: Subject }>({ items, unit, renderItem, progress, expanded: controlled, onToggle }: {
  items: T[]; unit: string; renderItem: (item: T) => React.ReactNode;
  progress: (items: T[]) => { done: number; total: number; unit: string };
  expanded?: Partial<Record<Subject, boolean>>; onToggle?: (subject: Subject) => void;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<Subject, boolean>>>({});
  const open = controlled ?? expanded;
  return <div className="space-y-3">{SUBJECTS.map(subject => {
    const group = items.filter(item => item.subject === subject), summary = progress(group);
    const pct = summary.total > 0 ? Math.min(100, Math.round(summary.done / summary.total * 100)) : 0;
    return <section key={subject} className="rounded-2xl border border-line bg-paper overflow-hidden">
      <button type="button" aria-expanded={Boolean(open[subject])} aria-label={`${subject} · ${group.length}${unit}`} className="w-full p-4 text-left space-y-2" onClick={() => onToggle ? onToggle(subject) : setExpanded(prev => ({ ...prev, [subject]: !prev[subject] }))}>
        <span className="flex justify-between items-center gap-2"><span className="font-bold text-sm text-ink-main">{subject}<span className="ml-2 text-xs font-normal text-ink-muted">{group.length}{unit}</span></span><ChevronDown size={16} className={`shrink-0 transition-transform ${open[subject] ? 'rotate-180' : ''}`} /></span>
        <span className="flex justify-between text-xs text-ink-muted"><span>已完成 {summary.done} / {summary.total} {summary.unit}</span><span className="font-mono text-sage">{pct}%</span></span>
        <ProgressBar value={pct} />
      </button>
      {open[subject] && <div className="border-t border-line p-3 space-y-3">{group.length ? group.map(renderItem) : <p className="text-xs text-ink-muted py-3 text-center">该科目暂无内容</p>}</div>}
    </section>;
  })}</div>;
}
