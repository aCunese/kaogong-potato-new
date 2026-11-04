import { expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import { LearningView } from '../src/components/views/LearningView';
import { AuthView } from '../src/components/views/AuthView';
import { AnalysisView } from '../src/components/views/AnalysisView';
import { WrongView } from '../src/components/views/WrongView';
import { AddPlanModal } from '../src/components/views/EditModals';
const noop = () => {};
function render(element: React.ReactElement, extra: any = {}) {
  const state: any = structuredClone(BLANK_STATE);
  state.version = 4;
  state.todos = [{ id: 't', text: 'Review an argument', date: '2026-10-26', done: false, createdAt: 1, completedAt: 0 }];
  state.courses = [{ id: 'c', name: 'Course', subject: '资料分析', totalLessons: 10, completedLessons: 1, minutes: 10, url: '' }];
  state.library = buildLibraryFromSources([], state.courses);
  state.wrong = [{ id: 'w', bookId: 'deleted', date: '2026-10-27', note: 'formula review', image: '' }];
  return renderToStaticMarkup(React.createElement(AppContext.Provider, { value: { state, activeDate: '2026-10-27', ...extra } as any }, element));
}
it('shows independent dated todos in learning, without exposing source library items', () => {
  const html = render(React.createElement(LearningView, { initialSubTab: 'library', onOpenBookEdit: noop, onOpenCourseEdit: noop, onOpenCustomAdd: noop, onOpenDeleteConfirm: noop, onToast: noop }));
  expect(html).toContain('Review an argument'); expect(html).toContain('2026-10-26'); expect(html).toContain('待办'); expect(html).not.toContain('加入今天');
});
it('puts registration below the primary login button', () => {
  const html = render(React.createElement(AuthView, { onToast: noop }));
  expect(html.indexOf('注册新学员')).toBeGreaterThan(html.indexOf('登录学员空间'));
});
it('separates course and book minutes in analysis', () => {
  const html = render(React.createElement(AnalysisView, { onOpenMonthPicker: noop, onOpenLegendDetail: noop }));
  expect(html).toContain('刷题用时'); expect(html).toContain('网课用时');
});
it('offers note search and date filters and folds orphan photos by default', () => {
  const html = render(React.createElement(WrongView, { onOpenImportModal: noop, onOpenDetailModal: noop, onOpenDeleteConfirm: noop }));
  expect(html).toContain('搜索复盘原因和思路'); expect(html).toContain('aria-label="错题开始日期"'); expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('formula review');
});
it('asks for planned lessons when a course is selected for today', () => {
  const html = render(React.createElement(AddPlanModal, { isOpen: true, onClose: noop, onToast: noop }));
  expect(html).toContain('本次计划节数');
});

it('keeps accumulated course minutes read-only while allowing lesson edits', async () => {
  const { CourseEditModal } = await import('../src/components/views/EditModals');
  const course: any = { id: 'c', name: 'Course', subject: '资料分析', totalLessons: 10, completedLessons: 1, minutes: 540, url: '' };
  const html = render(React.createElement(CourseEditModal, { isOpen: true, course, onClose: noop, onToast: noop }));
  expect(html).toContain('<output'); expect(html).toContain('自动累计');
  expect(html).toContain('aria-label="总节数"'); expect(html).toContain('aria-label="已完成节数"');
});
it('prefills editable completion minutes alongside course lesson count', async () => {
  const { CompletionModal } = await import('../src/components/views/CompletionModal');
  const plan: any = { id: 'p', date: '2026-10-27', libraryId: 'lib-course-c', name: 'Course', type: 'course', sourceId: 'c', subject: '资料分析', plannedMinutes: 30, actualMinutes: 20, accumulatedMs: 1200000, timerStart: 0, done: false, plannedLessons: 2 };
  const html = render(React.createElement(CompletionModal, { isOpen: true, plan, onClose: noop, onToast: noop }));
  expect(html).toContain('aria-label="实际学习分钟"'); expect(html).toContain('value="20"'); expect((html.match(/<input/g) ?? []).length).toBe(2);
});
it('makes pomodoro visible on the today page and all three modes visible in focus', async () => {
  const { TodayView } = await import('../src/components/views/TodayView');
  const { FocusModal } = await import('../src/components/views/FocusModal');
  const html = render(React.createElement(TodayView, { onOpenAddPlan: noop, onOpenFocus: noop, onOpenComplete: noop, onOpenCountdownEdit: noop }));
  expect(html).toContain('番茄钟');
  const plan: any = { id: 'p', date: '2026-10-27', name: 'Course', type: 'course', plannedMinutes: 30, actualMinutes: 0, timerStart: 0, done: false };
  const focus = render(React.createElement(FocusModal, { isOpen: true, plan, onClose: noop, onComplete: noop }));
  expect(focus).toContain('aria-label="计时模式"'); expect(focus).toContain('aria-pressed=');
});
it('integrates course-only metrics and grouped progress into overall analysis', () => {
  const html = render(React.createElement(AnalysisView, { onOpenMonthPicker: noop, onOpenLegendDetail: noop }));
  expect(html).not.toContain('网课分析'); expect(html).toContain('本期听课用时'); expect(html).toContain('网课节数进度'); expect(html).toContain('aria-expanded="false"');
});

it('supports moving overdue todos to today and renders history calendar entry', async () => {
  const { applyMoveTodosToDate } = await import('../src/utils/workflowMutators');
  const draft: any = {
    version: 4,
    todos: [
      { id: 't1', text: 'Past unfinished', date: '2026-10-25', done: false, createdAt: 1, completedAt: 0 },
      { id: 't2', text: 'Today task', date: '2026-10-27', done: false, createdAt: 2, completedAt: 0 },
    ],
  };
  const res = applyMoveTodosToDate(draft, ['t1'], '2026-10-27');
  expect('error' in res).toBe(false);
  expect(draft.todos[0].date).toBe('2026-10-27');

  const { TodoView } = await import('../src/components/views/TodoView');
  const html = render(React.createElement(TodoView));
  expect(html).toContain('历史月历');
  expect(html).toContain('今天');
  expect(html).toContain('移到今天');
});

it('supports editing study record duration for custom, book and course records', async () => {
  const { applyStudyRecordCorrection } = await import('../src/utils/workflowMutators');
  const { canCorrectStudyRecord } = await import('../src/utils/workflowPresentation');
  const customRecord: any = { id: 'r-custom', planId: 'p-custom', date: '2026-10-27', type: 'custom', sourceId: 'custom-1', subject: '常识判断', minutes: 23, questions: 0, errors: 0 };
  const state: any = { records: [customRecord], plans: [{ id: 'p-custom', recordId: 'r-custom', actualMinutes: 23, accumulatedMs: 1380000 }] };
  expect(canCorrectStudyRecord(state, customRecord)).toBe(true);

  const res = applyStudyRecordCorrection(state, { recordId: 'r-custom', type: 'custom', minutes: 35 });
  expect('error' in res).toBe(false);
  expect(customRecord.minutes).toBe(35);
  expect(state.plans[0].actualMinutes).toBe(35);
});

it('groups wrong records into 9 categories, merges multi-photo uploads into 1 record, and formats hour-precision timestamps', async () => {
  const { applyAddWrongRecords, resolveWrongRecordSubject, formatWrongRecordTime, getWrongRecordImages } = await import('../src/utils/workflowMutators');
  const { PhotoImportModal, WrongDetailModal } = await import('../src/components/views/EditModals');

  const draft: any = structuredClone(BLANK_STATE);
  draft.books = [{ id: 'b-math', name: '四海600题数量', subject: '数量关系', total: 600, done: 100, errors: 10, minutes: 200, pages: 100 }];

  // 1. Legacy record without subject maps to book subject or 其他
  expect(resolveWrongRecordSubject({ id: 'w1', bookId: 'b-math', date: '2026-11-01', note: '', image: 'img1' }, draft.books)).toBe('数量关系');
  expect(resolveWrongRecordSubject({ id: 'w2', bookId: 'deleted-book', date: '2026-11-01', note: '', image: 'img2' }, draft.books)).toBe('其他');

  // 2. Multi-image upload creates a single WrongRecord with images[] and createdAt
  const ts = new Date(2026, 10, 1, 14, 30, 0).getTime(); // 2026.11.1 14:30 local time
  const added = applyAddWrongRecords(
    draft,
    '数量关系',
    '2026-11-01',
    '工程问题赋值法复盘',
    ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB', 'data:image/jpeg;base64,CCC'],
    ts
  );
  expect('error' in added).toBe(false);
  expect(draft.wrong).toHaveLength(1);
  const rec = draft.wrong[0];
  expect(rec.subject).toBe('数量关系');
  expect(getWrongRecordImages(rec)).toHaveLength(3);
  expect(formatWrongRecordTime(rec)).toBe('2026.11.1-14:30');

  // Historical record without createdAt recovers hour:minute from id wrong-<ms>-0
  expect(formatWrongRecordTime({ id: `wrong-${ts}-0`, date: '2026-11-01' })).toBe('2026.11.1-14:30');

  // 3. WrongView renders dropdown category selector and density switcher
  const wrongHtml = render(React.createElement(WrongView, { onOpenImportModal: noop, onOpenDetailModal: noop, onOpenDeleteConfirm: noop }));
  expect(wrongHtml).toContain('aria-label="筛选错题分类"');
  expect(wrongHtml).toContain('所属分类（选择即定位 · 自动记忆）');
  expect(wrongHtml).toContain('2列');
  expect(wrongHtml).toContain('列表');
  expect(wrongHtml).toContain('3列');

  // 4. PhotoImportModal renders 9-category capsule grid instead of native select
  const importHtml = render(React.createElement(PhotoImportModal, { isOpen: true, initialTarget: { subject: '数量关系' }, onClose: noop, onToast: noop }));
  expect(importHtml).toContain('所属分类');
  expect(importHtml).not.toContain('<select');

  // 5. WrongDetailModal renders multi-image switcher and hour:minute timestamp
  const detailHtml = render(React.createElement(WrongDetailModal, { isOpen: true, record: rec, onClose: noop }));
  expect(detailHtml).toContain('2026.11.1-14:30');
  expect(detailHtml).toContain('1 / 3');
  expect(detailHtml).toContain('aria-label="点击放大查看错题图片"');
  expect(detailHtml).toContain('点击放大');
});
