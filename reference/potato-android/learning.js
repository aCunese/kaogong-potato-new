(() => {
  const css = `<style>
    .l-stack{display:grid;gap:12px}.l-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 12px}.l-section-title{display:flex;align-items:baseline;gap:8px}.l-section-title h3{font-size:17px;line-height:24px;margin:0;font-weight:700}.l-count{font-size:13px;color:var(--muted,#697160)}.l-section-action>*{min-height:34px!important;padding:7px 11px!important;font-size:13px!important;border-radius:10px!important}.l-resource{padding:16px!important;border:1px solid #E4E6D9;border-radius:18px;background:#FFFDF8;box-shadow:0 3px 10px #343c2f04}.l-resource-head{display:flex;align-items:center;gap:10px}.l-resource-icon{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:12px;background:#E7EDDF;color:#61794F}.l-resource-title{flex:1;min-width:0}.l-resource-title h3{margin:0;font-size:16px;line-height:22px;font-weight:700;letter-spacing:-.2px;white-space:normal;overflow-wrap:anywhere}.l-resource-title p{margin:3px 0 0;font-size:13px;line-height:17px;color:#697160}.l-more{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;border:0;background:transparent;color:#8D9486;text-decoration:none}.l-progress{height:5px;margin:10px 0 9px;border-radius:8px;background:#EDF0E6;overflow:hidden}.l-progress span{display:block;height:100%;border-radius:8px;background:#83986B}.l-stats{display:grid;grid-template-columns:1.45fr 1fr 1fr;gap:9px}.l-stats.two{grid-template-columns:1.3fr 1fr}.l-stat strong{display:block;font-size:21px;line-height:26px;color:#343C2F;font-weight:750;letter-spacing:-.6px}.l-stat strong small{font-size:13px;font-weight:500;color:#8D9486;letter-spacing:0}.l-stat span{display:block;margin-top:2px;font-size:12px;line-height:16px;color:#7A8271}.l-card-actions{display:flex;gap:8px;margin-top:10px}.l-card-actions>*{flex:1;min-width:0;min-height:44px!important;padding:10px 9px!important;font-size:13px!important;border-radius:10px!important}.l-card-actions .l-quiet{flex:0 0 44px;display:grid;place-items:center;border:1px solid #E4E6D9;background:#FFFDF8;color:#697160;text-decoration:none}.l-card-actions .l-open{flex:1.05}.l-inline-meta{display:flex;align-items:center;gap:6px;margin:12px 0 0;color:#697160;font-size:12px;line-height:18px}.l-inline-meta svg{flex:0 0 auto}.l-kind{display:inline-flex;align-items:center;gap:5px;border-radius:6px;padding:2px 7px;background:#F1F3EB;color:#61794F;font-size:11px;font-weight:600;line-height:17px}.l-library-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.l-library-head .l-resource-head{flex:1;min-width:0}.l-library-default{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #ECEDE3}.l-library-default span{font-size:13px;color:#697160}.l-minute{display:flex;align-items:center;gap:7px;font-size:12px;color:#697160}.l-minute input{width:52px;height:31px;border:1px solid #E1E5D6;border-radius:8px;text-align:center;background:#FBFCF7;color:#343C2F;font-size:14px;font-weight:600;font-family:inherit;outline:none}.l-footnote{margin:12px 3px 0;font-size:12px;line-height:19px;color:#929888}.l-form-intro{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:14px 16px;background:#E7EDDF;border-radius:16px;color:#61794F}.l-form-intro .l-resource-icon{width:36px;height:36px;flex-basis:36px;background:#FFFFFF80}.l-form-intro strong{display:block;font-size:14px;line-height:21px;color:#506841}.l-form-intro p{margin:2px 0 0;font-size:12px;line-height:18px;color:#758368}.l-form-card{padding:18px 16px!important;border:1px solid #E4E6D9;border-radius:18px;background:#FFFDF8}.l-form-card h3{margin:0 0 17px;font-size:15px;line-height:22px;color:#343C2F}.l-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px 12px}.l-fields>.l-full{grid-column:1/-1}.l-fields .form-field{margin:0;gap:7px}.l-fields .field-control{height:46px;padding:11px 12px}.l-field-label{display:block;margin-bottom:8px;font-size:13px;line-height:20px;color:#697160}.l-field-label span{color:#A2AA96}.l-select-wrap{position:relative}.l-select-wrap select{width:100%;height:46px;padding:0 37px 0 13px;border:1px solid #E1E5D6;border-radius:11px;background:#FCFCF7;color:#343C2F;font-family:inherit;font-size:15px;appearance:none;outline:none}.l-select-wrap>svg{position:absolute;right:13px;top:15px;pointer-events:none;color:#929A86}.l-field-hint{margin:6px 0 0;font-size:11px;line-height:17px;color:#929888}.l-form-note{display:flex;align-items:flex-start;gap:7px;margin:15px 3px 0;color:#8D9486;font-size:12px;line-height:19px}.l-form-note svg{margin-top:2px;flex:0 0 auto}.l-form-footer{display:flex;gap:10px;width:100%}.l-form-footer>*{flex:1;min-height:48px!important;font-size:15px!important;border-radius:13px!important}.l-form-footer>.l-delete{flex:0 0 48px;display:grid;place-items:center;border:1px solid #E5DED1;background:#FFFDF8;color:#A58973;text-decoration:none}.l-course-link{display:flex;align-items:center;gap:5px;font-size:11px;line-height:17px;color:#8B937F}.l-course-link svg{flex:0 0 auto}.l-custom-preview{display:flex;align-items:center;gap:12px;margin-top:17px;padding:15px 16px;border:1px dashed #D8DFCC;border-radius:15px;background:#F0F3E9}.l-custom-preview strong{display:block;margin:0 0 3px;color:#506841;font-size:14px}.l-custom-preview p{margin:0;color:#87917D;font-size:12px;line-height:19px}.l-subsection{margin:20px 0 11px;font-size:14px;font-weight:700;color:#697160}.l-reading-note{display:flex;align-items:center;gap:7px;font-size:12px;color:#87917D;margin:0 0 13px}.l-reading-note svg{color:#83986B}@media(max-width:380px){.l-resource{padding:14px!important}.l-resource-title h3{font-size:14px}.l-stats{gap:6px}.l-stat strong{font-size:20px}.l-card-actions>*{padding:7px 6px!important}.l-form-card{padding:16px 14px!important}.l-fields{gap:14px 10px}.l-form-intro{padding:13px 14px}}
  </style>`;

  const heading = (name, count, go, action = '添加') => `<div class="l-section-head"><div class="l-section-title"><h3>${name}</h3><span class="l-count">${count}</span></div><div class="l-section-action">${button(action, 'plus', 'secondary', go)}</div></div>`;
  const progress = value => `<div class="l-progress"><span style="width:${value}%"></span></div>`;
  const stat = (value, label, tail = '') => `<div class="l-stat"><strong>${value}${tail ? `<small>${tail}</small>` : ''}</strong><span>${label}</span></div>`;
  const iconBox = icon => `<span class="l-resource-icon">${I(icon, 21)}</span>`;
  const editLink = go => `<a class="l-more" data-go="${go}" aria-label="修改数据">${I('more', 20)}</a>`;
  const quietLink = (go, icon, label) => `<a class="l-quiet" data-go="${go}" aria-label="${label}">${I(icon, 16)}</a>`;

  const bookCard = ({ name, subject, done, total, accuracy, avg }) => `<article class="panel resource-card l-resource"><div class="l-resource-head">${iconBox('book')}<div class="l-resource-title"><h3>${name}</h3><p>${subject} · 题本</p></div>${editLink('book-edit')}</div>${progress(Math.round(done / total * 100))}<div class="l-stats">${stat(done, '完成题量', ` / ${total}`)}${stat(`${accuracy}%`, '正确率')}${stat(avg, '分钟 / 题')}</div><div class="l-card-actions">${button('加入今天', 'plus', 'primary', 'add-plan')}${button('修改数据', 'pencil', 'ghost', 'book-edit')}</div></article>`;
  const courseCard = ({ name, subject, done, total, minutes, url }) => `<article class="panel resource-card l-resource"><div class="l-resource-head">${iconBox('play')}<div class="l-resource-title"><h3>${name}</h3><p>${subject} · ${url ? '网课' : '未添加课程链接'}</p></div>${editLink('course-edit')}</div>${progress(Math.round(done / total * 100))}<div class="l-stats two">${stat(done, '已完成课时', ` / ${total}`)}${stat(minutes, '累计分钟')}</div><div class="l-card-actions">${button('加入今天', 'plus', 'primary', 'add-plan')}${url ? `<a class="l-external" href="${url}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #E4E6D9;background:#FFFDF8;color:#697160;text-decoration:none">${I('link', 15)}打开课程</a>` : button('修改课程', 'pencil', 'ghost', 'course-edit')}</div></article>`;
  const libraryCard = ({ name, subject, type, minutes, icon, custom }) => `<article class="panel resource-card l-resource"><div class="l-library-head"><div class="l-resource-head">${iconBox(icon)}<div class="l-resource-title"><h3>${name}</h3><p>${subject} <span aria-hidden="true">·</span> ${type}</p></div></div><span class="l-kind">${type}</span></div><div class="l-library-default"><span>默认时长</span><label class="l-minute"><input value="${minutes}" type="number" min="1" aria-label="默认分钟">分钟</label></div><div class="l-card-actions">${button('加入今天', 'plus', 'primary', 'add-plan')}${custom ? quietLink('library', 'trash', '删除自定义事项') : ''}</div></article>`;
  const subjectSelect = active => `<div><label class="l-field-label">所属科目</label><div class="l-select-wrap"><select aria-label="所属科目">${['资料分析', '判断推理', '言语理解', '数量关系', '政治理论', '常识判断', '申论', '面试'].map(subject => `<option${subject === active ? ' selected' : ''}>${subject}</option>`).join('')}</select>${I('chevron', 16)}</div></div>`;
  const fullField = (label, value, hint = '') => `<div class="l-full">${field(label, value, hint)}</div>`;
  const formIntro = (icon, title, text) => `<div class="l-form-intro">${iconBox(icon)}<div><strong>${title}</strong><p>${text}</p></div></div>`;
  const saveFooter = (go, deletable = false) => `<div class="l-form-footer">${deletable ? `<a class="l-delete" data-go="${go}" aria-label="删除">${I('trash', 19)}</a>` : ''}${button('保存', 'check', 'primary', go)}</div>`;

  Object.assign(window.PAGES, {
    books: {
      title: '题本进度',
      eyebrow: '考公工作台',
      subtitle: '记录每一次练习与进步',
      tab: 'study',
      mascot: 1,
      body: () => css + studyTabs('books') + heading('我的题本', '14 本', 'book-add') + `<div class="l-stack">${[
        { name: '2026资料分析夸夸刷（上）', subject: '资料分析', done: 240, total: 600, accuracy: 80, avg: '2.0' },
        { name: '2026判断推理夸夸刷', subject: '判断推理', done: 120, total: 552, accuracy: 82, avg: '1.5' },
        { name: '张弓言语200题', subject: '言语理解', done: 60, total: 200, accuracy: 85, avg: '1.2' }
      ].map(bookCard).join('')}</div><p class="l-footnote">完成今日日程后，题量与用时会自动更新。</p>`
    },
    courses: {
      title: '网课进度',
      eyebrow: '考公工作台',
      subtitle: '课程有进度，学习有安排',
      tab: 'study',
      mascot: 2,
      body: () => css + studyTabs('courses') + heading('我的网课', '7 门', 'course-add') + `<div class="l-stack">${[
        { name: '张弓言语十二箭', subject: '言语理解', done: 8, total: 12, minutes: 420, url: 'https://www.bilibili.com/video/BV14RzZBuEz3/' },
        { name: '数量关系系统课', subject: '数量关系', done: 2, total: 20, minutes: 120, url: 'https://www.bilibili.com/video/BV19N411U7Pc/' },
        { name: '政治理论基础课', subject: '政治理论', done: 0, total: 11, minutes: 0 }
      ].map(courseCard).join('')}</div><p class="l-footnote">新增网课会同步生成事项，随时加入今天。</p>`
    },
    library: {
      title: '事项库',
      eyebrow: '考公工作台',
      subtitle: '从这里，把学习安排进今天',
      tab: 'study',
      mascot: 0,
      body: () => css + studyTabs('library') + heading('全部事项', '22 项', 'custom-add', '自定义') + `<div class="l-stack">${[
        { name: '2026资料分析夸夸刷（上）', subject: '资料分析', type: '题本', minutes: 30, icon: 'book' },
        { name: '张弓言语十二箭', subject: '言语理解', type: '网课', minutes: 60, icon: 'play' },
        { name: '申论素材积累', subject: '申论', type: '自定义', minutes: 30, icon: 'pencil', custom: true }
      ].map(libraryCard).join('')}</div><p class="l-footnote">每本题本、每门网课都对应一个事项。</p>`
    },
    'book-edit': {
      title: '编辑题本',
      subtitle: '题量、错题与用时，一起记录',
      tab: 'study',
      back: 'books',
      noNav: true,
      body: () => css + formIntro('book', '2026资料分析夸夸刷（上）', '修改后同步更新题本与事项库') + `<section class="panel l-form-card"><h3>题本信息</h3><div class="l-fields">${fullField('题本名称', '2026资料分析夸夸刷（上）')}${subjectSelect('资料分析')}${field('总题数', '600')}${field('页数', '225')}${field('已做题数', '240')}${field('错题数', '48')}${field('累计分钟', '480')}</div></section><p class="l-form-note">${I('book', 14)}<span>这里修改累计数据；每日学习记录在完成日程时登记。</span></p>`,
      footer: () => saveFooter('books', true)
    },
    'course-edit': {
      title: '编辑网课',
      subtitle: '把课程进度整理清楚',
      tab: 'study',
      back: 'courses',
      noNav: true,
      body: () => css + formIntro('play', '张弓言语十二箭', '修改后同步更新课程与事项库') + `<section class="panel l-form-card"><h3>课程信息</h3><div class="l-fields">${fullField('课程名称', '张弓言语十二箭')}${subjectSelect('言语理解')}${field('总课时', '12')}${field('已完成课时', '8')}${field('累计分钟', '420')}${fullField('课程链接', 'https://www.bilibili.com/video/BV14RzZBuEz3/', '填写网页链接后，可从网课卡片打开')}</div></section><p class="l-form-note">${I('link', 14)}<span>课程在原网站打开，学习进度由你自主登记。</span></p>`,
      footer: () => saveFooter('courses', true)
    },
    'custom-add': {
      title: '自定义事项',
      subtitle: '给计划留一点自由安排',
      tab: 'study',
      back: 'library',
      noNav: true,
      body: () => css + formIntro('pencil', '除了题本与网课', '素材积累、背诵与练习，也可以安排') + `<section class="panel l-form-card"><h3>事项信息</h3><div class="l-fields">${fullField('事项名称', '申论素材积累')}${subjectSelect('申论')}${field('默认分钟', '30', '加入日程时可再调整')}</div></section><div class="l-custom-preview">${iconBox('clock')}<div><strong>保存到事项库</strong><p>之后可随时加入今天，完成后登记学习时间。</p></div></div>`,
      footer: () => saveFooter('library')
    }
  });
})();
