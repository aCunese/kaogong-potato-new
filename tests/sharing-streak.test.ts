import { describe, it, expect } from 'bun:test';
import { calculatePartnerStreak } from '../src/components/views/SharingModal';

describe('calculatePartnerStreak', () => {
  it('handles empty or undefined studyDates', () => {
    expect(calculatePartnerStreak([], '2026-10-30')).toEqual({ type: 'none', text: '暂无打卡' });
    expect(calculatePartnerStreak(undefined, '2026-10-30')).toEqual({ type: 'none', text: '暂无打卡' });
  });

  it('calculates single day streak when today is studied', () => {
    const res = calculatePartnerStreak(['2026-10-30'], '2026-10-30');
    expect(res).toEqual({ type: 'streak', text: '打卡 1 天 🔥' });
  });

  it('calculates consecutive days streak when today and previous days are studied', () => {
    const res = calculatePartnerStreak(['2026-10-28', '2026-10-29', '2026-10-30'], '2026-10-30');
    expect(res).toEqual({ type: 'streak', text: '连续打卡 3 天 🔥' });
  });

  it('stops streak count when a day is broken', () => {
    // 2026-10-27, 2026-10-29, 2026-10-30 (10-28 missing)
    const res = calculatePartnerStreak(['2026-10-27', '2026-10-29', '2026-10-30'], '2026-10-30');
    expect(res).toEqual({ type: 'streak', text: '连续打卡 2 天 🔥' });
  });

  it('calculates 1 day missed when today is not studied but yesterday was', () => {
    const res = calculatePartnerStreak(['2026-10-28', '2026-10-29'], '2026-10-30');
    expect(res).toEqual({ type: 'break', text: '1天未打卡' });
  });

  it('calculates multiple days missed when recent days are unstudied', () => {
    const res = calculatePartnerStreak(['2026-10-27'], '2026-10-30');
    // missed: 10-30 (1), 10-29 (2), 10-28 (3)
    expect(res).toEqual({ type: 'break', text: '连续 3 天未打卡 💤' });
  });
});
