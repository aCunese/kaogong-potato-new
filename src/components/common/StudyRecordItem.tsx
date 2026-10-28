import React from 'react';
import { Tag } from './UIComponents';
import { StudyRecord } from '../../types';
import { getCompletionSummary } from '../../utils/workflowPresentation';

const TYPE_LABEL = { book: '刷题', course: '网课', custom: '自定义' } as const;
const TYPE_VARIANT = { book: 'potato', course: 'course', custom: 'gray' } as const;

/**
 * One compact study-registration row, shared by the Today preview and the
 * full "学习登记记录" dialog so both stay visually consistent.
 */
export const StudyRecordItem: React.FC<{
  record: StudyRecord;
  name: string;
  dateLabel?: string;
  onEdit?: () => void;
}> = ({ record, name, dateLabel, onEdit }) => {
  const summary = getCompletionSummary(record);
  const meta = record.type === 'book' ? `${record.minutes} 分钟 · ${summary}` : summary;
  return (
    <div className="flex items-start justify-between gap-2 px-3.5 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag variant={TYPE_VARIANT[record.type]}>{TYPE_LABEL[record.type]}</Tag>
          <Tag variant="gray">{record.subject}</Tag>
          {dateLabel && <span className="text-[10px] text-ink-muted">{dateLabel}</span>}
        </div>
        <p className="truncate text-sm font-medium text-ink-main">{name}</p>
        <p className="break-words text-[11px] leading-relaxed text-ink-muted">{meta}</p>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 self-center rounded-lg px-1.5 py-1 text-[11px] text-sage underline decoration-sage/40 underline-offset-2"
        >
          修改本次登记
        </button>
      )}
    </div>
  );
};
