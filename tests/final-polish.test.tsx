import { CompletionModal } from '../src/components/views/CompletionModal';
import { parseIntegerDraft } from '../src/utils/numericDraft';
import { expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import { StandaloneTimerModal } from '../src/components/views/StandaloneTimerModal';
import { TodoView } from '../src/components/views/TodoView';
import { AnalysisView } from '../src/components/views/AnalysisView';
import { applyAddBook, applyEditBook, applyAddTodayTodo, applyAddPlan, applyCompletePlan } from '../src/utils/workflowMutators';

const render=(element:React.ReactElement,state:any=structuredClone(BLANK_STATE))=>renderToStaticMarkup(<AppContext.Provider value={{state,activeDate:'2000-01-01'} as any}>{element}</AppContext.Provider>);
it('shows rest as a fourth mode and hides rest settings from countup',()=>{const html=render(<StandaloneTimerModal isOpen onClose={()=>{}}/>);expect(html).toContain('>休息</button>');expect(html).not.toContain('aria-label="休息时长"');});
it('pure rest is saved without learning registration or pending entry',()=>{const state:any=structuredClone(BLANK_STATE);state.timerSessions=[{id:'r',timerMode:'countup',focusMinutes:25,restMinutes:5,phase:'rest',phaseMs:300000,status:'pending',createdAt:1,endedAt:300001,runningSince:0,segments:[{phase:'rest',start:1,end:300001}]}];const html=render(<StandaloneTimerModal isOpen onClose={()=>{}}/>,state);expect(html).not.toContain('补登记');expect(html).not.toContain('aria-label="关联学习事项"');});
it('book mutators reject invalid counts atomically while accepting zero progress',()=>{const data={name:'B',subject:'资料分析' as const,total:100,pages:0,done:0,errors:0,minutes:0};for(const updates of [{total:0},{total:1.5},{pages:-1},{done:-1},{done:0,errors:1}]){const state=structuredClone(BLANK_STATE);expect(applyAddBook(state,{...data,...updates})).toHaveProperty('error');expect(state.books).toHaveLength(0);}const state=structuredClone(BLANK_STATE);const added=applyAddBook(state,data);expect(added).not.toHaveProperty('error');const before=structuredClone(state);expect(applyEditBook(state,state.books[0].id,{total:0})).toHaveProperty('error');expect(state).toEqual(before);});it('todo date cannot be changed manually',()=>{expect(render(<TodoView/>)).toMatch(/aria-label="待办日期"[^>]*readonly/);});
it('overall analysis exposes three isolated categories with course as default',()=>{const html=render(<AnalysisView onOpenMonthPicker={()=>{}} onOpenLegendDetail={()=>{}}/>);expect(html).toContain('>网课学习</button>');expect(html).toContain('>题本学习</button>');expect(html).toContain('网课节数进度');expect(html).not.toContain('各科目每日正确率走势');});

it('todo date is read only and submission uses the actual local day across midnight',()=>{expect(render(<TodoView/>)).toMatch(/aria-label="待办日期"[^>]*readonly/);const state=structuredClone(BLANK_STATE);const before=new Date('2026-10-28T23:59:59').getTime(),after=before+2000;applyAddTodayTodo(state,'before',before);applyAddTodayTodo(state,'after',after);expect(state.todos?.map(t=>t.date)).toEqual(['2026-10-28','2026-10-29']);});
it('numeric drafts preserve meaningful zero, allow 10/100, reject blanks/fractions/negatives',()=>{for(const value of ['', '0','1.5','-1'])expect(parseIntegerDraft(value)).toBeNull();for(const value of ['10','100'])expect(parseIntegerDraft(value)).toBe(Number(value));expect(parseIntegerDraft('0','nonnegative')).toBe(0);expect(parseIntegerDraft('','nonnegative')).toBeNull();expect(parseIntegerDraft('','optional')).toBe(0);expect(parseIntegerDraft('0','optional')).toBeNull();});

it('ordinary course completion exposes the live remaining lesson maximum', () => {
  const state = structuredClone(BLANK_STATE);
  state.courses = [{ id: 'c', name: 'Course', subject: '资料分析', totalLessons: 10, completedLessons: 9, minutes: 0, url: '' }];
  state.library = buildLibraryFromSources([], state.courses);
  const added = applyAddPlan(state, 'lib-course-c', '2026-10-28', 30, 1);
  if ('error' in added) throw Error(added.error.message);
  const html = render(<CompletionModal plan={added.value} isOpen onClose={() => {}} onToast={() => {}} />, state);
  expect(html).toContain('max="1"');
});
it('book completion rejects zero questions without writes and accepts zero errors', () => {
  const state = structuredClone(BLANK_STATE);
  applyAddBook(state, {name:'Book',subject:'资料分析',total:100,pages:0,done:0,errors:0,minutes:0});
  const added = applyAddPlan(state, state.library[0].id, '2026-10-28', 30);
  if ('error' in added) throw Error(added.error.message);
  const input = {type:'book' as const,planId:added.value.id,minutes:1,questions:0,errors:0};
  const before = structuredClone(state);
  expect(applyCompletePlan(state, input)).toHaveProperty('error');
  expect(state).toEqual(before);
  expect(applyCompletePlan(state, {...input,questions:10})).not.toHaveProperty('error');
  expect(state.books[0]).toMatchObject({done:10,errors:0,minutes:1});
  expect(applyEditBook(state, state.books[0].id, {minutes:2})).toHaveProperty('error');
  expect(state.books[0].minutes).toBe(1);
});
