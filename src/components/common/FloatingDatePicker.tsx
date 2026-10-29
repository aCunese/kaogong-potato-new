import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react';

interface FloatingDatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  value: string; // "YYYY-MM-DD" or ""
  onChange: (date: string) => void;
  onClear?: () => void;
  highlightDates?: Set<string>; // dates with wrong questions, etc.
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

  if (!isOpen) return null;

  const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDaysInMonth = new Date(viewYear, viewMonth, 0).getDate();

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
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex flex-col justify-end animate-fadeIn"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-paper border-t border-line rounded-t-[28px] p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 shadow-2xl max-w-lg mx-auto w-full animate-slideUp">
        {/* 顶部把手指示条 */}
        <div className="w-10 h-1 bg-ink-muted/20 rounded-full mx-auto" />

        {/* 顶部标题栏 */}
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
                <span>清空此日期</span>
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

        {/* 月份切换器 */}
        <div className="flex items-center justify-between px-1 pt-1">
          <button
            type="button"
            onClick={handleMonthPrev}
            className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
            aria-label="上个月"
          >
            <ChevronLeft size={18} />
          </button>
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
          <button
            type="button"
            onClick={handleMonthNext}
            className="p-1.5 rounded-lg hover:bg-black/5 text-ink-muted transition"
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

        {/* 日期网格：点击任意日期立即完成选择并自动收起，零声音、免设置确认 */}
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {Array.from({ length: firstDayIndex }).map((_, i) => (
            <div key={`pad-${i}`} className="h-10 w-10 mx-auto" />
          ))}

          {Array.from({ length: totalDaysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dayString = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isSelected = value === dayString;
            const isToday = activeDate === dayString;
            const hasHighlight = highlightDates?.has(dayString);

            return (
              <button
                key={dayString}
                type="button"
                onClick={() => handleSelect(dayString)}
                className={`h-10 w-10 mx-auto rounded-full flex flex-col items-center justify-center relative transition-all active:scale-95 ${
                  isSelected
                    ? 'bg-sage text-white font-bold shadow-sm'
                    : isToday
                    ? 'border border-sage/50 text-sage font-bold bg-sage/10 hover:bg-sage/20'
                    : 'text-ink-main font-semibold hover:bg-black/5'
                }`}
                title={`${dayString}${isToday ? ' (今天)' : ''}${hasHighlight ? ' (有错题照片)' : ''}`}
              >
                <span className="leading-none text-xs">{dayNum}</span>
                {/* 错题等足迹微标记小圆点 */}
                {hasHighlight && (
                  <span
                    className={`w-1 h-1 rounded-full mt-0.5 ${
                      isSelected ? 'bg-white' : 'bg-sage'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-ink-muted text-center pt-1 pb-0.5">
          💡 点击任意日期直接选中并关闭，绿色小圆点标示有错题记录的日期
        </p>
      </div>
    </div>
  );
};
