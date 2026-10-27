import type { Course, StudyRecord } from '../types';
import { SUBJECTS } from '../types';

/** Course-only record totals; catalogue progress remains independent of the selected date range. */
export function getCourseAnalysis(courses: Course[], records: StudyRecord[]) {
  const selected = records.filter(record => record.type === 'course');
  const rows = new Map(courses.map(course => [course.id, {
    id: course.id, name: course.name, subject: course.subject,
    minutes: 0, lessons: 0, sessions: 0,
    completedLessons: course.completedLessons, totalLessons: course.totalLessons,
    cumulativeMinutes: course.minutes, deleted: false,
  }]));
  const days = new Map<string, { date: string; minutes: number; lessons: number }>();
  for (const record of selected) {
    if (!rows.has(record.sourceId)) rows.set(record.sourceId, {
      id: record.sourceId, name: '已删除课程', subject: record.subject,
      minutes: 0, lessons: 0, sessions: 0, completedLessons: 0, totalLessons: 0,
      cumulativeMinutes: 0, deleted: true,
    });
    const row = rows.get(record.sourceId)!;
    row.minutes += record.minutes; row.lessons += record.lessons ?? 0; row.sessions++;
    const day = days.get(record.date) ?? { date: record.date, minutes: 0, lessons: 0 };
    day.minutes += record.minutes; day.lessons += record.lessons ?? 0; days.set(record.date, day);
  }
  return {
    minutes: selected.reduce((sum, r) => sum + r.minutes, 0),
    lessons: selected.reduce((sum, r) => sum + (r.lessons ?? 0), 0),
    sessions: selected.length,
    courses: [...rows.values()],
    subjects: SUBJECTS.map(subject => ({ subject, minutes: selected.filter(r => r.subject === subject).reduce((sum, r) => sum + r.minutes, 0) })),
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
