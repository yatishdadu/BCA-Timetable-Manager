/** Phase 2E3C: conservative, auditable reset boundaries. */
export type ResetMode = 'drafts' | 'term' | 'fresh';
export type ResetImpact = {
  mode: ResetMode;
  termId?: string;
  protectedVersions: number;
  approvalEvidence: number;
  draftVersions: number;
  theoryDrafts: number;
  labBookings: number;
  activities: number;
  allocations: number;
  subjects: number;
  faculty: number;
  blockers: string[];
};
export const REQUIRED_PHRASES: Record<ResetMode, 'CLEAR DRAFTS' | 'RESET TERM' | 'START FRESH'> = {
  drafts: 'CLEAR DRAFTS', term: 'RESET TERM', fresh: 'START FRESH'
};
export const STAY_AFTER_FRESH = Object.freeze([
  'coordinator_login', 'coordinator_handover_audit', 'institution_branding',
  'lab_schedule_config', 'lab_clock_times',
]);
export const KNOWN_TABLES = new Set([
  ...STAY_AFTER_FRESH, 'faculty', 'academic_terms', 'semester_offerings', 'academic_sections',
  'term_subjects', 'section_subject_allocations', 'shared_laboratories',
  'lab_term_saturday', 'lab_semester_saturday', 'lab_bookings', 'semester_period_policies',
  'schedule_activities', 'schedule_activity_sections', 'schedule_lab_suspensions',
  'theory_draft_runs', 'manual_timetable_edits', 'timetable_review_versions', 'timetable_review_evidence', 'timetable_approval_audit',
  'sqlite_sequence', 'sqlite_stat1', 'knex_migrations', 'knex_migrations_lock'
]);
export function resetBlockers(protectedVersions: number, evidenceFiles: number): string[] {
  const list: string[] = [];
  if (protectedVersions > 0) list.push('Approved or published timetable versions exist in the affected records. Preserve them; reset is blocked.');
  if (evidenceFiles > 0) list.push('HOD approval attachments exist in the affected records. Reset is blocked to protect audit evidence.');
  return list;
}
export function assertNoUnknownTables(names: string[]): void {
  const unknown = names.filter(n => !KNOWN_TABLES.has(n) && !n.startsWith('sqlite_'));
  if (unknown.length) throw new Error('Unknown database tables are present (' + unknown.join(', ') + '). Reset is blocked until the schema is reviewed.');
}
