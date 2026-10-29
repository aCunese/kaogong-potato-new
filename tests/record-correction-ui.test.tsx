import { it, expect } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import { TodayView } from '../src/components/views/TodayView';
import { StudyRecordEditModal } from '../src/components/views/StudyRecordEditModal';

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
