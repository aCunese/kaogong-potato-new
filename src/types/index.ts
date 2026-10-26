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
}

export interface WrongRecord {
  id: string;
  date: string;
  bookId: string;
  note: string;
  image: string; // base64 or object URL
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
  version: number;
}

export type MainTab = 'today' | 'learning' | 'wrong' | 'analysis' | 'settings';
export type LearningSubTab = 'books' | 'courses' | 'library';
export type AnalysisSubTab = 'overall' | 'monthly';
