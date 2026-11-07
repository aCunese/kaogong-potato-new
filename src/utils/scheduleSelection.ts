import { LibraryItem, StudySubject, STUDY_SUBJECTS } from '../types';

export type ScheduleType = LibraryItem['type'];
export interface Selection { subject: string; id: string }
export interface CustomSelection { subject: StudySubject }
export interface Preferences {
  type: ScheduleType;
  book: Selection;
  course: Selection;
  custom: CustomSelection;
}

const empty = (): Preferences => ({
  type: 'book',
  book: { subject: 'all', id: '' },
  course: { subject: 'all', id: '' },
  custom: { subject: '其他' },
});
const key = (userId?: string) => `potato.schedule-selection.v1:${userId || 'guest'}`;

const memoryStorage = new Map<string, string>();
function getStorageItem(k: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(k);
  } catch { /* Storage access denied */ }
  return memoryStorage.get(k) ?? null;
}
function setStorageItem(k: string, v: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  } catch { /* Storage access denied */ }
  memoryStorage.set(k, v);
}

export function readScheduleSelection(userId?: string): Preferences {
  const value = empty();
  try {
    const raw = getStorageItem(key(userId));
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored) return value;
    if (['book', 'course', 'custom'].includes(stored.type)) value.type = stored.type;
    for (const type of ['book', 'course'] as const) {
      const selection = stored[type];
      if (selection && (selection.subject === 'all' || STUDY_SUBJECTS.includes(selection.subject as StudySubject))) {
        value[type] = { subject: selection.subject, id: typeof selection.id === 'string' ? selection.id : '' };
      }
    }
    if (stored.custom && STUDY_SUBJECTS.includes(stored.custom.subject as StudySubject)) {
      value.custom = { subject: stored.custom.subject as StudySubject };
    }
  } catch { /* Storage may be unavailable; selection still works in this dialog. */ }
  return value;
}

export function rememberScheduleSelection(userId: string | undefined, type: ScheduleType, subject: string, id: string) {
  const value = readScheduleSelection(userId);
  value.type = type;
  if (type === 'custom') {
    if (STUDY_SUBJECTS.includes(subject as StudySubject)) {
      value.custom = { subject: subject as StudySubject };
    }
  } else {
    value[type] = { subject, id };
  }
  try {
    setStorageItem(key(userId), JSON.stringify(value));
  } catch { /* Optional device preference. */ }
}

export function resolveScheduleSelection(library: LibraryItem[], userId?: string, initialId?: string, requestedType?: ScheduleType) {
  const stored = readScheduleSelection(userId);
  const explicit = initialId ? library.find(item => item.id === initialId) : undefined;
  let type = explicit?.type ?? requestedType ?? stored.type;
  if (!explicit && !requestedType && type !== 'custom' && library.length > 0 && !library.some(item => item.type === type)) {
    type = library[0].type;
  }
  if (type === 'custom') {
    const customSubject = (explicit?.subject as StudySubject) ?? stored.custom?.subject ?? '其他';
    return { type, subject: customSubject, item: explicit };
  }
  const subject = explicit?.subject ?? stored[type].subject;
  const items = library.filter(item => item.type === type && (subject === 'all' || item.subject === subject));
  const item = explicit ?? items.find(item => item.id === stored[type].id) ?? items[0];
  return { type, subject, item };
}
