export interface PokeEmailParams {
  senderNickname: string;
  recipientNickname: string;
  loginUrl?: string;
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
  return process.env.PUBLIC_URL || 'https://work.ruyne.space';
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

  const subject = `⚡️【土豆考公】你的研友「${senderClean}」向你发来了一记夺命连环催学提醒！`;

  const text = [
    `亲爱的 ${recipientClean} 同学：`,
    '',
    `⚡️ 哔哔哔！收到来自研友「${senderClean}」的备考催学提醒！`,
    '',
    '“说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！”',
    '',
    '📚 行测：言语理解抓中心、资料分析速算公式背熟了吗？',
    '📝 申论：概括归纳要点找全、大作文思辨结构列出来了吗？',
    '放下手机，深呼吸，倒一杯温水，现在坐回书桌前学 25 分钟还不晚！🥔💨',
    '',
    `👉 立即前往土豆考公工作台：${appUrl}`,
    '',
    '💡 土豆人备考格言：“上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的研友正默默和你并肩作战，快来汇合吧！”',
    '',
    '----------------------------------------',
    `此邮件由你的备考伙伴「${senderClean}」在土豆考公工作台手动点击触发。`,
    '土豆考公工作台 · 陪伴每一位脚踏实地的考公人',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; color: #2D3728; line-height: 1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #FAF8F5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #FFFFFF; border-radius: 24px; border: 1px solid #E2E8D8; box-shadow: 0 10px 25px rgba(75, 98, 64, 0.08); overflow: hidden;">
          
          <!-- Top Accent Bar -->
          <tr>
            <td style="background: linear-gradient(135deg, #4B6240 0%, #688559 100%); padding: 22px 28px; text-align: left;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="display: inline-block; background-color: rgba(255,255,255,0.22); color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; letter-spacing: 0.5px; margin-bottom: 6px;">
                      研友督学专线 · 学习打卡提醒 📖
                    </span>
                    <h1 style="margin: 4px 0 0; color: #FFFFFF; font-size: 20px; font-weight: 800; letter-spacing: -0.3px;">
                      🥔 土豆考公工作台
                    </h1>
                  </td>
                  <td align="right" style="font-size: 32px;">
                    🥔⚡️
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 28px 24px;">
              <!-- Greeting -->
              <h2 style="margin: 0 0 18px; font-size: 17px; font-weight: 700; color: #2D3728;">
                亲爱的 <span style="color: #4B6240; font-weight: 800;">${recipientHtml}</span> 同学：
              </h2>

              <!-- Alert Box -->
              <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #F59E0B; border-radius: 14px; padding: 16px 18px; margin-bottom: 24px;">
                <div style="font-size: 14px; font-weight: 700; color: #92400E; margin-bottom: 6px;">
                  ⚡️ 收到来自研友「${senderHtml}」的一记夺命连环催学提醒！
                </div>
                <div style="font-size: 13.5px; color: #B45309; line-height: 1.65;">
                  “说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！”
                </div>
              </div>

              <!-- Exam Study Encouragement -->
              <div style="font-size: 14px; color: #4A5568; line-height: 1.8; margin-bottom: 26px;">
                <p style="margin: 0 0 10px;">
                  📚 <strong>行测：</strong> 言语理解抓中心、资料分析速算公式背熟了吗？
                </p>
                <p style="margin: 0 0 10px;">
                  📝 <strong>申论：</strong> 概括归纳要点找全、大作文思辨结构列出来了吗？
                </p>
                <p style="margin: 0; color: #2D3728; font-weight: 500;">
                  放下手机，深呼吸，倒一杯温水，现在坐回书桌前学 25 分钟还不晚！🥔💨
                </p>
              </div>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${appUrlAttr}" target="_blank" style="display: inline-block; background-color: #4B6240; color: #FFFFFF; font-size: 15px; font-weight: 700; text-decoration: none; padding: 13px 36px; border-radius: 9999px; box-shadow: 0 4px 14px rgba(75, 98, 64, 0.35); letter-spacing: 0.3px;">
                      🚀 立即回桌前开始学习
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Quote Box -->
              <div style="background-color: #F4F7F0; border-radius: 14px; padding: 16px; text-align: center; border: 1px dashed #D3E0C8; margin-bottom: 12px;">
                <div style="font-size: 12.5px; color: #4F6344; line-height: 1.6;">
                  💡 <strong>土豆人备考格言：</strong><br/>
                  “上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的研友正默默和你并肩作战，快来汇合吧！”
                </div>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFBF9; padding: 18px 28px; border-top: 1px solid #EAEFE5; text-align: center;">
              <p style="margin: 0 0 4px; font-size: 11.5px; color: #8C9985; line-height: 1.5;">
                此邮件由你的备考伙伴「<strong>${senderHtml}</strong>」在土豆考公工作台手动点击「⚡️ 戳一下」触发。
              </p>
              <p style="margin: 0; font-size: 11px; color: #A8B4A2;">
                土豆考公工作台 · 陪伴每一位脚踏实地的考公人
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
