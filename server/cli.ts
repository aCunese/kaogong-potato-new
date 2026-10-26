import fs from 'node:fs';
import path from 'node:path';
import {
  createInviteCode,
  listUsers,
  setUserActiveStatus,
  createPasswordResetCode,
  resetPasswordWithCode,
  restoreUserWorkspace,
} from './admin';
import { rotateGenerationId, getCurrentGenerationId, closeDb } from './db';

const [,, command, ...args] = process.argv;

async function run() {
  switch (command) {
    case 'create-invite': {
      const code = createInviteCode('cli');
      console.log(`\n🎉 新注册邀请码已生成:\n${code}\n（一次性使用，注册后自动绑定作废）\n`);
      break;
    }

    case 'list-users': {
      const users = listUsers();
      console.log(`\n📋 当前系统用户列表 (${users.length} 个账号):`);
      console.table(users.map(u => ({
        ID: u.id,
        用户名: u.username,
        昵称: u.nickname,
        角色: u.role,
        状态: u.is_active ? '✅ 启用' : '🚫 停用',
        云端修订号: u.revision,
        媒体占用: `${(u.mediaBytes / 1024 / 1024).toFixed(2)} MB`,
        注册时间: u.created_at.slice(0, 16).replace('T', ' '),
      })));
      break;
    }

    case 'disable-user': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts disable-user <userId>'); process.exit(1); }
      const ok = setUserActiveStatus(userId, false);
      console.log(ok ? `✅ 用户 ${userId} 已停用，所有活跃会话已撤销。` : `❌ 用户 ${userId} 不存在。`);
      break;
    }

    case 'enable-user': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts enable-user <userId>'); process.exit(1); }
      const ok = setUserActiveStatus(userId, true);
      console.log(ok ? `✅ 用户 ${userId} 已恢复启用。` : `❌ 用户 ${userId} 不存在。`);
      break;
    }

    case 'reset-code': {
      const userId = args[0];
      if (!userId) { console.error('用法: bun server/cli.ts reset-code <userId>'); process.exit(1); }
      const result = createPasswordResetCode(userId, 'cli');
      if (!result) { console.error(`❌ 用户 ${userId} 不存在。`); process.exit(1); }
      console.log(`\n🔑 一次性密码重置码 (30分钟有效):\n${result.code}\n有效期至: ${result.expiresAt}\n`);
      break;
    }

    case 'reset-password': {
      const [code, newPass] = args;
      if (!code || !newPass) { console.error('用法: bun server/cli.ts reset-password <code> <newPassword>'); process.exit(1); }
      const result = await resetPasswordWithCode(code, newPass);
      console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case 'rotate-gen': {
      const oldGen = getCurrentGenerationId();
      const newGen = rotateGenerationId();
      console.log(`\n🔄 同步代际已轮换并撤销所有会话:\n旧代际: ${oldGen}\n新代际: ${newGen}\n`);
      break;
    }

    case 'restore-user': {
      const [userId, backupFile] = args;
      if (!userId || !backupFile) { console.error('用法: bun server/cli.ts restore-user <userId> <backupJsonFile>'); process.exit(1); }
      const resolved = path.resolve(backupFile);
      if (!fs.existsSync(resolved)) { console.error(`❌ 文件不存在: ${resolved}`); process.exit(1); }
      const content = fs.readFileSync(resolved, 'utf-8');
      const result = restoreUserWorkspace(userId, content, 'cli_restore');
      console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    default:
      console.log(`
考公工作台 · 管理员维护命令行工具

可用命令:
  create-invite                         生成新的一次性注册邀请码
  list-users                            查看所有已注册用户及其存储配额
  disable-user <userId>                 停用用户并撤销所有在线登录
  enable-user <userId>                  重新启用用户
  reset-code <userId>                   为用户生成30分钟一次性密码重置码
  reset-password <code> <newPassword>   使用重置码设置新密码
  rotate-gen                            轮换同步代际（整机灾备恢复后使用）
  restore-user <userId> <backupPath>    针对单个用户安全执行备份快照恢复
`);
  }
}

run().finally(() => closeDb());
