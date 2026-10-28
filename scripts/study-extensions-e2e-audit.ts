import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { chromium } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-study-e2e-'));
process.env.DATA_DIR = path.join(temp, 'data');
const output = path.resolve('output/study-extensions');
fs.mkdirSync(output, {recursive:true});
let clock = new Date('2026-10-28T10:00:00+09:00').getTime();
const messages: {to:string;subject:string;text:string}[] = [];
const sender = {available:true, async send(message: any) { messages.push(message); }};
const {getDb, closeDb, getCurrentGenerationId} = await import('../server/db');
const {createSession} = await import('../server/auth');
const {syncUserWorkspace} = await import('../server/workspace');
const {createEmailRouter} = await import('../server/emailRoutes');
const {startReminderWorker} = await import('../server/reminders');
const {default:app} = await import('../server/app');
const {BLANK_STATE} = await import('../src/constants/initialData');
const db = getDb();
for (const id of ['owner','viewer','stranger']) {
  db.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,id,id === 'owner' ? '备考伙伴甲' : id,'test-only-no-login',new Date().toISOString(),new Date().toISOString());
  const state = structuredClone(BLANK_STATE);
  if(id === 'owner') {
    state.books=[{id:'b',name:'图形推理700题',subject:'判断推理',total:700,pages:0,done:20,errors:12,minutes:30}];
    state.courses=[{id:'c',name:'申论精讲',subject:'申论',totalLessons:10,completedLessons:10,minutes:40,url:'https://private.example.test'}];
    state.records=[{id:'r',planId:'p',date:'2026-10-28',type:'book',sourceId:'b',subject:'判断推理',minutes:30,questions:20,errors:12},{id:'rc',planId:'pc',date:'2026-10-28',type:'course',sourceId:'c',subject:'申论',minutes:40,questions:0,errors:0,lessons:3}];
    state.plans=state.records.map((r:any)=>({id:r.planId,date:r.date,libraryId:'',name:r.type==='book'?'图形推理700题':'申论精讲',type:r.type,sourceId:r.sourceId,subject:r.subject,plannedMinutes:r.minutes,actualMinutes:r.minutes,accumulatedMs:r.minutes*60000,done:true,timerStart:0,recordId:r.id}));
  }
  const pushed=syncUserWorkspace({userId:id,expectedRevision:0,requestId:crypto.randomUUID(),generationId:getCurrentGenerationId(),schemaVersion:3,state});
  assert.equal(pushed.ok,true);
  db.prepare("UPDATE workspaces SET init_choice='blank' WHERE user_id=?").run(id);
}
const harness=express();harness.use(express.json(),cookieParser());
harness.use(createEmailRouter({db,sender,now:()=>clock,secret:'isolated-e2e-mail-secret'}));harness.use(app);
const server=harness.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+String((server.address() as any).port);
const worker=startReminderWorker({db,sender,now:()=>clock,autoStart:false});
const browser=await chromium.launch({headless:true});
const results:string[]=[], errors:string[]=[];
async function account(id:string) {
  const context=await browser.newContext({viewport:{width:393,height:873},timezoneId:'Asia/Tokyo',serviceWorkers:'block'});
  const session=createSession(id);
  await context.addCookies([{name:'potato_session',value:session.token,url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date(clock)});await page.goto(base);await page.getByRole('button',{name:'添加日程',exact:true}).waitFor();
  return {context,page,session};
}
const pass=(label:string)=>{results.push(label);console.log('PASS '+label);};
async function until(condition:()=>Promise<boolean>){for(let i=0;i<100;i++){if(await condition())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for persisted feature state');}
try {
  const owner=await account('owner'), viewer=await account('viewer'), stranger=await account('stranger');
  await owner.page.getByRole('button',{name:'修改登记',exact:true}).first().click();
  let dialog=owner.page.getByRole('dialog',{name:'修改本次登记'});
  await dialog.getByLabel('修正本次错题数').fill('21');assert.equal(await dialog.getByRole('button',{name:'保存修改'}).isDisabled(),true);
  await dialog.getByLabel('修正本次错题数').fill('2');
  for(const width of [360,393,412]){
    await owner.page.setViewportSize({width,height:915});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await dialog.screenshot({path:path.join(output,'record-edit-'+width+'.png')});
  }
  // Exercise the real persisted mutation failure boundary, not a mocked save callback.
  await owner.page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;(window as any).__restoreTx=()=>{IDBDatabase.prototype.transaction=original;};IDBDatabase.prototype.transaction=function(...args:any[]){if(args[1]==='readwrite')throw new DOMException('Isolated test save failure','UnknownError');return original.apply(this,args as any);};});
  await dialog.getByRole('button',{name:'保存修改'}).click();await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('修正本次错题数').inputValue(),'2');
  assert.equal(JSON.parse((db.prepare("SELECT state_json FROM workspaces WHERE user_id='owner'").get() as any).state_json).books[0].errors,12);
  await owner.page.evaluate(()=>(window as any).__restoreTx());await dialog.getByRole('button',{name:'保存修改'}).click();
  await until(async()=>JSON.parse((db.prepare("SELECT state_json FROM workspaces WHERE user_id='owner'").get() as any).state_json).books[0].errors===2);
  await owner.page.reload();await owner.page.getByRole('button',{name:'查看登记总结',exact:true}).first().click();
  await owner.page.getByText('完成 20 题 · 错题 2 道 · 正确率 90%',{exact:true}).waitFor();
  await owner.page.getByRole('button',{name:'返回今日工作台'}).click();
  await owner.page.getByRole('button',{name:'修改登记',exact:true}).nth(1).click();
  dialog=owner.page.getByRole('dialog',{name:'修改本次登记'});await dialog.getByLabel('修正本次完成节数').fill('2');await dialog.getByRole('button',{name:'保存修改'}).click();
  await until(async()=>JSON.parse((db.prepare("SELECT state_json FROM workspaces WHERE user_id='owner'").get() as any).state_json).courses[0].completedLessons===9);
  pass('Book/course corrections persist, recompute totals, reject invalid errors, retain draft after storage failure and fit 360/393/412');

  await owner.page.getByRole('button',{name:'我的',exact:true}).click();
  await owner.page.getByRole('button',{name:/邮箱与提醒/}).click();
  const mail=owner.page.getByRole('dialog',{name:'邮箱与定时提醒'});
  await mail.getByLabel('邮箱地址',{exact:true}).fill('recipient@example.test');await mail.getByRole('button',{name:'发送验证码',exact:true}).click();
  await mail.getByLabel('6 位验证码').waitFor();
  const verification=messages.find(message=>message.subject.includes('验证码'))!;assert.ok(verification);
  const code=verification.text.match(/\b\d{6}\b/)![0];await mail.getByLabel('6 位验证码').fill(code);await mail.getByRole('button',{name:'验证并绑定'}).click();
  await mail.getByRole('button',{name:'新建',exact:true}).click();await mail.getByLabel('提醒标题').fill('晚间错题复盘');await mail.getByLabel('提醒正文').fill('复盘图形推理错题');await mail.getByLabel('提醒发送时间').fill('2026-10-28T10:02');await mail.getByRole('button',{name:'保存一次性提醒'}).click();
  await mail.getByRole('button',{name:'编辑',exact:true}).click();await mail.getByLabel('提醒标题').fill('晚间错题复盘（已改）');await mail.getByRole('button',{name:'保存修改',exact:true}).click();
  await mail.getByText('晚间错题复盘（已改）',{exact:true}).waitFor();
  clock+=120000;await worker.poll();assert.equal(messages.filter(message=>message.subject.includes('晚间错题复盘')).length,1);await worker.poll();assert.equal(messages.filter(message=>message.subject.includes('晚间错题复盘')).length,1);
  assert.equal((db.prepare("SELECT status FROM email_reminders WHERE user_id='owner'").get() as any).status,'sent');
  await mail.getByRole('button',{name:'关闭弹窗',exact:true}).click();await owner.page.getByRole('button',{name:/邮箱与提醒/}).click();
  await mail.getByText('晚间错题复盘（已改）',{exact:true}).waitFor();
  for(const width of [360,393,412]){await owner.page.setViewportSize({width,height:915});assert.equal(await mail.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await mail.screenshot({path:path.join(output,'email-reminders-'+width+'.png')});}
  await mail.getByRole('button',{name:'新建',exact:true}).click();await mail.getByLabel('提醒标题').fill('取消测试');await mail.getByLabel('提醒发送时间').fill('2026-10-28T10:03');await mail.getByRole('button',{name:'保存一次性提醒'}).click();await mail.getByRole('button',{name:'取消提醒',exact:true}).click();await mail.getByText('已取消',{exact:true}).waitFor();
  pass('Verified recipient binding, reminder creation/editing and one-shot worker delivery work through real UI with isolated fake SMTP');
  await mail.getByRole('button',{name:'关闭弹窗',exact:true}).click();

  await owner.page.getByRole('button',{name:/学习数据共享/}).click();const sharing=owner.page.getByRole('dialog',{name:'学习数据分享'});
  await sharing.getByRole('button',{name:'生成一次性分享码'}).click();const sharedCode=await sharing.locator('#generated-study-code').inputValue();assert.ok(sharedCode);
  await viewer.page.getByRole('button',{name:'我的',exact:true}).click();await viewer.page.getByRole('button',{name:/学习数据共享/}).click();
  const received=viewer.page.getByRole('dialog');await received.locator('#redeem-study-code').fill(sharedCode!);await received.getByRole('button',{name:'获得只读查看授权'}).click();await received.getByRole('button',{name:'只读查看',exact:true}).click();
  await received.getByLabel('好友只读学习概览').waitFor();await received.getByText('图形推理700题',{exact:true}).first().waitFor();
  assert.equal(await received.getByRole('button',{name:'修改登记',exact:true}).count(),0);
  const beforeViewer=(db.prepare("SELECT state_json FROM workspaces WHERE user_id='viewer'").get() as any).state_json;
  for(const width of [360,393,412]){await viewer.page.setViewportSize({width,height:915});assert.equal(await received.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await received.screenshot({path:path.join(output,'shared-overview-'+width+'.png')});}
  const grant=(db.prepare("SELECT id FROM sharing_grants WHERE owner_id='owner' AND viewer_id='viewer'").get() as any).id;
  assert.equal((await stranger.context.request.get(base+'/api/sharing/grants/'+grant+'/overview')).status(),403);
  let release!:()=>void, captured!:()=>void;
  const responseReady=new Promise<void>(resolve=>{captured=resolve;}), responseRelease=new Promise<void>(resolve=>{release=resolve;});
  await viewer.page.route('**/api/sharing/grants/*/overview?**',async route=>{const response=await route.fetch();captured();await responseRelease;await route.fulfill({response}).catch(()=>{});});
  await received.getByRole('button',{name:'刷新分享数据'}).click();await responseReady;
  await received.getByRole('button',{name:'关闭弹窗',exact:true}).click();release();
  await viewer.page.getByRole('button',{name:/学习数据共享/}).click();await viewer.page.unroute('**/api/sharing/grants/*/overview?**');
  assert.equal(await viewer.page.getByLabel('好友只读学习概览').count(),0);
  await received.getByRole('button',{name:'只读查看',exact:true}).click();await received.getByLabel('好友只读学习概览').waitFor();
  await sharing.getByRole('button',{name:'刷新分享数据'}).click();await sharing.getByRole('button',{name:'撤销授权'}).click();
  await received.getByRole('button',{name:'刷新分享数据'}).click();await received.getByRole('alert').waitFor();assert.equal(await received.getByLabel('好友只读学习概览').count(),0);
  assert.equal((db.prepare("SELECT state_json FROM workspaces WHERE user_id='viewer'").get() as any).state_json,beforeViewer);
  pass('Sharing code redemption, late-response cancellation, read-only overview, third-account denial and revocation leave viewer data untouched');
  assert.deepEqual(errors,[]);pass('No browser runtime errors');
  fs.writeFileSync(path.join(output,'e2e-results.json'),JSON.stringify({passed:results,errors},null,2));
} finally {await worker.stop();await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));closeDb();fs.rmSync(temp,{recursive:true,force:true});}
