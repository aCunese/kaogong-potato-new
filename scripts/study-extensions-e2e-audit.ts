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
async function scrollPageBottom(page:any){await page.evaluate(()=>{document.querySelectorAll<HTMLElement>('div').forEach(node=>{if(node.scrollHeight>node.clientHeight+40&&['auto','scroll'].includes(getComputedStyle(node).overflowY))node.scrollTop=node.scrollHeight;});});}
try {
  const owner=await account('owner'), viewer=await account('viewer'), stranger=await account('stranger');
  // The Today page now hosts the study-registration log (replaces the old inline 历史日程 dropdown).
  await owner.page.getByRole('heading',{name:/学习登记记录/}).waitFor();
  assert.equal(await owner.page.getByLabel('查看历史日程').count(),0);
  for(const width of [360,393,412]){await owner.page.setViewportSize({width,height:915});await owner.page.clock.runFor(50);await scrollPageBottom(owner.page);await owner.page.screenshot({path:path.join(output,'today-records-'+width+'.png')});}
  await owner.page.setViewportSize({width:393,height:915});
  await owner.page.getByRole('button',{name:'查看全部',exact:true}).click();
  const recordsDialog=owner.page.getByRole('dialog',{name:'学习登记记录'});
  // Date-first view: one day at a time, today's plans and registrations together.
  await recordsDialog.getByLabel('选择查看日期').waitFor();
  assert.equal(await recordsDialog.getByText(/共 \d+ 条登记/).count(),0);
  await recordsDialog.getByText('当天日程',{exact:true}).waitFor();
  await recordsDialog.getByText('学习登记',{exact:true}).waitFor();
  await recordsDialog.getByText('图形推理700题',{exact:true}).first().waitFor();
  for(const width of [360,393,412]){await owner.page.setViewportSize({width,height:915});await owner.page.clock.runFor(50);assert.equal(await recordsDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await recordsDialog.screenshot({path:path.join(output,'study-records-'+width+'.png')});}
  await recordsDialog.getByRole('button',{name:'前一天'}).click();
  await recordsDialog.getByText('这一天没有日程或登记',{exact:true}).waitFor();
  await recordsDialog.getByRole('button',{name:'回到今天'}).click();
  await recordsDialog.getByText('今天的日程与登记',{exact:true}).waitFor();
  await recordsDialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await owner.page.setViewportSize({width:393,height:915});
  // Completed cards stay visible (line-through) but the compact list can be filtered to unfinished only.
  await owner.page.getByRole('button',{name:'只看未完成',exact:true}).click();
  await owner.page.getByText('今天没有未完成的日程了',{exact:true}).waitFor();
  await owner.page.getByRole('button',{name:'显示全部日程',exact:true}).click();
  assert.equal(await owner.page.getByRole('button',{name:'修改登记',exact:true}).count(),2);
  pass('Today page shows the study log; dialog views one selected day; completed cards filter to unfinished only');
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
  await owner.page.clock.runFor(3500);
  for(const [width,height] of [[360,800],[393,873],[412,915]]) {
    await owner.page.setViewportSize({width,height});await owner.page.clock.runFor(50);
    for(const label of ['学习提醒','学习伙伴']) {
      const entry=owner.page.getByRole('button',{name:label,exact:true});await entry.waitFor({state:'visible',timeout:3000});
      const box=await entry.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<height-65,'Primary entry must fit first viewport: '+label);
    }
    await owner.page.screenshot({path:path.join(output,'settings-polished-'+width+'.png')});
  }
  await owner.page.getByRole('button',{name:'数据管理',exact:true}).click();
  const dataManager=owner.page.getByRole('dialog',{name:'数据管理'});
  assert.equal(await dataManager.getByRole('button',{name:'重置题库',exact:true}).isVisible(),false);
  await dataManager.getByText('更多数据操作',{exact:true}).click();assert.equal(await dataManager.getByRole('button',{name:'重置题库',exact:true}).isVisible(),true);
  await dataManager.getByRole('button',{name:/数据备份与恢复/}).click();
  await owner.page.getByRole('dialog',{name:'数据备份与恢复',exact:true}).waitFor();
  await owner.page.getByRole('dialog',{name:'数据备份与恢复',exact:true}).getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await owner.page.getByRole('button',{name:'关于与更新',exact:true}).click();await owner.page.getByRole('dialog',{name:'关于与更新'}).getByRole('button',{name:'检查更新',exact:true}).waitFor();await owner.page.getByRole('dialog',{name:'关于与更新'}).getByRole('button',{name:'关闭弹窗',exact:true}).click();
  pass('Primary features fit the first viewport; backup/update remain reachable and reset stays tucked away');
  await owner.page.getByRole('button',{name:'学习提醒',exact:true}).click();
  const mail=owner.page.getByRole('dialog',{name:'学习提醒'});
  await mail.getByRole('heading',{name:'先绑定收件邮箱',exact:true}).waitFor();
  // Binding is a one-time setup, not numbered steps repeated for every reminder.
  assert.equal(await mail.getByText('绑邮箱',{exact:true}).count(),0);
  assert.equal(await mail.getByText('到点收邮件',{exact:true}).count(),0);
  for(const width of [360,393,412]){await owner.page.setViewportSize({width,height:873});await owner.page.clock.runFor(50);assert.equal(await mail.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await mail.screenshot({path:path.join(output,'email-bind-'+width+'.png')});}
  await mail.getByLabel('邮箱地址',{exact:true}).fill('recipient@example.test');await mail.getByRole('button',{name:'发送验证码',exact:true}).click();
  await mail.getByLabel('6 位验证码').waitFor();
  const verification=messages.find(message=>message.subject.includes('验证码'))!;assert.ok(verification);
  const code=verification.text.match(/\b\d{6}\b/)![0];await mail.getByLabel('6 位验证码').fill(code);await mail.getByRole('button',{name:'验证并绑定'}).click();
  await mail.getByLabel('提醒标题').waitFor();
  assert.equal(await mail.getByText('r***@example.test',{exact:true}).count(),1);
  assert.equal(await mail.getByLabel('新邮箱地址',{exact:true}).count(),0);
  // While composing, the reminder list is hidden so the dialog stays focused.
  assert.equal(await mail.getByRole('tab',{name:/^待发送/}).count(),0);
  // Mailbox management lives in its own second-level dialog, not inline on the main surface.
  await mail.getByRole('button',{name:'邮箱管理',exact:true}).click();
  const manager=owner.page.getByRole('dialog',{name:'邮箱管理'});
  await manager.getByRole('button',{name:'更换邮箱',exact:true}).waitFor();
  assert.equal(await manager.getByRole('button',{name:'解绑邮箱',exact:true}).count(),1);
  await manager.screenshot({path:path.join(output,'email-manager.png')});
  await manager.getByRole('button',{name:'更换邮箱',exact:true}).click();
  await manager.getByLabel('新邮箱地址',{exact:true}).waitFor();
  await manager.getByRole('button',{name:'取消更换',exact:true}).click();
  assert.equal(await manager.getByLabel('新邮箱地址',{exact:true}).count(),0);
  await manager.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  assert.equal(await owner.page.getByRole('dialog',{name:'邮箱管理'}).count(),0);
  await mail.getByLabel('提醒标题').fill('晚间错题复盘');await mail.getByLabel('提醒正文').fill('复盘图形推理错题');await mail.getByLabel('提醒发送时间').fill('2026-10-28T10:02');
  for(const width of [360,393,412]) {
    await owner.page.setViewportSize({width,height:873});await owner.page.clock.runFor(50);
    const box=await mail.boundingBox(), inputBox=await mail.getByLabel('提醒发送时间').boundingBox();assert.ok(box&&inputBox&&inputBox.x>=box.x&&inputBox.x+inputBox.width<=box.x+box.width);
    assert.equal(await mail.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await mail.screenshot({path:path.join(output,'reminder-form-'+width+'.png')});
  }
  await mail.getByRole('button',{name:'保存提醒'}).click();
  await mail.getByText(/将在10月28日10点02分提醒你/).waitFor();
  await mail.getByRole('button',{name:'编辑提醒',exact:true}).click();await mail.getByLabel('提醒标题').fill('晚间错题复盘（已改）');await mail.getByRole('button',{name:'保存修改',exact:true}).click();
  await mail.getByText('晚间错题复盘（已改）',{exact:true}).waitFor();
  clock+=120000;await worker.poll();assert.equal(messages.filter(message=>message.subject.includes('晚间错题复盘')).length,1);await worker.poll();assert.equal(messages.filter(message=>message.subject.includes('晚间错题复盘')).length,1);
  assert.equal((db.prepare("SELECT status FROM email_reminders WHERE user_id='owner'").get() as any).status,'sent');
  await mail.getByRole('button',{name:'关闭弹窗',exact:true}).click();await owner.page.getByRole('button',{name:'学习提醒',exact:true}).click();
  await mail.getByRole('tab',{name:/^历史记录/}).click();await mail.getByText('晚间错题复盘（已改）',{exact:true}).waitFor();
  // History is date-grouped and has status filters; long histories load incrementally.
  await mail.getByRole('button',{name:'已发送 1',exact:true}).click();await mail.getByText('晚间错题复盘（已改）',{exact:true}).waitFor();
  await mail.getByRole('button',{name:'已取消 0',exact:true}).click();await mail.getByText('还没有已取消的记录',{exact:true}).waitFor();
  await mail.getByRole('button',{name:'全部 1',exact:true}).click();
  await owner.page.clock.runFor(3500);
  for(const width of [360,393,412]){await owner.page.setViewportSize({width,height:915});assert.equal(await mail.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await mail.screenshot({path:path.join(output,'email-reminders-'+width+'.png')});}
  await mail.getByRole('button',{name:'新建提醒',exact:true}).click();await mail.getByLabel('提醒标题').fill('取消测试');await mail.getByLabel('提醒发送时间').fill('2026-10-28T10:03');await mail.getByRole('button',{name:'保存提醒'}).click();await mail.getByRole('button',{name:'取消提醒',exact:true}).click();await mail.getByText('已取消',{exact:true}).waitFor();
  pass('Verified recipient binding, second-level mailbox management, focused composer, grouped/filterable history and one-shot worker delivery work through real UI with isolated fake SMTP');
  await mail.getByRole('button',{name:'关闭弹窗',exact:true}).click();

  await owner.page.getByRole('button',{name:'学习伙伴',exact:true}).click();const sharing=owner.page.getByRole('dialog',{name:'学习伙伴'});
  assert.equal(await sharing.getByRole('tab',{name:'我查看的',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await sharing.getByRole('button',{name:'生成分享码',exact:true}).count(),0);
  await sharing.getByRole('tab',{name:'谁可以看我',exact:true}).click();await sharing.getByRole('button',{name:'生成分享码',exact:true}).click();const sharedCode=await sharing.locator('#generated-study-code').inputValue();assert.ok(sharedCode);
  await viewer.page.getByRole('button',{name:'我的',exact:true}).click();await viewer.page.getByRole('button',{name:'学习伙伴',exact:true}).click();
  const received=viewer.page.getByRole('dialog');assert.equal(await received.locator('#redeem-study-code').count(),0);await received.getByRole('button',{name:'添加学习伙伴',exact:true}).click();await received.getByLabel('朋友的分享码',{exact:true}).fill(sharedCode!);await received.getByRole('button',{name:'确认添加'}).click();await received.getByRole('button',{name:'查看学情',exact:true}).click();
  await received.getByLabel('伙伴只读学习概览').waitFor();await received.getByText('图形推理700题',{exact:true}).first().waitFor();
  assert.equal(await received.getByRole('button',{name:'修改登记',exact:true}).count(),0);
  const beforeViewer=(db.prepare("SELECT state_json FROM workspaces WHERE user_id='viewer'").get() as any).state_json;
  await viewer.page.clock.runFor(3500);
  for(const width of [360,393,412]){await viewer.page.setViewportSize({width,height:915});assert.equal(await received.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await received.screenshot({path:path.join(output,'shared-overview-'+width+'.png')});}
  const grant=(db.prepare("SELECT id FROM sharing_grants WHERE owner_id='owner' AND viewer_id='viewer'").get() as any).id;
  assert.equal((await stranger.context.request.get(base+'/api/sharing/grants/'+grant+'/overview')).status(),403);
  let release!:()=>void, captured!:()=>void;
  const responseReady=new Promise<void>(resolve=>{captured=resolve;}), responseRelease=new Promise<void>(resolve=>{release=resolve;});
  await viewer.page.route('**/api/sharing/grants/*/overview?**',async route=>{const response=await route.fetch();captured();await responseRelease;await route.fulfill({response}).catch(()=>{});});
  await received.getByRole('button',{name:'刷新伙伴学情'}).click();await responseReady;
  await received.getByRole('button',{name:'关闭弹窗',exact:true}).click();release();
  await viewer.page.getByRole('button',{name:'学习伙伴',exact:true}).click();await viewer.page.unroute('**/api/sharing/grants/*/overview?**');
  assert.equal(await viewer.page.getByLabel('伙伴只读学习概览').count(),0);
  await received.getByRole('button',{name:'查看学情',exact:true}).click();await received.getByLabel('伙伴只读学习概览').waitFor();
  await sharing.getByRole('button',{name:'刷新学习伙伴'}).click();await sharing.getByRole('button',{name:'撤销授权'}).click();
  await received.getByRole('button',{name:'刷新伙伴学情'}).click();await received.getByRole('alert').waitFor();assert.equal(await received.getByLabel('伙伴只读学习概览').count(),0);
  assert.equal((db.prepare("SELECT state_json FROM workspaces WHERE user_id='viewer'").get() as any).state_json,beforeViewer);
  pass('Sharing code redemption, late-response cancellation, read-only overview, third-account denial and revocation leave viewer data untouched');
  assert.deepEqual(errors,[]);pass('No browser runtime errors');
  fs.writeFileSync(path.join(output,'e2e-results.json'),JSON.stringify({passed:results,errors},null,2));
} finally {await worker.stop();await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));closeDb();fs.rmSync(temp,{recursive:true,force:true});}
