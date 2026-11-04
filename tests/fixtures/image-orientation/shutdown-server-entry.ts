import fs from 'node:fs';
import { createInviteCode } from '../../../server/admin';

// Isolated test startup only; the invite is written inside a private temp folder.
fs.writeFileSync(process.env.ORIENTATION_INVITE_FILE!, createInviteCode());
await import('../../../server/index');
