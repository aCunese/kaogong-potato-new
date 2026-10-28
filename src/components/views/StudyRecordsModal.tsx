import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/UIComponents';
import { StudyRecordItem } from '../common/StudyRecordItem';
import { Plan, StudyRecord } from '../../types';
import {
  addDays,
  canCorrectStudyRecord,
  getPlanCompletion,
  getStudyRecordName,
  studyDateLabel,
} from '../../utils/workflowPresentation';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Trash2 } from 'lucide-react';

interface StudyRecordsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Date to open on; defaults to the active day. */
  initialDate?: string;
  onEditRecord?: (record: StudyRecord) => void;
  onOpenComplete?: (plan: Plan) => void;
  onDeletePlan?: (plan: Plan) => void;
}

const TYPE_LABEL = { book: '刷题', course: '网课', custom: '自定义' } as const;

/**
 * Date-first study log: pick a day (calendar or ‹ ›), then see that day's plans
 * (back-registration included) and registrations. Avoids stacking every record.
 */
export const StudyRecordsModal: React.FC<StudyRecordsModalProps> = ({ isOpen, onClose, initialDate, onEditRecord, onOpenComplete, onDeletePlan }) => {
  const { state, activeDate } = useApp();
  const [pickedDate, setPickedDate] = useState(activeDate);

  useEffect(() => {
    if (isOpen) setPickedDate(initialDate || activeDate);
  }, [isOpen, initialDate, activeDate]);

  const selectedDate = pickedDate || activeDate;
  const isToday = selectedDate === activeDate;
  const plans = useMemo(
    () => state.plans.filter(plan => plan.date === selectedDate)
      .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name)),
    [state.plans, selectedDate],
  );
  const records = useMemo(
    () => state.records.filter(record => record.date === selectedDate)
      .sort((a, b) => a.id.localeCompare(b.id)),
    [state.records, selectedDate],
  );
  const totalMinutes = records.reduce((sum, record) => sum + record.minutes, 0);
  const pendingPlans = plans.filter(plan => !plan.done).length;
  const shiftDate = (days: number) => setPickedDate(addDays(selectedDate, days));
  const openComplete = (plan: Plan) => { onClose(); onOpenComplete?.(plan); };
  const editRecord = (record: StudyRecord) => { onClose(); onEditRecord?.(record); };

  return <Modal isOpen={isOpen} onClose={onClose} title="学习登记记录">
    <div className="space-y-4 text-sm">
      {/* 日期选择：日历选择 + 前后翻日，默认今天 */}
      <div className="rounded-2xl border border-line bg-cream/50 p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="前一天"
            onClick={() => shiftDate(-1)}
            className="flex h-10 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-paper text-ink-muted active:bg-cream"
          >
            <ChevronLeft size={17} />
          </button>
          <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2">
            <CalendarDays size={15} className="shrink-0 text-sage" />
            <span className="truncate text-sm font-bold text-ink-main">{studyDateLabel(selectedDate, activeDate)}</span>
            <span className="shrink-0 font-mono text-[10px] text-ink-muted">{selectedDate.slice(5).replace('-', '/')}</span>
            <input
              type="date"
              aria-label="选择查看日期"
              value={selectedDate}
              max={activeDate}
              onChange={event => { if (event.target.value) setPickedDate(event.target.value); }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <button
            type="button"
            aria-label="后一天"
            disabled={isToday}
            onClick={() => shiftDate(1)}
            className="flex h-10 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-paper text-ink-muted active:bg-cream disabled:opacity-40"
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[10px] text-ink-muted">
          <span>{isToday ? '今天的日程与登记' : '可左右翻看前后日期'}</span>
          {!isToday && <button type="button" onClick={() => setPickedDate(activeDate)} className="rounded-md px-1.5 py-0.5 text-sage">回到今天</button>}
        </div>
      </div>

      {!plans.length && !records.length && <div className="rounded-2xl border border-dashed border-line bg-cream/35 px-4 py-8 text-center">
        <ClipboardList size={26} className="mx-auto mb-3 text-sage" />
        <p className="font-medium text-ink-main">这一天没有日程或登记</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">可以左右翻看其他日期，或回到今天。</p>
      </div>}

      {plans.length > 0 && <section className="space-y-1.5" aria-label="当天日程">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h4 className="text-xs font-bold text-ink-main">当天日程</h4>
          <span className="text-[10px] text-ink-muted">{plans.length} 项{pendingPlans > 0 ? ` · ${pendingPlans} 项待登记` : ''}</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="divide-y divide-line/60">
            {plans.map(plan => {
              const record = getPlanCompletion(plan, state.records).record;
              const elapsed = Math.floor(getPlanCompletion(plan, state.records).minutes);
              return <div key={plan.id} className="flex items-start justify-between gap-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${plan.done ? 'font-medium text-ink-muted line-through' : 'font-medium text-ink-main'}`}>{plan.name}</p>
                  <p className="mt-0.5 text-[10px] text-ink-muted">
                    {TYPE_LABEL[plan.type]} · {plan.subject} · {elapsed} / {plan.plannedMinutes} 分钟 · {plan.done ? '已登记' : '待补登记'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-center text-[11px]">
                  <button type="button" onClick={() => openComplete(plan)} className="text-sage underline decoration-sage/40 underline-offset-2">
                    {plan.done ? '查看登记总结' : '补登记'}
                  </button>
                  {plan.done && record && onEditRecord && canCorrectStudyRecord(state, record) && <button type="button" onClick={() => editRecord(record)} className="text-sage underline decoration-sage/40 underline-offset-2">修改登记</button>}
                  {onDeletePlan && <button type="button" aria-label="删除并撤销登记" title="删除并撤销登记" onClick={() => onDeletePlan(plan)} className="rounded-lg p-1 text-ink-muted hover:text-alarm"><Trash2 size={14} /></button>}
                </div>
              </div>;
            })}
          </div>
        </div>
      </section>}

      {records.length > 0 && <section className="space-y-1.5" aria-label="当天学习登记">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h4 className="flex items-center gap-1 text-xs font-bold text-ink-main"><CheckCircle2 size={12} className="text-sage" />学习登记</h4>
          <span className="text-[10px] text-ink-muted">{records.length} 条 · {totalMinutes} 分钟</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="divide-y divide-line/60">
            {records.map(record => <StudyRecordItem
              key={record.id}
              record={record}
              name={getStudyRecordName(state, record)}
              onEdit={onEditRecord && canCorrectStudyRecord(state, record) ? () => editRecord(record) : undefined}
            />)}
          </div>
        </div>
      </section>}

      {isToday && pendingPlans > 0 && <p className="px-1 text-[10px] leading-relaxed text-ink-muted">今天还有 {pendingPlans} 项日程未登记，完成登记后会自动出现在这里。</p>}
    </div>
  </Modal>;
};
