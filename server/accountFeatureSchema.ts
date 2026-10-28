import type { Database } from 'better-sqlite3';
import { initEmailSchema } from './accountEmail';
import { initSharingSchema } from './sharing';

const tables: Record<string, string[]> = {
  account_email_bindings: ['user_id', 'email', 'verified_at'],
  email_challenges: ['id', 'user_id', 'email', 'code_hash', 'generation_id', 'created_at', 'expires_at', 'attempts', 'delivered'],
  email_rate_limits: ['bucket', 'window_start', 'count'],
  email_reminders: ['id', 'user_id', 'request_id', 'payload_hash', 'generation_id', 'title', 'body', 'send_at', 'timezone', 'status', 'revision', 'attempts', 'next_attempt_at', 'lease_token', 'lease_until', 'message_id', 'delayed', 'created_at', 'updated_at'],
  sharing_codes: ['id', 'owner_id', 'code_hash', 'generation_id', 'created_at', 'expires_at', 'used_at', 'cancelled_at'],
  sharing_grants: ['id', 'owner_id', 'viewer_id', 'generation_id', 'created_at', 'revoked_at'],
};

export function validateAccountFeatureSchema(db: Database): void {
  const marker = db.prepare("SELECT value FROM server_meta WHERE key='account_features_schema'").get() as { value: string } | undefined;
  const present = Object.keys(tables).some(name => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)));
  if (!marker && !present) return; // Supported backups made before account features existed.
  if (marker?.value !== '1') throw new Error('ACCOUNT_FEATURE_SCHEMA: unsupported or incomplete account feature version');
  for (const [name, required] of Object.entries(tables)) {
    const columns = db.pragma(`table_info(${name})`) as { name: string }[];
    if (required.some(column => !columns.some(found => found.name === column))) throw new Error(`ACCOUNT_FEATURE_SCHEMA: incomplete table ${name}`);
    const references = name === 'sharing_grants' ? ['owner_id', 'viewer_id'] : name === 'sharing_codes' ? ['owner_id'] : name === 'email_rate_limits' ? [] : ['user_id'];
    const foreignKeys = db.pragma(`foreign_key_list(${name})`) as { from: string; table: string; to: string }[];
    if (references.some(column => !foreignKeys.some(key => key.from === column && key.table === 'users' && key.to === 'id'))) throw new Error(`ACCOUNT_FEATURE_SCHEMA: missing ownership constraint ${name}`);
  }
}

export function migrateAccountFeatures(db: Database): void {
  validateAccountFeatureSchema(db);
  db.transaction(() => {
    initEmailSchema(db);
    initSharingSchema(db);
    db.prepare("INSERT OR REPLACE INTO server_meta(key,value) VALUES ('account_features_schema','1')").run();
  })();
}
