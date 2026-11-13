/** Pure, side-effect-free rules for projecting the read-only master timetable. */
export type MasterEvent = {
  id: string; source: 'Lab' | 'Activity' | 'Theory'; title: string; detail: string;
  mode: 'Weekly' | 'Dated'; weekday: number; bookingDate: string | null;
  startPeriod: number; periodCount: number; sectionIds: string[];
  facultyId: string | null; labId: string | null; languageOne?: boolean;
};
export type SuspensionKey = { labBookingId: string; bookingDate: string };

export function parseScheduleDate(iso: string): number {
  if (!/^(20\d\d|21\d\d)-\d{2}-\d{2}$/.test(iso)) throw new Error('Select a valid date between 2000 and 2199');
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error('Select a real calendar date');
  }
  return (d.getUTCDay() + 6) % 7; // Monday=0, Sunday=6
}

export function effectiveMasterEvents(
  events: MasterEvent[], suspensions: SuspensionKey[], date: string | null,
): MasterEvent[] {
  const day = date === null ? null : parseScheduleDate(date);
  const suspended = new Set(suspensions.map(s => `${s.labBookingId}::${s.bookingDate}`));
  return events.filter(e => {
    if (date === null) return e.mode === 'Weekly';
    if (e.mode === 'Dated') return e.bookingDate === date;
    if (e.weekday !== day) return false;
    if (e.source === 'Lab' && suspended.has(`${e.id}::${date}`)) return false;
    return true;
  }).sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.title.localeCompare(b.title));
}

export function projectedConflicts(events: MasterEvent[]): string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      // On a date-specific projection all events are for one date, but weekly
      // projections contain multiple weekdays.
      if (a.weekday !== b.weekday) continue;
      if (a.startPeriod >= b.startPeriod + b.periodCount || b.startPeriod >= a.startPeriod + a.periodCount) continue;
      const section = a.sectionIds.some(id => b.sectionIds.includes(id));
      const faculty = Boolean(a.facultyId && a.facultyId === b.facultyId);
      const lab = Boolean(a.labId && a.labId === b.labId);
      if (section || faculty || lab) {
        conflicts.push(`${a.title} overlaps ${b.title} (${[section && 'section', faculty && 'faculty', lab && 'laboratory'].filter(Boolean).join(', ')}) on weekday ${a.weekday + 1}, P${Math.max(a.startPeriod, b.startPeriod)}`);
      }
    }
  }
  return conflicts;
}
