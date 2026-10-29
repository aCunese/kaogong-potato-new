import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Button } from '../common/UIComponents';
import { StudyRecordItem } from '../common/StudyRecordItem';
import { Plan, StudyRecord } from '../../types';
import {
  addDays,
  canCorrectStudyRecord,
  getPlanCompletion,
  getStudyRecordName,
  studyDateLabel,
} from '../../utils/workflowPresentation';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Trash2,
  Calendar as CalendarIcon,
} from 'lucide-react';

interface StudyRecordsViewProps {
  onBack: () => void;
  initialDate?: string;
  onEditRecord?: (record: StudyRecord) => void;
  onOpenComplete?: (plan: Plan) => void;
  onDeletePlan?: (plan: Plan) => void;
}

const TYPE_LABEL = { book: '刷题', course: '网课', custom: '自定义' } as const;

export const StudyRecordsView: React.FC<StudyRecordsViewProps> = ({
  onBack,
  initialDate,
  onEditRecord,
  onOpenComplete,
  onDeletePlan,
}) => {
  const { state, activeDate } = useApp();
  const [viewMode, setViewMode] = useState<'calendar' | 'detail'>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || activeDate);

  // 月历定位（默认 activeDate 年月）
  const initialYear = Number(activeDate?.slice(0, 4)) || new Date().getFullYear();
  const initialMonth = Number(activeDate?.slice(5, 7)) || (new Date().getMonth() + 1);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  // 所有存在学习登记记录或日程的日期集合
  const datesWithData = useMemo(() => {
    const set = new Set<string>();
    for (const r of state.records) set.add(r.date);
    for (const p of state.plans) set.add(p.date);
    return set;
  }, [state.records, state.plans]);

  // 当月学习天数与累计时长
  const monthStats = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
    const monthDates = new Set<string>();
    let totalMinutes = 0;
    let recordCount = 0;
    for (const r of state.records) {
      if (r.date.startsWith(prefix)) {
        monthDates.add(r.date);
        totalMinutes += r.minutes;
        recordCount += 1;
      }
    }
    return {
      activeDays: monthDates.size,
      recordCount,
      totalMinutes,
    };
  }, [state.records, viewYear, viewMonth]);

  // 月历计算
  const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDaysInMonth = new Date(viewYear, viewMonth, 0).getDate();

  const handleMonthPrev = () => {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleMonthNext = () => {
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  // 选中日期的日程与登记数据
  const plans = useMemo(
    () =>
      state.plans
        .filter(plan => plan.date === selectedDate)
        .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name)),
    [state.plans, selectedDate],
  );
  const records = useMemo(
    () =>
      state.records
        .filter(record => record.date === selectedDate)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [state.records, selectedDate],
  );
  const totalMinutes = records.reduce((sum, record) => sum + record.minutes, 0);
  const pendingPlans = plans.filter(plan => !plan.done).length;
  const isToday = selectedDate === activeDate;
  const shiftDate = (days: number) => setSelectedDate(addDays(selectedDate, days));

  // --------------------------------------------------------------------------
  // 视图 1：月历总览（微信/待办同款，仅做了的日期加粗显示，空白淡化）
  // --------------------------------------------------------------------------
  if (viewMode === 'calendar') {
    return (
      <div className="space-y-4 animate-fadeIn">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs text-sage hover:underline font-medium"
          >
            <ChevronLeft size={16} />
            <span>返回今日</span>
          </button>
          <h2 className="text-sm font-bold text-ink-main">学习登记记录</h2>
          <div className="w-16" />
        </div>

        {/* 微信风格月历卡片 */}
        <Card className="p-3.5 space-y-3.5">
          {/* 年月切换 */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={handleMonthPrev}
              className="p-1 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="上个月"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-main">
                {viewYear}年 {viewMonth}月
              </span>
              {(viewYear !== initialYear || viewMonth !== initialMonth) && (
                <button
                  type="button"
                  onClick={() => {
                    setViewYear(initialYear);
                    setViewMonth(initialMonth);
                  }}
                  className="text-xs text-sage hover:underline"
                >
                  回到本月
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleMonthNext}
              className="p-1 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="下个月"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* 星期表头 */}
          <div className="grid grid-cols-7 text-center text-xs text-ink-muted py-1 font-medium">
            <span>日</span>
            <span>一</span>
            <span>二</span>
            <span>三</span>
            <span>四</span>
            <span>五</span>
            <span>六</span>
          </div>

          {/* 微信风格日期网格 */}
          <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`pad-${i}`} className="h-9 w-9 mx-auto" />
            ))}

            {Array.from({ length: totalDaysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dayString = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const hasData = datesWithData.has(dayString);
              const isTodayDate = dayString === activeDate;

              if (!hasData && !isTodayDate) {
                return (
                  <div
                    key={dayString}
                    className="h-9 w-9 mx-auto flex items-center justify-center text-ink-muted/30 select-none"
                  >
                    {dayNum}
                  </div>
                );
              }

              return (
                <button
                  key={dayString}
                  type="button"
                  onClick={() => {
                    setSelectedDate(dayString);
                    setViewMode('detail');
                  }}
                  className={`h-9 w-9 mx-auto rounded-full flex items-center justify-center transition-all ${
                    isTodayDate
                      ? 'bg-sage text-white font-bold shadow-sm'
                      : 'text-ink-main font-semibold hover:bg-black/5 cursor-pointer'
                  }`}
                  title={`${dayString}${isTodayDate ? ' (今天)' : ''}${hasData ? ' (点击查看登记)' : ''}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </Card>

        {/* 统计与提示 */}
        <div className="rounded-2xl border border-line bg-paper/80 p-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-ink-main font-medium">
            <span>本月学习天数</span>
            <span className="font-bold text-sage">{monthStats.activeDays} 天</span>
          </div>
          <div className="flex items-center justify-between text-ink-muted text-[11px]">
            <span>本月完成登记</span>
            <span>{monthStats.recordCount} 条 · {monthStats.totalMinutes} 分钟</span>
          </div>
        </div>

        <p className="text-xs text-ink-muted text-center py-1">
          💡 点击有记录的日期，进入直接查看或补记当天学习登记
        </p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 视图 2：单日日程与登记详情页（直接看、无需弹窗设置、前后翻日）
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-4 animate-fadeIn text-sm">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between pb-2 border-b border-line">
        <button
          type="button"
          onClick={() => setViewMode('calendar')}
          className="inline-flex items-center gap-1 text-xs text-sage hover:underline font-medium"
        >
          <ChevronLeft size={16} />
          <span>返回月历</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="前一天"
            onClick={() => shiftDate(-1)}
            className="p-1 rounded-lg hover:bg-black/5 text-ink-muted"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-sm font-bold text-ink-main">
            {studyDateLabel(selectedDate, activeDate)}
            <span className="ml-1 font-mono text-xs font-normal text-ink-muted">
              {selectedDate.slice(5).replace('-', '/')}
            </span>
          </h2>
          <button
            type="button"
            aria-label="后一天"
            disabled={isToday}
            onClick={() => shiftDate(1)}
            className="p-1 rounded-lg hover:bg-black/5 text-ink-muted disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-ink-muted hover:text-ink-main"
        >
          返回今日
        </button>
      </div>

      {/* 无记录状态 */}
      {!plans.length && !records.length && (
        <div className="rounded-2xl border border-dashed border-line bg-cream/35 px-4 py-8 text-center">
          <ClipboardList size={26} className="mx-auto mb-3 text-sage" />
          <p className="font-medium text-ink-main">这一天没有日程或登记</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            可以前后翻看其他日期，或返回月历查看有学习记录的日期。
          </p>
        </div>
      )}

      {/* 当天日程列表 */}
      {plans.length > 0 && (
        <section className="space-y-1.5" aria-label="当天日程">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h4 className="text-xs font-bold text-ink-main">当天日程</h4>
            <span className="text-[10px] text-ink-muted">
              {plans.length} 项{pendingPlans > 0 ? ` · ${pendingPlans} 项待登记` : ''}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="divide-y divide-line/60">
              {plans.map(plan => {
                const record = getPlanCompletion(plan, state.records).record;
                const elapsed = Math.floor(getPlanCompletion(plan, state.records).minutes);
                return (
                  <div key={plan.id} className="flex items-start justify-between gap-2 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${
                          plan.done ? 'font-medium text-ink-muted line-through' : 'font-medium text-ink-main'
                        }`}
                      >
                        {plan.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-muted">
                        {TYPE_LABEL[plan.type]} · {plan.subject} · {elapsed} / {plan.plannedMinutes} 分钟 ·{' '}
                        {plan.done ? '已登记' : '待补登记'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-center text-[11px]">
                      <button
                        type="button"
                        onClick={() => onOpenComplete?.(plan)}
                        className="text-sage underline decoration-sage/40 underline-offset-2"
                      >
                        {plan.done ? '查看登记总结' : '补登记'}
                      </button>
                      {plan.done && record && onEditRecord && canCorrectStudyRecord(state, record) && (
                        <button
                          type="button"
                          onClick={() => onEditRecord(record)}
                          className="text-sage underline decoration-sage/40 underline-offset-2"
                        >
                          修改登记
                        </button>
                      )}
                      {onDeletePlan && (
                        <button
                          type="button"
                          aria-label="删除并撤销登记"
                          title="删除并撤销登记"
                          onClick={() => onDeletePlan(plan)}
                          className="rounded-lg p-1 text-ink-muted hover:text-alarm"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 当天学习登记列表 */}
      {records.length > 0 && (
        <section className="space-y-1.5" aria-label="当天学习登记">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h4 className="flex items-center gap-1 text-xs font-bold text-ink-main">
              <CheckCircle2 size={12} className="text-sage" />学习登记
            </h4>
            <span className="text-[10px] text-ink-muted">
              {records.length} 条 · {totalMinutes} 分钟
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="divide-y divide-line/60">
              {records.map(record => (
                <StudyRecordItem
                  key={record.id}
                  record={record}
                  name={getStudyRecordName(state, record)}
                  onEdit={
                    onEditRecord && canCorrectStudyRecord(state, record)
                      ? () => onEditRecord(record)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {isToday && pendingPlans > 0 && (
        <p className="px-1 text-[10px] leading-relaxed text-ink-muted">
          今天还有 {pendingPlans} 项日程未登记，完成登记后会自动出现在这里。
        </p>
      )}
    </div>
  );
};
