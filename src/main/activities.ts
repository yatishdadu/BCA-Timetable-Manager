import { protectedHandle } from './coordinatorAuth.ts';
import { assertSectionsWithinSchedule } from './semesterSchedules.ts';
/** Club, sports, and explicitly dated HOD certification slots.
 * Additive development schema; these are PLANNED records, not approval signatures.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { checkClock, type CollegeClock } from './clockRules.ts';
import { validateActivityDate, validateEventSpan, activityConflict, type ScheduleSlot } from './activityRules.ts';
import { canSuspendWeeklyBcaLab } from './overrideRules.ts';

const uuid = z.string().uuid();
const input = z.object({
  id: uuid.optional(), termId: uuid,
  kind: z.enum(['Club', 'Sports', 'Certification']),
  title: z.string().trim().min(2).max(140),
  organizer: z.string().trim().max(120),
  notes: z.string().trim().max(300),
  mode: z.enum(['Weekly', 'Dated']),
  weekday: z.number().int().min(0).max(5),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(30),
  startPeriod: z.number().int().min(1).max(6),
  periodCount: z.number().int().min(1).max(3),
  sectionIds: z.array(uuid).min(1).max(24),
  facultyId: uuid.nullable(),
  labId: uuid.nullable(),
  suspendConflictingBcaLabs: z.boolean().optional().default(false),
  hodInstructionReference: z.string().trim().max(200).optional().default(''),
  hodInstructionChannel: z.enum(['Printed','Digital','Both']).optional(),
});

export async function ensureActivityTables(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('schedule_activities'))) {
    await db.schema.createTable('schedule_activities', t => {
      t.string('id', 36).primary();
      t.string('term_id', 36).notNullable().references('id').inTable('academic_terms').onDelete('RESTRICT');
      t.string('kind', 20).notNullable();
      t.string('title', 140).notNullable();
      t.string('organizer', 120).notNullable().defaultTo('');
      t.string('notes', 300).notNullable().defaultTo('');
      t.string('mode', 8).notNullable();
      t.integer('weekday').notNullable();
      t.string('booking_date', 10).nullable();
      t.integer('start_period').notNullable();
      t.integer('period_count').notNullable();
      t.string('faculty_id', 36).nullable().references('id').inTable('faculty').onDelete('RESTRICT');
      t.string('lab_id', 36).nullable().references('id').inTable('shared_laboratories').onDelete('RESTRICT');
      t.boolean('active').notNullable().defaultTo(true);
      t.index(['term_id', 'weekday', 'active']);
    });
  }
  if (!(await db.schema.hasTable('schedule_activity_sections'))) {
    await db.schema.createTable('schedule_activity_sections', t => {
      t.string('activity_id', 36).notNullable().references('id').inTable('schedule_activities').onDelete('RESTRICT');
      t.string('section_id', 36).notNullable().references('id').inTable('academic_sections').onDelete('RESTRICT');
      t.primary(['activity_id', 'section_id']);
      t.index(['section_id']);
    });
  }
  if (!(await db.schema.hasTable('schedule_lab_suspensions'))) {
    // These are date-specific exceptions, not modifications to weekly lab bookings.
    await db.schema.createTable('schedule_lab_suspensions', t => {
      t.string('activity_id', 36).notNullable().references('id').inTable('schedule_activities').onDelete('RESTRICT');
      t.string('lab_booking_id', 36).notNullable().references('id').inTable('lab_bookings').onDelete('RESTRICT');
      t.string('booking_date', 10).notNullable();
      t.string('hod_reference', 200).notNullable();
      t.string('hod_channel', 12).notNullable();
      t.timestamp('recorded_at').notNullable().defaultTo(db.fn.now());
      t.primary(['activity_id','lab_booking_id','booking_date']);
      t.index(['lab_booking_id','booking_date']);
    });
  }
}

type ActivityRow = {id:string;term_id:string;mode:'Weekly'|'Dated';weekday:number;
  booking_date:string|null;start_period:number;period_count:number;faculty_id:string|null;
  lab_id:string|null;active:number;kind:string;title:string;organizer:string;notes:string};

async function withSections(db: Knex, onlyActive = false): Promise<(ActivityRow & {section_ids:string[]; section_labels:string[]})[]> {
  const query = db('schedule_activities as e')
    .leftJoin('faculty as f', 'f.id', 'e.faculty_id')
    .leftJoin('shared_laboratories as lab', 'lab.id', 'e.lab_id')
    .select('e.*', 'f.name as faculty_name', 'lab.code as lab_code');
  if (onlyActive) query.where('e.active', 1);
  const rows = await query.orderBy('e.weekday').orderBy('e.start_period').orderBy('e.booking_date');
  if (!rows.length) return [];
  const sections = await db('schedule_activity_sections as x')
    .join('academic_sections as s', 's.id', 'x.section_id')
    .join('semester_offerings as so', 'so.id', 's.offering_id')
    .whereIn('x.activity_id', rows.map(r=>r.id))
    .select('x.activity_id', 'x.section_id', 'so.semester_number', 's.code', 'so.id as offering_id');
  return rows.map(r => {
    const matching = sections.filter(s=>s.activity_id===r.id);
    return {...r, section_ids:matching.map(s=>String(s.section_id)),
      section_labels: matching.map(s=>`Semester ${s.semester_number}-${s.code}`)};
  });
}

function slot(row: ActivityRow & {section_ids:string[]}): ScheduleSlot {
  return {term_id:String(row.term_id),mode:row.mode,weekday:Number(row.weekday),
    booking_date:row.booking_date,start_period:Number(row.start_period),
    period_count:Number(row.period_count),section_ids:row.section_ids,
    faculty_id:row.faculty_id,lab_id:row.lab_id};
}

/** Used by the LABORATORY save handler too: safety check works in both directions. */
export async function assertLabHasNoActivityClash(db: Knex, candidate: ScheduleSlot): Promise<void> {
  const activities = await withSections(db, true);
  for (const row of activities) {
    const reason = activityConflict(candidate, slot(row));
    if (reason) throw new Error(`Existing ${row.kind.toLowerCase()} activity '${row.title}': ${reason}`);
  }
}

async function getClock(db: Knex): Promise<CollegeClock> {
  const row = await db('lab_clock_times').where({id:1}).first();
  if (!row) throw new Error('College clock not configured');
  const clock = JSON.parse(String(row.data_json)) as CollegeClock;
  checkClock(clock);
  if (!clock.confirmed) throw new Error('Confirm the college period timings in Shared Laboratories first');
  return clock;
}

async function ensureSaturdayOpen(db: Knex, termId: string, sections: {id:string; offering_id:string}[], lastPeriod: number): Promise<void> {
  const campus = await db('lab_term_saturday').where({term_id:termId}).first();
  if (!campus || Number(campus.confirmed)!==1) {
    throw new Error('Confirm this term’s Saturday campus hours before booking Saturday activities');
  }
  if (lastPeriod > Number(campus.campus_periods)) throw new Error('Activity is outside the approved campus Saturday hours');
  const offerings = [...new Set(sections.map(s=>s.offering_id))];
  const overrides = await db('lab_semester_saturday').whereIn('offering_id',offerings).select();
  for (const offeringId of offerings) {
    const override = overrides.find(x=>x.offering_id===offeringId);
    const allowed = override ? Number(override.periods) : Number(campus.campus_periods);
    if (lastPeriod > allowed) throw new Error('A participating semester is not scheduled for those Saturday periods');
  }
}

async function ensureActiveResources(db: Knex, data: z.infer<typeof input>) {
  if (!(await db('academic_terms').where({id:data.termId}).first())) throw new Error('Academic term not found');
  if (new Set(data.sectionIds).size!==data.sectionIds.length) throw new Error('Choose each section only once');
  const sections = await db('academic_sections as s')
    .join('semester_offerings as so','so.id','s.offering_id')
    .whereIn('s.id',data.sectionIds)
    .select('s.id','s.active as section_active','so.id as offering_id',
      'so.active as offering_active','so.term_id');
  if (sections.length!==data.sectionIds.length || sections.some(s=>s.term_id!==data.termId ||
      Number(s.section_active)!==1 || Number(s.offering_active)!==1)) {
    throw new Error('Every participating section must be active and belong to the selected term');
  }
  if (data.facultyId) {
    const faculty=await db('faculty').where({id:data.facultyId,active:1}).first();
    if (!faculty) throw new Error('Select an active faculty member');
  }
  if (data.labId) {
    const lab=await db('shared_laboratories').where({id:data.labId,active:1}).first();
    if (!lab) throw new Error('Select an active laboratory');
  }
  return sections.map(s=>({id:String(s.id),offering_id:String(s.offering_id)}));
}

/** Existing lab bookings use a 2-period slot. Current allocated faculty wins over an old snapshot. */
type LaboratorySlot = ScheduleSlot & {booking_id:string;booking_type:'BCA'|'External'|'Maintenance';owner_label:string;display_label:string};
async function labSlots(db: Knex): Promise<LaboratorySlot[]> {
  const rows = await db('lab_bookings as b')
    .leftJoin('section_subject_allocations as a','a.id','b.allocation_id')
    .leftJoin('academic_sections as sec','sec.id','b.section_id')
    .leftJoin('semester_offerings as so','so.id','sec.offering_id')
    .leftJoin('term_subjects as sub','sub.id','a.subject_id')
    .leftJoin('faculty as f','f.id','a.faculty_id')
    .leftJoin('shared_laboratories as l','l.id','b.lab_id')
    .where('b.active',1).select('b.*','a.faculty_id as current_faculty_id',
      'sec.code as section_code','so.semester_number','sub.name as subject_name',
      'f.name as faculty_name','l.code as lab_code');
  return rows.map(r=>({booking_id:String(r.id),booking_type:r.booking_type,owner_label:String(r.owner_label||''),
    display_label:[r.lab_code,
      r.semester_number ? `Semester ${r.semester_number}-${r.section_code}` : r.owner_label,
      r.subject_name,r.faculty_name].filter(Boolean).join(' · '),
    term_id:String(r.term_id),mode:r.mode as 'Weekly'|'Dated',
    weekday:Number(r.weekday),booking_date:r.booking_date?String(r.booking_date):null,
    start_period:Number(r.start_period),period_count:2,
    section_ids:r.section_id?[String(r.section_id)]:[],
    faculty_id:r.allocation_id?r.current_faculty_id:(r.faculty_id||null),
    lab_id:String(r.lab_id)}));
}

export async function assertActivitySpansValidForClock(db: Knex, clock: CollegeClock): Promise<void> {
  const rows=await db('schedule_activities').where({active:1}).select('id','start_period','period_count');
  for(const row of rows) {
    try { validateEventSpan(clock,Number(row.start_period),Number(row.period_count)); }
    catch(err) { throw new Error(`Activity ${row.id} would become invalid: ${err instanceof Error?err.message:String(err)}`); }
  }
}

export async function assertActivitiesFitSaturday(db: Knex, termId:string, campusPeriods:number, offeringId?:string, semesterPeriods?:number):Promise<void> {
  const rows=await db('schedule_activities as e')
    .join('schedule_activity_sections as p','p.activity_id','e.id')
    .join('academic_sections as s','s.id','p.section_id')
    .where('e.term_id',termId).where('e.active',1).where('e.weekday',5)
    .select('e.id','e.start_period','e.period_count','s.offering_id');
  for(const row of rows) {
    const end=Number(row.start_period)+Number(row.period_count)-1;
    if(end>campusPeriods) throw new Error(`Activity ${row.id} requires Saturday P${end}, beyond new campus hours`);
    if(offeringId && row.offering_id===offeringId && semesterPeriods!==undefined && end>semesterPeriods) {
      throw new Error(`Activity ${row.id} would exceed that semester's Saturday hours`);
    }
  }
}

type ConflictReport = {
  replacements: {date:string;labBookingId:string;weekday:number;startPeriod:number;endPeriod:number;
    ownerLabel:string;reason:string}[];
  blockers: {date:string;source:string;reason:string}[];
};

async function reviewConflicts(
  db: Knex, data: z.infer<typeof input>, dates: (string|null)[],
  ignoreActivityId?:string,
):Promise<ConflictReport> {
  const activities=await withSections(db,true);
  const labs=await labSlots(db);
  const report:ConflictReport={replacements:[],blockers:[]};
  for(const date of dates) {
    const day=date===null?data.weekday:validateActivityDate(date);
    const candidate:ScheduleSlot={term_id:data.termId,mode:data.mode,weekday:day,
      booking_date:date,start_period:data.startPeriod,period_count:data.periodCount,
      section_ids:data.sectionIds,faculty_id:data.facultyId,lab_id:data.labId};
    for(const existing of activities) {
      if(existing.id===ignoreActivityId)continue;
      const reason=activityConflict(candidate,slot(existing));
      if(reason)report.blockers.push({date:date||'Weekly',source:`${existing.kind}: ${existing.title}`,reason});
    }
    for(const lab of labs) {
      const reason=activityConflict(candidate,lab);
      if(!reason)continue;
      if(canSuspendWeeklyBcaLab(candidate,data.kind,lab)) {
        report.replacements.push({date:date!,labBookingId:lab.booking_id,weekday:day,
          startPeriod:lab.start_period,endPeriod:lab.start_period+1,
          ownerLabel:lab.display_label,reason});
      } else {
        report.blockers.push({date:date||'Weekly',source:`${lab.booking_type} laboratory (${lab.display_label})`,reason});
      }
    }
  }
  return report;
}

export function registerActivityHandlers(db: Knex):void {
  protectedHandle('activities:list', async (_event, rawTermId:unknown) => {
    const termId=uuid.parse(rawTermId);
    const rows=await withSections(db);
    return rows.filter(r=>r.term_id===termId);
  });
  protectedHandle('activities:listSuspensions', async (_event, rawTermId:unknown)=>{
    const termId=uuid.parse(rawTermId);
    return db('schedule_lab_suspensions as x')
      .join('schedule_activities as a','a.id','x.activity_id')
      .join('lab_bookings as b','b.id','x.lab_booking_id')
      .join('shared_laboratories as lab','lab.id','b.lab_id')
      .leftJoin('academic_sections as sec','sec.id','b.section_id')
      .leftJoin('semester_offerings as so','so.id','sec.offering_id')
      .where('a.term_id',termId)
      .select('x.booking_date','x.activity_id','x.lab_booking_id','x.hod_reference','x.hod_channel',
        'x.recorded_at','a.title as activity_title','a.active as activity_active',
        'b.active as booking_active','b.start_period','lab.code as lab_code',
        'so.semester_number','sec.code as section_code')
      .orderBy('x.booking_date').orderBy('lab.code');
  });
  protectedHandle('activities:preview',async(_event,raw:unknown)=>{
    const data=input.parse(raw);
    const dates=data.mode==='Weekly'?[null]:data.dates;
    if(data.kind==='Certification' && data.mode!=='Dated') throw new Error('Certification must use specific dates');
    if(data.mode==='Dated'&&!dates.length)throw new Error('Enter at least one date');
    if(new Set(data.dates).size!==data.dates.length)throw new Error('Duplicate dates are not permitted');
    const clock=await getClock(db);
    validateEventSpan(clock,data.startPeriod,data.periodCount);
    await ensureActiveResources(db,data);
    for(const date of dates) {
      const day=date===null?data.weekday:validateActivityDate(date);
      await assertSectionsWithinSchedule(db,data.sectionIds,day,data.startPeriod,data.periodCount);
      if(day===5) {
        const sections=await ensureActiveResources(db,data);
        await ensureSaturdayOpen(db,data.termId,sections,data.startPeriod+data.periodCount-1);
      }
    }
    return reviewConflicts(db,data,dates,data.id);
  });
  protectedHandle('activities:save', async (_event, raw:unknown) => {
    const data=input.parse(raw);
    if (data.kind==='Certification' && data.mode!=='Dated') {
      throw new Error('Certification must use specific HOD-allotted calendar dates, not a weekly default');
    }
    if (data.mode==='Weekly' && data.dates.length) throw new Error('Weekly activities cannot include dates');
    if (data.mode==='Dated' && !data.dates.length) throw new Error('Enter at least one approved calendar date');
    if (data.id && data.dates.length>1) throw new Error('Edit one dated session at a time');
    if (new Set(data.dates).size !== data.dates.length) throw new Error('Remove duplicate calendar dates');
    if(data.suspendConflictingBcaLabs && (data.kind!=='Certification'||data.mode!=='Dated')) {
      throw new Error('Only a dated certification may suspend recurring BCA laboratory sessions');
    }
    if(data.suspendConflictingBcaLabs && (!data.hodInstructionReference.trim()||!data.hodInstructionChannel)) {
      throw new Error('Record the HOD instruction reference and evidence channel for suspensions');
    }
    const dates = data.mode==='Weekly' ? [null] : data.dates;
    const clock=await getClock(db);
    validateEventSpan(clock,data.startPeriod,data.periodCount);
    return db.transaction(async trx => {
      if (data.id && !(await trx('schedule_activities').where({id:data.id}).first())) throw new Error('Activity not found');
      if(data.id && await trx('schedule_lab_suspensions').where({activity_id:data.id}).first()) {
        throw new Error('This certification has suspension history. Cancel and recreate it to change its dates or resources.');
      }
      const sections=await ensureActiveResources(trx,data);
      for(const date of dates) {
        const day=date===null?data.weekday:validateActivityDate(date);
        await assertSectionsWithinSchedule(trx,data.sectionIds,day,data.startPeriod,data.periodCount);
        if(day===5)await ensureSaturdayOpen(trx,data.termId,sections,data.startPeriod+data.periodCount-1);
      }
      const report=await reviewConflicts(trx,data,dates,data.id);
      if(report.blockers.length) {
        const b=report.blockers[0];
        throw new Error(`Cannot schedule ${b.date}: ${b.source}. ${b.reason}`);
      }
      if(report.replacements.length && !data.suspendConflictingBcaLabs) {
        const first=report.replacements[0];
        throw new Error(`The certification would displace ${report.replacements.length} regular BCA laboratory occurrence(s), starting ${first.date} P${first.startPeriod}–P${first.endPeriod}. Preview and explicitly authorize these suspensions.`);
      }
      if(data.suspendConflictingBcaLabs && !report.replacements.length) {
        throw new Error('No recurring BCA laboratory clash exists to suspend. Uncheck the suspension option.');
      }
      const saved=[];
      for (const date of dates) {
        const day=date===null?data.weekday:validateActivityDate(date);
        const id=data.id||randomUUID();
        const fields={term_id:data.termId,kind:data.kind,title:data.title,organizer:data.organizer,
          notes:data.notes,mode:data.mode,weekday:day,booking_date:date,
          start_period:data.startPeriod,period_count:data.periodCount,
          faculty_id:data.facultyId,lab_id:data.labId,active:1};
        if(data.id) {
          await trx('schedule_activities').where({id}).update(fields);
          await trx('schedule_activity_sections').where({activity_id:id}).delete();
        } else {
          await trx('schedule_activities').insert({id,...fields});
        }
        await trx('schedule_activity_sections').insert(data.sectionIds.map(section_id=>({activity_id:id,section_id})));
        for(const conflict of report.replacements.filter(c=>c.date===date)) {
          await trx('schedule_lab_suspensions').insert({
            activity_id:id,lab_booking_id:conflict.labBookingId,booking_date:conflict.date,
            hod_reference:data.hodInstructionReference,hod_channel:data.hodInstructionChannel,
          });
        }
        saved.push({id,...fields,section_ids:data.sectionIds});
      }
      return saved;
    });
  });
  protectedHandle('activities:cancel',async(_event,rawId:unknown)=>{
    const id=uuid.parse(rawId);
    // No deletion of suspensions: they remain as audit records, but no longer
    // apply when the certification is inactive. The weekly lab resumes.
    const n=await db('schedule_activities').where({id}).update({active:0});
    if(!n) throw new Error('Activity not found');
    return {success:true};
  });
}
