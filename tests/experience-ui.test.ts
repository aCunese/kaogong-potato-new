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
  expect(html).toContain('搜索复盘原因和思路'); expect(html).toContain('type="date"'); expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('formula review');
});
it('asks for planned lessons when a course is selected for today', () => {
  const html = render(React.createElement(AddPlanModal, { isOpen: true, onClose: noop, onToast: noop }));
  expect(html).toContain('本次计划节数');
});
