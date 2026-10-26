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
- [x] M1: Local workbench defect fixes & regression verification (`9ec3a38`)
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
- [x] M2: Accounts, User Isolation, Server Persistence & Outbox Sync (`8431f40`)
  - [x] Express 5 server scaffold (`server/app.ts`, `server/index.ts`)
  - [x] SQLite WAL persistence & dynamic path schema (`server/db.ts`)
  - [x] Argon2id password hashing, single-use invites, session cookie, CSRF protection (`server/auth.ts`)
  - [x] Outbox queue & revision snapshot sync with 409 conflict detection (`server/workspace.ts`)
  - [x] Media upload, magic byte check, quota limits & ownership verification (`server/media.ts`)
  - [x] Offline-first IndexedDB partitioning per userId & sync flusher (`src/utils/db.ts`, `src/utils/syncClient.ts`)
  - [x] Server management CLI tool (`server/cli.ts`)
  - [x] Server integration test suite (`tests/server.test.ts`, 6/6 pass)
- [x] M3: Docker Compose, Disaster Recovery, Restic, & Restore Drills
  - [x] Production Dockerfile (multi-stage Node 24 bookworm-slim) & docker-compose.yml
  - [x] Online SQLite backup & restic disaster recovery scripts (`scripts/backup.sh`, `scripts/restore.sh`)
  - [x] Disaster recovery rehearsal test (`tests/disaster-recovery.test.ts`, 1/1 pass)
- [x] M4: Android Shell, Service Worker Offline Cache, & Versioning / Rollback
  - [x] Service Worker offline shell caching (`public/sw.js`) & register in `index.html` and `src/main.tsx`
  - [x] Strict API route isolation in SW (never fallback to index.html for API requests)
  - [x] Versioning check (`/version.json`), non-intrusive update prompt without disrupting active timer
  - [x] Offline readiness indicator ("离线已就绪") wired to IndexedDB and SW cache
  - [x] Android WebView production shell in `android/` with strict SSL, no mixed content, and physical back button JavaScript delegation
  - [x] Full end-to-end verification (84 unit tests, 6 server tests, 1 disaster recovery test, 160/160 browser screen audits pass)

## Completed Milestones
All four core milestones (M1 Local Defects, M2 Cloud Multi-User Accounts & Sync, M3 Production Deployment & Disaster Recovery, M4 Offline Service Worker & Android Shell) have been implemented, verified, and confirmed against specifications.
