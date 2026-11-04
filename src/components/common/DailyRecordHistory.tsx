import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Modal } from './UIComponents';

interface DailyRecordHistoryProps<T extends { date: string }> {
  title: string;
  days: T[];
  rangeKey: string;
  emptyMessage: string;
  renderSummary: (day: T) => React.ReactNode;
  renderDetail?: (day: T) => React.ReactNode;
}

const PREVIEW_DAYS = 3;
const PAGE_SIZE = 5;

export function DailyRecordHistory<T extends { date: string }>({
  title, days, rangeKey, emptyMessage, renderSummary, renderDetail,
}: DailyRecordHistoryProps<T>) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [previewExpanded, setPreviewExpanded] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const id = useId();
  const datesKey = days.map(day => day.date).join('|');
  const totalPages = Math.max(1, Math.ceil(days.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
    setPreviewExpanded(null);
    setHistoryExpanded(null);
  }, [rangeKey, datesKey]);

  useEffect(() => {
    if (days.length <= PREVIEW_DAYS) setHistoryOpen(false);
  }, [days.length]);

  useEffect(() => {
    setHistoryExpanded(null);
    listRef.current?.scrollTo({ top: 0 });
  }, [currentPage, historyOpen, rangeKey, datesKey]);

  const changePage = (next: number) => {
    setPage(Math.max(1, Math.min(totalPages, next)));
  };

  const renderDay = (day: T, inHistory: boolean) => {
    const expanded = (inHistory ? historyExpanded : previewExpanded) === day.date;
    const detailId = `${id}-${inHistory ? 'history' : 'preview'}-${day.date}`;
    const summary = <>
      <span className="shrink-0 font-mono font-semibold text-ink-main">{day.date}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">{renderSummary(day)}</span>
        {renderDetail && <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
      </span>
    </>;

    return <div key={day.date} className="border-b border-line/60 last:border-0">
      {renderDetail ? <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 py-2 text-left text-xs text-ink-muted"
        onClick={() => {
          const setExpanded = inHistory ? setHistoryExpanded : setPreviewExpanded;
          setExpanded(expanded ? null : day.date);
        }}
      >{summary}</button> : <div className="flex min-h-[44px] items-center justify-between gap-2 py-2 text-xs text-ink-muted">{summary}</div>}
      {renderDetail && expanded && <div id={detailId} className="pb-2">{renderDetail(day)}</div>}
    </div>;
  };

  return <section aria-label={title} className="rounded-2xl border border-line bg-paper p-4">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-ink-main">{title}</h3>
      {days.length > PREVIEW_DAYS && <button
        type="button"
        className="inline-flex min-h-[32px] items-center gap-0.5 text-xs font-medium text-sage"
        onClick={() => { setPage(1); setHistoryExpanded(null); setHistoryOpen(true); }}
      >查看全部（共 {days.length} 天）<ChevronRight size={14} /></button>}
    </div>
    {days.length ? days.slice(0, PREVIEW_DAYS).map(day => renderDay(day, false)) : <p className="py-4 text-center text-xs text-ink-muted">{emptyMessage}</p>}

    <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title={`${title}历史`}>
      <div className="flex h-[min(28rem,65vh)] flex-col gap-3">
        <p className="shrink-0 text-[11px] text-ink-muted">{rangeKey === 'all' ? '全部记录' : `近${rangeKey}天`} · 共 {days.length} 天 · 左右滑动翻页</p>
        <div
          ref={listRef}
          role="region"
          aria-label="历史日期列表"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ touchAction: 'pan-y' }}
          onTouchStart={event => {
            suppressClick.current = false;
            touchStart.current = event.touches.length === 1
              ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
              : null;
          }}
          onTouchMove={event => {
            if (event.touches.length !== 1) touchStart.current = null;
          }}
          onTouchCancel={() => { touchStart.current = null; }}
          onTouchEnd={event => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start || event.changedTouches.length !== 1) return;
            const dx = event.changedTouches[0].clientX - start.x;
            const dy = event.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
              suppressClick.current = true;
              changePage(currentPage + (dx < 0 ? 1 : -1));
            }
          }}
          onClickCapture={event => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >{days.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(day => renderDay(day, true))}</div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line pt-3">
          <Button size="sm" className="min-h-[40px]" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={14} />上一页</Button>
          <span aria-live="polite" className="text-xs font-mono text-ink-muted">第 {currentPage}/{totalPages} 页</span>
          <Button size="sm" className="min-h-[40px]" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)}>下一页<ChevronRight size={14} /></Button>
        </div>
      </div>
    </Modal>
  </section>;
}
