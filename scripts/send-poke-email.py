#!/usr/bin/env python3
"""
Direct MX email sender for Potato Study Companion Poke Email.
Can send the generated rich HTML poke email directly to recipient via official MX.
"""

import sys
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid, formataddr
from email.header import Header
import os
import re

recipient = sys.argv[1] if len(sys.argv) > 1 else '946265043@qq.com'
preview_html_path = os.path.join(os.path.dirname(__file__), '../output/poke-email-preview.html')

if not os.path.exists(preview_html_path):
    print(f"Error: Preview HTML not found at {preview_html_path}")
    sys.exit(1)

with open(preview_html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

# Build alternative multipart email (Plain text + Rich HTML)
msg = MIMEMultipart('alternative')
msg['Subject'] = Header('⚡️【土豆考公】你的研友「阿土（研友）」向你发来了一记夺命连环催！', 'utf-8')
msg['From'] = formataddr((str(Header('土豆考公督学专线', 'utf-8')), 'service@potato.study'))
msg['To'] = recipient
msg['Date'] = formatdate(localtime=True)
msg['Message-ID'] = make_msgid(domain='potato.study')

plain_text = f"""亲爱的 {recipient} 同学：

⚡️ 收到来自研友「阿土（研友）」的一记夺命连环催！
“说好一起上岸，你怎么偷偷摸鱼啦？约定好的复习时间已经到了，今日任务还在等你打卡！”

📚 行测：言语理解抓中心、资料分析速算公式背熟了吗？
📝 申论：概括归纳要点找全、大作文思辨结构列出来了吗？
放下手机，深呼吸，倒一杯温水，现在坐回书桌前学 25 分钟还不晚！🥔💨

👉 立即回桌前开始学习：https://kaogong-potato.example.com

💡 土豆人备考格言：“上岸的人不是最聪明的，而是每天最耐得住寂寞坐在桌前的那一个。你的研友正默默和你并肩作战，快来汇合吧！”

----------------------------------------
此邮件由你的备考伙伴「阿土（研友）」在土豆考公工作台手动点击「⚡️ 戳一下」触发。
土豆考公工作台 · 陪伴每一位脚踏实地的考公人
"""

part1 = MIMEText(plain_text, 'plain', 'utf-8')
part2 = MIMEText(html_content, 'html', 'utf-8')
msg.attach(part1)
msg.attach(part2)

print(f"Connecting to QQ Mail MX server (mx1.qq.com:25)...")
s = smtplib.SMTP('mx1.qq.com', 25, timeout=15)
try:
    ehlo_res = s.ehlo('potato.study')
    print(f"EHLO: {ehlo_res}")
    mail_res = s.mail('service@potato.study')
    print(f"MAIL FROM: {mail_res}")
    rcpt_res = s.rcpt(recipient)
    print(f"RCPT TO {recipient}: {rcpt_res}")
    data_res = s.data(msg.as_bytes())
    print(f"DATA RESULT: {data_res}")
    if data_res[0] == 250:
        print(f"✅ 邮件已成功送达腾讯 QQ 邮箱服务器队列！目标邮箱: {recipient}")
    else:
        print(f"⚠️ 服务器返回状态码: {data_res}")
finally:
    s.quit()
