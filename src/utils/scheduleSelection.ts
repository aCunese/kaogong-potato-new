import { LibraryItem, StudySubject, STUDY_SUBJECTS } from '../types';

export type ScheduleType = LibraryItem['type'];
export interface Selection { subject: string; id: string }
export interface CustomSelection { subject: StudySubject }
export interface Preferences {
  type: ScheduleType;
  book: Selection;
  course: Selection;
  custom: CustomSelection;
  presets: Record<string, string[]>;
}

const NORMALIZE_SUBJECTS: Record<string, StudySubject> = { '常识': '常识判断' };

export const createEmptyPresets = (): Record<string, string[]> => {
  const presets: Record<string, string[]> = {};
  for (const s of STUDY_SUBJECTS) {
    presets[s] = [];
  }
  return presets;
};

const DEFAULT_PREFERENCES: Preferences = {
  type: 'book',
  book: { subject: 'all', id: '' },
  course: { subject: 'all', id: '' },
  custom: { subject: '其他' },
  presets: createEmptyPresets(),
};

const getStorageKey = (userId?: string) => `potato.schedule-selection.v1:${userId || 'guest'}`;

const memoryStorage = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch { /* Storage access denied */ }
  return memoryStorage.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch { /* Storage access denied */ }
  memoryStorage.set(key, value);
}

export function readScheduleSelection(userId?: string): Preferences {
  const preferences: Preferences = { ...DEFAULT_PREFERENCES, presets: createEmptyPresets() };
  try {
    const raw = getStorageItem(getStorageKey(userId));
    if (!raw) return preferences;

    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return preferences;

    if (['book', 'course', 'custom'].includes(stored.type)) {
      preferences.type = stored.type;
    }

    for (const type of ['book', 'course'] as const) {
      const selection = stored[type];
      if (selection && (selection.subject === 'all' || STUDY_SUBJECTS.includes(selection.subject as StudySubject))) {
        preferences[type] = {
          subject: selection.subject,
          id: typeof selection.id === 'string' ? selection.id : '',
        };
      }
    }

    if (stored.custom?.subject && STUDY_SUBJECTS.includes(stored.custom.subject as StudySubject)) {
      preferences.custom = { subject: stored.custom.subject as StudySubject };
    }

    if (stored.presets && typeof stored.presets === 'object') {
      for (const key of Object.keys(stored.presets)) {
        preferences.presets[key] = stored.presets[key];
      }
    }
  } catch { /* Storage may be unavailable; selection still works in this dialog. */ }
  return preferences;
}

export function rememberScheduleSelection(userId: string | undefined, type: ScheduleType, subject: string, id: string) {
  const preferences = readScheduleSelection(userId);
  preferences.type = type;

  const normalizedSubject = NORMALIZE_SUBJECTS[subject] ?? subject;

  if (type === 'custom') {
    if (STUDY_SUBJECTS.includes(normalizedSubject as StudySubject)) {
      preferences.custom = { subject: normalizedSubject as StudySubject };
    }
  } else {
    preferences[type] = { subject: normalizedSubject, id };
  }

  try {
    setStorageItem(getStorageKey(userId), JSON.stringify(preferences));
  } catch { /* Optional device preference. */ }
}

export function savePresets(userId: string | undefined, subjectOrPresets: string | Record<string, string[]>, maybeList?: string[]) {
  const preferences = readScheduleSelection(userId);
  if (typeof subjectOrPresets !== 'string') {
    preferences.presets = subjectOrPresets;
  } else {
    preferences.presets[subjectOrPresets] = maybeList ?? [];
  }
  try {
    setStorageItem(getStorageKey(userId), JSON.stringify(preferences));
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
