# Implementation Status

## Baseline Snapshot
- Base Commit: `main@535cb42`
- Branch: `main`
- Initial Dirty Files: 20 modified, 3 untracked
- Backup Files Created:
  - `docs/implementation/baseline_diff.patch`
  - `docs/implementation/baseline_status.txt`
- Current Runtime Environment: Node.js `v22.22.3`, Bun `1.3.14`, Darwin ARM64

## Milestone Progress Summary
- [x] Baseline audit & workspace preservation
- [x] M1: Local workbench defect fixes & regression verification
  - [x] Revision concurrency check in IndexedDB write transaction
  - [x] Wait for IndexedDB transaction completion (oncomplete vs onsuccess)
  - [x] Millisecond timer precision and pause idempotency
  - [x] Atomic completion mutation (book/course/custom -> record + plan + library)
  - [x] 30/90 days local natural day boundaries
  - [x] Orphan photo deletion and view preservation
  - [x] Built-in avatar `pose-0`~`pose-7` export fix in `createPortableBackupState`
  - [x] Preview isolation: prevent preview export from touching real IndexedDB media
  - [x] Fix dialog accessibility & role in `FocusModal.tsx` and `CompletionModal.tsx`
  - [x] Fix `verify-screens.ts` button and text selectors (`共 7 门网课`, `完成登记`)
  - [x] Run full 50-screen 3-viewport automated test and confirm 100% pass (160/160 pass)
- [/] M2: Accounts, User Isolation, Server Persistence & Outbox Sync
  - [ ] Node.js 24 LTS + Express 5 server scaffold
  - [ ] SQLite WAL persistence & user database schema
  - [ ] Argon2id password hashing, single-use invites, session cookie, CSRF protection
  - [ ] Outbox queue & revision snapshot sync
  - [ ] Media upload & ownership verification
  - [ ] Offline-first IndexedDB partitioning per userId
- [ ] M3: Docker Compose, Disaster Recovery, Restic, & Restore Drills
- [ ] M4: Android Shell, Service Worker Offline Cache, & Versioning / Rollback

## Next Steps
1. Commit M1 milestone baseline into git.
2. Design and implement M2 backend server in `server/`:
   - Express 5 + better-sqlite3 / sqlite3 with WAL mode.
   - User table, invite code table, session table, snapshot table, media table, reset code table.
   - Auth APIs, workspace sync APIs, media upload/download APIs.
3. Implement frontend sync client:
   - Outbox in IndexedDB partitioned by `userId`.
   - Sync status bar (saved locally, syncing, synced, conflict).
   - Conflict resolution UI.
