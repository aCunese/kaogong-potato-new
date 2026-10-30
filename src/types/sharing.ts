import type { PlanType, StudySubject } from './index';

export interface SharingCodeMetadata {
  id: string;
  createdAt: string;
  expiresAt: string;
}

/** Plaintext exists only in the generation response and the current open dialog. */
export interface CreatedSharingCode extends SharingCodeMetadata {
  value: string;
}

export interface SharedGrant {
  id: string;
  nickname: string;
  createdAt: string;
}

export interface SharingGrantsResponse {
  ok: true;
  owned: SharedGrant[];
  received: SharedGrant[];
  codes: SharingCodeMetadata[];
}

export interface SharedStudyTotals {
  minutes: number;
  questions: number;
  errors: number;
  /** Percentage from 0 to 100; null when no book questions were recorded. */
  accuracy: number | null;
  lessons: number;
}

export interface SharedSourceProgress {
  name: string;
  subject: StudySubject;
  total: number;
  done: number;
  errors: number;
  minutes: number;
}

export interface SharedStudyRecord {
  date: string;
  type: PlanType;
  subject: StudySubject;
  sourceName: string;
  /** Questions for books, lessons for courses, zero for custom activities. */
  quantity: number;
  minutes: number;
  errors: number;
}

/** Explicit public DTO. Never place an AppState, profile, or source object here. */
export interface SharedStudyOverview {
  ownerNickname: string;
  updatedAt: string | null;
  range: { from: string | null; to: string | null };
  selectedTotals: SharedStudyTotals;
  allTimeTotals: SharedStudyTotals;
  /** Catalogue counters are cumulative and independent of the selected range. */
  books: SharedSourceProgress[];
  courses: SharedSourceProgress[];
  records: {
    items: SharedStudyRecord[];
    page: number;
    pageSize: number;
    total: number;
  };
  studyDates?: string[];
}
