import json
from pathlib import Path
b=Path(__file__).parent
res=json.loads((b/'all-scenes-result.json').read_text());ids={k:v['id'] for k,v in res['screens'].items()}
font="await Promise.all(['Regular','Medium','Bold'].flatMap(style=>['Noto Sans SC','Roboto'].map(family=>figma.loadFontAsync({family,style}))));\n"
helpers="""const made=[],track=n=>(made.push(n.id),n);const color=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});const fill=h=>[{type:'SOLID',color:color(h)}];
function text(parent,str,size=14,bold=false,width=1000){const t=track(figma.createText());parent.appendChild(t);t.fontName={family:'Noto Sans SC',style:bold?'Bold':'Regular'};t.fontSize=size;t.lineHeight={unit:'PIXELS',value:size*1.6};t.characters=str;t.fills=fill(bold?'#343C2F':'#697160');t.resize(width,50);t.textAutoResize='HEIGHT';return t;}
function column(parent,name,width=1000){const n=track(figma.createAutoLayout('VERTICAL'));parent.appendChild(n);n.name=name;n.resize(width,100);n.layoutSizingVertical='HUG';n.itemSpacing=16;n.fills=[];return n;}
"""
code="const IDS="+json.dumps(ids)+";\nconst page=await figma.getNodeByIdAsync('4:265');await figma.setCurrentPageAsync(page);page.name='02 首页列表表单图表弹窗总览';\n"+font+helpers+"""
const board=column(page,'首页 · 列表 · 表单 · 图表 · 弹窗',2220);board.x=100;board.y=100;board.paddingTop=32;board.paddingBottom=32;board.paddingLeft=32;board.paddingRight=32;board.fills=fill('#EAECE3');text(board,'考公工作台 · 土豆陪伴版 Android',30,true,2156);text(board,'五类关键界面 / 412 × 915 逻辑尺寸 / 全部由可编辑文字、矢量与组件构成',16,false,2156);
const row=track(figma.createAutoLayout('HORIZONTAL'));board.appendChild(row);row.name='五类界面参考';row.itemSpacing=24;row.fills=[];
const labels=[['today','首页 · 今日执行'],['books','列表 · 题本进度'],['book-edit','表单 · 完整字段'],['overall','数据 · 八科分析'],['confirm-reset','弹窗 · 危险操作确认']];
for(const [id,label]of labels){const col=column(row,label,412);text(col,label,17,true,412);const src=await figma.getNodeByIdAsync(IDS[id]);const copy=track(src.clone());col.appendChild(copy);copy.name=label;copy.layoutSizingHorizontal='FIXED';copy.layoutSizingVertical='FIXED';for(const n of copy.findAll(()=>true))made.push(n.id);}
return {createdNodeIds:[...new Set(made)],pageId:page.id,reviewBoardId:board.id,width:board.width,height:board.height,types:labels.map(x=>x[1])};
"""
(b/'build-overview.js').write_text(code)
coverage=[
['今日计划','三考试日期与倒计时；从事项库加入今天；计划分钟；正向开始/暂停/继续；多任务同时计时；三类完成登记、防重；删除不撤销历史。','today / today-multi / focus / complete-* / countdown'],
['事项库','题本与网课自动一对一事项；自定义新增/删除；默认分钟；快捷加入今天；来源保持与空态。','library / custom-add / add-plan'],
['题本进度','新增空白与编辑；名称、科目、总题数、页数、已做题数、错题数、累计分钟共七字段；题量进度、正确率、平均分钟/题；删除确认。','books / book-add / book-edit / confirm-book'],
['网课进度','新增空白与编辑；名称、科目、总课时、已完成课时、累计分钟、链接共六字段；有效外链与无链接态；删除确认。','courses / course-add / course-edit / confirm-course'],
['错题复盘','按题本分组；系统相册多图；共享复盘原因；一图一记录；压缩、处理进度与部分失败；大图和删除；照片条数独立于错误题数。','wrong / photo-import / wrong-detail / states-form / confirm-photo'],
['总体分析','30天、90天、全部；完整八科时间分布与每日正确率；可识别图例、单点和无题量状态；仅从完成登记记录聚合。','overall / overall-legend / states-empty'],
['每月分析','年月选择；总分钟、题量、错题、加权正确率；八科正确率与用时；无记录和无题量分别表达。','monthly / month-picker / states-empty'],
['我的与设置','显示名/头像；用户名注册登录退出；自动同步状态和手动上传拉取；JSON导出导入；映射自检；重置；网页APK次级分发。','settings / guest / login / register / sync / backup / profile / download-apk']]
code="const page=await figma.getNodeByIdAsync('4:266');await figma.setCurrentPageAsync(page);page.name='03 功能覆盖与状态清单';\n"+font+helpers+'const COVERAGE='+json.dumps(coverage,ensure_ascii=False)+';\n'+"""
const root=column(page,'八模块功能覆盖表',1280);root.x=100;root.y=100;root.paddingTop=32;root.paddingBottom=32;root.paddingLeft=32;root.paddingRight=32;root.fills=fill('#F4F3EB');text(root,'八个原模块，逐项保留',28,true,1216);text(root,'50个设计与状态画面 · 主流程、列表、表单、图表、确认与异常状态均有对应位置',16,false,1216);
for(let i=0;i<COVERAGE.length;i++){const [title,body,screenIds]=COVERAGE[i];const c=column(root,(i+1)+' '+title,1216);c.paddingTop=18;c.paddingBottom=18;c.paddingLeft=20;c.paddingRight=20;c.cornerRadius=18;c.fills=fill('#FFFDF8');text(c,String(i+1).padStart(2,'0')+' / '+title,20,true,1176);text(c,body,15,false,1176);text(c,screenIds,12,false,1176);}
text(root,'统计口径与实现边界',22,true,1216);text(root,'今日累计分钟包含已暂停任务的 actualMinutes；总体与月度只汇总完成登记的 records。直接编辑累计值不回填记录；照片数量不改变题本错题数。课程使用外链。申论和面试可作为通用资料科目，无专属评分。',15,false,1216);text(root,'账号隔离、时间戳、补传、离线统一存储与 Android 文件落盘等是待修复/待验收要求，设计和原型不代表后端已完成。无在线题库、AI/OCR、播放器、支付会员或未来排期。',15,false,1216);
return{createdNodeIds:made,pageId:page.id,coverageId:root.id,modules:8};
"""
(b/'build-coverage.js').write_text(code)
prompt=(b.parent/'FIGMA-REBUILD-PROMPT.md').read_text()
code="const page=await figma.getNodeByIdAsync('4:267');await figma.setCurrentPageAsync(page);page.name='04 完整复刻Prompt';\n"+font+helpers+'const PROMPT='+json.dumps(prompt,ensure_ascii=False)+';\n'+"""
const root=column(page,'完整 Android 复刻 Prompt',1140);root.x=100;root.y=100;root.paddingTop=32;root.paddingBottom=32;root.paddingLeft=32;root.paddingRight=32;root.fills=fill('#FFFDF8');text(root,'考公工作台 · 完整复刻 Prompt',28,true,1076);text(root,'最新版：土豆 / 奶油白 / 鼠尾草绿。可直接复制下方全文交给 Figma Make 或开发。',15,false,1076);const body=text(root,PROMPT,14,false,1076);body.name='可复制的完整Prompt';return {createdNodeIds:made,pageId:page.id,promptFrameId:root.id,promptTextId:body.id,characters:PROMPT.length};
"""
(b/'build-prompt.js').write_text(code)
state=json.loads((b/'foundations-result.json').read_text());mas=state['mascots']
code="const page=await figma.getNodeByIdAsync('4:268');await figma.setCurrentPageAsync(page);page.name='05 土豆角色素材';\n"+font+helpers+'const MASCOTS='+json.dumps(mas)+';\n'+"""
const root=column(page,'土豆 · 八种学习动作',1056);root.x=100;root.y=100;root.paddingTop=32;root.paddingBottom=32;root.paddingLeft=32;root.paddingRight=32;root.fills=fill('#F4F3EB');text(root,'土豆学习伙伴 / 8 个独立动作',28,true,992);text(root,'保持同一角色比例、圆眼、暖黄身体与手绘描边。内容图像作为独立素材，业务文字保持原生可编辑。',15,false,992);
const names=['挥手 / 欢迎','读书 / 今日与题本','听课 / 网课','查错 / 错题复盘','图表 / 学习分析','电脑 / 数据管理','庆祝 / 完成登记','笔记 / 自定义事项'];
for(let row=0;row<2;row++){const line=track(figma.createAutoLayout('HORIZONTAL'));root.appendChild(line);line.itemSpacing=24;line.fills=[];for(let col=0;col<4;col++){const i=row*4+col;const tile=column(line,names[i],230);tile.paddingTop=20;tile.paddingBottom=20;tile.paddingLeft=20;tile.paddingRight=20;tile.cornerRadius=18;tile.fills=fill('#FFFDF8');const c=await figma.getNodeByIdAsync(MASCOTS[i]);const inst=track(c.createInstance());tile.appendChild(inst);inst.resize(138,150.5);text(tile,names[i],14,true,190);}}
return{createdNodeIds:made,pageId:page.id,assetBoardId:root.id,poses:8};
"""
(b/'build-assets.js').write_text(code)
print('document scripts ready')
