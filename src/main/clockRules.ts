/** Confirmed SSMRV daily period clock; pure functions without Electron or database imports. */
export type ClockPeriod = { number: number; start: string; end: string };
export type CollegeClock = {
  periods: ClockPeriod[];
  lunchStart: string;
  lunchEnd: string;
  confirmed: boolean;
};

export const confirmedReferenceClock: CollegeClock = {
  periods: [
    { number: 1, start: '09:45', end: '10:45' },
    { number: 2, start: '10:45', end: '11:45' },
    { number: 3, start: '11:45', end: '12:45' },
    { number: 4, start: '13:45', end: '14:45' },
    { number: 5, start: '14:45', end: '15:45' },
    { number: 6, start: '15:45', end: '16:45' },
  ],
  lunchStart: '12:45', lunchEnd: '13:45', confirmed: false,
};

export function minutes(hhmm: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error('Use 24-hour HH:MM times');
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function checkClock(clock: CollegeClock): void {
  if (!clock || !Array.isArray(clock.periods) || clock.periods.length !== 6) {
    throw new Error('Exactly six numbered teaching periods must be configured');
  }
  const lunchStart = minutes(clock.lunchStart), lunchEnd = minutes(clock.lunchEnd);
  if (lunchEnd <= lunchStart) throw new Error('Lunch must finish after it starts');
  for (let i = 0; i < 6; i++) {
    const p = clock.periods[i];
    if (p.number !== i + 1) throw new Error('Periods must be numbered P1 through P6 in order');
    if (minutes(p.end) <= minutes(p.start)) throw new Error(`P${i + 1} has an invalid start/end time`);
    if (minutes(p.end) - minutes(p.start) !== 60) throw new Error(`P${i + 1} must last exactly 60 minutes`);
    if (i === 0) continue;
    const previousEnd = minutes(clock.periods[i - 1].end);
    const currentStart = minutes(p.start);
    if (i === 3) {
      if (previousEnd !== lunchStart || currentStart !== lunchEnd) {
        throw new Error('Lunch must be between P3 and P4, without overlapping either period');
      }
    } else if (previousEnd !== currentStart) {
      throw new Error(`P${i} and P${i + 1} must be continuous`);
    }
  }
}

export function labBlockClockMinutes(clock: CollegeClock, startPeriod: number): number {
  checkClock(clock);
  if (!Number.isInteger(startPeriod) || startPeriod < 1 || startPeriod > 5) {
    throw new Error('A laboratory block needs two existing periods');
  }
  if (startPeriod === 3) throw new Error('A laboratory block cannot cross lunch');
  const first = clock.periods[startPeriod - 1];
  const second = clock.periods[startPeriod];
  if (minutes(first.end) !== minutes(second.start)) throw new Error('A laboratory block must be continuous');
  return minutes(second.end) - minutes(first.start);
}

export function requireTwoHours(clock: CollegeClock, startPeriod: number): void {
  if (labBlockClockMinutes(clock, startPeriod) !== 120) {
    throw new Error('A laboratory booking must be 120 uninterrupted minutes');
  }
}

export function effectiveSaturdayPeriods(campusPeriods: number, semesterOverride: number | null): number {
  if (![0, 3, 6].includes(campusPeriods)) throw new Error('Campus Saturday policy must be Closed, 3 periods, or 6 periods');
  if (semesterOverride !== null && ![0, 3, 6].includes(semesterOverride)) {
    throw new Error('Semester Saturday policy must be Closed, 3 periods, or 6 periods');
  }
  if (semesterOverride !== null && semesterOverride > campusPeriods) {
    throw new Error('A semester cannot run beyond the campus Saturday hours');
  }
  return semesterOverride === null ? campusPeriods : semesterOverride;
}
