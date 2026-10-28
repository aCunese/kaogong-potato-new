import type { TimerSession } from '../types';
import { sessionDays } from './timerSessions';
import { filterAnalysisRecords, AnalysisRange } from './workflowPresentation';
export function getSessionAnalysis(sessions: TimerSession[], range: AnalysisRange, today: string) {
  const days = filterAnalysisRecords(sessions.filter(s => s.status === 'pending' || s.status === 'registered').flatMap(s => sessionDays(s)), range, today);
  return { focusMs: days.reduce((n,d) => n+d.focusMs,0), restMs: days.reduce((n,d) => n+d.restMs,0) };
}
