import { LibraryItem, StudySubject, STUDY_SUBJECTS } from '../types';

type ScheduleType = LibraryItem['type'];
interface Selection { subject: string; id: string }
interface Preferences { type: ScheduleType; book: Selection; course: Selection }
const empty = (): Preferences => ({ type: 'book', book: { subject: 'all', id: '' }, course: { subject: 'all', id: '' } });
const key = (userId?: string) => `potato.schedule-selection.v1:${userId || 'guest'}`;

export function readScheduleSelection(userId?: string): Preferences {
  const value = empty();
  try {
    const stored = JSON.parse(localStorage.getItem(key(userId)) || 'null');
    if (!stored) return value;
    if (['book', 'course', 'custom'].includes(stored.type)) value.type = stored.type;
    for (const type of ['book', 'course'] as const) {
      const selection = stored[type];
      if (selection && (selection.subject === 'all' || STUDY_SUBJECTS.includes(selection.subject as StudySubject))) {
        value[type] = { subject: selection.subject, id: typeof selection.id === 'string' ? selection.id : '' };
      }
    }
  } catch { /* Storage may be unavailable; selection still works in this dialog. */ }
  return value;
}

export function rememberScheduleSelection(userId: string | undefined, type: ScheduleType, subject: string, id: string) {
  const value = readScheduleSelection(userId);
  value.type = type;
  if (type !== 'custom') value[type] = { subject, id };
  try { localStorage.setItem(key(userId), JSON.stringify(value)); } catch { /* Optional device preference. */ }
}

export function resolveScheduleSelection(library: LibraryItem[], userId?: string, initialId?: string, requestedType?: ScheduleType) {
  const stored = readScheduleSelection(userId);
  const explicit = initialId ? library.find(item => item.id === initialId) : undefined;
  const type = explicit?.type ?? requestedType ?? stored.type;
  const subject = explicit?.subject ?? (type === 'custom' ? 'all' : stored[type].subject);
  const items = library.filter(item => item.type === type && (subject === 'all' || item.subject === subject));
  const item = explicit ?? items.find(item => item.id === (type === 'custom' ? '' : stored[type].id)) ?? items[0];
  return { type, subject, item };
}
