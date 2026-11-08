#!/usr/bin/env python3
"""
Authenticated SMTP email sender for Potato Study Companion Poke Email.
Uses official SSL/TLS SMTP authentication to guarantee inbox delivery and avoid spam folders.
"""

import sys
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.utils import formatdate, make_msgid, formataddr
from email.header import Header

# Load environment or local config
env_file = os.path.join(os.path.dirname(__file__), '../.env.smtp.local')
config = {}
if os.path.exists(env_file):
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                config[k.strip()] = v.strip()

smtp_host = os.environ.get('SMTP_HOST', config.get('SMTP_HOST', 'smtp.qq.com'))
smtp_port = int(os.environ.get('SMTP_PORT', config.get('SMTP_PORT', '465')))
smtp_user = os.environ.get('SMTP_USER', config.get('SMTP_USER', ''))
smtp_pass = os.environ.get('SMTP_PASS', config.get('SMTP_PASS', ''))
smtp_from = os.environ.get('SMTP_FROM', config.get('SMTP_FROM', smtp_user))
from_name = os.environ.get('SMTP_FROM_NAME', config.get('SMTP_FROM_NAME', '土豆考公'))

if not smtp_user or not smtp_pass:
    print("Error: SMTP_USER and SMTP_PASS must be provided in environment or .env.smtp.local")
    sys.exit(1)

recipient = sys.argv[1] if len(sys.argv) > 1 else '946265043@qq.com'
preview_html_path = os.path.join(os.path.dirname(__file__), '../output/poke-email-preview.html')
preview_txt_path = os.path.join(os.path.dirname(__file__), '../output/poke-email-preview.txt')

if not os.path.exists(preview_html_path):
    print(f"Error: Preview HTML not found at {preview_html_path}")
    sys.exit(1)

with open(preview_html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

plain_text = ""
if os.path.exists(preview_txt_path):
    with open(preview_txt_path, 'r', encoding='utf-8') as f:
        plain_text = f.read()
else:
    plain_text = f"""亲爱的 {recipient} 同学：

📖 收到来自学友「阿土（学友）」的学习打卡提醒！
“说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！”

01 [行测] 言语理解抓中心、资料分析速算公式背熟了吗？
02 [申论] 概括归纳要点找全、大作文思辨结构列出来了吗？

放下手机，深呼吸，倒一杯温水，现在坐回书桌前学 25 分钟还不晚！🥔💨

👉 立即前往土豆考公工作台：https://work.ruyne.space

💡 土豆人备考格言：“上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的学友正默默和你并肩作战，快来汇合吧！”

----------------------------------------
此邮件由你的备考伙伴「阿土（学友）」在土豆考公工作台手动点击触发。
土豆考公工作台 · 陪伴每一位脚踏实地的考公人
"""

# Build MIME structure:
# multipart/related
#   ├── multipart/alternative
#   │     ├── text/plain
#   │     └── text/html (referencing cid:xxx)
#   └── inline images (cid:cat_poke.png, etc.)
msg = MIMEMultipart('related')
msg['Subject'] = Header('【土豆考公】你的学友「阿土（学友）」喊你回书桌前学习打卡啦 🥔', 'utf-8')
msg['From'] = formataddr((str(Header(from_name, 'utf-8')), smtp_from))
msg['To'] = recipient
msg['Reply-To'] = smtp_from
msg['Date'] = formatdate(localtime=True)
from_domain = smtp_from.split('@')[1] if '@' in smtp_from else 'qq.com'
msg['Message-ID'] = make_msgid(domain=from_domain)
msg['X-Auto-Response-Suppress'] = 'All'
msg['X-Mailer'] = 'Potato-Study-Workspace'

msg_alt = MIMEMultipart('alternative')
part1 = MIMEText(plain_text, 'plain', 'utf-8')
part2 = MIMEText(html_content, 'html', 'utf-8')
msg_alt.attach(part1)
msg_alt.attach(part2)
msg.attach(msg_alt)

# Attach inline images
assets_dir = os.path.join(os.path.dirname(__file__), '../public/assets/email')
image_files = ['cat_poke.png', 'paw_stamp.png', 'paw_trail.png', 'cat_sleep.png']
for img_name in image_files:
    img_path = os.path.join(assets_dir, img_name)
    if os.path.exists(img_path):
        with open(img_path, 'rb') as img_f:
            img_part = MIMEImage(img_f.read(), _subtype='png')
            img_part.add_header('Content-ID', f'<{img_name}>')
            img_part.add_header('Content-Disposition', 'inline', filename=img_name)
            msg.attach(img_part)

print(f"Connecting to authenticated SMTP server ({smtp_host}:{smtp_port}, user: {smtp_user})...")
context = ssl.create_default_context()
if smtp_port == 465:
    with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=15) as server:
        server.login(smtp_user, smtp_pass)
        print("SMTP Auth Successful.")
        send_res = server.sendmail(smtp_from, [recipient], msg.as_string())
        print(f"✅ 邮件已成功通过 QQ 官方认证 SMTP 发送！目标邮箱: {recipient}, 返回状态: {send_res}")
else:
    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        print("SMTP Auth Successful.")
        send_res = server.sendmail(smtp_from, [recipient], msg.as_string())
        print(f"✅ 邮件已成功通过认证 SMTP 发送！目标邮箱: {recipient}, 返回状态: {send_res}")
