import React, { useState } from 'react';
import { Modal, Button } from '../common/UIComponents';
import { Calendar, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { PotatoSprite } from '../common/PotatoSprite';

interface MonthPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMonth: string; // e.g. "2026-10"
  onSelectMonth: (month: string) => void;
}

export const MonthPickerModal: React.FC<MonthPickerModalProps> = ({
  isOpen,
  onClose,
  selectedMonth,
  onSelectMonth,
}) => {
  const [currentYear, setCurrentYear] = useState<number>(() => {
    const parts = (selectedMonth || '2026-10').split('-');
    return parseInt(parts[0], 10) || 2026;
  });

  React.useEffect(() => {
    if (isOpen) {
      const parts = (selectedMonth || '').split('-');
      const y = parseInt(parts[0], 10);
      if (!isNaN(y)) {
        setCurrentYear(y);
      }
    }
  }, [isOpen, selectedMonth]);

  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

  const handlePick = (m: string) => {
    const formatted = `${currentYear}-${m}`;
    onSelectMonth(formatted);
    onClose();
  };

  const handlePickThisMonth = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    setCurrentYear(y);
    onSelectMonth(`${y}-${m}`);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="选择分析月份">
      <div className="space-y-4">
        {/* 年份选择器 */}
        <div className="flex items-center justify-between px-2 py-1 bg-cream/70 rounded-xl border border-line">
          <button
            onClick={() => setCurrentYear(y => y - 1)}
            className="p-1 text-ink-muted hover:text-ink-main rounded-lg hover:bg-paper"
            title="上一年"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-bold text-sm text-ink-main font-mono">{currentYear} 年</span>
          <button
            onClick={() => setCurrentYear(y => y + 1)}
            className="p-1 text-ink-muted hover:text-ink-main rounded-lg hover:bg-paper"
            title="下一年"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* 12个月份网格 */}
        <div className="grid grid-cols-3 gap-2.5">
          {months.map(m => {
            const monthStr = `${currentYear}-${m}`;
            const isSelected = selectedMonth === monthStr;
            return (
              <button
                key={m}
                onClick={() => handlePick(m)}
                className={`py-3 px-2 rounded-xl text-xs font-medium border transition-all flex flex-col items-center justify-center gap-1 ${
                  isSelected
                    ? 'bg-sage text-white border-sage font-bold shadow-sm scale-[1.02]'
                    : 'bg-paper text-ink-main border-line hover:border-sage/50 hover:bg-cream/50'
                }`}
              >
                <span>{parseInt(m, 10)} 月</span>
                {isSelected && <Check size={12} className="stroke-[3]" />}
              </button>
            );
          })}
        </div>

        {/* 底部当前提示 */}
        <div className="pt-2 flex items-center justify-between text-xs text-ink-muted border-t border-line/60">
          <span>当前统计月份：<strong className="text-ink-main">{selectedMonth}</strong></span>
          <Button variant="secondary" size="sm" onClick={handlePickThisMonth}>
            本月
          </Button>
        </div>
      </div>
    </Modal>
  );
};
