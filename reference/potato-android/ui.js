window.PAGES = {};
const paths = {
 home:'M3 10 12 3l9 7M5 9v11h5v-6h4v6h5V9', book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-5a3 3 0 0 0-3 2',
 play:'m9 5 11 7-11 7V5Z', pause:'M8 5v14M16 5v14', plus:'M12 5v14M5 12h14', arrow:'m10 5-7 7 7 7M3 12h18', chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6',
 more:'M5 12h.01M12 12h.01M19 12h.01', check:'m5 12 4 4L19 6', clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', calendar:'M4 6h16v15H4V6ZM8 3v6M16 3v6M4 11h16',
 image:'M3 4h18v16H3V4Zm1 12 5-5 5 5 3-3 4 4M8 8h.01', chart:'M4 3v18h18M8 16v-4M13 16V7M18 16V4', user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
 cloud:'M7 18h11a4 4 0 0 0 1-7.9A7 7 0 0 0 5.7 8.7 4.7 4.7 0 0 0 1 13.4 4.6 4.6 0 0 0 6 18', upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', download:'M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6',
 shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6', refresh:'M20 7a9 9 0 1 0 1 9M20 2v5h-5', logout:'M9 4H4v16h5M10 12h11m-5-5 5 5-5 5',
 lock:'M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4', pencil:'m3 17 12-12 4 4L7 21H3v-4ZM13 7l4 4m0-8 2-2 4 4-2 2', link:'m9 15 6-6M9 7l2-2a5 5 0 0 1 7 7l-2 2M15 17l-2 2a5 5 0 0 1-7-7l2-2',
 trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 headphones:'M4 13V10a8 8 0 0 1 16 0v3M4 11H2v8h5v-8H4Zm16 0h2v8h-5v-8h3', list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', close:'m6 6 12 12M18 6 6 18', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 leaf:'M20 3C6 1 0 13 8 19c6 5 14-3 12-16ZM5 21 16 8', spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7', info:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', folder:'M3 6h7l2 3h9v12H3V6Z', bell:'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5l-2 4ZM10 21h4'
};
window.I = (name,size=20)=>`<svg class="icon" data-icon="${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.book}"/></svg>`;
window.potato = (pose=0,extraClass='')=>`<span class="potato ${extraClass}" style="--px:${pose%4*100/3}%;--py:${pose>3?100:0}%" role="img" aria-label="土豆学习伙伴"></span>`;
window.button = (text,icon='',kind='primary',go='')=>`<a class="btn ${kind}" ${go?`href="?screen=${go}" data-go="${go}"`:''}>${icon?I(icon,18):''}<span>${text}</span></a>`;
window.field = (label,value='',hint='')=>`<label class="form-field"><span class="field-label">${label}</span><span class="field-control"><span class="field-value">${value||'<span class="placeholder">请输入</span>'}</span>${/科目|所属|日期/.test(label)?I('down',16):''}</span>${hint?`<span class="field-hint">${hint}</span>`:''}</label>`;
window.section=(title,right='')=>`<div class="section-head"><h2>${title}</h2>${right}</div>`;
window.metric=(value,label)=>`<div class="metric"><b>${value}</b><span>${label}</span></div>`;
window.subjectTags=(active='全部')=>`<div class="subject-chips">${['全部','资料分析','判断推理','言语理解'].map(s=>`<span class="chip ${s===active?'active':''}">${s}</span>`).join('')}</div>`;
window.studyTabs=active=>`<div class="segment">${[['books','题本'],['courses','网课'],['library','事项库']].map(([id,label])=>`<a href="?screen=${id}" data-go="${id}" class="${id===active?'selected':''}">${label}</a>`).join('')}</div>`;
window.analysisTabs=active=>`<div class="segment">${[['overall','总体'],['monthly','月度']].map(([id,label])=>`<a href="?screen=${id}" data-go="${id}" class="${id===active?'selected':''}">${label}</a>`).join('')}</div>`;
window.arrowRow=(icon,title,sub='',go='',end='')=>`<a class="setting-row" ${go?`data-go="${go}" href="?screen=${go}"`:''}><span class="row-symbol">${I(icon)}</span><span class="row-copy"><b>${title}</b>${sub?`<small>${sub}</small>`:''}</span>${end?`<span class="row-end">${end}</span>`:''}${I('chevron',17)}</a>`;
