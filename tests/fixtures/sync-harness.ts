/**
 * Browser test harness: re-exports the real persistence + sync modules so the
 * regression suite can exercise them against native IndexedDB / Web Locks /
 * fetch inside Chromium (no mocked module internals).
 */
export * from '../../src/utils/db';
export * from '../../src/utils/syncClient';
export * from '../../src/utils/mediaSync';
export * from '../../src/utils/seedMerge';
export * from '../../src/utils/guestMigration';
export { BLANK_STATE, DEMO_STATE } from '../../src/constants/initialData';
