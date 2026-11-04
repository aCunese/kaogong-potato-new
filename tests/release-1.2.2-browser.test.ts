import { afterAll, beforeAll, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { buildBrowserHarness, createHarnessPage } from '../scripts/lib/boundary-checks';
let browser: Browser, harness: string, css: string;
beforeAll(async () => {
  const builtCss = spawnSync('node', ['node_modules/tailwindcss/lib/cli.js', '-i', 'src/index.css', '--minify'], { encoding: 'utf8' });
  expect(builtCss.status).toBe(0); css = builtCss.stdout;
  harness = await buildBrowserHarness(); browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });
async function mount(page: Page, view = 'schedule') {
  await page.evaluate(view => {
    const w = window as any, state = structuredClone(w.BLANK_STATE);
    state.books = [{id:'b1',name:'申论范文',subject:'申论'},{id:'b2',name:'申论练习二',subject:'申论'}];
    state.library = state.books.map((b:any) => ({id:'lib-'+b.id,type:'book',sourceId:b.id,name:b.name,subject:b.subject,defaultMinutes:30}));
    state.courses = [{id:'c1',name:'资料网课',subject:'资料分析',totalLessons:20,completedLessons:0},{id:'c2',name:'申论网课',subject:'申论',totalLessons:20,completedLessons:0}];
    state.library.push(...state.courses.map((c:any) => ({id:'lib-'+c.id,type:'course',sourceId:c.id,name:c.name,subject:c.subject,defaultMinutes:45})));
    state.records = [
      {id:'r1',date:'2026-11-04',type:'book',sourceId:'b1',questions:10,errors:2,minutes:20,subject:'申论'},
      {id:'r2',date:'2026-11-04',type:'book',sourceId:'b1',questions:20,errors:3,minutes:20,subject:'申论'},
      {id:'r3',date:'2026-11-03',type:'book',sourceId:'deleted',questions:5,errors:5,minutes:10,subject:'资料分析'},
      {id:'r4',date:'2026-09-01',type:'book',sourceId:'b2',questions:8,errors:0,minutes:10,subject:'申论'},
      {id:'r5',date:'2026-11-04',type:'course',sourceId:'c1',questions:99,errors:0,minutes:40,subject:'资料分析'},
    ];
    state.wrong = [{id:'w',date:'2026-11-04',bookId:'资料分析',subject:'资料分析',note:'原笔记',image:''}];
    w.releaseFixture = {state,activeDate:'2026-11-04',currentUser:{id:'user-a'},registerUpdateBlocker:()=>()=>{},addPlan:async()=>({ok:true}),addCustomPlan:async()=>({ok:true}),updateWrongRecord:async(id:string, updates:any)=>{
      if (w.failSave) return {ok:false,message:'保存暂未完成'};
      const saved = w.mut.applyUpdateWrongRecord(state,id,updates); w.renderRelease();
      return 'error' in saved ? {ok:false,message:saved.error.message} : {ok:true};
    }};
    w.releaseProps = {isOpen:true,onClose:()=>{w.releaseProps.isOpen=false;w.renderRelease();},onToast:()=>{}};
    w.testRoot = w.createRoot(document.getElementById('root'));
    w.renderRelease = (patch:any={},props:any={}) => {
      Object.assign(w.releaseFixture,patch);Object.assign(w.releaseProps,props);
      const element = view==='analysis' ? w.React.createElement(w.AnalysisView,{onOpenMonthPicker:()=>{},onOpenLegendDetail:()=>{}}) : view==='wrong' ? w.React.createElement(w.WrongDetailModal,{...w.releaseProps,record:state.wrong[0]}) : w.React.createElement(w.AddPlanModal,w.releaseProps);
      w.testRoot.render(w.React.createElement(w.AppContext.Provider,{value:{...w.releaseFixture}},element));
    };
    w.renderRelease();
  }, view);
}
it('remembers each account and schedule type while showing names without subject decorations', async () => {
  const {page,context}=await createHarnessPage(browser,harness);page.setDefaultTimeout(2500);
  try {
    await mount(page);
    const dialog=page.getByRole('dialog',{name:'添加今日日程'}), picker=dialog.getByLabel('选择事项',{exact:true});
    expect(await picker.textContent()).toBe('申论范文');
    await dialog.getByRole('button',{name:'申论',exact:true}).click();
    await picker.click();await dialog.getByRole('option',{name:'申论练习二',exact:true}).click();
    await dialog.getByRole('button',{name:'网课',exact:true}).click();
    await dialog.getByRole('button',{name:'资料分析',exact:true}).click();
    await page.evaluate(()=>{const w=window as any;w.renderRelease({}, {isOpen:false});});
    await dialog.waitFor({state:'hidden'});
    await page.evaluate(()=>(window as any).renderRelease({}, {isOpen:true}));
    expect(await dialog.getByRole('button',{name:'网课',exact:true}).getAttribute('aria-pressed')).toBe('true');
    await dialog.getByRole('button',{name:'题本',exact:true}).click();
    expect(await dialog.getByRole('button',{name:'申论',exact:true}).getAttribute('aria-pressed')).toBe('true');
    expect(await picker.textContent()).toBe('申论练习二');
    await page.evaluate(()=>(window as any).renderRelease({currentUser:{id:'user-b'}}));
    await page.waitForFunction(()=>document.querySelector('[aria-label="选择事项"]')?.textContent==='申论范文');
    await page.evaluate(()=>(window as any).renderRelease({currentUser:{id:'user-a'}},{initialLibraryId:'lib-c2'}));
    await page.waitForFunction(()=>document.querySelector('[aria-label="选择事项"]')?.textContent==='申论网课');
    expect(await dialog.getByRole('button',{name:'申论',exact:true}).getAttribute('aria-pressed')).toBe('true');
  } finally {await context.close();}
},15000);
it('summarizes actual book registrations by day/source and updates corrections and range', async()=>{
  const {page,context}=await createHarnessPage(browser,harness);page.setDefaultTimeout(2500);
  try{
    await mount(page,'analysis'); await page.getByRole('button',{name:'题本学习',exact:true}).click();
    const card=page.getByRole('region',{name:'每日刷题记录'});await card.waitFor();
    const row=card.getByTestId('practice-2026-11-04-b1');
    expect(await row.textContent()).toContain('申论范文');expect(await row.getByTestId('questions').textContent()).toBe('30');expect(await row.getByTestId('correct').textContent()).toBe('25');
    expect(await card.textContent()).not.toContain('99');expect(await card.textContent()).not.toContain('2026-09-01');
    await page.evaluate(()=>{const w=window as any;w.releaseFixture.state.records[1].errors=10;w.renderRelease();});
    await page.waitForFunction(()=>document.querySelector('[data-testid="practice-2026-11-04-b1"] [data-testid="correct"]')?.textContent==='18');
    await page.getByRole('button',{name:'全部记录',exact:true}).click();expect(await card.textContent()).toContain('2026-09-01');
    await card.getByRole('button',{name:/2026-11-03/}).click();expect(await card.textContent()).toContain('题本已删除');
    expect(await card.getByTestId('practice-2026-11-03-deleted').getByTestId('correct').textContent()).toBe('0');
    await card.getByRole('button',{name:/2026-09-01/}).click();
    expect(await card.getByTestId('practice-2026-09-01-b2').getByTestId('correct').textContent()).toBe('8');
  }finally{await context.close();}
},15000);
it('offers repeatable wrong-note editing with cancellation and failed-save draft retention',async()=>{
  const {page,context}=await createHarnessPage(browser,harness);page.setDefaultTimeout(2500);
  try{
    await mount(page,'wrong');const detail=page.getByRole('dialog',{name:'错题复盘大图详情'});
    await detail.getByRole('button',{name:'编辑',exact:true}).click();await detail.getByRole('textbox').fill('修改后的笔记');
    await page.evaluate(()=>{(window as any).failSave=true;});await detail.getByRole('button',{name:'保存修改',exact:true}).click();
    await detail.getByRole('alert').waitFor();expect(await detail.getByRole('textbox').inputValue()).toBe('修改后的笔记');
    await page.evaluate(()=>{(window as any).failSave=false;});await detail.getByRole('button',{name:'保存修改',exact:true}).click();
    await detail.getByRole('button',{name:'编辑',exact:true}).click();expect(await detail.getByRole('textbox').inputValue()).toBe('修改后的笔记');
    await detail.getByRole('textbox').fill('取消这次');await detail.getByRole('button',{name:'取消',exact:true}).click();
    expect(await detail.textContent()).toContain('修改后的笔记');expect(await detail.textContent()).not.toContain('取消这次');
  }finally{await context.close();}
},15000);

it('restores the device preference after reload and falls back within the same subject when a source is deleted', async () => {
  const {page,context}=await createHarnessPage(browser,harness); page.setDefaultTimeout(2500);
  try {
    await mount(page);
    let dialog=page.getByRole('dialog',{name:'添加今日日程'});
    await dialog.getByRole('button',{name:'申论',exact:true}).click();
    await dialog.getByLabel('选择事项',{exact:true}).click();
    await dialog.getByRole('option',{name:'申论练习二',exact:true}).click();
    await page.reload(); await page.addScriptTag({content:harness,type:'module'});
    await page.waitForFunction(()=>!!(window as any).db); await mount(page);
    dialog=page.getByRole('dialog',{name:'添加今日日程'});
    await page.waitForFunction(()=>document.querySelector('[aria-label="选择事项"]')?.textContent==='申论练习二');
    expect(await dialog.getByRole('button',{name:'申论',exact:true}).getAttribute('aria-pressed')).toBe('true');
    await page.evaluate(()=>{const w=window as any; w.renderRelease({state:{...w.releaseFixture.state,library:w.releaseFixture.state.library.filter((l:any)=>l.id!=='lib-b2')}});});
    await page.waitForFunction(()=>document.querySelector('[aria-label="选择事项"]')?.textContent==='申论范文');
    expect(await dialog.getByRole('button',{name:'申论',exact:true}).getAttribute('aria-pressed')).toBe('true');
  } finally { await context.close(); }
},15000);

it('keeps schedule, daily totals and wrong editing usable at 360, 393 and 412 pixels', async () => {
  for(const width of [360,393,412]) {
    const {page,context}=await createHarnessPage(browser,harness);page.setDefaultTimeout(2500);
    try {
      await page.setViewportSize({width,height:844}); await page.addStyleTag({content:css});
      await mount(page,'wrong'); const detail=page.getByRole('dialog',{name:'错题复盘大图详情'});
      const edit=detail.getByRole('button',{name:'编辑',exact:true}); await edit.click();
      const box=await detail.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
      expect(await detail.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await expect(detail.getByRole('button',{name:'保存修改'}).isVisible()).resolves.toBe(true);
      await page.screenshot({path:`output/release-1.2.2/wrong-edit-${width}.png`});
      await page.evaluate(()=>{(window as any).testRoot.unmount();}); await mount(page,'analysis');
      await page.getByRole('button',{name:'题本学习',exact:true}).click();
      const card=page.getByRole('region',{name:'每日刷题记录'}); await card.waitFor();
      expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await card.screenshot({path:`output/release-1.2.2/daily-records-${width}.png`});
    } finally {await context.close();}
  }
},20000);
