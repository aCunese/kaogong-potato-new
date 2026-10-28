import { expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../src/context/AppContext';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import { LearningView } from '../src/components/views/LearningView';
import { AnalysisView } from '../src/components/views/AnalysisView';
import { AddPlanModal, CourseEditModal } from '../src/components/views/EditModals';
import { StandaloneTimerModal } from '../src/components/views/StandaloneTimerModal';
const noop=()=>{};
function render(element:React.ReactElement){const state=structuredClone(BLANK_STATE);state.courses=[{id:'c',name:'Course',subject:'资料分析',totalLessons:10,completedLessons:2,minutes:10,url:''}];state.books=[{id:'b',name:'Book',subject:'资料分析',total:100,pages:1,done:30,errors:5,minutes:40}];state.library=buildLibraryFromSources(state.books,state.courses);return renderToStaticMarkup(<AppContext.Provider value={{state,activeDate:'2026-10-28'} as any}>{element}</AppContext.Provider>);}
it('uses lesson-count terminology and never offers editable time',()=>{const html=render(<CourseEditModal isOpen onClose={noop} onToast={noop}/>);expect(html).toContain('总节数');expect(html).toContain('已完成节数');expect(html).not.toContain('总课时');});
it('folds both libraries into all eight subjects by default',()=>{for(const initialSubTab of ['books','courses'] as const){const html=render(<LearningView initialSubTab={initialSubTab} onOpenBookEdit={noop} onOpenCourseEdit={noop} onOpenCustomAdd={noop} onOpenDeleteConfirm={noop} onToast={noop}/>);expect((html.match(/aria-expanded="false"/g)??[]).length).toBe(8);expect(html).toContain('判断推理');expect(html).not.toContain('均速');}});
it('lets the user choose explicit source categories and preselect a course',()=>{const html=render(<AddPlanModal isOpen initialLibraryId="lib-course-c" onClose={noop} onToast={noop}/>);expect(html).toContain('日程类型');expect(html).toContain('剩余');expect(html).toContain('本次计划节数');});
it('opens an independent timer without a source picker',()=>{const html=render(<StandaloneTimerModal isOpen onClose={noop}/>);expect(html).toContain('正计时');expect(html).toContain('倒计时');expect(html).toContain('专注时间');expect(html).not.toContain('休息时长');expect(html).toContain('>休息</button>');expect(html).not.toContain('选择学习日程');});
it('integrates course progress into overall analysis with one time chart',()=>{const html=render(<AnalysisView onOpenMonthPicker={noop} onOpenLegendDetail={noop}/>);expect(html).toContain('总体分析');expect(html).not.toContain('网课分析');expect(html).toContain('网课节数进度');expect(html).toContain('专注与休息');expect(html).toContain('网课学习');});
it('leaves a completed rest clock at zero instead of showing study overtime',()=>{
 const state:any=structuredClone(BLANK_STATE);state.version=5;state.timerSessions=[{id:'s',timerMode:'countdown',focusMinutes:1,restMinutes:1,phase:'rest',phaseMs:60000,status:'paused',createdAt:1,endedAt:0,runningSince:0,segments:[{phase:'focus',start:1,end:190001},{phase:'rest',start:190001,end:250001}]}];
 const html=renderToStaticMarkup(<AppContext.Provider value={{state} as any}><StandaloneTimerModal isOpen onClose={noop}/></AppContext.Provider>);
 expect(html).toMatch(/aria-label="计时读数"[^>]*>00:00<\/output>/);
});
