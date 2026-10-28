import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE } from '../src/constants/initialData';
import * as sessions from '../src/utils/timerSessions';
import { applyAddCountdown, applyUpdateCountdown, applyDeleteCountdown, COUNTDOWN_MAX, applyAddCustomPlan } from '../src/utils/workflowMutators';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { validateWorkspacePayload } from '../server/workspace';
import { StandaloneTimerModal } from '../src/components/views/StandaloneTimerModal';
import { TodayView } from '../src/components/views/TodayView';
import { CountdownModal } from '../src/components/views/EditModals';

const t = new Date('2026-10-28T10:00:00').getTime();
const noop = () => {};
const fresh = () => structuredClone(BLANK_STATE);
const render = (element: React.ReactElement, state: any = fresh(), activeDate = '2026-10-28') =>
  renderToStaticMarkup(<AppContext.Provider value={{ state, activeDate } as any}>{element}</AppContext.Provider>);

function startedSession(state: any, subject: '申论' | '其他' | '资料分析' | undefined, focusMinutes = 20) {
  const created = sessions.applyCreateSession(state, { timerMode: 'countup', focusMinutes, restMinutes: 5 }, t, subject);
  expect(created).not.toHaveProperty('error');
  const session = (created as any).value;
  expect(sessions.applySessionAction(state, session.id, 'focus', t)).not.toHaveProperty('error');
  return session;
}

describe('番茄钟：开始前选类别，结束自动登记为自定义学习', () => {
  it('creates a session with the selected category and rejects invalid categories', () => {
    const state = fresh();
    const session = startedSession(state, '申论');
    expect(state.timerSessions?.[0]).toMatchObject({ subject: '申论', status: 'running', timerMode: 'countup' });
    expect(sessions.applyCreateSession(fresh(), { timerMode: 'countup', focusMinutes: 20, restMinutes: 5 }, t, '未知科目' as any)).toHaveProperty('error');
    // 开始后锁定：只有 paused 状态才能改类别
    expect(sessions.applySessionSubject(state, session.id, '其他')).toHaveProperty('error');
    expect(sessions.applySessionAction(state, session.id, 'pause', t + 1000)).not.toHaveProperty('error');
    expect(sessions.applySessionSubject(state, session.id, '其他')).not.toHaveProperty('error');
    expect(state.timerSessions?.[0].subject).toBe('其他');
  });

  it('finishes and auto-registers exactly one custom record with the category subject', () => {
    const state = fresh();
    const session = startedSession(state, '申论');
    const result = sessions.applyFinishAndAutoRegister(state, session.id, t + 20 * 60000);
    expect(result).not.toHaveProperty('error');
    expect(state.plans).toHaveLength(1);
    expect(state.records).toHaveLength(1);
    const plan = state.plans[0], record = state.records[0];
    expect(plan).toMatchObject({ name: '番茄钟 · 申论', type: 'custom', subject: '申论', done: true, libraryId: '', sourceId: '', actualMinutes: 20 });
    expect(record).toMatchObject({ planId: plan.id, type: 'custom', subject: '申论', minutes: 20, questions: 0, errors: 0, sessionId: session.id });
    expect(state.timerSessions?.[0]).toMatchObject({ status: 'registered', planId: plan.id });
    expect(state.books).toHaveLength(0);
    expect(state.courses).toHaveLength(0);
    // 重复结束/登记不会产生第二条记录
    expect(sessions.applyFinishAndAutoRegister(state, session.id, t + 21 * 60000)).not.toHaveProperty('error');
    expect(state.plans).toHaveLength(1);
    expect(state.records).toHaveLength(1);
  });

  it('requires a category before finishing a new-style focus session', () => {
    const state = fresh();
    const session = startedSession(state, undefined);
    expect(sessions.applyFinishAndAutoRegister(state, session.id, t + 20 * 60000)).toMatchObject({ error: { code: 'SUBJECT_REQUIRED' } });
    expect(state.plans).toHaveLength(0);
    expect(state.records).toHaveLength(0);
  });

  it('keeps the legacy association path for pending sessions without a category', () => {
    const state = fresh();
    state.books = [{ id: 'b', name: 'Book', subject: '资料分析', total: 100, done: 0, errors: 0, minutes: 0, pages: 1 }];
    state.library = [{ id: 'lib-book-b', type: 'book', sourceId: 'b', name: 'Book', subject: '资料分析', defaultMinutes: 30 }];
    const session = startedSession(state, undefined);
    expect(sessions.applySessionAction(state, session.id, 'finish', t + 20 * 60000)).not.toHaveProperty('error');
    expect(state.timerSessions?.[0].status).toBe('pending');
    const registered = sessions.applyRegisterSession(state, session.id, { libraryId: 'lib-book-b', questions: 10, errors: 2 }, t + 20 * 60000);
    expect(registered).not.toHaveProperty('error');
    expect(state.records[0]).toMatchObject({ type: 'book', subject: '资料分析', minutes: 20, questions: 10, errors: 2 });
  });

  it('round-trips category sessions through backup and server payload validation', () => {
    const state = fresh();
    const session = startedSession(state, '政治理论');
    expect(sessions.applyFinishAndAutoRegister(state, session.id, t + 30 * 60000)).not.toHaveProperty('error');
    expect(validateWorkspacePayload(state, 5).valid).toBe(true);
    const backup = validateAndMigrateBackup(JSON.stringify(state));
    expect(backup.valid).toBe(true);
    expect(backup.migratedState?.timerSessions).toEqual(state.timerSessions);
    expect(backup.migratedState?.records).toEqual(state.records);
    // 非法类别必须被同步/备份校验拒绝
    const invalidSync = structuredClone(state);
    (invalidSync.timerSessions![0] as any).subject = '综合';
    expect(validateWorkspacePayload(invalidSync, 5).valid).toBe(false);
    expect(validateAndMigrateBackup(JSON.stringify(invalidSync)).valid).toBe(false);
  });

  it('renders category picker before start, locks it while running, and keeps legacy form for old pending sessions', () => {
    const freshHtml = render(<StandaloneTimerModal isOpen onClose={noop} />);
    expect(freshHtml).toContain('aria-label="学习类别"');
    expect(freshHtml).toContain('政治理论');
    expect(freshHtml).toContain('开始专注');
    expect(freshHtml).not.toContain('关联学习事项');

    const runningState = fresh();
    const running = startedSession(runningState, '申论');
    const runningHtml = render(<StandaloneTimerModal isOpen onClose={noop} />, runningState);
    expect(runningHtml).toContain('已选：申论 · 已锁定');
    expect(runningHtml).not.toContain('aria-label="学习类别"');

    const legacyState = fresh();
    const legacy = startedSession(legacyState, undefined);
    sessions.applySessionAction(legacyState, legacy.id, 'finish', t + 20 * 60000);
    const legacyHtml = render(<StandaloneTimerModal isOpen onClose={noop} />, legacyState);
    // 旧版无类别待登记会话从“待登记计时”列表进入补登记表单
    expect(legacyHtml).toContain('待登记计时（1）');
    expect(legacyHtml).toContain('补登记');
  });
});

describe('倒数日：自定义名称与日期、增删改、上限与兼容', () => {
  it('adds, renames, reschedules and deletes countdowns, including the default three', () => {
    const state = fresh();
    expect(state.countdowns.map(c => c.name)).toEqual(['国考', '省考', '事业编']);
    const added = applyAddCountdown(state, '  考研复试 ', '2027-03-20');
    expect(added).not.toHaveProperty('error');
    const addedValue = (added as any).value;
    expect(addedValue).toMatchObject({ name: '考研复试', date: '2027-03-20' });
    expect(state.countdowns).toHaveLength(4);
    expect(applyUpdateCountdown(state, addedValue.id, '2027-03-25', '考研面试')).not.toHaveProperty('error');
    expect(state.countdowns.find(c => c.id === addedValue.id)).toMatchObject({ name: '考研面试', date: '2027-03-25' });
    expect(applyDeleteCountdown(state, 'exam-national')).not.toHaveProperty('error');
    expect(state.countdowns.map(c => c.name)).toEqual(['省考', '事业编', '考研面试']);
    expect(applyDeleteCountdown(state, 'exam-national')).toHaveProperty('error');
  });

  it('validates names, dates and the six-item limit', () => {
    const state = fresh();
    expect(applyAddCountdown(state, '   ', '')).toHaveProperty('error');
    expect(applyAddCountdown(state, '名'.repeat(21), '')).toHaveProperty('error');
    expect(applyAddCountdown(state, '目标', '2026.12.01')).toHaveProperty('error');
    expect(applyAddCountdown(state, '目标', '')).not.toHaveProperty('error');
    while (state.countdowns.length < COUNTDOWN_MAX) {
      expect(applyAddCountdown(state, `目标${state.countdowns.length}`, '')).not.toHaveProperty('error');
    }
    expect(state.countdowns).toHaveLength(COUNTDOWN_MAX);
    expect(applyAddCountdown(state, '第七个', '')).toMatchObject({ error: { code: 'COUNTDOWN_LIMIT' } });
    expect(applyUpdateCountdown(state, 'exam-national', 'bad-date')).toHaveProperty('error');
    expect(applyUpdateCountdown(state, 'exam-national', '', '  ')).toHaveProperty('error');
  });

  it('keeps user-defined countdowns and deletions in backups without forcing the fixed three back', () => {
    const state = fresh();
    applyDeleteCountdown(state, 'exam-national');
    applyDeleteCountdown(state, 'exam-provincial');
    const added = applyAddCountdown(state, '考研', '2027-12-25');
    expect(added).not.toHaveProperty('error');
    expect(state.countdowns).toHaveLength(2);
    const backup = validateAndMigrateBackup(JSON.stringify(state));
    expect(backup.valid).toBe(true);
    expect(backup.migratedState?.countdowns).toEqual(state.countdowns);
    expect(validateWorkspacePayload(backup.migratedState, backup.migratedState!.version).valid).toBe(true);
  });

  it('still migrates legacy fixed countdown IDs but preserves other entries in order', () => {
    const legacy = JSON.stringify({
      ...structuredClone(BLANK_STATE),
      countdowns: [
        { id: 'cd-1', name: '2027年国考', date: '2026-11-29' },
        { id: 'custom-keep', name: '考研', date: '2027-12-25' },
        { id: 'cd-3', name: '上半年事业编联考', date: '2027-04-18' },
      ],
    });
    const result = validateAndMigrateBackup(legacy);
    expect(result.valid).toBe(true);
    expect(result.migratedState?.countdowns).toEqual([
      { id: 'exam-national', name: '2027年国考', date: '2026-11-29' },
      { id: 'custom-keep', name: '考研', date: '2027-12-25' },
      { id: 'exam-public-service', name: '上半年事业编联考', date: '2027-04-18' },
    ]);
  });

  it('renders custom countdown cards with ended state and an add entry, and hides add at six items', () => {
    const state = fresh();
    state.countdowns = [
      { id: 'cd-future', name: '考研', date: '2026-12-25' },
      { id: 'cd-ended', name: '模拟考', date: '2026-10-01' },
      { id: 'exam-national', name: '国考', date: '' },
    ];
    const html = render(<TodayView onOpenAddPlan={noop} onOpenFocus={noop} onOpenComplete={noop} onOpenCountdownEdit={noop} onAddCountdown={noop} />, state);
    expect(html).toContain('考研');
    expect(html).toContain('已结束');
    expect(html).toContain('设置日期');
    expect(html).toContain('添加倒数日');
    expect(html).toContain('overflow-x-auto');

    const full = fresh();
    full.countdowns = Array.from({ length: COUNTDOWN_MAX }, (_, i) => ({ id: `cd-${i}`, name: `目标${i}`, date: '' }));
    const fullHtml = render(<TodayView onOpenAddPlan={noop} onOpenFocus={noop} onOpenComplete={noop} onOpenCountdownEdit={noop} onAddCountdown={noop} />, full);
    expect(fullHtml).not.toContain('aria-label="添加倒数日"');
  });

  it('renders create and edit countdown modals with delete confirmation entry', () => {
    const state = fresh();
    const createHtml = render(<CountdownModal isOpen mode="create" onClose={noop} onToast={noop} />, state);
    expect(createHtml).toContain('添加倒数日');
    expect(createHtml).toContain('倒数日名称');
    expect(createHtml).toContain('倒数日目标日期');

    const editHtml = render(<CountdownModal isOpen mode="edit" countdownId="exam-national" onClose={noop} onToast={noop} />, state);
    expect(editHtml).toContain('编辑倒数日');
    expect(editHtml).toContain('删除倒数日');
  });
});

describe('番茄钟登记与自定义日程统计口径一致', () => {
  it('custom plan created by the timer registers against the same subject totals as manual custom plans', () => {
    const state = fresh();
    const session = startedSession(state, '资料分析', 20);
    expect(sessions.applyFinishAndAutoRegister(state, session.id, t + 20 * 60000)).not.toHaveProperty('error');
    const manual = applyAddCustomPlan(state, '整理错题', '资料分析', '2026-10-28', 30);
    expect(manual).not.toHaveProperty('error');
    const manualPlan = (manual as any).value;
    // 自定义学习总量 = 20 + 30，科目统计来自同一批记录，不重复累计
    state.records.push({
      id: 'rec-manual', planId: manualPlan.id, date: '2026-10-28', type: 'custom', sourceId: '', subject: '资料分析', minutes: 30, questions: 0, errors: 0,
    });
    state.plans.push({ ...manualPlan, done: true, actualMinutes: 30 });
    const customTotal = state.records.filter(r => r.type === 'custom').reduce((n, r) => n + r.minutes, 0);
    const subjectTotal = state.records.filter(r => r.subject === '资料分析').reduce((n, r) => n + r.minutes, 0);
    expect(customTotal).toBe(50);
    expect(subjectTotal).toBe(50);
  });
});
