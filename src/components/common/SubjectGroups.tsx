import React, { useState } from 'react';
import { ChevronDown, Edit2 } from 'lucide-react';
import { SUBJECTS, Subject, StudySubject, getSubjectLabel } from '../../types';
import { ProgressBar } from './UIComponents';
export function SubjectGroups<T extends { subject: Subject }>({ items, unit, renderItem, progress, expanded: controlled, onToggle, subjectLabels, onEditSubject }: {
  items: T[]; unit: string; renderItem: (item: T) => React.ReactNode;
  progress: (items: T[]) => { done: number; total: number; unit: string };
  expanded?: Partial<Record<Subject, boolean>>; onToggle?: (subject: Subject) => void;
  subjectLabels?: Partial<Record<StudySubject, string>>;
  onEditSubject?: (subject: Subject) => void;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<Subject, boolean>>>({});
  const open = controlled ?? expanded;
  return <div className="space-y-3">{SUBJECTS.map(subject => {
    const group = items.filter(item => item.subject === subject), summary = progress(group);
    const pct = summary.total > 0 ? Math.min(100, Math.round(summary.done / summary.total * 100)) : 0;
    const displayLabel = getSubjectLabel(subject, subjectLabels);
    return <section key={subject} className="relative rounded-2xl border border-line bg-paper overflow-hidden">
      <button type="button" aria-expanded={Boolean(open[subject])} aria-label={`${displayLabel} · ${group.length}${unit}`} className="w-full p-4 text-left space-y-2" onClick={() => onToggle ? onToggle(subject) : setExpanded(prev => ({ ...prev, [subject]: !prev[subject] }))}>
        <span className="flex justify-between items-center gap-2">
          <span className="font-bold text-sm text-ink-main pr-8">
            {displayLabel}
            <span className="ml-2 text-xs font-normal text-ink-muted">{group.length}{unit}</span>
          </span>
          <ChevronDown size={16} className={`shrink-0 transition-transform ${open[subject] ? 'rotate-180' : ''}`} />
        </span>
        <span className="flex justify-between text-xs text-ink-muted"><span>已完成 {summary.done} / {summary.total} {summary.unit}</span><span className="font-mono text-sage">{pct}%</span></span>
        <ProgressBar value={pct} />
      </button>
      {onEditSubject && (
        <button
          type="button"
          aria-label={`编辑分类名称：${displayLabel}`}
          title={`修改「${displayLabel}」分类名称`}
          onClick={e => {
            e.stopPropagation();
            onEditSubject(subject);
          }}
          className="absolute top-3.5 right-10 p-1 rounded-lg text-ink-muted hover:text-sage hover:bg-black/5 transition"
        >
          <Edit2 size={13} />
        </button>
      )}
      {open[subject] && <div className="border-t border-line p-3 space-y-3">{group.length ? group.map(renderItem) : <p className="text-xs text-ink-muted py-3 text-center">该科目暂无内容</p>}</div>}
    </section>;
  })}</div>;
}
