import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, Trash2 } from 'lucide-react';

interface FloatingDatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  value: string; // "YYYY-MM-DD" or ""
  onChange: (date: string) => void;
  onClear?: () => void;
  highlightDates?: Set<string>; // dates with records, etc.
  activeDate?: string; // today date string, e.g. "2026-10-30"
}

export const FloatingDatePicker: React.FC<FloatingDatePickerProps> = ({
  isOpen,
  onClose,
  title,
  value,
  onChange,
  onClear,
  highlightDates,
  activeDate,
}) => {
  // 默认定位年月：若有选中值以选中值为准，否则以 activeDate 或当前系统年月为准
  const baseDate = value || activeDate || new Date().toISOString().slice(0, 10);
  const initialYear = Number(baseDate.slice(0, 4)) || new Date().getFullYear();
  const initialMonth = Number(baseDate.slice(5, 7)) || (new Date().getMonth() + 1);

  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  useEffect(() => {
    if (isOpen) {
      const d = value || activeDate || new Date().toISOString().slice(0, 10);
      const y = Number(d.slice(0, 4)) || new Date().getFullYear();
      const m = Number(d.slice(5, 7)) || (new Date().getMonth() + 1);
      setViewYear(y);
      setViewMonth(m);
    }
  }, [isOpen, value, activeDate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDaysInMonth = new Date(viewYear, viewMonth, 0).getDate();

  const handleYearPrev = () => {
    setViewYear(y => y - 1);
  };

  const handleYearNext = () => {
    setViewYear(y => y + 1);
  };

  const handleMonthPrev = () => {
    if (viewMonth === 1) {
      setViewYear(y => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const handleMonthNext = () => {
    if (viewMonth === 12) {
      setViewYear(y => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleSelect = (dayString: string) => {
    onChange(dayString);
    onClose();
  };

  const handleClear = () => {
    if (onClear) onClear();
    else onChange('');
    onClose();
  };

  const currentSysYear = Number(activeDate?.slice(0, 4)) || new Date().getFullYear();
  const currentSysMonth = Number(activeDate?.slice(5, 7)) || (new Date().getMonth() + 1);
  const isViewingCurrentMonth = viewYear === currentSysYear && viewMonth === currentSysMonth;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fadeIn"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-paper border border-line rounded-[28px] p-5 space-y-3.5 shadow-2xl max-w-sm w-full mx-auto">
        {/* 顶部标题栏与清除/关闭操作 */}
        <div className="flex items-center justify-between pb-1 pt-0.5 border-b border-line">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-ink-main">{title}</h3>
            {value && (
              <span className="font-mono text-xs text-sage font-medium bg-sage/10 px-2 py-0.5 rounded-md">
                {value}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-0.5 text-xs text-alarm hover:underline font-medium px-2 py-1 rounded-md hover:bg-alarm/10 transition"
              >
                <Trash2 size={13} />
                <span>清除</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭日历"
              className="p-1 rounded-lg text-ink-muted hover:text-ink-main hover:bg-black/5 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 年月份切换器（支持按年、按月及回到本月） */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleYearPrev}
              className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="上一年"
              title="上一年"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleMonthPrev}
              className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="上个月"
              title="上个月"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-main">
              {viewYear}年 {viewMonth}月
            </span>
            {!isViewingCurrentMonth && (
              <button
                type="button"
                onClick={() => {
                  setViewYear(currentSysYear);
                  setViewMonth(currentSysMonth);
                }}
                className="text-xs text-sage hover:underline"
              >
                回到本月
              </button>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleMonthNext}
              className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="下个月"
              title="下个月"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={handleYearNext}
              className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
              aria-label="下一年"
              title="下一年"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
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

        {/* 日期网格：
            - 有错题记录的日期：深色加粗，可点击
            - 无错题记录的日期：浅灰淡化，不可点击
            - 今天/选中日期：实体墨绿圆底
            - 单击即选即关，免确认免按键音，无绿色小圆点 */}
        <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
          {Array.from({ length: firstDayIndex }).map((_, i) => (
            <div key={`pad-${i}`} className="h-10 w-10 mx-auto" />
          ))}

          {Array.from({ length: totalDaysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dayString = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isSelected = value === dayString;
            const isToday = activeDate === dayString;
            const hasData = highlightDates ? highlightDates.has(dayString) : true;
            const isClickable = hasData || isToday || isSelected;

            if (!isClickable) {
              return (
                <div
                  key={dayString}
                  className="h-10 w-10 mx-auto flex items-center justify-center text-ink-muted/20 select-none cursor-default text-xs font-normal"
                >
                  {dayNum}
                </div>
              );
            }

            return (
              <button
                key={dayString}
                type="button"
                onClick={() => handleSelect(dayString)}
                className={`h-10 w-10 mx-auto rounded-full flex items-center justify-center text-xs transition-all active:scale-95 ${
                  isSelected || (isToday && !value)
                    ? 'bg-sage text-white font-bold shadow-sm'
                    : isToday
                    ? 'border border-sage/50 text-sage font-bold bg-sage/10 hover:bg-sage/20'
                    : 'text-ink-main font-bold hover:bg-black/5 cursor-pointer'
                }`}
                title={`${dayString}${isToday ? ' (今天)' : ''}${highlightDates && hasData ? ' (有错题记录)' : ''}`}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
