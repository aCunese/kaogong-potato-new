const page=await figma.getNodeByIdAsync('4:268');await figma.setCurrentPageAsync(page);page.name='05 土豆角色素材';
await Promise.all(['Regular','Medium','Bold'].flatMap(style=>['Noto Sans SC','Roboto'].map(family=>figma.loadFontAsync({family,style}))));
const made=[],track=n=>(made.push(n.id),n);const color=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});const fill=h=>[{type:'SOLID',color:color(h)}];
function text(parent,str,size=14,bold=false,width=1000){const t=track(figma.createText());parent.appendChild(t);t.fontName={family:'Noto Sans SC',style:bold?'Bold':'Regular'};t.fontSize=size;t.lineHeight={unit:'PIXELS',value:size*1.6};t.characters=str;t.fills=fill(bold?'#343C2F':'#697160');t.resize(width,50);t.textAutoResize='HEIGHT';return t;}
function column(parent,name,width=1000){const n=track(figma.createAutoLayout('VERTICAL'));parent.appendChild(n);n.name=name;n.resize(width,100);n.layoutSizingVertical='HUG';n.itemSpacing=16;n.fills=[];return n;}
const MASCOTS={"0": "4:195", "1": "4:196", "2": "4:197", "3": "4:198", "4": "4:199", "5": "4:200", "6": "4:201", "7": "4:202"};

const root=column(page,'土豆 · 八种学习动作',1056);root.x=100;root.y=100;root.paddingTop=32;root.paddingBottom=32;root.paddingLeft=32;root.paddingRight=32;root.fills=fill('#F4F3EB');text(root,'土豆学习伙伴 / 8 个独立动作',28,true,992);text(root,'保持同一角色比例、圆眼、暖黄身体与手绘描边。内容图像作为独立素材，业务文字保持原生可编辑。',15,false,992);
const names=['挥手 / 欢迎','读书 / 今日与题本','听课 / 网课','查错 / 错题复盘','图表 / 学习分析','电脑 / 数据管理','庆祝 / 完成登记','笔记 / 自定义事项'];
for(let row=0;row<2;row++){const line=track(figma.createAutoLayout('HORIZONTAL'));root.appendChild(line);line.itemSpacing=24;line.fills=[];for(let col=0;col<4;col++){const i=row*4+col;const tile=column(line,names[i],230);tile.paddingTop=20;tile.paddingBottom=20;tile.paddingLeft=20;tile.paddingRight=20;tile.cornerRadius=18;tile.fills=fill('#FFFDF8');const c=await figma.getNodeByIdAsync(MASCOTS[i]);const inst=track(c.createInstance());tile.appendChild(inst);inst.resize(138,150.5);text(tile,names[i],14,true,190);}}
return{createdNodeIds:made,pageId:page.id,assetBoardId:root.id,poses:8};
