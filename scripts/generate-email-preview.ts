import fs from 'node:fs';
import path from 'node:path';
import { generatePokeEmailContent } from '../server/pokeEmailTemplate';

const outputDir = path.resolve('output');
fs.mkdirSync(outputDir, { recursive: true });

const email = generatePokeEmailContent({
  senderNickname: '阿土（学友）',
  recipientNickname: '下一站上岸',
  loginUrl: 'https://work.ruyne.space',
  useCid: true,
  customMessage: '说好一起上岸，约定好的复习时间已经到了，今日任务还在等你打卡，快回书桌前一起复习吧！',
  checkItems: [
    { num: '01', subject: '行测', text: '言语理解抓中心、资料分析速算公式背熟了吗？' },
    { num: '02', subject: '申论', text: '概括归纳要点找全、大作文思辨结构列出来了吗？' },
  ],
});

const htmlPath = path.join(outputDir, 'poke-email-preview.html');
fs.writeFileSync(htmlPath, email.html, 'utf-8');
const textPath = path.join(outputDir, 'poke-email-preview.txt');
fs.writeFileSync(textPath, email.text, 'utf-8');

console.log('Preview HTML generated at:', htmlPath);
console.log('Subject:', email.subject);
