/** Pure activity scheduling logic, shared by activity and laboratory bookings. */
import { checkClock, minutes, type CollegeClock } from './clockRules.ts';
import { weekdayOfISODate } from './labRules.ts';

export type ScheduleSlot = {
  term_id: string;
  mode: 'Weekly' | 'Dated';
  weekday: number;
  booking_date: string | null;
  start_period: number;
  period_count: number;
  section_ids: string[];
  faculty_id: string | null;
  lab_id: string | null;
};

export function validateEventSpan(clock: CollegeClock, startPeriod: number, count: number): number {
  checkClock(clock);
  if (!Number.isInteger(startPeriod) || !Number.isInteger(count) || count < 1 || count > 3 ||
      startPeriod < 1 || startPeriod + count - 1 > 6) {
    throw new Error('Activity must occupy 1–3 existing timetable periods');
  }
  if (startPeriod <= 3 && startPeriod + count - 1 >= 4) {
    throw new Error('An activity cannot cross the lunch break');
  }
  for (let i = startPeriod; i < startPeriod + count - 1; i++) {
    if (clock.periods[i - 1].end !== clock.periods[i].start) {
      throw new Error('Activity periods must be uninterrupted');
    }
  }
  return minutes(clock.periods[startPeriod + count - 2].end) - minutes(clock.periods[startPeriod - 1].start);
}

export function validateActivityDate(iso: string): number {
  const day = weekdayOfISODate(iso);
  if (day === 6) throw new Error('Sunday is not a configured teaching day');
  return day;
}

export function timeOverlaps(a: ScheduleSlot, b: ScheduleSlot): boolean {
  if (a.weekday !== b.weekday) return false;
  if (a.mode === 'Dated' && b.mode === 'Dated') {
    if (a.booking_date !== b.booking_date) return false;
  } else if (a.term_id !== b.term_id) {
    return false;
  }
  return a.start_period < b.start_period + b.period_count &&
    b.start_period < a.start_period + a.period_count;
}

export function activityConflict(a: ScheduleSlot, b: ScheduleSlot): string | null {
  if (!timeOverlaps(a, b)) return null;
  if (a.lab_id && b.lab_id && a.lab_id === b.lab_id) {
    return 'Shared laboratory is already reserved during these periods';
  }
  const occupied = new Set(b.section_ids);
  if (a.section_ids.some(id => occupied.has(id))) {
    return 'A participating BCA section already has a scheduled activity or laboratory during these periods';
  }
  if (a.faculty_id && b.faculty_id && a.faculty_id === b.faculty_id) {
    return 'Faculty member already has a scheduled activity or laboratory during these periods';
  }
  return null;
}
