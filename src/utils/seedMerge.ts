import { AppState, Book, Course, LibraryItem } from '../types';
import { BLANK_STATE, STABLE_COUNTDOWNS } from '../constants/initialData';
import {
  SEED_BOOKS_TEMPLATE,
  SEED_COURSES_TEMPLATE,
  SEED_CUSTOM_ITEMS_TEMPLATE,
} from './seedFactory';

/**
 * Merges the default seed library (14 本题本 / 7 门课程 / 22 个事项) into an existing
 * state WITHOUT losing user custom items, custom books/courses or any progress.
 * Used by the client as the offline-safe merge; the authoritative cross-device
 * application happens server-side via POST /api/workspace/init-choice.
 */
export function mergeSeedIntoState(state: AppState): AppState {
  const next: AppState = JSON.parse(JSON.stringify(state ?? BLANK_STATE));

  const bookIds = new Set(next.books.map(b => b.id));
  const bookNameKeys = new Set(next.books.map(b => `${b.name}::${b.subject}`));
  for (const template of SEED_BOOKS_TEMPLATE) {
    if (bookIds.has(template.id) || bookNameKeys.has(`${template.name}::${template.subject}`)) continue;
    const book: Book = { ...template, done: 0, errors: 0, minutes: 0 };
    next.books.push(book);
    bookIds.add(book.id);
    bookNameKeys.add(`${book.name}::${book.subject}`);
  }

  const courseIds = new Set(next.courses.map(c => c.id));
  const courseNameKeys = new Set(next.courses.map(c => `${c.name}::${c.subject}`));
  for (const template of SEED_COURSES_TEMPLATE) {
    if (courseIds.has(template.id) || courseNameKeys.has(`${template.name}::${template.subject}`)) continue;
    const course: Course = { ...template, completedLessons: 0, minutes: 0, url: '' };
    next.courses.push(course);
    courseIds.add(course.id);
    courseNameKeys.add(`${course.name}::${course.subject}`);
  }

  // Rebuild/complete library links without dropping existing custom items.
  const libraryById = new Map(next.library.map(item => [item.id, item]));
  const linkedBookIds = new Set(next.library.filter(l => l.type === 'book').map(l => l.sourceId));
  const linkedCourseIds = new Set(next.library.filter(l => l.type === 'course').map(l => l.sourceId));
  for (const book of next.books) {
    const libId = `lib-book-${book.id}`;
    if (!linkedBookIds.has(book.id) && !libraryById.has(libId)) {
      const item: LibraryItem = {
        id: libId,
        type: 'book',
        sourceId: book.id,
        name: book.name,
        subject: book.subject,
        defaultMinutes: 30,
      };
      next.library.push(item);
      libraryById.set(item.id, item);
    }
  }
  for (const course of next.courses) {
    const libId = `lib-course-${course.id}`;
    if (!linkedCourseIds.has(course.id) && !libraryById.has(libId)) {
      const item: LibraryItem = {
        id: libId,
        type: 'course',
        sourceId: course.id,
        name: course.name,
        subject: course.subject,
        defaultMinutes: 45,
      };
      next.library.push(item);
      libraryById.set(item.id, item);
    }
  }
  const customNames = new Set(next.library.filter(l => l.type === 'custom').map(l => l.name));
  for (const custom of SEED_CUSTOM_ITEMS_TEMPLATE) {
    if (libraryById.has(custom.id) || customNames.has(custom.name)) continue;
    next.library.push({ ...custom });
    libraryById.set(custom.id, custom);
    customNames.add(custom.name);
  }

  // Ensure the three stable countdown configs exist (never overwrite user dates).
  const countdownIds = new Set(next.countdowns.map(c => c.id));
  for (const stable of STABLE_COUNTDOWNS) {
    if (!countdownIds.has(stable.id)) {
      next.countdowns.push({ ...stable });
      countdownIds.add(stable.id);
    }
  }

  next.version = 3;
  return next;
}
