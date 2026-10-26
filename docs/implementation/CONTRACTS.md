# Technical Contracts & Specifications

## 1. Storage & Persistence Contracts
- Database Name: `kaogong_potato_v3` (v3 schema in IndexedDB)
- Stores:
  - `snapshots`: Keyed by `'latest'`, holds `{ key: string, state: AppState, version: number, revision: number, migratedFromV2: boolean, updatedAt: string }`.
  - `media`: Keyed by `id`, holds `{ id: string, type: 'photo' | 'avatar', mime: string, blob: Blob | string, createdAt: string }`.
  - `damaged_cache`: Keyed by `id`, holds raw corrupted strings.
  - `outbox` (M2): Keyed by `id`, holds pending sync mutation batches.
- Revision Management:
  - Monotonically increasing integer `revision`.
  - Stale write check occurs strictly inside IndexedDB `readwrite` transaction.
  - If current snapshot revision != expected revision, transaction aborts with `REVISION_CONFLICT`.

## 2. Timer & Completion Contracts
- Running timer:
  - `timerStart > 0`: Unix epoch timestamp when timer resumed.
  - `accumulatedMs`: Milliseconds accumulated across previous running segments.
  - `actualMinutes`: Integer floor of `accumulatedMs / 60000`.
- Pause Contract:
  - When pausing, `accumulatedMs += Date.now() - timerStart`, `timerStart = 0`. Idempotent if `timerStart === 0`.
- Completion Contract:
  - Atomic update inside `commitMutation`:
    - Mark plan `done = true`, `actualMinutes`, `accumulatedMs`.
    - If `book`: update `book.done`, `book.errors`, `book.minutes`.
    - If `course`: update `course.completedLessons`, `course.minutes`.
    - Create exactly one `StudyRecord` attributed to the plan's original `date`.
  - Non-reversible duplicate completion rejection.

## 3. Avatar & Portable Backup Contracts
- Avatars:
  - Built-in avatars are identified by string `'pose-0'` through `'pose-7'`.
  - Custom user uploads are stored in `media` store with ID or data URL.
- Portable Backup Export:
  - `createPortableBackupState` resolves local `media` IDs to base64 Data URLs so that JSON export is self-contained.
  - Built-in avatars (`pose-0`~`pose-7`), data URLs, HTTP URLs, and relative paths MUST NOT be resolved against the `media` store.
  - In `preview` mode, no resolution against live IndexedDB is permitted.

## 4. API & Sync Contracts (M2 Target)
- Auth:
  - `POST /api/auth/register` (single-use invite code, username, Argon2id password)
  - `POST /api/auth/login` (rate-limited, returns HttpOnly session cookie)
  - `POST /api/auth/logout` (revokes session)
  - `GET /api/auth/me` (returns authenticated user profile or 401)
- Workspace Sync:
  - `GET /api/workspace` (returns latest snapshot revision, updated_at, etag)
  - `POST /api/workspace` (pushes new snapshot revision with idempotency key `requestId`, `expectedRevision`)
  - 409 Conflict: Returns remote revision and snapshot when revision mismatch occurs.
- Media:
  - `POST /api/media/upload` (multipart/form-data, ownership verification, quota enforcement)
  - `GET /api/media/:id` (session authenticated, strictly verifies resource belongs to user)
