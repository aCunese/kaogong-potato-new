import { describe, expect, it } from 'bun:test';
import { BLANK_STATE, buildLibraryFromSources } from '../src/constants/initialData';
import * as sessions from '../src/utils/timerSessions';
import { applyAddTodo, applyStartTimer, applyDeletePlan } from '../src/utils/workflowMutators';
import { getTimerReminder } from '../src/utils/studyTimers';
import { validateAndMigrateBackup } from '../src/utils/backupValidator';
import { validateWorkspacePayload } from '../server/workspace';
const config = { timerMode: 'pomodoro' as const, focusMinutes: 25, restMinutes: 5 };
const t = new Date('2026-10-28T10:00:00').getTime();
function fixture() {
 const s = structuredClone(BLANK_STATE);
 s.courses=[{id:'c',name:'Course',subject:'资料分析',totalLessons:10,completedLessons:0,minutes:0,url:''}];
 s.books=[{id:'b',name:'Book',subject:'资料分析',total:100,done:0,errors:0,minutes:0,pages:1}];
 s.library=buildLibraryFromSources(s.books,s.courses);return s;
}
function create(s:any) { const r=sessions.applyCreateSession(s,config,t);if('error' in r)throw Error(r.error.message);return r.value; }
describe('Schema 5 independent timers',()=>{
 it('works without sources; overtime continues silently and rest stops at its deadline',()=>{
  const s=structuredClone(BLANK_STATE);const a=create(s);
  expect(sessions.applySessionAction(s,a.id,'focus',t)).not.toHaveProperty('error');
  expect(sessions.sessionTotals(a,t+30*60000).focusMs).toBe(30*60000);
  sessions.applySessionAction(s,a.id,'rest',t+30*60000);
  expect(sessions.sessionTotals(a,t+50*60000)).toEqual({focusMs:30*60000,restMs:5*60000});
  sessions.maintainSessionTimers(s,t+50*60000);expect(a.status).toBe('paused');
  sessions.applySessionAction(s,a.id,'focus',t+50*60000);
  sessions.applySessionAction(s,a.id,'finish',t+51*60000);
  expect(a.status).toBe('pending'); expect(sessions.sessionTotals(a)).toEqual({focusMs:31*60000,restMs:5*60000});
  expect(s.records).toHaveLength(0);expect(s.plans).toHaveLength(0);
 });
 it('registers once, rejects invalid/deleted sources without partial writes, and reverses its statistics',()=>{
  const s=fixture();const a=create(s);sessions.applySessionAction(s,a.id,'focus',t);sessions.applySessionAction(s,a.id,'finish',t+35*60000);
  const before=structuredClone(s);
  expect(sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:0},t+35*60000)).toHaveProperty('error');expect(s).toEqual(before);
  expect(sessions.applyRegisterSession(s,a.id,{libraryId:'missing',lessons:2},t+35*60000)).toHaveProperty('error');expect(s).toEqual(before);
  const done=sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:2},t+35*60000);expect(done).not.toHaveProperty('error');
  expect(s.courses[0]).toMatchObject({minutes:35,completedLessons:2});expect(s.records).toHaveLength(1);
  sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:2},t+35*60000);expect(s.records).toHaveLength(1);expect(s.courses[0].minutes).toBe(35);
  applyDeletePlan(s,s.plans[0].id);expect(s.courses[0].minutes).toBe(0);expect((s as any).timerSessions[0].status).toBe('voided');
 });
 it('retains milliseconds across pauses/config changes and splits midnight without interrupting',()=>{
  const s=fixture();const a=create(s);const start=new Date('2026-10-28T23:59:30').getTime();
  sessions.applySessionAction(s,a.id,'focus',start);sessions.applySessionAction(s,a.id,'pause',start+30500);
  sessions.applySessionConfig(s,a.id,{...config,timerMode:'countup'});
  sessions.applySessionAction(s,a.id,'focus',start+40000);sessions.applySessionAction(s,a.id,'finish',start+70000);
  expect(sessions.sessionTotals(a).focusMs).toBe(60500);
  expect(sessions.sessionDays(a).map(d=>d.date)).toEqual(['2026-10-28','2026-10-29']);
  sessions.applyRegisterSession(s,a.id,{libraryId:'lib-book-b',questions:10,errors:2},start+70000);
  expect(s.books[0]).toMatchObject({done:10,errors:2,minutes:1});
  expect(s.records.reduce((n,r)=>n+r.minutes,0)).toBe(1);expect(s.records.find(r=>r.questions)?.date).toBe('2026-10-29');
 });
 it('prevents simultaneous plan/session timers, repeated start and invalid settings',()=>{
  const s=fixture();const a=create(s);
  sessions.applySessionAction(s,a.id,'focus',t);sessions.applySessionAction(s,a.id,'focus',t+1000);expect(a.runningSince).toBe(t);
  expect(sessions.applySessionConfig(s,a.id,{...config,focusMinutes:0})).toHaveProperty('error');
  s.plans.push({id:'p',date:'2026-10-28',libraryId:'lib-book-b',sourceId:'b',type:'book',subject:'资料分析',name:'Book',plannedMinutes:30,actualMinutes:0,done:false,timerStart:0});
  expect(applyStartTimer(s,'p',t)).toHaveProperty('error');
  sessions.applySessionAction(s,a.id,'pause',t+1000);applyStartTimer(s,'p',t+1000);
  expect(sessions.applySessionAction(s,a.id,'rest',t+2000)).toHaveProperty('error');
 });
 it('roundtrips Schema 5 through backup/server and never downgrades on todo mutation',()=>{
  const s=fixture();const a=create(s);sessions.applySessionAction(s,a.id,'focus',t);
  applyAddTodo(s,'Keep schema','2026-10-28',t);expect(s.version).toBe(5);
  const result=validateAndMigrateBackup(JSON.stringify(s));expect(result.valid).toBe(true);expect(result.migratedState).toEqual(s);
  expect(validateWorkspacePayload(s,5).valid).toBe(true);expect(validateWorkspacePayload(s,4).valid).toBe(false);
  const invalid=structuredClone(s);(invalid as any).timerSessions[0].segments=[{phase:'focus',start:t,end:t-1}];expect(validateWorkspacePayload(invalid,5).valid).toBe(false);
 });
 it('does not produce any focus overtime notification for legacy or new focus mode',()=>{
  const plan:any={id:'p',name:'Focus',date:'2026-10-28',timerMode:'pomodoro',focusMinutes:25,timerStart:t,accumulatedMs:0,done:false};
  expect(getTimerReminder(plan,t+30*60000)).toBeUndefined();
 });
});
it('keeps session statistics unchanged by association and excludes reversed/unfinished sessions',async()=>{
 const {getSessionAnalysis}=await import('../src/utils/sessionAnalysis');const s=fixture(),a=create(s);
 sessions.applySessionAction(s,a.id,'focus',t);sessions.applySessionAction(s,a.id,'rest',t+30*60000);sessions.applySessionAction(s,a.id,'finish',t+40*60000);
 const before=getSessionAnalysis(s.timerSessions!,'all','2026-10-28');expect(before).toEqual({focusMs:30*60000,restMs:5*60000});
 sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:1},t+40*60000);expect(getSessionAnalysis(s.timerSessions!,'all','2026-10-28')).toEqual(before);
 applyDeletePlan(s,s.plans[0].id);expect(getSessionAnalysis(s.timerSessions!,'all','2026-10-28')).toEqual({focusMs:0,restMs:0});
});
it('guest merge remaps registered session links and preserves pending sessions and schema 5',async()=>{
 const {buildGuestMigration}=await import('../src/utils/guestMigration');const guest=fixture(),a=create(guest);
 sessions.applySessionAction(guest,a.id,'focus',t);sessions.applySessionAction(guest,a.id,'finish',t+60000);sessions.applyRegisterSession(guest,a.id,{libraryId:'lib-course-c',lessons:1},t+60000);
 const account=structuredClone(guest);const {mergedState}=buildGuestMigration(account,guest);
 expect(mergedState.timerSessions).toHaveLength(2);expect(validateWorkspacePayload(mergedState,5).valid).toBe(true);
 const pending=fixture(),p=create(pending);sessions.applySessionAction(pending,p.id,'focus',t);sessions.applySessionAction(pending,p.id,'finish',t+60000);
 const result=buildGuestMigration(fixture(),pending);expect(result.mergedState.timerSessions).toHaveLength(1);expect(result.mergedState.version).toBe(5);
});
it('counts one course session once even when its minutes span two calendar days',async()=>{
 const {getCourseAnalysis}=await import('../src/utils/courseAnalysis');const s=fixture(),a=create(s);const start=new Date('2026-10-28T23:58:00').getTime();
 sessions.applySessionAction(s,a.id,'focus',start);sessions.applySessionAction(s,a.id,'finish',start+5*60000);sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:2},start+5*60000);
 const summary=getCourseAnalysis(s.courses,s.records);expect(summary.minutes).toBe(5);expect(summary.lessons).toBe(2);expect(summary.sessions).toBe(1);expect(summary.courses[0].sessions).toBe(1);
});
it('legacy phase switch cannot bypass the global single-running-timer guard',async()=>{
 const {applyAddPlan,applyConfigureTimer,applySwitchTimerPhase}=await import('../src/utils/workflowMutators');const s=fixture();
 const added=applyAddPlan(s,'lib-book-b','2026-10-28',30);if('error'in added)throw Error(added.error.message);applyConfigureTimer(s,added.value.id,config);
 const a=create(s);sessions.applySessionAction(s,a.id,'focus',t);const before=structuredClone(s);
 expect(applySwitchTimerPhase(s,added.value.id,'rest',t+1000)).toHaveProperty('error');expect(s).toEqual(before);
});
it('migrates registered historical session after its source was deleted without losing links',async()=>{
 const {buildGuestMigration}=await import('../src/utils/guestMigration');const {applyDeleteCourse}=await import('../src/utils/workflowMutators');const guest=fixture(),a=create(guest);
 sessions.applySessionAction(guest,a.id,'focus',t);sessions.applySessionAction(guest,a.id,'finish',t+60000);sessions.applyRegisterSession(guest,a.id,{libraryId:'lib-course-c',lessons:1},t+60000);applyDeleteCourse(guest,'c');
 expect(validateWorkspacePayload(guest,5).valid).toBe(true);const {mergedState}=buildGuestMigration(structuredClone(BLANK_STATE),guest);
 expect(mergedState.plans).toHaveLength(1);expect(mergedState.courses).toHaveLength(0);expect(mergedState.timerSessions?.[0].status).toBe('registered');expect(validateWorkspacePayload(mergedState,5).valid).toBe(true);
});
it('uses total session duration in the completion summary while quantities belong to the end day',async()=>{
 const presentation=await import('../src/utils/workflowPresentation') as any;const s=fixture(),a=create(s);const start=new Date('2026-10-28T23:58:00').getTime();
 sessions.applySessionAction(s,a.id,'focus',start);sessions.applySessionAction(s,a.id,'finish',start+5*60000);sessions.applyRegisterSession(s,a.id,{libraryId:'lib-course-c',lessons:2},start+5*60000);
 const display=presentation.getPlanCompletion(s.plans[0],s.records);expect(display.minutes).toBe(5);expect(display.summary).toContain('5 分钟');expect(display.record.date).toBe('2026-10-29');
});
it('rejects malformed core arrays without throwing before normal workspace validation',()=>{
 expect(()=>validateWorkspacePayload({...BLANK_STATE,version:5,plans:{},timerSessions:[]},5)).not.toThrow();expect(validateWorkspacePayload({...BLANK_STATE,version:5,plans:{},timerSessions:[]},5).valid).toBe(false);
});
