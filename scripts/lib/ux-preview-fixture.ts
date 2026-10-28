/**
 * Shared seed fixture for the 2026-10-28 UX preview.
 * Used by scripts/ux-records-email-preview.ts (screenshots) and
 * scripts/preview-server.ts (interactive local preview server).
 */
export interface UxPreviewFixture {
  books: any[];
  courses: any[];
  records: any[];
  plans: any[];
  countdowns: any[];
}

export interface UxPreviewReminder {
  id: string;
  title: string;
  body: string;
  sendAt: number;
  status: 'pending' | 'sent' | 'cancelled';
  revision?: number;
  created: number;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createUxPreviewFixture(today: string): UxPreviewFixture {
  const books = [
    { id: 'b1', name: '决战行测5000题·资料分析', subject: '资料分析', total: 1000, pages: 480, done: 620, errors: 94, minutes: 1350 },
    { id: 'b2', name: '图形推理700题', subject: '判断推理', total: 700, pages: 0, done: 120, errors: 40, minutes: 900 },
    { id: 'b3', name: '申论高分作答100篇', subject: '申论', total: 100, pages: 360, done: 32, errors: 0, minutes: 760 },
  ];
  const courses = [
    { id: 'c1', name: '资料分析速算提速课', subject: '资料分析', totalLessons: 20, completedLessons: 18, minutes: 1260, url: '' },
    { id: 'c2', name: '申论精讲', subject: '申论', totalLessons: 10, completedLessons: 10, minutes: 600, url: '' },
  ];
  const records: any[] = [];
  const plans: any[] = [];
  for (let day = 0; day < 12; day++) {
    const date = addDays(today, -day);
    const count = day === 0 ? 3 : 1 + (day % 3);
    for (let i = 0; i < count; i++) {
      const pick = (day + i) % 5;
      const id = `r-${date}-${i}`;
      if (pick === 0 || pick === 3) {
        records.push({ id, planId: `p-${id}`, date, type: 'book', sourceId: pick === 0 ? 'b1' : 'b2', subject: pick === 0 ? '资料分析' : '判断推理', minutes: 25 + ((day + i) % 4) * 10, questions: 20 + ((day + i) % 5) * 5, errors: 2 + ((day + i) % 4) });
        if (day > 0 && day < 3) plans.push({ id: `p-${id}`, date, name: pick === 0 ? '决战行测5000题·资料分析' : '图形推理700题', type: 'book', sourceId: pick === 0 ? 'b1' : 'b2', subject: pick === 0 ? '资料分析' : '判断推理', plannedMinutes: 40, actualMinutes: 35, accumulatedMs: 35 * 60000, done: true, timerStart: 0, recordId: id, libraryId: '' });
      } else if (pick === 1) {
        records.push({ id, planId: `p-${id}`, date, type: 'course', sourceId: 'c1', subject: '资料分析', minutes: 40 + ((day + i) % 3) * 10, questions: 0, errors: 0, lessons: 2 + ((day + i) % 3) });
        if (day > 0 && day < 3) plans.push({ id: `p-${id}`, date, name: '资料分析速算提速课', type: 'course', sourceId: 'c1', subject: '资料分析', plannedMinutes: 45, actualMinutes: 40, accumulatedMs: 40 * 60000, done: true, timerStart: 0, recordId: id, libraryId: '' });
      } else {
        records.push({ id, planId: `p-${id}`, date, type: 'custom', sourceId: '', subject: '申论', minutes: 30 + ((day + i) % 3) * 15, questions: 0, errors: 0 });
        if (day > 0 && day < 3) plans.push({ id: `p-${id}`, date, name: '申论大作文提纲练习', type: 'custom', sourceId: '', subject: '申论', plannedMinutes: 45, actualMinutes: 30, accumulatedMs: 30 * 60000, done: true, timerStart: 0, recordId: id, libraryId: '' });
      }
    }
  }
  // Today's schedule cards, one pending item, and one un-registered plan from two days ago.
  for (const record of records.filter(item => item.date === today)) {
    plans.push({
      id: record.planId, date: today,
      name: record.type === 'book' ? '决战行测5000题·资料分析' : record.type === 'course' ? '资料分析速算提速课' : '申论大作文提纲练习',
      type: record.type, sourceId: record.sourceId, subject: record.subject, plannedMinutes: record.minutes,
      actualMinutes: record.minutes, accumulatedMs: record.minutes * 60000, done: true, timerStart: 0, recordId: record.id, libraryId: '',
    });
  }
  plans.push({ id: 'p-pending', date: today, name: '错题复盘 30 题', type: 'custom', sourceId: '', subject: '判断推理', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0, libraryId: '' });
  plans.push({ id: 'p-history-open', date: addDays(today, -2), name: '数量关系工程问题专项', type: 'book', sourceId: 'b2', subject: '数量关系', plannedMinutes: 30, actualMinutes: 0, accumulatedMs: 0, done: false, timerStart: 0, libraryId: '' });
  const countdowns = [
    { id: 'exam-national', name: '国考', date: addDays(today, 32) },
    { id: 'exam-provincial', name: '省考', date: addDays(today, 137) },
  ];
  return { books, courses, records, plans, countdowns };
}

/** Three pending reminders plus one delivered and one cancelled example. */
export function createUxReminderFixture(nowMs: number): UxPreviewReminder[] {
  const atLocal = (hour: number, minute: number, dayOffset: number) => {
    const date = new Date(nowMs);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, minute, 0, 0);
    return date.getTime();
  };
  const upcomingHour = new Date(nowMs + 45 * 60_000);
  return [
    { id: 'rem-1', title: '资料分析 3 套速算', body: '先做 3 套，再集中复盘错题原因。', sendAt: upcomingHour.getTime(), status: 'pending', created: nowMs - 3 * 3_600_000 },
    { id: 'rem-2', title: '判断推理错题复盘', body: '图形推理错题 20 道，重点看对称与数量类。', sendAt: atLocal(8, 0, 1), status: 'pending', created: nowMs - 2 * 3_600_000 },
    { id: 'rem-3', title: '申论大作文提纲', body: '列一份乡村振兴主题的作文提纲，控制在 15 分钟。', sendAt: atLocal(20, 0, 2), status: 'pending', created: nowMs - 3_600_000 },
    { id: 'rem-4', title: '昨天的判断推理复盘', body: '复盘图形推理 20 道错题。', sendAt: atLocal(22, 0, -1), status: 'sent', created: nowMs - 30 * 3_600_000 },
    { id: 'rem-5', title: '周末模拟考', body: '周六上午 9:00 全真模拟一套行测。', sendAt: atLocal(9, 0, -3), status: 'cancelled', revision: 2, created: nowMs - 60 * 3_600_000 },
  ];
}
