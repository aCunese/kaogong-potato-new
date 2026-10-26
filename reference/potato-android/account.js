(() => {
  const mStyles = `<style>
    .m-intro{margin:0 0 24px;color:#697160;font-size:15px;line-height:1.75}
    .m-profile{display:flex;align-items:center;gap:15px;padding:4px 0 23px;min-width:0}
    .m-avatar{display:grid;place-items:center;width:76px;height:76px;flex:0 0 76px;border-radius:25px;background:#E9EDDD;overflow:hidden}
    .m-avatar-potato{width:76px!important;height:76px!important}
    .m-profile-main{min-width:0;flex:1}.m-profile-main h2{font-size:20px;line-height:1.4;margin:0 0 6px;font-weight:750;letter-spacing:-.5px}
    .m-username{font-size:13px;color:#858B7B;letter-spacing:.3px}.m-profile-go{color:#697160}
    .m-sync-card{padding:20px 20px 18px;background:#E7EDDF;border-radius:23px;margin-bottom:26px}
    .m-sync-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.m-sync-head h3{display:flex;align-items:center;gap:8px;margin:0;font-size:17px;color:#4F6740}
    .m-sync-head .m-tag{font-size:12px;line-height:1;background:#FFFDF8;padding:7px 9px;color:#61794F;border-radius:8px;white-space:nowrap}
    .m-sync-card p{font-size:14px;color:#6D7864;margin:8px 0 17px;line-height:1.65}
    .m-two-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.m-two-actions .btn{width:100%;font-size:14px;min-height:45px;justify-content:center}
    .m-lines{border-top:1px solid #E4E6D9;border-bottom:1px solid #E4E6D9;margin-bottom:23px}
    .m-lines>*+*{border-top:1px solid #E4E6D9}.m-lines .arrow-row{border-bottom:0}
    .m-inline-status{display:flex;align-items:center;gap:6px;color:#61794F;font-size:13px}
    .m-account-note{display:flex;gap:9px;align-items:flex-start;color:#858B7B;font-size:13px;line-height:1.7;margin:16px 0 4px}
    .m-account-note svg{flex:none;margin-top:2px}.m-quiet-link{display:flex;align-items:center;justify-content:center;gap:7px;color:#818775;font-size:14px;text-decoration:none;min-height:45px}
    .m-guest-message{margin:0 0 20px}.m-guest-message h2{font-size:23px;margin:0 0 9px;letter-spacing:-.5px}.m-guest-message p{color:#697160;margin:0;font-size:15px;line-height:1.75;max-width:280px}
    .m-guest-actions{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;margin:0 0 28px}.m-guest-actions .btn{width:100%;justify-content:center;min-height:49px}
    .m-device-status{padding:18px 0 23px;border-top:1px solid #E4E6D9;border-bottom:1px solid #E4E6D9;margin-bottom:24px}
    .m-device-status h3{display:flex;gap:9px;align-items:center;font-size:16px;margin:0 0 8px}.m-device-status p{font-size:14px;color:#697160;line-height:1.7;margin:0}
    .m-form-intro{padding-top:9px;margin-bottom:28px}.m-form-intro h2{font-size:26px;line-height:1.45;letter-spacing:-.8px;margin:0 0 10px}.m-form-intro p{color:#697160;font-size:15px;line-height:1.75;margin:0}
    .m-auth-form{display:grid;gap:20px}.m-auth-form .form-field{margin:0}.m-auth-form label{font-size:14px}
    .m-auth-switch{font-size:14px;text-align:center;color:#858B7B;margin:25px 0 18px}.m-auth-switch a{color:#61794F;font-weight:650;text-decoration:none;margin-left:5px}
    .m-form-note{border-top:1px solid #E4E6D9;padding-top:19px;margin-top:24px;display:flex;gap:9px;color:#858B7B;font-size:13px;line-height:1.75}.m-form-note svg{flex:none;margin-top:3px}
    .m-footer-note{text-align:center;color:#858B7B;font-size:12px;margin:0 0 11px;line-height:1.65}.m-footer .btn{width:100%;justify-content:center;min-height:52px}
    .m-big-sync{text-align:center;padding:18px 0 27px}.m-cloud-mark{height:74px;width:74px;margin:0 auto 15px;border-radius:27px;display:grid;place-items:center;background:#E7EDDF;color:#61794F;position:relative}
    .m-cloud-check{position:absolute;right:-3px;bottom:-2px;background:#61794F;color:#FFFDF8;display:grid;place-items:center;border:4px solid #F4F3EB;border-radius:50%;height:28px;width:28px}
    .m-big-sync h2{font-size:27px;margin:0 0 7px;letter-spacing:-.5px}.m-big-sync p{font-size:14px;color:#858B7B;margin:0;line-height:1.75}
    .m-sync-meta{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #E4E6D9;border-bottom:1px solid #E4E6D9;padding:18px 0;margin-bottom:24px}.m-sync-meta>div+div{border-left:1px solid #E4E6D9;padding-left:24px}.m-sync-meta span{display:block;color:#858B7B;font-size:12px;margin-bottom:5px}.m-sync-meta strong{font-weight:650;font-size:15px}
    .m-transfer{padding:18px 0;border-top:1px solid #E4E6D9}.m-transfer:first-child{border-top:0;padding-top:0}.m-transfer-title{display:flex;gap:10px;align-items:center;margin-bottom:8px}.m-transfer-title h3{margin:0;font-size:16px}.m-transfer-title svg{color:#61794F}.m-transfer p{font-size:14px;line-height:1.75;color:#697160;margin:0 0 13px}.m-transfer .btn{min-height:44px;width:100%;justify-content:center}
    .m-offline-note{background:#ECEEE4;border-radius:15px;padding:14px 15px;margin-top:20px}.m-offline-note strong{display:flex;gap:8px;align-items:center;font-size:14px;font-weight:650;color:#697160}.m-offline-note p{font-size:13px;color:#858B7B;line-height:1.75;margin:5px 0 0}
    .m-backup-intro{display:flex;align-items:center;gap:15px;margin:1px 0 24px}.m-backup-icon{display:grid;place-items:center;flex:none;width:60px;height:66px;border-radius:18px;background:#E7EDDF;color:#61794F}.m-backup-intro h2{margin:0 0 6px;font-size:21px;letter-spacing:-.5px}.m-backup-intro p{font-size:14px;line-height:1.65;color:#697160;margin:0}
    .m-checklist{margin:14px 0 16px;display:grid;gap:12px}.m-checkline{display:flex;align-items:center;gap:10px;color:#697160;font-size:14px}.m-checkline svg{color:#61794F;flex:none}.m-check-result{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.m-check-result strong{font-size:16px}.m-check-result span{font-size:12px;color:#858B7B}
    .m-check-panel{background:#FFFDF8;border-radius:20px;padding:19px;margin:22px 0}.m-check-panel .btn{min-height:42px;width:100%;justify-content:center;font-size:14px}
    .m-danger{border-top:1px solid #DDCEC0;padding-top:18px;margin-top:25px}.m-danger h3{font-size:15px;color:#99745E;margin:0 0 7px;display:flex;align-items:center;gap:8px}.m-danger p{font-size:13px;line-height:1.75;color:#938371;margin:0 0 12px}.m-danger .btn{background:#EDE4D8;color:#8E6C55;border:0;min-height:43px;width:100%;justify-content:center;font-size:14px}
    .m-edit-avatar{text-align:center;padding:20px 0 28px}.m-edit-avatar button{border:0;position:relative;width:124px;height:124px;padding:0;background:#E7EDDF;border-radius:40px;display:block;margin:auto;cursor:pointer}.m-edit-potato{width:124px!important;height:124px!important}.m-photo-edit{display:grid;place-items:center;position:absolute;right:-4px;bottom:2px;background:#61794F;color:#FFFDF8;height:34px;width:34px;border-radius:12px;border:4px solid #F4F3EB}.m-edit-avatar p{font-size:14px;color:#697160;margin:15px 0 0}.m-edit-form{padding:3px 0 22px}.m-edit-explain{font-size:13px;color:#858B7B;line-height:1.75;margin:12px 0 0}.m-profile-note{margin-top:28px;display:flex;align-items:flex-start;gap:10px;padding-top:21px;border-top:1px solid #E4E6D9;color:#858B7B;font-size:14px;line-height:1.75}.m-profile-note svg{color:#61794F;flex:none;margin-top:3px}
    @media(max-width:370px){.m-profile-main h2{font-size:18px}.m-avatar{width:64px;height:64px;flex-basis:64px}.m-sync-card{padding:17px}.m-sync-meta>div+div{padding-left:18px}.m-form-intro{margin-bottom:22px}.m-big-sync{padding-top:10px}}
  </style>`;
  const mFooter = (text, icon, go, note = '') => `<div class="m-footer">${note ? `<p class="m-footer-note">${note}</p>` : ''}${button(text, icon, 'primary', go)}</div>`;
  const mNote = text => `<div class="m-account-note">${I('shield', 16)}<span>${text}</span></div>`;

  Object.assign(window.PAGES, {
    settings: {
      title: '我的工作台', subtitle: '资料、同步与数据管理', tab: 'mine', mascot: 5,
      body: () => `${mStyles}
        <a class="m-profile" data-go="profile" style="text-decoration:none;color:inherit">
          <div class="m-avatar">${potato(0, 'm-avatar-potato')}</div>
          <div class="m-profile-main"><h2>土豆的备考空间</h2><div class="m-username">potato_01</div></div>
          <span class="m-profile-go">${I('chevron', 20)}</span>
        </a>
        <div class="m-sync-card">
          <div class="m-sync-head"><h3>${I('cloud', 21)}云端同步</h3><span class="m-tag">${I('check', 12)} 已同步</span></div>
          <p>最近同步于今天 09:41<br>本机学习记录已上传至当前账号。</p>
          <div class="m-two-actions">${button('上传本机', 'upload', 'primary', 'sync')}${button('从云端拉取', 'download', 'secondary', 'confirm-pull')}</div>
        </div>
        ${section('数据与管理')}
        <div class="m-lines">
          ${arrowRow('download', '本地 JSON 备份', '导出备份文件，或从文件恢复', 'backup')}
          ${arrowRow('shield', '数据自检', '检查题本、课程与事项库关联', 'backup', '正常')}
          ${arrowRow('refresh', '恢复初始数据', '操作前请先导出备份', 'backup')}
        </div>
        <a class="m-quiet-link" data-go="confirm-logout">${I('logout', 17)}退出当前账号</a>
        ${mNote('离线操作会先保存在本机，联网后请留意同步状态。')}`
    },

    guest: {
      title: '我的工作台', subtitle: '先照顾好今天的学习', tab: 'mine', mascot: 0,
      body: () => `${mStyles}
        <div class="m-profile">
          <div class="m-avatar">${potato(0, 'm-avatar-potato')}</div>
          <div class="m-profile-main"><h2>我的备考空间</h2><div class="m-username">尚未登录 · 本机模式</div></div>
        </div>
        <div class="m-guest-message"><h2>让学习进度，跟着你走。</h2><p>登录账号后，可在手机和电脑之间同步工作台数据。</p></div>
        <div class="m-guest-actions">${button('登录账号', 'user', 'primary', 'login')}${button('注册账号', 'arrow', 'secondary', 'register')}</div>
        <div class="m-device-status"><h3>${I('shield', 19)}当前保存在本机</h3><p>题本、日程与错题都可以继续使用。<br>建议定期导出 JSON 文件备份。</p></div>
        ${section('本机数据')}
        <div class="m-lines">
          ${arrowRow('download', '导出与恢复', '使用 JSON 文件备份学习记录', 'backup')}
          ${arrowRow('shield', '数据自检', '查看工作台数据关联状态', 'backup')}
        </div>
        ${mNote('清理应用数据或卸载前，请先备份尚未同步的记录。')}`
    },

    login: {
      title: '登录账号', subtitle: '连接你的备考空间', tab: 'mine', noNav: true, back: 'guest', mascot: 0,
      body: () => `${mStyles}
        <div class="m-form-intro"><h2>欢迎回来，<br>今天也一起进步。</h2><p>使用同一个账号，读取你的云端记录。</p></div>
        <div class="m-auth-form">
          ${field('账号名称', 'potato_01', '请输入注册时使用的账号名称')}
          ${field('登录密码', '••••••••', '请输入你的密码')}
        </div>
        <p class="m-auth-switch">还没有账号？<a data-go="register">注册一个 ${I('arrow', 14)}</a></p>
        <div class="m-form-note">${I('cloud', 18)}<span>登录后将读取云端数据。若本机有未同步的记录，建议先<a data-go="backup" style="color:#61794F;text-decoration:none">导出备份</a>。</span></div>`,
      footer: () => mFooter('登录并同步', 'arrow', 'settings')
    },

    register: {
      title: '注册账号', subtitle: '创建你的备考空间', tab: 'mine', noNav: true, back: 'guest', mascot: 7,
      body: () => `${mStyles}
        <div class="m-form-intro"><h2>给努力，<br>留一个专属空间。</h2><p>设置账号和密码，开始同步学习记录。</p></div>
        <div class="m-auth-form">
          ${field('账号名称', 'potato_01', '至少 2 位字符，登录时使用')}
          ${field('登录密码', '••••••••', '至少 4 位字符，请妥善保存')}
        </div>
        <p class="m-auth-switch">已经有账号？<a data-go="login">直接登录 ${I('arrow', 14)}</a></p>
        <div class="m-form-note">${I('shield', 18)}<span>每人使用独立账号。注册后，当前本机工作台数据会上传到这个新账号。</span></div>`,
      footer: () => mFooter('注册并同步', 'arrow', 'settings')
    },

    sync: {
      title: '同步管理', subtitle: '本机与云端，状态清清楚楚', tab: 'mine', noNav: true, back: 'settings', mascot: 5,
      body: () => `${mStyles}
        <div class="m-big-sync"><div class="m-cloud-mark">${I('cloud', 35)}<span class="m-cloud-check">${I('check', 13)}</span></div><h2>已同步</h2><p>最近同步 · 今天 09:41</p></div>
        <div class="m-sync-meta"><div><span>当前账号</span><strong>potato_01</strong></div><div><span>本机状态</span><strong>当前记录已上传</strong></div></div>
        <div>
          <div class="m-transfer"><div class="m-transfer-title">${I('upload', 20)}<h3>上传本机数据</h3></div><p>将当前本机记录上传至云端，覆盖该账号已有的云端数据。</p>${button('上传到云端', 'upload', 'primary', 'confirm-upload')}</div>
          <div class="m-transfer"><div class="m-transfer-title">${I('download', 20)}<h3>从云端拉取</h3></div><p>使用云端记录覆盖本机数据。操作前，可先导出本机备份。</p>${button('从云端拉取', 'download', 'secondary', 'confirm-pull')}</div>
        </div>
        <div class="m-offline-note"><strong>${I('shield', 16)}离线时，先保存在本机</strong><p>联网后会尝试上传。若多台设备都有修改，请先备份，再选择要保留的数据。</p></div>`
    },

    backup: {
      title: '数据备份', subtitle: '多留一份，学习更安心', tab: 'mine', noNav: true, back: 'settings', mascot: 5,
      body: () => `${mStyles}
        <div class="m-backup-intro"><div class="m-backup-icon">${I('download', 29)}</div><div><h2>保留一份本地备份</h2><p>JSON 文件包含学习记录与照片，<br>可用于恢复当前工作台。</p></div></div>
        <div class="m-two-actions">${button('导出 JSON', 'download', 'primary', 'backup')}${button('导入恢复', 'upload', 'secondary', 'confirm-import')}</div>
        ${mNote('导入文件会替换本机数据；登录状态下，导入后的记录也会参与同步。')}
        <div class="m-check-panel">
          <div class="m-check-result"><strong>数据自检</strong><span>刚刚检查</span></div>
          <div class="m-checklist">
            <div class="m-checkline">${I('check', 16)}题本与事项库关联正常</div>
            <div class="m-checkline">${I('check', 16)}网课与事项库关联正常</div>
            <div class="m-checkline">${I('check', 16)}3 个考试倒计时正常</div>
          </div>
          ${button('重新检查', 'refresh', 'secondary', 'backup')}
        </div>
        <div class="m-danger"><h3>${I('trash', 17)}恢复初始数据</h3><p>恢复默认题本、课程与学习记录。登录状态下，重置后的数据也会参与同步，请先导出备份。</p>${button('恢复初始数据', 'refresh', 'secondary', 'confirm-reset')}</div>`
    },

    profile: {
      title: '编辑资料', subtitle: '把这里，变成你的空间', tab: 'mine', noNav: true, back: 'settings', mascot: 7,
      body: () => `${mStyles}
        <div class="m-edit-avatar"><button data-go="profile" aria-label="更换头像">${potato(0, 'm-edit-potato')}<span class="m-photo-edit">${I('image', 16)}</span></button><p>点击头像，从相册更换</p></div>
        <div class="m-edit-form">${field('显示名称', '土豆的备考空间', '这个名称会显示在你的工作台中')}<p class="m-edit-explain">可以使用昵称，也可以写下一句给自己的鼓励。</p></div>
        <div class="m-profile-note">${I('cloud', 20)}<span>头像和显示名称会随工作台数据一起同步，换设备后也能继续使用。</span></div>`,
      footer: () => mFooter('保存资料', 'check', 'settings')
    }
  });
})();
