import { AppState, Book, Course, Countdown, LibraryItem, Plan, StudyRecord, WrongRecord } from '../types';

export const INITIAL_COUNTDOWNS: Countdown[] = [
  { id: 'cd-1', name: '国考', date: '2026-11-29' },
  { id: 'cd-2', name: '省考', date: '2027-03-14' },
  { id: 'cd-3', name: '事业编', date: '2027-04-18' },
];

export const INITIAL_BOOKS: Book[] = [
  { id: 'b-1', name: '资料分析高分宝典', subject: '资料分析', total: 600, pages: 280, done: 320, errors: 48, minutes: 780 },
  { id: 'b-2', name: '模块宝典·判断推理', subject: '判断推理', total: 800, pages: 350, done: 450, errors: 72, minutes: 920 },
  { id: 'b-3', name: '言语理解题海训练', subject: '言语理解', total: 750, pages: 320, done: 380, errors: 65, minutes: 810 },
  { id: 'b-4', name: '数量关系专项突破', subject: '数量关系', total: 500, pages: 240, done: 210, errors: 52, minutes: 640 },
  { id: 'b-5', name: '政治理论精粹题本', subject: '政治理论', total: 400, pages: 180, done: 160, errors: 22, minutes: 350 },
  { id: 'b-6', name: '常识判断考前冲刺', subject: '常识判断', total: 600, pages: 260, done: 280, errors: 68, minutes: 490 },
  { id: 'b-7', name: '申论真题范文汇编', subject: '申论', total: 50, pages: 300, done: 18, errors: 0, minutes: 540 },
  { id: 'b-8', name: '面试真题热点模拟', subject: '面试', total: 60, pages: 220, done: 15, errors: 0, minutes: 420 },
  { id: 'b-9', name: '历年国考行政职业能力测验', subject: '资料分析', total: 900, pages: 420, done: 510, errors: 89, minutes: 1120 },
  { id: 'b-10', name: '决战行测5000题·资料', subject: '资料分析', total: 1000, pages: 480, done: 620, errors: 94, minutes: 1350 },
  { id: 'b-11', name: '决战行测5000题·言语', subject: '言语理解', total: 1000, pages: 490, done: 580, errors: 92, minutes: 1210 },
  { id: 'b-12', name: '决战行测5000题·判断', subject: '判断推理', total: 1000, pages: 460, done: 640, errors: 98, minutes: 1290 },
  { id: 'b-13', name: '申论高分作答100篇', subject: '申论', total: 100, pages: 360, done: 32, errors: 0, minutes: 760 },
  { id: 'b-14', name: '面试结构化思维通关', subject: '面试', total: 80, pages: 250, done: 24, errors: 0, minutes: 510 },
];

export const INITIAL_COURSES: Course[] = [
  { id: 'c-1', name: '资料分析速算提速课', subject: '资料分析', totalLessons: 32, completedLessons: 18, minutes: 540, url: 'https://example.com/course/data-analysis' },
  { id: 'c-2', name: '判断推理图推专项', subject: '判断推理', totalLessons: 28, completedLessons: 20, minutes: 600, url: 'https://example.com/course/logic-inference' },
  { id: 'c-3', name: '言语理解逻辑填空核心', subject: '言语理解', totalLessons: 36, completedLessons: 24, minutes: 720, url: 'https://example.com/course/verbal-reasoning' },
  { id: 'c-4', name: '数量关系秒杀技巧课', subject: '数量关系', totalLessons: 24, completedLessons: 12, minutes: 360, url: 'https://example.com/course/quant' },
  { id: 'c-5', name: '政治理论最新考点全解', subject: '政治理论', totalLessons: 20, completedLessons: 10, minutes: 300, url: '' },
  { id: 'c-6', name: '申论大作文破局课', subject: '申论', totalLessons: 16, completedLessons: 8, minutes: 480, url: 'https://example.com/course/essay' },
  { id: 'c-7', name: '结构化面试通关训练营', subject: '面试', totalLessons: 22, completedLessons: 11, minutes: 550, url: '' },
];

export const INITIAL_CUSTOM_ITEMS: LibraryItem[] = [
  { id: 'lib-custom-1', type: 'custom', sourceId: '', name: '每日晨读人民日报时评', subject: '政治理论', defaultMinutes: 20 },
];

// Helper to build 1-to-1 library mapping
export function buildLibraryFromSources(books: Book[], courses: Course[], existingLib: LibraryItem[] = []): LibraryItem[] {
  const existingMap = new Map(existingLib.map(item => [item.id, item]));
  const result: LibraryItem[] = [];

  // Books
  for (const b of books) {
    const id = `lib-book-${b.id}`;
    const old = existingMap.get(id);
    result.push({
      id,
      type: 'book',
      sourceId: b.id,
      name: b.name,
      subject: b.subject,
      defaultMinutes: old ? old.defaultMinutes : 30,
    });
  }

  // Courses
  for (const c of courses) {
    const id = `lib-course-${c.id}`;
    const old = existingMap.get(id);
    result.push({
      id,
      type: 'course',
      sourceId: c.id,
      name: c.name,
      subject: c.subject,
      defaultMinutes: old ? old.defaultMinutes : 45,
    });
  }

  // Preserve existing custom items without resurrecting deliberately deleted ones (Fixes A13)
  for (const item of existingLib) {
    if (item.type === 'custom') {
      result.push(item);
    }
  }

  return result;
}

export const INITIAL_LIBRARY: LibraryItem[] = [
  ...buildLibraryFromSources(INITIAL_BOOKS, INITIAL_COURSES, []),
  ...INITIAL_CUSTOM_ITEMS,
];

export const INITIAL_PLANS: Plan[] = [
  {
    id: 'plan-1',
    date: '2026-10-25',
    libraryId: 'lib-book-b-1',
    name: '资料分析高分宝典',
    type: 'book',
    sourceId: 'b-1',
    subject: '资料分析',
    plannedMinutes: 30,
    actualMinutes: 35,
    done: true,
    timerStart: 0,
    recordId: 'rec-today-1',
  },
  {
    id: 'plan-2',
    date: '2026-10-25',
    libraryId: 'lib-course-c-1',
    name: '资料分析速算提速课',
    type: 'course',
    sourceId: 'c-1',
    subject: '资料分析',
    plannedMinutes: 30,
    actualMinutes: 30,
    done: true,
    timerStart: 0,
    recordId: 'rec-today-2',
  },
  {
    id: 'plan-3',
    date: '2026-10-25',
    libraryId: 'lib-book-b-2',
    name: '模块宝典·判断推理',
    type: 'book',
    sourceId: 'b-2',
    subject: '判断推理',
    plannedMinutes: 40,
    actualMinutes: 0,
    done: false,
    timerStart: 0,
  },
  {
    id: 'plan-4',
    date: '2026-10-25',
    libraryId: 'lib-custom-1',
    name: '每日晨读人民日报时评',
    type: 'custom',
    sourceId: '',
    subject: '政治理论',
    plannedMinutes: 20,
    actualMinutes: 0,
    done: false,
    timerStart: 0,
  },
];

// Month records: Oct 2026 exactly totals 1260 mins, 420 questions, 84 errors, 80% accuracy!
// 八科分布: 360, 270, 240, 180, 90, 60, 45, 15 = 1260 mins
export const INITIAL_RECORDS: StudyRecord[] = [
  // 资料分析: 360 min, 150 questions, 25 errors (83.3%)
  { id: 'rec-1', planId: 'p-hist-1', date: '2026-10-05', type: 'book', sourceId: 'b-1', subject: '资料分析', minutes: 120, questions: 50, errors: 8 },
  { id: 'rec-2', planId: 'p-hist-2', date: '2026-10-12', type: 'book', sourceId: 'b-1', subject: '资料分析', minutes: 110, questions: 50, errors: 9 },
  { id: 'rec-3', planId: 'p-hist-3', date: '2026-10-20', type: 'course', sourceId: 'c-1', subject: '资料分析', minutes: 65, questions: 0, errors: 0 },
  { id: 'rec-today-1', planId: 'plan-1', date: '2026-10-25', type: 'book', sourceId: 'b-1', subject: '资料分析', minutes: 35, questions: 50, errors: 8 },
  { id: 'rec-today-2', planId: 'plan-2', date: '2026-10-25', type: 'course', sourceId: 'c-1', subject: '资料分析', minutes: 30, questions: 0, errors: 0 },

  // 判断推理: 270 min, 120 questions, 24 errors (80%)
  { id: 'rec-4', planId: 'p-hist-4', date: '2026-10-06', type: 'book', sourceId: 'b-2', subject: '判断推理', minutes: 90, questions: 40, errors: 8 },
  { id: 'rec-5', planId: 'p-hist-5', date: '2026-10-15', type: 'book', sourceId: 'b-2', subject: '判断推理', minutes: 90, questions: 40, errors: 8 },
  { id: 'rec-6', planId: 'p-hist-6', date: '2026-10-22', type: 'book', sourceId: 'b-2', subject: '判断推理', minutes: 90, questions: 40, errors: 8 },

  // 言语理解: 240 min, 100 questions, 20 errors (80%)
  { id: 'rec-7', planId: 'p-hist-7', date: '2026-10-08', type: 'book', sourceId: 'b-3', subject: '言语理解', minutes: 120, questions: 50, errors: 10 },
  { id: 'rec-8', planId: 'p-hist-8', date: '2026-10-18', type: 'book', sourceId: 'b-3', subject: '言语理解', minutes: 120, questions: 50, errors: 10 },

  // 数量关系: 180 min, 50 questions, 15 errors (70%)
  { id: 'rec-9', planId: 'p-hist-9', date: '2026-10-10', type: 'book', sourceId: 'b-4', subject: '数量关系', minutes: 90, questions: 25, errors: 8 },
  { id: 'rec-10', planId: 'p-hist-10', date: '2026-10-21', type: 'book', sourceId: 'b-4', subject: '数量关系', minutes: 90, questions: 25, errors: 7 },

  // 政治理论: 90 min (0 questions, course & custom)
  { id: 'rec-11', planId: 'p-hist-11', date: '2026-10-09', type: 'course', sourceId: 'c-5', subject: '政治理论', minutes: 50, questions: 0, errors: 0 },
  { id: 'rec-12', planId: 'p-hist-12', date: '2026-10-17', type: 'custom', sourceId: '', subject: '政治理论', minutes: 40, questions: 0, errors: 0 },

  // 常识判断: 60 min (0 questions, book review)
  { id: 'rec-13', planId: 'p-hist-13', date: '2026-10-14', type: 'book', sourceId: 'b-6', subject: '常识判断', minutes: 60, questions: 0, errors: 0 },

  // 申论: 45 min
  { id: 'rec-14', planId: 'p-hist-14', date: '2026-10-16', type: 'course', sourceId: 'c-6', subject: '申论', minutes: 45, questions: 0, errors: 0 },

  // 面试: 15 min
  { id: 'rec-15', planId: 'p-hist-15', date: '2026-10-23', type: 'course', sourceId: 'c-7', subject: '面试', minutes: 15, questions: 0, errors: 0 },
];

export const INITIAL_WRONG: WrongRecord[] = [
  {
    id: 'w-1',
    date: '2026-10-22',
    bookId: 'b-1',
    note: '增长率与基期比值公式记混，把现期当成基期代入导致选项选偏。下次记得圈注基期年份！',
    image: '',
  },
  {
    id: 'w-2',
    date: '2026-10-18',
    bookId: 'b-2',
    note: '图形推理空间折叠题，相对面与相邻面的时针方向判断失误。折纸法确认是顺时针顺序。',
    image: '',
  },
  {
    id: 'w-3',
    date: '2026-10-15',
    bookId: 'b-3',
    note: '逻辑填空第二空成语色彩偏消极，文段语境是积极导向，误选了“南辕北辙”。',
    image: '',
  },
];

export const INITIAL_PROFILE: { name: string; username: string; avatar: string } = {
  name: '土豆的备考空间',
  username: 'potato_01',
  avatar: '',
};

export const INITIAL_STATE: AppState = {
  profile: INITIAL_PROFILE,
  countdowns: INITIAL_COUNTDOWNS,
  books: INITIAL_BOOKS,
  courses: INITIAL_COURSES,
  library: buildLibraryFromSources(INITIAL_BOOKS, INITIAL_COURSES, INITIAL_CUSTOM_ITEMS),
  plans: INITIAL_PLANS,
  records: INITIAL_RECORDS,
  wrong: INITIAL_WRONG,
  version: 2,
};
