import { it, expect } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import { TodayView } from '../src/components/views/TodayView';
import { StudyRecordEditModal } from '../src/components/views/StudyRecordEditModal';
import { StudyRecordsView } from '../src/components/views/StudyRecordsView';
import { WrongView } from '../src/components/views/WrongView';
import { FloatingDatePicker } from '../src/components/common/FloatingDatePicker';

const noop = () => {};
const state = structuredClone(BLANK_STATE);
state.records = [{ id: 'r', planId: '', type: 'book', sourceId: 'deleted', subject: '判断推理', date: '2026-10-28', minutes: 30, questions: 20, errors: 12 }];
const provider = (element: React.ReactNode) => renderToStaticMarkup(<AppContext.Provider value={{state, activeDate: '2026-10-28'} as any}>{element}</AppContext.Provider>);
it('exposes correction for historical registrations without a surviving plan on the Today page', () => {
  const html = provider(<TodayView onOpenAddPlan={noop} onOpenFocus={noop} onOpenComplete={noop} onOpenCountdownEdit={noop} {...{onEditRecord: noop}} />);
  expect(html).toContain('学习登记记录');
  expect(html).toContain('修改本次登记');
  expect(html).toContain('完成 20 题');
  expect(html).not.toContain('历史日程</label>');
});
it('offers editable quantities and duration for study records', () => {
  const html = provider(<StudyRecordEditModal record={state.records[0]} onClose={noop} onToast={noop}/>);
  expect(html).toContain('aria-label="修正本次错题数"');
  expect(html).toContain('value="12"');
  expect(html).toContain('30 分钟');
  expect(html).toContain('aria-label="修正实际学习用时"');
  expect(html).toContain('value="30"');
  expect(html).toContain('关联资料已删除');
});

it('StudyRecordsView renders WeChat/Todo style calendar grid without native input[type=date] or click sound', () => {
  const html = provider(<StudyRecordsView onBack={noop} initialDate="2026-10-28" />);
  expect(html).toContain('学习登记记录');
  expect(html).toContain('返回今日');
  expect(html).toContain('2026年 10月');
  expect(html).toContain('💡 点击有记录的日期');
  // Strict assertion: zero input[type=date] to eliminate Android system sounds & confirmation steps
  expect(html).not.toContain('type="date"');
  // Day 28 has record so it should be rendered as an interactive button
  expect(html).toContain('2026-10-28');
});

it('WrongView uses FloatingDatePicker triggers without native green datepicker or sound', () => {
  const html = provider(<WrongView onOpenImportModal={noop} onOpenDetailModal={noop} onOpenDeleteConfirm={noop} />);
  expect(html).toContain('错题照片复盘');
  expect(html).toContain('aria-label="错题开始日期"');
  expect(html).toContain('aria-label="错题结束日期"');
  // Strict assertion: zero input[type=date] in WrongView to eliminate Android system sounds & confirmation steps
  expect(html).not.toContain('type="date"');
});

it('FloatingDatePicker renders centered modal with clickable highlighted days, dimmed non-highlighted days and zero green dots', () => {
  const highlightDates = new Set(['2026-10-28']);
  const html = provider(
    <FloatingDatePicker
      isOpen={true}
      onClose={noop}
      title="选择开始日期"
      value="2026-10-28"
      onChange={noop}
      highlightDates={highlightDates}
      activeDate="2026-10-29"
    />
  );
  expect(html).toContain('items-center justify-center');
  expect(html).toContain('选择开始日期');
  expect(html).toContain('清除');
  expect(html).toContain('2026年 10月');
  expect(html).toContain('有错题记录');
  // Day 28 (with wrong questions) is interactive button
  expect(html).toContain('title="2026-10-28 (有错题记录)"');
  // Day 27 (without wrong questions) is non-clickable text
  expect(html).toContain('text-ink-muted/20 select-none cursor-default');
  // No green dots
  expect(html).not.toContain('rounded-full mt-0.5');
  // Zero native type="date"
  expect(html).not.toContain('type="date"');
});
