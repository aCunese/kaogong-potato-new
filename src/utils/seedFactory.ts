import { AppState, Book, Course, Countdown, LibraryItem, Profile } from '../types';
import { STABLE_COUNTDOWNS } from '../constants/initialData';

export const SEED_BOOKS_TEMPLATE: Omit<Book, 'done' | 'errors' | 'minutes'>[] = [
  { id: 'b-1', name: '资料分析高分宝典', subject: '资料分析', total: 600, pages: 280 },
  { id: 'b-2', name: '模块宝典·判断推理', subject: '判断推理', total: 800, pages: 350 },
  { id: 'b-3', name: '言语理解题海训练', subject: '言语理解', total: 750, pages: 320 },
  { id: 'b-4', name: '数量关系专项突破', subject: '数量关系', total: 500, pages: 240 },
  { id: 'b-5', name: '政治理论精粹题本', subject: '政治理论', total: 400, pages: 180 },
  { id: 'b-6', name: '常识判断考前冲刺', subject: '常识判断', total: 600, pages: 260 },
  { id: 'b-7', name: '申论真题范文汇编', subject: '申论', total: 50, pages: 300 },
  { id: 'b-8', name: '面试真题热点模拟', subject: '面试', total: 60, pages: 220 },
  { id: 'b-9', name: '历年国考行政职业能力测验', subject: '资料分析', total: 900, pages: 420 },
  { id: 'b-10', name: '决战行测5000题·资料', subject: '资料分析', total: 1000, pages: 480 },
  { id: 'b-11', name: '决战行测5000题·言语', subject: '言语理解', total: 1000, pages: 490 },
  { id: 'b-12', name: '决战行测5000题·判断', subject: '判断推理', total: 1000, pages: 460 },
  { id: 'b-13', name: '申论高分作答100篇', subject: '申论', total: 100, pages: 360 },
  { id: 'b-14', name: '面试结构化思维通关', subject: '面试', total: 80, pages: 250 },
];

export const SEED_COURSES_TEMPLATE: Omit<Course, 'completedLessons' | 'minutes' | 'url'>[] = [
  { id: 'c-1', name: '资料分析速算提速课', subject: '资料分析', totalLessons: 32 },
  { id: 'c-2', name: '判断推理图推专项', subject: '判断推理', totalLessons: 28 },
  { id: 'c-3', name: '言语理解逻辑填空核心', subject: '言语理解', totalLessons: 36 },
  { id: 'c-4', name: '数量关系秒杀技巧课', subject: '数量关系', totalLessons: 24 },
  { id: 'c-5', name: '政治理论最新考点全解', subject: '政治理论', totalLessons: 20 },
  { id: 'c-6', name: '申论大作文破局课', subject: '申论', totalLessons: 16 },
  { id: 'c-7', name: '结构化面试通关训练营', subject: '面试', totalLessons: 22 },
];

export const SEED_CUSTOM_ITEMS_TEMPLATE: LibraryItem[] = [
  { id: 'lib-custom-1', type: 'custom', sourceId: '', name: '每日晨读人民日报时评', subject: '政治理论', defaultMinutes: 20 },
];

export function createSeedBooks(): Book[] {
  return SEED_BOOKS_TEMPLATE.map(t => ({
    ...t,
    done: 0,
    errors: 0,
    minutes: 0,
  }));
}

export function createSeedCourses(): Course[] {
  return SEED_COURSES_TEMPLATE.map(t => ({
    ...t,
    completedLessons: 0,
    minutes: 0,
    url: '', // 清空演示链接，界面展示“待添加课程链接”
  }));
}

export function createSeedLibrary(books: Book[], courses: Course[]): LibraryItem[] {
  const library: LibraryItem[] = [];

  for (const b of books) {
    library.push({
      id: `lib-book-${b.id}`,
      type: 'book',
      sourceId: b.id,
      name: b.name,
      subject: b.subject,
      defaultMinutes: 30,
    });
  }

  for (const c of courses) {
    library.push({
      id: `lib-course-${c.id}`,
      type: 'course',
      sourceId: c.id,
      name: c.name,
      subject: c.subject,
      defaultMinutes: 45,
    });
  }

  library.push(...SEED_CUSTOM_ITEMS_TEMPLATE);
  return library;
}

export function createSeedProfile(username: string, nickname?: string): Profile {
  const cleanUsername = username.trim().toLowerCase();
  const cleanNickname = (nickname && nickname.trim()) ? nickname.trim() : cleanUsername;
  return {
    name: `${cleanNickname}的备考空间`,
    username: cleanUsername,
    avatar: '',
  };
}

export function createSeedCountdowns(): Countdown[] {
  return structuredClone(STABLE_COUNTDOWNS);
}

/**
 * Creates a clean official seed AppState for newly registered users.
 * Contains:
 * - 14 books with 0 done, 0 errors, 0 minutes
 * - 7 courses with 0 completed lessons, 0 minutes, url: ''
 * - 22 library items (14 books + 7 courses + 1 morning reading)
 * - plans: []
 * - records: []
 * - wrong: []
 * - countdowns: stable IDs with date: ''
 * - profile: real username and nickname
 */
export function createSeedState(username: string, nickname?: string): AppState {
  const books = createSeedBooks();
  const courses = createSeedCourses();
  const library = createSeedLibrary(books, courses);

  return {
    profile: createSeedProfile(username, nickname),
    countdowns: createSeedCountdowns(),
    books,
    courses,
    library,
    plans: [],
    records: [],
    wrong: [],
    version: 3,
  };
}
