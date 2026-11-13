import { protectedHandle } from './coordinatorAuth.ts';
/** Phase 2B1: a read-only, evidence-based master timetable projection.
 * Does not allocate theory hours or change existing reservations.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Knex } from 'knex';
import { getCurrentTheoryDraft } from './theoryGenerator.ts';
import { effectiveMasterEvents, parseScheduleDate, projectedConflicts, type MasterEvent, type SuspensionKey } from './masterRules.ts';
import { listTermSchedules } from './semesterSchedules.ts';
import { inspectTimetable, type ScheduleSection } from './semesterScheduleRules.ts';

const queryInput = z.object({ termId: z.string().uuid(), date: z.string().nullable() });
const str = (v: unknown) => v === null || v === undefined ? null : String(v);

export async function loadMasterSnapshot(db: Knex, raw: unknown) {
    const { termId, date } = queryInput.parse(raw);
    if (date !== null && parseScheduleDate(date) === 6) {
      throw new Error('Sunday is not a regular teaching day. Special working-day exceptions are not yet implemented.');
    }
    const term = await db('academic_terms').where({ id: termId }).first();
    if (!term) throw new Error('Academic term not found');
    const sections = await db('academic_sections as sec')
      .join('semester_offerings as so', 'so.id', 'sec.offering_id')
      .where('so.term_id', termId).where('so.active', 1).where('sec.active', 1)
      .select('sec.id', 'sec.code', 'so.semester_number', 'so.id as offering_id').orderBy('so.semester_number').orderBy('sec.code').orderBy('sec.id');
    const faculty = await db('faculty').where({ active: 1 }).select('id', 'name', 'category', 'workload_target').orderBy('name').orderBy('id');
    const labs = await db('shared_laboratories').select('id', 'code', 'name').orderBy('code').orderBy('id');
    const labRows = await db('lab_bookings as b')
      .leftJoin('section_subject_allocations as a', 'a.id', 'b.allocation_id')
      .leftJoin('term_subjects as sub', 'sub.id', 'a.subject_id')
      .leftJoin('shared_laboratories as lab', 'lab.id', 'b.lab_id')
      .where('b.term_id', termId).where('b.active', 1)
      .select('b.*', 'a.faculty_id as current_faculty_id', 'sub.name as subject_name', 'lab.code as lab_code').orderBy('b.id');
    const activities = await db('schedule_activities').where({ term_id: termId, active: 1 }).orderBy('id').select();
    const participation = await db('schedule_activity_sections as x')
      .join('schedule_activities as a', 'a.id', 'x.activity_id')
      .where('a.term_id', termId).where('a.active', 1)
      .select('x.activity_id', 'x.section_id').orderBy('x.activity_id').orderBy('x.section_id');
    const labels = new Map(labs.map(l => [String(l.id), String(l.code)]));
    const events: MasterEvent[] = [];
    for (const row of labRows) {
      events.push({
        id: String(row.id), source: 'Lab',
        title: row.booking_type === 'BCA' ? (String(row.subject_name || 'Unassigned BCA Lab')) : `${row.booking_type} lab reservation`,
        detail: `${row.lab_code || labels.get(String(row.lab_id)) || 'Lab'} · ${row.booking_type === 'BCA' ? 'BCA' : String(row.owner_label || row.booking_type)}`,
        mode: row.mode, weekday: Number(row.weekday), bookingDate: str(row.booking_date),
        startPeriod: Number(row.start_period), periodCount: 2,
        sectionIds: row.section_id ? [String(row.section_id)] : [],
        facultyId: str(row.allocation_id ? row.current_faculty_id : row.faculty_id), labId: str(row.lab_id),
      });
    }
    for (const row of activities) {
      events.push({
        id: String(row.id), source: 'Activity', title: String(row.title), detail: String(row.kind),
        mode: row.mode, weekday: Number(row.weekday), bookingDate: str(row.booking_date),
        startPeriod: Number(row.start_period), periodCount: Number(row.period_count),
        sectionIds: participation.filter(p => p.activity_id === row.id).map(p => String(p.section_id)),
        facultyId: str(row.faculty_id), labId: str(row.lab_id),
      });
    }
    const suspensions: SuspensionKey[] = await db('schedule_lab_suspensions as x')
      .join('schedule_activities as a', 'a.id', 'x.activity_id')
      .where('a.term_id', termId).where('a.active', 1)
      .select('x.lab_booking_id as labBookingId', 'x.booking_date as bookingDate').orderBy('x.booking_date').orderBy('x.lab_booking_id');
    // Saved theory periods are a DRAFT overlay. Hide stale drafts rather than
    // misrepresenting periods after source assignments or bookings change.
    const draft = await getCurrentTheoryDraft(db, termId);
    const theoryPlaced = new Map<string, number>();
    if (draft && !draft.stale) {
      for (const s of draft.slots) {
        theoryPlaced.set(s.allocationId, (theoryPlaced.get(s.allocationId) || 0) + 1);
        events.push({
          id: `theory-${s.allocationId}-${s.day}-${s.period}`, source: 'Theory',
          title: s.subject, detail: 'Automatically placed · UNAPPROVED DRAFT',
          mode: 'Weekly', weekday: s.day, bookingDate: null, startPeriod: s.period,
          periodCount: 1, sectionIds: [s.sectionId], facultyId: s.facultyId, labId: null, languageOne: s.languageOne === true,
        });
      }
    }
    const visible = effectiveMasterEvents(events, suspensions, date);
    const allocationRows = await db('section_subject_allocations as a')
      .join('academic_sections as sec', 'sec.id', 'a.section_id')
      .join('semester_offerings as so', 'so.id', 'sec.offering_id')
      .join('term_subjects as s', 's.id', 'a.subject_id')
      .where('so.term_id', termId).where('a.active', 1).where('s.active', 1)
      .select('a.id', 'a.section_id', 'a.faculty_id', 'a.weekly_hours', 's.name as subject_name', 's.kind').orderBy('a.id');
    const weeklyLabCounts = new Map<string, number>();
    for (const row of labRows) {
      if (row.booking_type !== 'BCA' || row.mode !== 'Weekly' || !row.allocation_id) continue;
      const key = String(row.allocation_id);
      weeklyLabCounts.set(key, (weeklyLabCounts.get(key) || 0) + 2);
    }
    const unplaced = allocationRows.map(row => {
      const placed = row.kind === 'Lab' ? (weeklyLabCounts.get(String(row.id)) || 0) : (theoryPlaced.get(String(row.id)) || 0);
      return {
        allocationId: String(row.id), sectionId: String(row.section_id),
        subject: String(row.subject_name), kind: String(row.kind),
        facultyId: str(row.faculty_id), required: Number(row.weekly_hours),
        placed, remaining: Math.max(0, Number(row.weekly_hours) - placed),
      };
    });
    const scheduleRows = await listTermSchedules(db,termId);
    const scheduleByOffering = new Map(scheduleRows.map(s=>[s.offeringId,s]));
    const scheduleSections:ScheduleSection[]=sections.map(s=>{
      const policy=scheduleByOffering.get(String(s.offering_id));
      return {id:String(s.id),label:`Semester ${s.semester_number}-${s.code}`,
        code:String(s.code),semesterNumber:Number(s.semester_number),
        allowedPeriods:policy?.allowedPeriods??[1,2,3,4,5,6],saturdayPeriods:policy?.saturdayPeriods??0};
    });
    const scheduleIssues = inspectTimetable(visible,scheduleSections);
    const clock = await db('lab_clock_times').where({ id: 1 }).first();
    const saved = clock ? JSON.parse(String(clock.data_json)) : null;
    return {
      term: { id: termId, academicYear: String(term.academic_year), cycle: String(term.cycle) },
      date, sections: sections.map(r => ({ id: String(r.id), label: `Semester ${r.semester_number}-${r.code}` })),
      faculty: faculty.map(f => ({ id: String(f.id), name: String(f.name), target: Number(f.workload_target) })),
      labs: labs.map(l => ({ id: String(l.id), code: String(l.code) })),
      events: visible, conflicts: [...projectedConflicts(visible),...scheduleIssues.filter(issue=>issue.code==='OUTSIDE_HOURS'||issue.code==='LANGUAGE_1').map(issue=>issue.message)],
      scheduleIssues, semesterSchedules:scheduleRows, unplaced,
      clock: saved,
      note: draft?.stale ? 'Saved theory draft is STALE and hidden; recalculate and save again. This is not an official timetable.' : draft ? 'Saved theory periods are an UNAPPROVED DRAFT. Remaining unplaced periods must be reviewed.' : 'Theory has not yet been saved. Open Theory Generator to preview and save a draft.',
    };
}

export function registerMasterTimetableHandlers(db: Knex): void {
  protectedHandle('master:snapshot', (_event, raw: unknown) => loadMasterSnapshot(db, raw));
}
