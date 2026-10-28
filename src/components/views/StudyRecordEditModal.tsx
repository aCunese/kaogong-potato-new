import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button, Modal } from '../common/UIComponents';
import { parseIntegerDraft } from '../../utils/numericDraft';
import type { StudyRecord, StudyRecordCorrectionInput } from '../../types';

export function StudyRecordEditModal({ record, onClose, onToast }: {
  record: StudyRecord; onClose: () => void; onToast: (message: string) => void;
}) {
  const { state, currentUser, updateStudyRecord } = useApp();
  const [questions, setQuestions] = useState(String(record.questions));
  const [errors, setErrors] = useState(String(record.errors));
  const [lessons, setLessons] = useState(String(record.lessons ?? 0));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const owner = useRef(currentUser?.id);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const liveOwner = useRef(currentUser?.id);
  liveOwner.current = currentUser?.id;
  const liveRecord = state.records.find(r => r.id === record.id);
  const source = record.type === 'book' ? state.books.find(b => b.id === record.sourceId) : state.courses.find(c => c.id === record.sourceId);
  const q = parseIntegerDraft(questions), e = parseIntegerDraft(errors, 'nonnegative'), l = parseIntegerDraft(lessons);
  const valid = record.type === 'book' ? q !== null && e !== null && e <= q : record.type === 'course' && l !== null;
  if (owner.current !== currentUser?.id) return null;
  return <Modal isOpen onClose={onClose} title="修改本次登记" closeDisabled={saving}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (saving || !valid || !liveRecord) return;
      setSaving(true); setError('');
      const input: StudyRecordCorrectionInput = record.type === 'book'
        ? { type: 'book', recordId: record.id, questions: q!, errors: e!, expected: { questions: record.questions, errors: record.errors } }
        : { type: 'course', recordId: record.id, lessons: l!, expected: { lessons: record.lessons ?? 0 } };
      try {
        const result = await updateStudyRecord(input);
        if (!mounted.current || owner.current !== liveOwner.current) return;
        if (result.ok) { onToast('登记已修改，进度与学情已更新'); onClose(); }
        else setError(result.message);
      } catch { if (mounted.current && owner.current === liveOwner.current) setError('保存失败，请重试。'); }
      finally { if (mounted.current && owner.current === liveOwner.current) setSaving(false); }
    }}>
      <div className="rounded-xl bg-cream/70 p-3 text-sm space-y-1">
        <p className="font-bold break-words">{source?.name ?? '历史学习记录'}</p>
        <p className="text-xs text-ink-muted">{record.subject} · {record.date} · {record.minutes} 分钟</p>
        <p className="text-xs text-ink-muted">日期和计时用时保持原值；修改后自动调整累计进度。</p>
        {!source && <p className="text-xs text-ink-muted">关联资料已删除，本次修改仅更新历史学情。</p>}
      </div>
      {record.type === 'book' ? <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-ink-muted">本次做题数<input aria-label="修正本次做题数" type="number" min="1" step="1" required disabled={saving} value={questions} onChange={event => setQuestions(event.target.value)} className="mt-1 w-full min-w-0 p-3 rounded-xl border border-line bg-cream/60 text-sm" /></label>
        <label className="text-xs text-ink-muted">本次错题数<input aria-label="修正本次错题数" type="number" min="0" max={q ?? undefined} step="1" required disabled={saving} value={errors} onChange={event => setErrors(event.target.value)} className="mt-1 w-full min-w-0 p-3 rounded-xl border border-line bg-cream/60 text-sm" /></label>
      </div> : <label className="block text-xs text-ink-muted">本次完成节数<input aria-label="修正本次完成节数" type="number" min="1" step="1" required disabled={saving} value={lessons} onChange={event => setLessons(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-line bg-cream/60 text-sm" /></label>}
      {!valid && <p className="text-xs text-alarm">请填写有效整数，错题数不能超过做题数。</p>}
      {(error || !liveRecord) && <p role="alert" className="text-xs text-alarm">{error || '这条学习登记已不存在，请关闭后刷新。'}</p>}
      <Button type="submit" variant="primary" fullWidth disabled={saving || !valid || !liveRecord}>{saving ? '正在保存…' : '保存修改'}</Button>
    </form>
  </Modal>;
}
