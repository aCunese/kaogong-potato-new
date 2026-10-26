# Verification Ledger & Test Results

## Test Suite Executions

### 1. Bun Unit Test Suite (84 tests)
- Command: `bun test`
- Commit: `M1 Working Tree`
- Result: **84 passed / 0 failed** (808 assertions, ~821ms)
- Covered Suites:
  - `tests/screens_audit.test.ts` (7 tests)
  - `tests/storage-regressions.test.ts` (8 tests, including avatar export and preview isolation)
  - `tests/workflow-regressions.test.ts` (6 tests)
  - `tests/storage.test.ts` (36 tests)
  - `tests/workflow.test.ts` (21 tests)
  - `tests/ui_interaction.test.ts` (14 tests)

### 2. Playwright Headless 3-Viewport 50-Screen Audit
- Command: `bun scripts/verify-screens.ts`
- Environment: Headless Chromium, 3 viewports: 412x915, 393x873, 360x800
- Result: **160 passed / 0 failed** (100% pass)
  - 412x915: 50 screens + root checks passed
  - 393x873: 50 screens + root checks passed
  - 360x800: 50 screens + root checks passed
  - E2E Interaction Checks:
    - Orphan photo remains deletable and cancel preserves it: **Passed**
    - Preview changes do not mutate normal snapshot: **Passed**
    - Persisted mutation failure keeps draft without false success: **Passed**
    - Running plan completion pauses latest timer and uses recorded summary: **Passed**

### 3. Backend Server API & Security Suite (7 integration tests)
- Command: `npm run test:server` (`node --import tsx --test tests/server.test.ts`)
- Target: Node.js 24 LTS / Express 5 API
- Result: **7 passed / 0 failed**
  - GET `/version.json` and GET `/api/health` system telemetry
  - Single-use invite registration, Argon2id password hashing, uniqueness checks
  - Rate limiting (5 attempts / 15m) & CSRF token protection
  - Workspace revision snapshot sync, idempotency, and 409 conflict detection
  - Multi-user isolation & media ownership verification
  - Admin password reset code (30m), session revocation, and generation rotation
  - User backup export, history tracking, and history restore endpoints (`/api/backups/*`)

### 4. Disaster Recovery & Generation Rotation Drill (1 test)
- Command: `npm run test:dr` (`node --import tsx --test tests/disaster-recovery.test.ts`)
- Result: **1 passed / 0 failed**
  - Live data creation (rev 1, media attachment)
  - Hot backup using SQLite Online Backup API (`db.backup(...)`) & attachments manifest
  - Post-backup activity simulation
  - Total data corruption / disaster simulation
  - Restoration from hot backup & PRAGMA integrity check
  - Generation rotation (`rotateGenerationId()`), session revocation, and rejection of stale client push (`GENERATION_MISMATCH`)

### 5. Unified Test Suite Execution
- Command: `npm test` (`npm run test:unit && npm run test:server && npm run test:dr`)
- Result: **91 passed / 0 failed** (84 unit tests + 6 server tests + 1 DR drill test)

### 6. Build & Typecheck
- Command: `npm run build` (`tsc && vite build`)
- Result: **Passed** (0 errors, output bundles in `dist/`, including `sw.js`, `manifest.json`, `version.json`)
