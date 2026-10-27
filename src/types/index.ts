export const SUBJECTS = [
  '资料分析',
  '判断推理',
  '言语理解',
  '数量关系',
  '政治理论',
  '常识判断',
  '申论',
  '面试',
] as const;

export type Subject = typeof SUBJECTS[number];

export interface Countdown {
  id: string;
  name: string;
  date: string;
}

export type PlanType = 'book' | 'course' | 'custom';

export interface Plan {
  id: string;
  date: string;
  libraryId: string;
  name: string;
  type: PlanType;
  sourceId: string;
  subject: Subject;
  plannedMinutes: number;
  actualMinutes: number;
  accumulatedMs?: number; // Exact elapsed milliseconds, prevents fractional pause inflation (Fixes A10)
  done: boolean;
  timerStart: number; // timestamp in ms, 0 if paused/not running
  recordId?: string;
}

export interface Book {
  id: string;
  name: string;
  subject: Subject;
  total: number;
  pages: number;
  done: number;
  errors: number;
  minutes: number;
}

export interface Course {
  id: string;
  name: string;
  subject: Subject;
  totalLessons: number;
  completedLessons: number;
  minutes: number;
  url: string;
}

export interface LibraryItem {
  id: string;
  type: PlanType;
  sourceId: string;
  name: string;
  subject: Subject;
  defaultMinutes: number;
}

export interface StudyRecord {
  id: string;
  planId: string;
  date: string;
  type: PlanType;
  sourceId: string;
  subject: Subject;
  minutes: number;
  questions: number;
  errors: number;
  lessons?: number; // for course completion
}

export interface WrongRecord {
  id: string;
  date: string;
  bookId: string;
  note: string;
  image: string; // base64 or object URL or media ID
  storagePath?: string;
  images?: string[];
}

export interface Profile {
  name: string;
  username: string;
  avatar: string;
}

export interface AppState {
  profile: Profile;
  countdowns: Countdown[];
  books: Book[];
  courses: Course[];
  library: LibraryItem[];
  plans: Plan[];
  records: StudyRecord[];
  wrong: WrongRecord[];
  version: 3;
}

export type MutationResult<T> =
  | { ok: true; value: T; revision?: number }
  | { ok: false; code: string; message: string; field?: string };

export type CompletionInput =
  | { type: 'book'; planId: string; questions: number; errors: number; minutes: number }
  | { type: 'course'; planId: string; lessons: number; minutes: number }
  | { type: 'custom'; planId: string; minutes: number };

export interface MediaRecord {
  id: string;
  type: 'photo' | 'avatar';
  mime: string;
  blob: Blob | string;
  thumbnailBlob?: Blob | string;
  createdAt: string;
}

export interface SnapshotRecord {
  key: string;
  state: AppState;
  version: 3;
  /**
   * Local mutation version. Monotonic counter of local writes to this partition.
   * NEVER send this value as the cloud `expectedRevision`.
   * Kept as `revision` for backward compatibility with existing snapshots/UI.
   */
  revision: number;
  /** Cloud revision this snapshot's content was last confirmed at (CAS base for pushes). */
  confirmedRevision?: number;
  /** Server generation this snapshot's content belongs to. */
  generationId?: string;
  /** Content hash (sha256 hex of JSON.stringify(state)) confirmed by the server. */
  confirmedContentHash?: string;
  /** Content hash (sha256 hex) of the CURRENT state stored in this snapshot. */
  contentHash?: string;
  migratedFromV2: boolean;
  updatedAt: string;
}

/** Server sync baseline for one account partition. Stored separately from the snapshot. */
export interface SyncBaseline {
  userId: string;
  confirmedRevision: number;
  generationId: string;
  contentHash: string;
  updatedAt: string;
}

/** Persisted conflict state so a conflict survives queue filtering / reload / focus. */
export interface SyncConflictRecord {
  userId: string;
  code: string;
  message: string;
  serverRevision: number;
  serverGenerationId: string;
  serverContentHash: string;
  serverState: AppState | null;
  localRevision?: number;
  detectedAt: string;
}

export interface User {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

export interface OutboxRecord {
  id: string;
  userId: string;
  /** Stable idempotency key. Must never be regenerated for retries of the same task. */
  requestId: string;
  state: AppState;
  /** Cloud revision this task was built against (CAS base). NOT a local edit counter. */
  expectedRevision: number;
  generationId: string;
  createdAt: string;
  status: 'pending' | 'in_flight' | 'failed' | 'quarantined' | 'conflict';
  reason?: string;
  quarantineReason?: string;
  /** Number of failed push attempts (bounded exponential backoff). */
  attempts?: number;
  /** ISO timestamp before which this task must not be retried. */
  nextAttemptAt?: string;
  /** Cross-tab lease owner + expiry for in_flight tasks. */
  leaseOwner?: string;
  leaseExpiresAt?: string;
  /** Content hash of the payload when it was successfully confirmed. */
  confirmedContentHash?: string;
  /** Monotonically increasing attempt fence to ignore stale release/confirmation callbacks. */
  attemptFence?: number;
  /** Timestamp when the current in-flight attempt was dispatched. */
  sentAt?: string;
  /** Frozen serialized request for idempotent retry verification. */
  frozenRequest?: string;
  /** Precomputed payload hash of the task state. */
  payloadHash?: string;
  /** Expected server content hash for CAS-by-hash verification. */
  expectedContentHash?: string;
}

export interface WorkspacePushPayload {
  requestId: string;
  expectedRevision: number;
  expectedContentHash?: string;
  schemaVersion: 3;
  generationId: string;
  state: AppState;
  reason: string;
}

export interface PreparedOutboxCompaction {
  targetTaskId: string;
  observedTaskIds: string[];
  snapshotToken: { revision: number; contentHash: string };
  state: AppState;
  expectedRevision: number;
  generationId: string;
}

export type SyncState = 'idle' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface DamagedCacheRecord {
  id: string;
  raw: string;
  recordedAt: string;
  reason: string;
}

export type MainTab = 'today' | 'learning' | 'wrong' | 'analysis' | 'settings';
export type LearningSubTab = 'books' | 'courses' | 'library';
export type AnalysisSubTab = 'overall' | 'monthly';

export interface LockScope {
  ownerId: string;
  userId: string;
  fence: number;
  expiresAt: number;
  isExpired: () => boolean;
}

export interface OperationScope {
  userId: string | null;
  epoch: number;
  operationId: string;
  signal?: AbortSignal;
}

export interface OperationContext {
  scope: OperationScope;
  isCurrent: () => boolean;
  abortSignal?: AbortSignal;
}

export interface ExecuteMutationOptions {
  context?: OperationContext;
  recoveryBeforeWrite?: boolean;
}

