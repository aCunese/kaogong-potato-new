import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Button } from '../common/UIComponents';
import { PotatoSprite } from '../common/PotatoSprite';
import { TimerMode, MutationResult } from '../../types';
import { sessionTotals } from '../../utils/timerSessions';
const format = (ms: number) => { const seconds=Math.floor(Math.abs(ms)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; };
const positive = (value:string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>0;
export function StandaloneTimerModal({ isOpen, onClose }: { isOpen:boolean; onClose:()=>void }) {
  const { state, beginTimerSession, sessionAction, configureSession, registerSession, registerUpdateBlocker } = useApp();
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [mode,setMode]=useState<TimerMode | 'rest'>(()=>{const active=state.timerSessions?.find(s=>s.status==='running'||s.status==='paused');return active?.phase==='rest'?'rest':active?.timerMode??'countup';}),[focus,setFocus]=useState(()=>String(state.timerSessions?.find(s=>s.status==='running'||s.status==='paused')?.focusMinutes??25)),[rest,setRest]=useState(()=>String(state.timerSessions?.find(s=>s.status==='running'||s.status==='paused')?.restMinutes??5));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const [,tick]=useState(0);
  const [sourceType,setSourceType]=useState<'book'|'course'|'custom'>('book'),[sourceId,setSourceId]=useState('');
  const [questions,setQuestions]=useState(''),[errors,setErrors]=useState('0'),[lessons,setLessons]=useState('1');
  const selected = selectedId ? state.timerSessions?.find(s=>s.id===selectedId&&s.status==='pending'&&sessionTotals(s).focusMs>0) : undefined;
  const current = selected ?? state.timerSessions?.find(s=>s.status==='running'||s.status==='paused');
  useEffect(()=>{if(selectedId&&!selected)setSelectedId(null);},[selectedId,selected?.id]);
  const totals=current?sessionTotals(current):{focusMs:0,restMs:0};
  const running=current?.status==='running',pending=current?.status==='pending'&&totals.focusMs>0;
  useEffect(()=>{if(!isOpen)return;setError('');setSuccess('');if(current){setMode(current.phase==='rest'?'rest':current.timerMode);setFocus(String(current.focusMinutes));setRest(String(current.restMinutes));}},[isOpen,current?.id]);
  useEffect(()=>{if(!isOpen)return;const interval=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(interval);},[isOpen]);
  useEffect(()=>{if(isOpen&&registerUpdateBlocker)return registerUpdateBlocker('standalone-timer','正在设置计时或登记学习数据');},[isOpen,registerUpdateBlocker]);
  const sources=state.library.filter(l=>l.type===sourceType);
  const source=sources.find(l=>l.id===sourceId)??sources[0];
  const course=state.courses.find(c=>sourceType==='course'&&c.id===source?.sourceId);
  const remaining=course?course.totalLessons-course.completedLessons:0;
  const validLearning=mode==='countup'||positive(focus);
  const config={timerMode:mode==='rest'?current?.timerMode??'countup':mode,focusMinutes:positive(focus)?Number(focus):25,restMinutes:positive(rest)?Number(rest):5};
  const run=async<T,>(action:()=>Promise<MutationResult<T>>) => {
    if(busy)return false;setBusy(true);setError('');setSuccess('');
    try{const result=await action();if(!result.ok){setError(result.message);return false;}return true;}
    catch{setError('操作未保存，请重试；原计时数据已保留。');return false;}finally{setBusy(false);}
  };
  const start=async(phase:'focus'|'rest')=>{
    if((phase==='focus'&&!validLearning)||(phase==='rest'&&!positive(rest)))return;
    await run<unknown>(async()=>{
      if(current){
        if(!running){const saved=await configureSession(current.id,config);if(!saved.ok)return saved;}
        return sessionAction(current.id,phase);
      }
      return beginTimerSession(config,phase);
    });
  };
  const register=async(e:React.FormEvent)=>{
    e.preventDefault();if(!current||!source)return;
    const saved=await run(()=>registerSession(current.id,{libraryId:source.id,questions:Number(questions),errors:Number(errors),lessons:Number(lessons)}));
    if(saved){setSelectedId(null);setQuestions('');setErrors('0');setLessons('1');setSuccess('已关联学习事项，进度和用时已更新。');}
  };
  const displayRest=running&&current?.phase==='rest';
  const phaseMs=(current?.phaseMs??0)+(running?Math.max(0,Date.now()-(current?.runningSince??Date.now())):0);
  const target=(current?.focusMinutes??Number(focus))*60000;
  const clock=mode==='rest'?Math.max(0,Number(rest)*60000-(current?.phase==='rest'?phaseMs:0)):mode==='countdown'?target-totals.focusMs:mode==='pomodoro'?target-(current?.phase==='focus'?phaseMs:0):totals.focusMs;
  const pendingOthers=(state.timerSessions??[]).filter(s=>s.status==='pending'&&sessionTotals(s).focusMs>0&&s.id!==current?.id);
  const validRegistration=Boolean(source)&&totals.focusMs>0&&(sourceType==='book'? positive(questions)&&/^\d+$/.test(errors)&&Number.isSafeInteger(Number(questions))&&Number.isSafeInteger(Number(errors))&&Number(errors)<=Number(questions):sourceType==='course'?positive(lessons)&&Number(lessons)<=remaining:true);
  return <Modal isOpen={isOpen} onClose={onClose} title="番茄钟">
    {error&&<p role="alert" className="mb-3 rounded-xl bg-alarm-light text-alarm p-3 text-xs">{error}</p>}
    {success&&<p role="status" className="mb-3 text-sage text-xs">{success}</p>}
    {pending ? <form onSubmit={register} className="space-y-4">
      <h3 className="font-bold text-sm">结束计时 · 关联学习事项</h3>
      <div className="rounded-xl bg-sage-light/40 p-3 text-xs space-y-2"><p>实际学习用时 <output aria-label="本次实际学习用时">{Math.floor(totals.focusMs/60000)} 分 {Math.floor(totals.focusMs%60000/1000)} 秒</output></p><p>休息 {format(totals.restMs)} · 不计入学习用时</p><p className="text-ink-muted">登记按整分钟确认：{totals.focusMs>0?Math.max(1,Math.round(totals.focusMs/60000)):0} 分钟，用时不能手动修改。</p></div>
      <div role="group" aria-label="关联事项类型" className="grid grid-cols-3 gap-1 bg-cream rounded-xl p-1">{([['book','题本'],['course','网课'],['custom','其他学习']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={sourceType===value} onClick={()=>{setSourceType(value);setSourceId('');setError('');}} className={`p-2 rounded-lg text-xs ${sourceType===value?'bg-paper text-sage font-bold':'text-ink-muted'}`}>{label}</button>)}</div>
      <label className="block text-xs text-ink-muted">关联事项<select aria-label="关联学习事项" value={source?.id??''} onChange={e=>setSourceId(e.target.value)} className="mt-1 w-full rounded-xl border border-line p-2.5 bg-cream/70">{!sources.length&&<option value="">请先在学习库添加相应事项</option>}{sources.map(l=><option key={l.id} value={l.id}>{l.subject} · {l.name}</option>)}</select></label>
      {sourceType==='book'&&<div className="grid grid-cols-2 gap-2"><label className="text-xs">本次做题数<input aria-label="本次做题数" type="number" min="1" step="1" required value={questions} onChange={e=>setQuestions(e.target.value)} className="mt-1 w-full p-2 rounded-xl border border-line bg-cream/70"/></label><label className="text-xs">本次错题数<input aria-label="本次错题数" type="number" min="0" step="1" required value={errors} onChange={e=>setErrors(e.target.value)} className="mt-1 w-full p-2 rounded-xl border border-line bg-cream/70"/></label></div>}
      {sourceType==='course'&&<label className="block text-xs">本次完成节数 · 剩余 {remaining} 节<input aria-label="本次完成节数" type="number" min="1" max={remaining} step="1" required value={lessons} onChange={e=>setLessons(e.target.value)} className="mt-1 w-full p-2 rounded-xl border border-line bg-cream/70"/></label>}
      <Button fullWidth variant="primary" type="submit" disabled={busy||!validRegistration}>保存学习登记</Button>
      {!totals.focusMs&&<p className="text-xs text-ink-muted">本次只有休息时间，已进入休息统计，无须关联学习事项。</p>}
      <Button fullWidth variant="light" onClick={()=>{setSelectedId(null);setError('');}}>开始新的计时</Button>
      <p className="text-xs text-ink-muted">暂时关闭会保留待登记记录；稍后可在番茄钟中继续。</p>
    </form>:<div className="space-y-4">
      <fieldset disabled={running||busy} className="space-y-3 disabled:opacity-70">
        <div role="group" aria-label="计时模式" className="grid grid-cols-4 gap-1 bg-cream p-1 rounded-xl">{([['countup','正计时'],['countdown','倒计时'],['pomodoro','专注时间'],['rest','休息']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)} className={`py-2 rounded-lg text-xs ${mode===value?'bg-sage text-white font-bold':'text-ink-muted'}`}>{label}</button>)}</div>
        {mode!=='countup'&&mode!=='rest'&&<label className="block text-xs text-ink-muted">{mode==='countdown'?'倒计时分钟':'专注时长（分钟）'}<input aria-label="专注时长" type="number" min="1" step="1" value={focus} onChange={e=>setFocus(e.target.value)} className="mt-1 w-full p-2.5 border border-line rounded-xl bg-cream/70"/></label>}
        {mode==='rest'&&<label className="block text-xs text-ink-muted">休息时长（分钟）<input aria-label="休息时长" type="number" min="1" step="1" value={rest} onChange={e=>setRest(e.target.value)} className="mt-1 w-full p-2.5 border border-line rounded-xl bg-cream/70"/></label>}
      </fieldset>
      <div className="text-center"><div className="flex justify-center"><PotatoSprite pose={displayRest?7:1} size={72}/></div><p className="text-xs text-sage">{displayRest?'休息中 · 不计学习用时':running?'正在专注':current?.phase==='rest'&&phaseMs>=(current?.restMinutes??5)*60000?'休息已结束，等待手动开始':'准备好后开始'}</p><output aria-label="计时读数" className="block text-5xl font-bold font-mono my-3">{clock<0?'+':''}{format(clock||0)}</output><p className="text-xs text-ink-muted">专注 {format(totals.focusMs)} · 休息 {format(totals.restMs)}</p></div>
      <p className="text-xs text-ink-muted">{mode==='rest'?'休息到点自动暂停，保持00:00；不计入学习用时。':'专注到点继续累计，不提醒、不自动切换休息；结束后再关联学习事项。'}切换功能前请先暂停，累计用时会保留。</p>
      <div className="grid grid-cols-2 gap-2"><Button variant="primary" disabled={busy||(!running&&(mode==='rest'?!positive(rest):!validLearning))} onClick={()=>running?void run(()=>sessionAction(current!.id,'pause')):void start(mode==='rest'?'rest':'focus')}>{running?'暂停':mode==='rest'?'开始休息':'开始专注'}</Button><Button disabled={busy||!current||current.status==='registered'} onClick={async()=>{if(current&&await run(()=>sessionAction(current.id,'finish'))){if(sessionTotals(current).focusMs>0)setSelectedId(current.id);else{setSelectedId(null);setSuccess('休息已保存，无须登记学习事项。');}}}}>{totals.focusMs>0?'结束并登记':'结束'}</Button></div>
    </div>}
    {pendingOthers.length>0&&<section className="mt-5 pt-3 border-t border-line space-y-2"><h3 className="text-sm font-bold">待登记计时（{pendingOthers.length}）</h3>{pendingOthers.map(s=><button key={s.id} className="block w-full rounded-xl bg-cream p-3 text-left text-xs" onClick={()=>{setSelectedId(s.id);setError('');}}>补登记 · {new Date(s.endedAt).toLocaleDateString()} · 专注 {format(sessionTotals(s).focusMs)} / 休息 {format(sessionTotals(s).restMs)}</button>)}</section>}
  </Modal>;
}
