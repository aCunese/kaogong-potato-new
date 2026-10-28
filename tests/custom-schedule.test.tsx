import { expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import * as mutations from '../src/utils/workflowMutators';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { buildGuestMigration } from '../src/utils/guestMigration';
import { AddPlanModal, CustomAddModal, OverallLegendModal } from '../src/components/views/EditModals';
import { AnalysisView } from '../src/components/views/AnalysisView';
import { TimeDistribution } from '../src/components/views/TimeDistribution';

const date = '2026-10-28';
const noop = () => {};
const fresh = () => structuredClone(BLANK_STATE);
const render = (element: React.ReactElement, state = fresh()) => renderToStaticMarkup(
  <AppContext.Provider value={{ state, activeDate: date } as any}>{element}</AppContext.Provider>
);
const add = (state: ReturnType<typeof fresh>, name = '复盘', subject: any = '其他', minutes = 30) => {
  expect(mutations).toHaveProperty('applyAddCustomPlan');
  return (mutations as any).applyAddCustomPlan(state, name, subject, date, minutes);
};
function completedState() {
  const state = fresh();
  for (const [name, subject, minutes] of [['背申论金句', '申论', 20], ['晨读时政', '政治理论', 30], ['整理备考计划', '其他', 15]] as const) {
    const result = add(state, name, subject, minutes);
    expect(result).not.toHaveProperty('error');
    const completion = mutations.applyCompletePlan(state, { type: 'custom', planId: result.value.id, minutes });
    expect(completion).not.toHaveProperty('error');
  }
  return state;
}
it('creates a trimmed direct custom plan without touching the library or progress counters', () => {
  const state = fresh();
  const result = add(state, '  整理备考计划  ');
  expect(result).not.toHaveProperty('error');
  expect(result.value).toMatchObject({ name: '整理备考计划', subject: '其他', type: 'custom', date, plannedMinutes: 30, actualMinutes: 0, libraryId: '', sourceId: '', done: false });
  expect(state.plans).toHaveLength(1);
  expect(state.library).toHaveLength(0);
  expect(state.records).toHaveLength(0);
});
it('rejects bad names subjects and minutes without partial state changes', () => {
  for (const [name, subject, minutes] of [[' ', '其他', 30], ['x'.repeat(201), '其他', 30], ['复盘', '未知科目', 30], ['复盘', '其他', 0], ['复盘', '其他', 1.5], ['复盘', '其他', NaN], ['复盘', '其他', -1]] as const) {
    const state = fresh(), before = structuredClone(state);
    expect(add(state, name, subject, minutes)).toHaveProperty('error');
    expect(state).toEqual(before);
  }
  expect(add(fresh(), 'x'.repeat(200))).not.toHaveProperty('error');
});
it('registers 65 minutes once and keeps question and lesson counts out of custom study', () => {
  const state = completedState();
  expect(state.records.map(r => [r.subject, r.minutes, r.questions, r.errors])).toEqual([['申论', 20, 0, 0], ['政治理论', 30, 0, 0], ['其他', 15, 0, 0]]);
  expect(state.records.reduce((n, r) => n + r.minutes, 0)).toBe(65);
  const before = structuredClone(state);
  expect(mutations.applyCompletePlan(state, { type: 'custom', planId: state.plans[0].id, minutes: 20 })).toHaveProperty('error');
  expect(state).toEqual(before);
});
it('round-trips other custom plans and records in portable backups', () => {
  const state = completedState();
  const result = validateAndMigrateBackup(JSON.stringify(state));
  expect(result.valid).toBe(true);
  expect(result.migratedState?.records).toEqual(state.records);
  expect(result.migratedState?.plans).toEqual(state.plans);
});
it('accepts other in the custom library but rejects it in book/course records and plans', () => {
  const state = fresh();
  state.library.push({ id: 'custom-other', type: 'custom', sourceId: '', name: '整理计划', subject: '其他' as any, defaultMinutes: 15 });
  expect(validateAndMigrateBackup(JSON.stringify(state)).valid).toBe(true);
  for (const type of ['book', 'course'] as const) {
    const invalid = completedState();
    invalid.plans[2].type = type;
    expect(validateAndMigrateBackup(JSON.stringify(invalid)).valid).toBe(false);
    const records = completedState();
    records.records[2].type = type;
    expect(validateAndMigrateBackup(JSON.stringify(records)).valid).toBe(false);
    const library = fresh(); library.library = [{ ...state.library[0], type }];
    expect(validateAndMigrateBackup(JSON.stringify(library)).valid).toBe(false);
  }
});
it('keeps direct custom plans and completed records during guest migration', () => {
  const guest = completedState();
  const { mergedState, preview } = buildGuestMigration(fresh(), guest);
  expect(mergedState.plans).toHaveLength(3);
  expect(mergedState.records).toHaveLength(3);
  expect(mergedState.records.reduce((n, r) => n + r.minutes, 0)).toBe(65);
  expect(preview.plansSkipped).toBe(0);
});
it('prefills an editable custom title and shows eight subjects plus other without a source picker', () => {
  const state = fresh();
  state.library.push({ id: 'custom', type: 'custom', sourceId: '', name: '晨读', subject: '申论', defaultMinutes: 20 });
  const html = render(<AddPlanModal isOpen initialLibraryId="custom" onClose={noop} onToast={noop} onOpenCustomAdd={noop} />, state);
  expect(html).toContain('aria-label="事项名称"');
  expect(html).toContain('value="晨读"');
  expect(html).toContain('maxLength="200"');
  expect(html).toContain('其他');
  expect(html).not.toContain('aria-label="选择事项"');
  expect(html).not.toContain('全部科目');
  expect(html).not.toContain('添加自定义学习事项');
});
it('allows the legacy custom-item editor to choose other', () => {
  const html = render(<CustomAddModal isOpen onClose={noop} onToast={noop} />);
  expect(html).toContain('其他');
});
it('isolates custom distribution from book and course records', () => {
  const state = completedState();
  state.records.push({ ...state.records[0], id: 'book-record', type: 'book', minutes: 100, questions: 10 }, { ...state.records[0], id: 'course-record', type: 'course', minutes: 200 });
  const html = render(<TimeDistribution records={state.records} sessions={[]} range="all" today={date} view={'custom' as any} onViewChange={noop} onLegend={noop} />, state);
  expect(html).toContain('自定义学习用时分布');
  expect(html).toContain('共65分钟');
  expect(html).toContain('其他');
  expect(html).toContain('grid-cols-2');
  expect(html).not.toContain('共365分钟');
});
it('includes other in legends and monthly totals with no fabricated accuracy', () => {
  const state = completedState();
  const legend = render(<OverallLegendModal isOpen records={state.records} onClose={noop} />, state);
  expect(legend).toContain('科目投入时间与图例详情');
  expect(legend).toContain('其他');
  expect(legend).toContain('23.1%');
  const monthly = render(<AnalysisView initialSubTab="monthly" selectedMonth="2026-10" onOpenMonthPicker={noop} onOpenLegendDetail={noop} />, state);
  expect(monthly).toContain('自定义学习用时');
  expect(monthly).toContain('各科正确率与用时');
  expect(monthly).toContain('其他');
  expect(monthly).toContain('65');
  expect(monthly).toContain('无题量');
});
