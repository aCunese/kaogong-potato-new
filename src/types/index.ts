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
  | { ok: true; value: T }
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
  revision: number;
  migratedFromV2: boolean;
  updatedAt: string;
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
  requestId: string;
  state: AppState;
  expectedRevision: number;
  generationId: string;
  createdAt: string;
  status: 'pending' | 'in_flight' | 'failed';
  reason?: string;
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
