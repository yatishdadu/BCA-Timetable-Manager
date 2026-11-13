/** Pure slot validation/collision rules, shared by IPC and tests. No Electron imports. */
export type BookingMode = 'Weekly' | 'Dated';
export type BookingType = 'BCA' | 'External' | 'Maintenance';
export type SlotConfig = {
  days: 5 | 6;
  periodsPerDay: number;
  saturdayPeriods: number;
  breakAfter: number;
};
export type BookingSlot = {
  term_id: string;
  mode: BookingMode;
  weekday: number; // Monday=0, ... Saturday=5
  booking_date: string | null;
  start_period: number; // 1-based
  lab_id: string;
  section_id?: string | null;
  faculty_id?: string | null;
};

export function weekdayOfISODate(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Use a valid date YYYY-MM-DD');
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error('Invalid calendar date');
  }
  return (d.getUTCDay() + 6) % 7;
}

export function validateSlot(config: SlotConfig, slot: Pick<BookingSlot, 'mode' | 'weekday' | 'booking_date' | 'start_period'>): void {
  const day = slot.mode === 'Dated' ? weekdayOfISODate(slot.booking_date ?? '') : slot.weekday;
  if (!Number.isInteger(day) || day < 0 || day >= config.days) {
    throw new Error('Booking day is not a college working day');
  }
  if (slot.mode === 'Weekly' && slot.booking_date) throw new Error('Weekly bookings cannot have a specific date');
  if (slot.mode === 'Dated' && day !== slot.weekday) throw new Error('Booking date does not match the selected weekday');
  const periods = day === 5 ? config.saturdayPeriods : config.periodsPerDay;
  if (!Number.isInteger(slot.start_period) || slot.start_period < 1 || slot.start_period + 1 > periods) {
    throw new Error('A lab must fit exactly two consecutive periods on the selected day');
  }
  if (config.breakAfter > 0 && slot.start_period === config.breakAfter) {
    throw new Error('A two-period lab cannot cross the common break');
  }
}

/** Returns true only if the bookings occur on a potentially overlapping date/day and period. */
export function overlapsInTime(a: BookingSlot, b: BookingSlot): boolean {
  if (a.weekday !== b.weekday) return false;
  // Dated one-offs can conflict even if a user accidentally selected another term.
  if (a.mode === 'Dated' && b.mode === 'Dated') {
    if (a.booking_date !== b.booking_date) return false;
  } else if (a.term_id !== b.term_id) {
    // A term's repeating weekly reservations are limited to that academic term.
    return false;
  }
  return a.start_period < b.start_period + 2 && b.start_period < a.start_period + 2;
}

export function resourceConflict(a: BookingSlot, b: BookingSlot): string | null {
  if (!overlapsInTime(a, b)) return null;
  if (a.lab_id === b.lab_id) return 'Laboratory is already booked during these periods';
  if (a.section_id && b.section_id && a.section_id === b.section_id) {
    return 'BCA section already has another lab during these periods';
  }
  if (a.faculty_id && b.faculty_id && a.faculty_id === b.faculty_id) {
    return 'Faculty member already has another lab during these periods';
  }
  return null;
}
