import fs from 'node:fs';
import path from 'node:path';
import { generatePokeEmailContent } from '../server/pokeEmailTemplate';

const outputDir = path.resolve('output');
fs.mkdirSync(outputDir, { recursive: true });

const email = generatePokeEmailContent({
  senderNickname: '阿土（研友）',
  recipientNickname: '946265043@qq.com',
  loginUrl: 'https://kaogong-potato.example.com',
});

const htmlPath = path.join(outputDir, 'poke-email-preview.html');
fs.writeFileSync(htmlPath, email.html, 'utf-8');

console.log('Preview HTML generated at:', htmlPath);
console.log('Subject:', email.subject);
