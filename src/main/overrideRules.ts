/** Pure authorization eligibility rule for date-specific BCA laboratory suspensions. */
import type { ScheduleSlot } from './activityRules.ts';
export type LabToReview = ScheduleSlot & {
  booking_id:string;
  booking_type:'BCA'|'External'|'Maintenance';
  owner_label:string;
};
/** True means eligible for explicit suspension, not that it is authorized. */
export function canSuspendWeeklyBcaLab(
  candidate: ScheduleSlot,
  kind: string,
  lab: LabToReview,
): boolean {
  return kind === 'Certification' && candidate.mode === 'Dated' &&
    candidate.booking_date !== null && candidate.term_id === lab.term_id &&
    lab.mode === 'Weekly' && lab.booking_type === 'BCA';
}
