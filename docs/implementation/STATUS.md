# Implementation Status

## Baseline Snapshot
- Base Commit: `main@6351f3a`
- Active Working Branch: `codex/prod-release-m1-m4`
- Baseline Audit:
  - 84 Bun unit tests: PASS
  - 7 Backend server integration tests: PASS
  - 1 Disaster recovery drill test: PASS
  - 160 Playwright 3-viewport screen tests: PASS
- Verified Remote Infrastructure:
  - Target Host: `ubuntu@18.224.72.68` (AWS EC2 Ubuntu 24.04 LTS x86_64, 2 vCPU, 2GB RAM, 24GB disk free)
  - Docker 29.9.2, Docker Compose v5.6.1 available
  - Port 3000 free; Nginx active on 80/443 with Cloudflare Origin SSL certificate
  - Domain: `work.ruyne.space` CNAME to `ruyne.space` under Cloudflare proxy

## Current Execution Phase: M1 (Sync, Auth, Generation, Seed Factory & Backend Validation)

### Work Allocation & File Ownership
1. **Seed Data Factory & Lifecycle (P0)**:
   - File: `src/constants/initialData.ts`, `src/utils/seedFactory.ts` (Owner: Frontend/Data)
   - Scope: 14 books (0 progress), 7 courses (0 progress, placeholder URL cleared), 22 library items (14 books + 7 courses + 1 morning reading), plans/records/wrong empty, profile with real username/nickname, stable countdown IDs with empty dates.
   - Lifecycle: Server-side atomic seed generation on registration in `server/app.ts` & `server/workspace.ts`. Frontend hydrates server state directly without pushing blank snapshot.
2. **Sync Direction & Conflict UI (Defects A & B)**:
   - Files: `src/utils/syncClient.ts`, `src/context/AppContext.tsx`, `src/App.tsx`, `src/components/SyncModal.tsx`
   - Scope: Separate `syncNormal`, `forceUploadLocal`, `forcePullRemote`. Prevent overwriting local edits during pull by version checks inside IndexedDB transaction.
3. **Session Generation & Clean Account Switching (Defect C & D)**:
   - Files: `src/context/AppContext.tsx`, `src/utils/db.ts`
   - Scope: Tag all async sync/auth calls with session generation. Discard stale responses on logout/switch.
4. **Offline Cold Start Identity Preservation (Defect E)**:
   - File: `src/context/AppContext.tsx`, `src/utils/db.ts`
   - Scope: Keep non-sensitive last active user identity locally (NO token in storage). On network error during `/api/auth/me`, maintain user workspace in offline mode.
5. **Atomic Workspace Reset (Defect F)**:
   - Files: `src/context/AppContext.tsx`, `src/utils/db.ts`
   - Scope: Clear local cache vs reset workspace. Reset creates recovery snapshot and enqueues sync mutation.
6. **Conflict Resolution Atomicity (Defect G)**:
   - Files: `src/context/AppContext.tsx`, `src/utils/db.ts`
   - Scope: Atomically replace snapshot, handle old outbox, and commit new outbox in a single transaction.
7. **Concurrency Double-Spend Defense (Defect H)**:
   - Files: `server/app.ts`, `server/admin.ts`
   - Scope: Conditional atomic consumption of invite and reset codes with `changes === 1` check. Password policy alignment (min 8 chars).
8. **Generation Guard Enforcement (Defect I)**:
   - Files: `server/workspace.ts`, `server/db.ts`, `src/utils/syncClient.ts`, `src/context/AppContext.tsx`
   - Scope: Non-empty generation check, record generation per mutation, reject stale outbox on generation rotation.
9. **Server Validation, Unicode Filename & Typecheck (Defect J)**:
   - Files: `server/workspace.ts`, `server/app.ts`, `tsconfig.json`
   - Scope: AppState schema validation on sync, RFC 5987 Content-Disposition encoding, fix `req.params.id` type error and include `server/` in TS checks.

## Milestones Roadmap
- [x] **M1**: Sync, Auth, Transactions, Generation, Seed Data & Server Validation (Completed: commit `b2d2769`)
- [x] **M2**: Backup Consistency, Recovery, Offline Cache, Versioning & Deployment Config (Completed: commit `331da7c`)
- [x] **M3**: AWS / Cloudflare Independent Deployment & Public Verification (Completed: live at https://work.ruyne.space)
- [x] **M4**: Android Signed Deliverable, Hardware Verification & Rehearsal (Completed: v1.0.1 APK signed with v2/v3, APK download live)

## Production Deployment Telemetry
- **Public Domain**: `https://work.ruyne.space`
- **Reverse Proxy**: Nginx 1.24 (Ubuntu 24.04 LTS), SSL Cloudflare Origin CA, Strict-Transport-Security, HTTP/2, 50M upload limit
- **Container**: `kaogong-potato-app` running image `kaogong-potato:latest` (Node 24 LTS, UID 1000 node user)
- **Database**: SQLite WAL mode persisted at `/home/ubuntu/kaogong-app/data/potato.db`
- **Media Storage**: `/home/ubuntu/kaogong-app/data/attachments/`
- **Automated Backup**: Daily cron at 03:00 UTC running `scripts/backup.sh`, logrotate configured
- **Health Endpoint**: `https://work.ruyne.space/api/health` -> `status: healthy`
- **Version Endpoint**: `https://work.ruyne.space/version.json` -> `version: 1.0.1`, `build: 20261026.02`
- **APK Deliverable**: `https://work.ruyne.space/api/download/apk` -> `kaogong-potato-v1.0.1.apk` (SHA256: 70b939badc4ea98854d97c680fdf60aa68cfaec99907b9a8a980a77c7f64a34b)
