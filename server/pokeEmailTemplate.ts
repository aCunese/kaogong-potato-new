export interface PokeCheckItem {
  num?: string;
  subject?: string;
  text: string;
}

export interface PokeEmailParams {
  senderNickname: string;
  recipientNickname: string;
  loginUrl?: string;
  customMessage?: string;
  checkItems?: (PokeCheckItem | string)[];
  sendDate?: string;
  useCid?: boolean;
}

export interface PokeEmailContent {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHeader(str: string): string {
  return str.replace(/[\r\n]/g, ' ').trim();
}

export function sanitizeUrl(urlStr?: string): string {
  if (urlStr) {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {}
  }
  return process.env.APP_BASE_URL || process.env.PUBLIC_URL || 'https://work.ruyne.space';
}

function formatChineseDate(d: Date = new Date()): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month} 月 ${day} 日`;
}

export function generatePokeEmailContent(params: PokeEmailParams): PokeEmailContent {
  const rawSender = params.senderNickname.trim() || '你的备考伙伴';
  const rawRecipient = params.recipientNickname.trim() || '备考同学';

  const senderClean = sanitizeHeader(rawSender);
  const recipientClean = sanitizeHeader(rawRecipient);

  const senderHtml = escapeHtml(rawSender);
  const recipientHtml = escapeHtml(rawRecipient);
  const appUrl = sanitizeUrl(params.loginUrl);
  const appUrlAttr = escapeHtml(appUrl);
  const assetBase = appUrl.replace(/\/$/, '') + '/assets/email';

  const catPokeSrc = params.useCid ? 'cid:cat_poke.png' : `${assetBase}/cat_poke.png`;
  const pawStampSrc = params.useCid ? 'cid:paw_stamp.png' : `${assetBase}/paw_stamp.png`;
  const pawTrailSrc = params.useCid ? 'cid:paw_trail.png' : `${assetBase}/paw_trail.png`;
  const catSleepSrc = params.useCid ? 'cid:cat_sleep.png' : `${assetBase}/cat_sleep.png`;

  const sendDate = params.sendDate || formatChineseDate();

  // Custom Message
  const defaultMessage = '说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！';
  const customMessage = params.customMessage?.trim() || defaultMessage;
  const messageHtml = escapeHtml(customMessage);

  // Custom Check Items (今日自查)
  const defaultCheckItems: PokeCheckItem[] = [
    { num: '01', subject: '行测', text: '言语理解抓中心、资料分析速算公式背熟了吗？' },
    { num: '02', subject: '申论', text: '概括归纳要点找全、大作文思辨结构列出来了吗？' },
  ];

  let resolvedCheckItems: PokeCheckItem[] = [];
  if (params.checkItems && params.checkItems.length > 0) {
    resolvedCheckItems = params.checkItems.map((item, idx) => {
      if (typeof item === 'string') {
        const num = String(idx + 1).padStart(2, '0');
        const match = item.match(/^([^:：]{1,6})[:：]\s*(.+)$/);
        if (match) {
          return { num, subject: match[1].trim(), text: match[2].trim() };
        }
        return { num, subject: '自查', text: item.trim() };
      }
      return {
        num: item.num || String(idx + 1).padStart(2, '0'),
        subject: item.subject || '自查',
        text: item.text.trim(),
      };
    }).filter(i => i.text.length > 0);
  }
  if (resolvedCheckItems.length === 0) {
    resolvedCheckItems = defaultCheckItems;
  }

  const subject = `【土豆考公】你的学友「${senderClean}」提醒你回书桌前学习打卡啦 🥔`;

  const textLines = [
    `亲爱的 ${recipientClean} 同学：`,
    '',
    `📖 收到学友「${senderClean}」的学习打卡提醒！`,
    `“${customMessage}”`,
    '',
    '今日自查 · BEFORE YOU START',
    ...resolvedCheckItems.map(item => `${item.num} [${item.subject}] ${item.text}`),
    '',
    '放下手机，深呼吸，倒一杯温水，现在坐回书桌前学 25 分钟还不晚！🥔💨',
    '',
    `👉 立即回桌前开始学习：${appUrl}`,
    '',
    '💡 土豆人备考格言：“上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的学友正默默和你并肩作战，快来汇合吧！”',
    '',
    '----------------------------------------',
    `此邮件由你的备考伙伴「${senderClean}」在土豆考公工作台手动点击「戳一下」触发。`,
    '土豆考公工作台 · 陪伴每一位脚踏实地的考公人',
  ];
  const text = textLines.join('\n');

  const checkItemsHtml = resolvedCheckItems.map((item, idx) => {
    const isLast = idx === resolvedCheckItems.length - 1;
    const borderStyle = isLast ? 'border-top:1px solid #e2dbc7;border-bottom:1px solid #e2dbc7;' : 'border-top:1px solid #e2dbc7;';
    return `<tr>
      <td width="44" valign="top" style="font-family:Georgia,serif;font-size:20px;color:#b03a26;padding:14px 0;${borderStyle}">${escapeHtml(item.num || '')}</td>
      <td valign="top" style="padding:14px 0;${borderStyle}">
        <span style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;font-weight:bold;color:#2e3a26;letter-spacing:2px;">${escapeHtml(item.subject || '自查')}</span>
        <span style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.8;color:#454a3e;">&nbsp;&nbsp;${escapeHtml(item.text)}</span>
      </td>
    </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#4B6240">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3efe4;-webkit-text-size-adjust:100%;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#232b1e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe4;">
<tr><td align="center" style="padding:32px 16px 40px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fffef9;border:1px solid #e2dbc7;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.06);">
    <!-- 刊头 -->
    <tr><td style="padding:26px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:11px;letter-spacing:3px;color:#77816b;font-weight:bold;">学友督学专线 · 学习打卡提醒</td>
          <td align="right" style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:11px;letter-spacing:2px;color:#a39a83;">${escapeHtml(sendDate)}</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td style="border-top:2px solid #2e3a26;font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #2e3a26;font-size:0;line-height:4px;">&nbsp;</td></tr></table>
    </td></tr>

    <!-- 品牌行：左边印章+字，右边抬爪小猫——替学友“戳一下” -->
    <tr><td style="padding:16px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td valign="middle" style="background:#b03a26;color:#fffef9;font-family:'Songti SC','SimSun',serif;font-size:13px;line-height:16px;letter-spacing:2px;padding:7px 6px 6px 8px;text-align:center;border-radius:3px;">上<br>岸</td>
            <td valign="middle" style="padding-left:14px;">
              <div style="font-family:'Songti SC','STSong','SimSun',serif;font-size:24px;font-weight:bold;letter-spacing:3px;color:#232b1e;line-height:1.2;">土豆考公工作台</div>
              <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;letter-spacing:1.5px;color:#8a917d;margin-top:4px;">陪伴每一位脚踏实地的考公人</div>
            </td>
          </tr></table>
        </td>
        <td align="right" valign="bottom" width="196">
          <img src="${catPokeSrc}" width="188" alt="抬起爪子的小橘白猫督学" style="display:block;border:0;max-width:188px;">
        </td>
      </tr></table>
    </td></tr>

    <!-- 称呼 -->
    <tr><td style="padding:22px 40px 0 40px;font-family:'Songti SC','SimSun',serif;font-size:17px;color:#232b1e;">
      亲爱的 <span style="border-bottom:2px solid #d8c98f;padding-bottom:1px;font-weight:bold;color:#2e3a26;">${recipientHtml}</span> 同学：
    </td></tr>

    <!-- 学友来信：右上角猫爪印 -->
    <tr><td style="padding:18px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7ec;border-left:4px solid #5c6e4e;border-radius:4px;">
        <tr>
          <td style="padding:20px 12px 20px 22px;">
            <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;letter-spacing:2px;color:#5c6e4e;font-weight:bold;">学友来信 — 来自「${senderHtml}」· 小猫代戳</div>
            <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;font-weight:bold;color:#232b1e;margin-top:8px;">收到学习打卡提醒 📖</div>
            <div style="font-family:'Songti SC','SimSun',serif;font-size:15px;line-height:1.9;color:#4a4638;margin-top:8px;white-space:pre-wrap;">“${messageHtml}”</div>
          </td>
          <td width="64" valign="top" style="padding:14px 14px 0 0;">
            <img src="${pawStampSrc}" width="46" height="46" alt="爪印" style="display:block;border:0;opacity:.85;">
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- 今日自查 (支持自定义) -->
    <tr><td style="padding:28px 40px 0 40px;">
      <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:11px;letter-spacing:3px;color:#a39a83;font-weight:bold;">今日自查 · BEFORE YOU START</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
        ${checkItemsHtml}
      </table>
    </td></tr>

    <!-- 猫爪小径：小猫先一步走回书桌了 -->
    <tr><td style="padding:16px 40px 0 40px;">
      <img src="${pawTrailSrc}" width="280" height="36" alt="猫爪小径" style="display:block;border:0;max-width:280px;">
    </td></tr>

    <!-- 25分钟 -->
    <tr><td style="padding:10px 40px 0 40px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;line-height:1.9;color:#232b1e;">
      放下手机，深呼吸，倒一杯温水，<br>现在坐回书桌前学 <span style="font-weight:bold;border-bottom:3px solid #d8c98f;">25 分钟</span> 还不晚！🥔💨
    </td></tr>

    <!-- CTA -->
    <tr><td style="padding:24px 40px 0 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#2e3a26;border-radius:8px;">
          <a href="${appUrlAttr}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;font-weight:bold;letter-spacing:2px;color:#fffef9;text-decoration:none;border-radius:8px;">立即回桌前开始学习 &nbsp;→</a>
        </td>
      </tr></table>
    </td></tr>

    <!-- 格言 + 睡猫 -->
    <tr><td style="padding:32px 40px 0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e2dbc7;font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" style="padding-top:16px;">
          <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:11px;letter-spacing:3px;color:#a39a83;font-weight:bold;">土豆人备考格言</div>
          <div style="font-family:'Songti SC','SimSun',serif;font-size:14px;line-height:2;color:#6b6a5c;padding-top:8px;">“上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的学友正默默和你并肩作战，快来汇合吧！”</div>
        </td>
        <td width="186" valign="bottom" align="right" style="padding-top:10px;">
          <img src="${catSleepSrc}" width="178" alt="趴在书上睡着的小猫" style="display:block;border:0;max-width:178px;">
        </td>
      </tr></table>
    </td></tr>

    <!-- 页脚 -->
    <tr><td style="padding:24px 40px 26px 40px;">
      <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;line-height:1.9;color:#a09a87;border-top:1px solid #eeead9;padding-top:16px;">
        此邮件由你的备考伙伴「<strong>${senderHtml}</strong>」在土豆考公工作台手动点击「戳一下」触发。<br>
        土豆考公工作台 · 陪伴每一位脚踏实地的考公人
      </div>
    </td></tr>
  </table>

</td></tr></table>
</body>
</html>`;

  return { subject, text, html };
}

