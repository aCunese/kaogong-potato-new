# Technical Contracts & Specifications

## 1. Storage & Persistence Contracts
- Database Name: `kaogong_potato_v3` (v3 schema in IndexedDB)
- Stores:
  - `snapshots`: Keyed by `'latest'`, holds `{ key: string, state: AppState, version: number, revision: number, migratedFromV2: boolean, updatedAt: string }`.
  - `media`: Keyed by `id`, holds `{ id: string, type: 'photo' | 'avatar', mime: string, blob: Blob | string, createdAt: string }`.
  - `damaged_cache`: Keyed by `id`, holds raw corrupted strings.
  - `outbox`: Keyed by `id`, holds pending sync mutation batches.
  - `auth_meta`: Keyed by `'last_user'`, holds non-sensitive `{ id, username, nickname, role, lastActiveAt }` for offline cold start. (NO TOKENS).
- Revision Management:
  - Monotonically increasing integer `revision`.
  - Stale write check occurs strictly inside IndexedDB `readwrite` transaction.
  - If current snapshot revision != expected revision, transaction aborts with `REVISION_CONFLICT`.

## 2. Formal Account Seed Factory Contract
- New registered accounts receive a seeded workspace created inside the registration transaction:
  1. **14 Books**:
     - Retains exact IDs, names, subjects, totals, pages from preview.
     - `done = 0`, `errors = 0`, `minutes = 0`.
  2. **7 Courses**:
     - Retains exact IDs, names, subjects, totalLessons from preview.
     - `completedLessons = 0`, `minutes = 0`.
     - `url = ''` (cleared, frontend displays "待添加课程链接").
  3. **22 Library Items**:
     - 14 book items (30 min default).
     - 7 course items (45 min default).
     - 1 custom item: `每日晨读人民日报时评` (20 min default).
     - Strict 1:1 mapping with books and courses.
  4. **Plans, Records, Wrong**:
     - `plans = []`, `records = []`, `wrong = []`. Zero fake history, zero active timers.
  5. **Profile & Countdowns**:
     - `profile = { name: `${nickname}的备考空间`, username, avatar: '' }`.
     - `countdowns = STABLE_COUNTDOWNS` (exam-national, exam-provincial, exam-public-service) with `date = ''`.
- Seed metadata: `seedVersion: 1` stored in `workspaces.seed_version` and separate from `schema_version: 3`.
- Lifecycle invariants:
  - Seeded once at server registration.
  - Non-resurrection: User-initiated deletion or clearance does not re-trigger seeding.
  - Existing accounts and partitions remain untouched.
  - `?preview=1` retains `DEMO_STATE` and remains isolated.

## 3. Sync Directions & Conflict Resolution Contract
- **Normal Sync (`syncNormal`)**:
  - If outbox is empty: checks remote revision via `GET /api/workspace`; if server > local, pulls and fast-forwards.
  - If outbox has items: sequentially pushes to `POST /api/workspace` with `generationId`, `expectedRevision`, `requestId`.
  - On 409 `REVISION_CONFLICT`: enters conflict state, stops processing subsequent items, surfaces both local and server state to UI.
- **Force Upload / Keep Local (`forceUploadLocal`)**:
  - Verifies server generation.
  - Re-checks server revision via `GET /api/workspace`.
  - Atomically inside single transaction: wipes outdated outbox items, generates an atomic force mutation targeting `serverRevision + 1`, commits, and pushes to server.
- **Force Pull / Keep Remote (`forcePullRemote`)**:
  - Before applying remote: creates a local emergency restore point in `workspace_history` or snapshot backup.
  - In a single IndexedDB transaction: checks if local state was modified during transit. If modified, flags conflict. If clean, clears outbox and applies `serverState`.
- **Generation Invariant (`GENERATION_MISMATCH`)**:
  - Pushes require matching non-empty `generationId`.
  - If server generation rotated (disaster restore), push returns 409 `GENERATION_MISMATCH`. Outbox items are quarantined for audit, never blindly replayed under a new generation.

## 4. API Security & Concurrency Contracts
- **Registration**:
  - `hashPassword` executed outside transaction.
  - In SQLite transaction:
    - Atomically verify and claim invite code: `UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL`.
    - Check `changes === 1`; rollback on mismatch.
    - Insert into `users`.
    - Insert seeded workspace into `workspaces` (revision: 1, seed_version: 1).
- **Password Reset**:
  - `hashPassword` executed outside transaction.
  - In SQLite transaction:
    - Atomically verify and claim reset code: `UPDATE reset_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?`.
    - Check `changes === 1`; rollback on mismatch.
    - Update `password_hash` in `users`.
    - Revoke all user sessions.
- **Password Policy**:
  - Consistent minimum 8 characters across registration and reset.
- **Content-Disposition**:
  - RFC 5987 compliance: `filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`.
- **Server Input Validation**:
  - `POST /api/workspace` rigorously validates `state` structure: schemaVersion === 3, core arrays (books, courses, library, plans, records, wrong, countdowns) exist and are non-null. Invalid states rejected with HTTP 400 without touching revision or history.
