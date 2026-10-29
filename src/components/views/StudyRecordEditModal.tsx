import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button, Modal } from '../common/UIComponents';
import { parseIntegerDraft } from '../../utils/numericDraft';
import { getStudyRecordName } from '../../utils/workflowPresentation';
import type { StudyRecord, StudyRecordCorrectionInput } from '../../types';

export function StudyRecordEditModal({ record, onClose, onToast }: {
  record: StudyRecord; onClose: () => void; onToast: (message: string) => void;
}) {
  const { state, currentUser, updateStudyRecord } = useApp();
  const [questions, setQuestions] = useState(String(record.questions));
  const [errors, setErrors] = useState(String(record.errors));
  const [lessons, setLessons] = useState(String(record.lessons ?? 0));
  const [minutes, setMinutes] = useState(String(record.minutes));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const owner = useRef(currentUser?.id);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const liveOwner = useRef(currentUser?.id);
  liveOwner.current = currentUser?.id;
  const liveRecord = state.records.find(r => r.id === record.id);
  const recordName = getStudyRecordName(state, record);

  const q = parseIntegerDraft(questions);
  const e = parseIntegerDraft(errors, 'nonnegative');
  const l = parseIntegerDraft(lessons);
  const m = parseIntegerDraft(minutes);

  const minutesValid = m !== null && m > 0;
  const quantityValid = record.type === 'book'
    ? (q !== null && q > 0 && e !== null && e <= q)
    : record.type === 'course'
    ? (l !== null && l > 0)
    : true;
  const valid = minutesValid && quantityValid;

  if (owner.current !== currentUser?.id) return null;

  return <Modal isOpen onClose={onClose} title="修改本次登记" closeDisabled={saving}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (saving || !valid || !liveRecord) return;
      setSaving(true); setError('');
      let input: StudyRecordCorrectionInput;
      if (record.type === 'book') {
        input = {
          type: 'book',
          recordId: record.id,
          questions: q!,
          errors: e!,
          minutes: m!,
          expected: { questions: record.questions, errors: record.errors, minutes: record.minutes },
        };
      } else if (record.type === 'course') {
        input = {
          type: 'course',
          recordId: record.id,
          lessons: l!,
          minutes: m!,
          expected: { lessons: record.lessons ?? 0, minutes: record.minutes },
        };
      } else {
        input = {
          type: 'custom',
          recordId: record.id,
          minutes: m!,
          expected: { minutes: record.minutes },
        };
      }

      try {
        const result = await updateStudyRecord(input);
        if (!mounted.current || owner.current !== liveOwner.current) return;
        if (result.ok) { onToast('登记已修改，进度与时长已更新'); onClose(); }
        else setError(result.message);
      } catch { if (mounted.current && owner.current === liveOwner.current) setError('保存失败，请重试。'); }
      finally { if (mounted.current && owner.current === liveOwner.current) setSaving(false); }
    }}>
      <div className="rounded-xl bg-cream/70 p-3 text-sm space-y-1">
        <p className="font-bold break-words">{recordName}</p>
        <p className="text-xs text-ink-muted">{record.subject} · {record.date} · 原用时 {record.minutes} 分钟</p>
        <p className="text-xs text-ink-muted">修改后自动同步校正日程已学时长与学情分析。</p>
        {((record.type === 'book' && !state.books.some(b => b.id === record.sourceId)) || (record.type === 'course' && !state.courses.some(c => c.id === record.sourceId))) && (
          <p className="text-xs text-ink-muted">关联资料已删除，本次修改仅更新历史学情。</p>
        )}
      </div>

      {/* 学习用时修改（全类型支持，支持删空退格） */}
      <label className="block text-xs text-ink-muted">
        实际学习用时 (分钟)
        <input
          aria-label="修正实际学习用时"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={saving}
          value={minutes}
          onChange={event => {
            const val = event.target.value.replace(/[^\d]/g, '');
            setMinutes(val);
          }}
          placeholder="请输入有效分钟数（如 30）"
          className="mt-1 w-full p-3 rounded-xl border border-line bg-cream/60 text-sm font-mono"
        />
      </label>

      {record.type === 'book' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-muted">
            本次做题数
            <input
              aria-label="修正本次做题数"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={saving}
              value={questions}
              onChange={event => setQuestions(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="正整数"
              className="mt-1 w-full min-w-0 p-3 rounded-xl border border-line bg-cream/60 text-sm font-mono"
            />
          </label>
          <label className="text-xs text-ink-muted">
            本次错题数
            <input
              aria-label="修正本次错题数"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={saving}
              value={errors}
              onChange={event => setErrors(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="非负整数"
              className="mt-1 w-full min-w-0 p-3 rounded-xl border border-line bg-cream/60 text-sm font-mono"
            />
          </label>
        </div>
      )}

      {record.type === 'course' && (
        <label className="block text-xs text-ink-muted">
          本次完成节数
          <input
            aria-label="修正本次完成节数"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={saving}
            value={lessons}
            onChange={event => setLessons(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="正整数"
            className="mt-1 w-full p-3 rounded-xl border border-line bg-cream/60 text-sm font-mono"
          />
        </label>
      )}

      {/* 校验提示 */}
      {!minutesValid && minutes.trim() !== '' && (
        <p className="text-xs text-alarm">用时须为大于0的整数分钟（不可为0或负数）。</p>
      )}
      {!minutesValid && minutes.trim() === '' && (
        <p className="text-xs text-alarm">请输入实际学习用时分钟数。</p>
      )}
      {record.type === 'book' && !quantityValid && (
        <p className="text-xs text-alarm">请填写有效做题数，错题数不能超过做题数。</p>
      )}
      {record.type === 'course' && !quantityValid && (
        <p className="text-xs text-alarm">完成节数须为正整数。</p>
      )}

      {(error || !liveRecord) && (
        <p role="alert" className="text-xs text-alarm">
          {error || '这条学习登记已不存在，请关闭后刷新。'}
        </p>
      )}

      <Button type="submit" variant="primary" fullWidth disabled={saving || !valid || !liveRecord}>
        {saving ? '正在保存…' : '保存修改'}
      </Button>
    </form>
  </Modal>;
}
