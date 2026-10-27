# Experience fixes implementation plan

> **For agentic workers:** Use superpowers:executing-plans. User approved the complete design in chat and explicitly requested direct implementation.

**Goal:** Implement the confirmed experience fixes without changing the cancelled question-bank requirement or deploying production.

**Architecture:** Keep books/courses/library as study sources. Add independent dated todos; extend persisted plan timers and atomic record reversal. Preserve the existing IDB/outbox/CAS architecture and introduce workspace schema 4 only when new fields are used, while continuing to read and sync schema 3.

**Tech Stack:** React, TypeScript, IndexedDB, Express, SQLite. No new dependencies.

**Spec:** Approved chat plan, “土豆工作台体验优化：最终需求与实施方案”. This file records its implementation boundaries.

## Global constraints

- Only Learning's library tab becomes independent todos; keep the internal library and today's source picker.
- Todos: manual daily creation, dated history, toggle completion, delete; no study statistics.
- Time fields may be blank drafts; blank/zero must not submit or fall back to defaults.
- Timers: count up/count down/pomodoro; countdown/focus overtime continues; rest never counts and stops at its deadline; transitions are manual.
- Midnight caps old timers, archives old plans without deleting records, and allows historical completion.
- Manual plan deletion reverses its associated record and source increments atomically; retain photos and manual baseline, reject inconsistent counters.
- Course planned lessons and minutes; manual confirmation of actual integer lessons and minutes; lesson-based progress remains.
- Note-only wrong-photo search, date filters, collapsed books and incremental thumbnails; distinct subject colors; separate analysis minutes by type.
- Registration below login; retain one-use invites; do not claim the production invite cause is verified.
- Save automatically, retry bounded network requests, preserve frozen request identity, auth fencing and conflict protection.
- No production/data/backup cleanup, deployment, APK release, dependency additions, or unrelated changes.

## Review focus

- Old clients cannot erase new schema fields; exact old request replays still succeed.
- Background/reopened timers are capped at midnight; rest duration cannot inflate learning.
- Repeated deletion and missing source entities cannot double-reverse records.
- New todo/timer fields survive persistence, backup import and server round trips.
- Searches include notes of deleted-book photos and never eagerly mount all photos.

## Tasks

1. [x] Add failing workflow/backup tests for invalid plan time, record reversal, independent todos, timer transitions and midnight caps. Implement pure mutations/types and verify target tests.
2. [x] Extend schema validation, backup normalization and versioned sync payloads; test new-field round trips, downgrade rejection and immutable old-request replay.
3. [x] Wire Context operations and automatic timer maintenance; implement TodoView, plan/time/course inputs, history and focus modes. Verify types and browser interactions.
4. [x] Implement note filtering, folded/paged photos, type-based analysis totals, distinct colors and registration placement/diagnostics. Verify rendered behavior.
5. [x] Bound workspace/media network requests and test timeout recovery without changing idempotency. Run full tests, typecheck, build, isolated browser/real-server acceptance; review the diff and report actual limits.

Each behavioral task follows a failing-test → minimal implementation → passing-test cycle. Commit only this task's files after verification; do not stage pre-existing untracked files.

## Execution ledger

- Baseline: codex/personal-release-fixes@96fe1b8. Existing untracked .serena and prior docs preserved.
- Ruling: execute in the current feature branch because the user explicitly requested direct edits; do not create or switch worktrees.
- Ruling: schema 3 remains valid for legacy states; new features mark their state version 4, with an anti-downgrade server guard. Database disaster-recovery manifest version is separate and remains unchanged.

- Tasks 1–5 complete: 209 unit/render/network tests, 31 server tests and 24 disaster-recovery tests passed; typecheck/build passed; 15 real-browser checks passed using temporary SQLite + native IDB.
- Final review found two P2 issues, each reproduced before fixing: matched-source guest records could reverse the account baseline; captured expired-rest IDs could pause a new focus. Both fixed with passing regressions.
- Ruling: newly migrated matched-source records carry sourceApplied=false because their counters were deliberately not merged. Legacy records without this marker retain their existing source-accounting convention; uncertain/inconsistent counters cause an atomic refusal instead of negative counts.
- Ruling: application foreground reminders are implemented; native lock-screen alarms, production invite lookup, deployment and APK distribution remain outside this code-only execution.
- Ruling: keep the current feature branch; no merge, push, remote change or worktree cleanup.
