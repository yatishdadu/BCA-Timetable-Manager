/** Phase 2K1: term/semester-scoped working periods, additive and authenticated. */
import type { Knex } from 'knex';
import { z } from 'zod';
import { protectedHandle } from './coordinatorAuth.ts';
import { assertPeriodsAllowed, normalizedPolicy, type SemesterPeriodPolicy, type SemesterScheduleMode } from './semesterScheduleRules.ts';
const uuid=z.string().uuid();
const updateSchema=z.object({offeringId:uuid,mode:z.enum(['Morning Only','Full Day','Custom Timing']),allowedPeriods:z.array(z.number().int().min(1).max(6)).max(6)}).strict();
const DEFAULT:SemesterPeriodPolicy=normalizedPolicy('Full Day',[1,2,3,4,5,6]);
export async function ensureSemesterScheduleSchema(db:Knex):Promise<void>{
 if(!(await db.schema.hasTable('semester_period_policies'))){
  await db.schema.createTable('semester_period_policies',t=>{
   t.string('offering_id',36).primary().references('id').inTable('semester_offerings').onDelete('RESTRICT');
   t.string('mode',20).notNullable();t.text('allowed_periods_json').notNullable();t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
  });
 }
}
export function readPolicyRow(row:{mode?:unknown;allowed_periods_json?:unknown}|null|undefined):SemesterPeriodPolicy{
 if(!row)return {...DEFAULT,allowedPeriods:[...DEFAULT.allowedPeriods]};
 const data=JSON.parse(String(row.allowed_periods_json));
 return normalizedPolicy(String(row.mode) as SemesterScheduleMode,data);
}
export async function getOfferingPolicy(db:Knex,offeringId:string):Promise<SemesterPeriodPolicy>{
 return readPolicyRow(await db('semester_period_policies').where({offering_id:offeringId}).first());
}
export async function listTermSchedules(db:Knex,termId:string){
 const rows=await db('semester_offerings as so')
  .leftJoin('semester_period_policies as p','p.offering_id','so.id')
  .leftJoin('lab_semester_saturday as sat','sat.offering_id','so.id')
  .leftJoin('lab_term_saturday as campus','campus.term_id','so.term_id')
  .where('so.term_id',termId)
  .select('so.id','so.semester_number','so.active','p.mode','p.allowed_periods_json','sat.periods as sat_override','campus.campus_periods','campus.confirmed')
  .orderBy('so.semester_number');
 if(!(await db('academic_terms').where({id:termId}).first()))throw new Error('Academic term not found');
 return rows.map(r=>{
  const policy=readPolicyRow(r.mode?{mode:r.mode,allowed_periods_json:r.allowed_periods_json}:null);
  const campus=Number(r.confirmed)===1?Number(r.campus_periods):0;
  const saturdayPeriods=r.sat_override===null||r.sat_override===undefined?campus:Math.min(Number(r.sat_override),campus);
  return {offeringId:String(r.id),semesterNumber:Number(r.semester_number),active:Number(r.active)===1,
   ...policy,saturdayPeriods};
 });
}
/** Active classroom events that cannot be silently invalidated by changing teaching hours. */
export async function assertExistingReservationsFit(db:Knex,offeringId:string,policy:SemesterPeriodPolicy):Promise<void>{
 const offering=await db('semester_offerings').where({id:offeringId}).first();
 if(!offering)throw new Error('Semester offering not found');
 const schedules=await listTermSchedules(db,String(offering.term_id));
 const schedule=schedules.find(s=>s.offeringId===offeringId)!;
 const labRows=await db('lab_bookings as b')
  .join('academic_sections as s','s.id','b.section_id')
  .where('s.offering_id',offeringId).where('b.active',1)
  .select('b.id','b.weekday','b.start_period','b.period_count');
 for(const b of labRows)assertPeriodsAllowed(policy,Number(b.weekday),Number(b.start_period),Number(b.period_count),schedule.saturdayPeriods,`Existing lab ${b.id}`);
 const activityRows=await db('schedule_activities as a')
  .join('schedule_activity_sections as x','x.activity_id','a.id')
  .join('academic_sections as s','s.id','x.section_id')
  .where('s.offering_id',offeringId).where('a.active',1)
  .select('a.id','a.weekday','a.start_period','a.period_count');
 for(const a of activityRows)assertPeriodsAllowed(policy,Number(a.weekday),Number(a.start_period),Number(a.period_count),schedule.saturdayPeriods,`Existing activity ${a.id}`);
 // Saved theory versions are never rewritten. A policy change makes the active draft stale;
 // the generator recalculates it from the new policy before any new save.
}
export async function assertSectionsWithinSchedule(db:Knex,sectionIds:string[],day:number,start:number,count:number):Promise<void>{
 if(!sectionIds.length)return;
 const rows=await db('academic_sections as s').join('semester_offerings as so','so.id','s.offering_id')
  .whereIn('s.id',sectionIds).select('s.id','so.id as offering_id','so.term_id','so.semester_number');
 if(rows.length!==new Set(sectionIds).size)throw new Error('One or more sections no longer exist');
 const policyCache=new Map<string,{policy:SemesterPeriodPolicy;saturdayPeriods:number}>();
 for(const r of rows){const offeringId=String(r.offering_id);
  let entry=policyCache.get(offeringId);
  if(!entry){const policies=await listTermSchedules(db,String(r.term_id));const match=policies.find(x=>x.offeringId===offeringId)!;
   entry={policy:{mode:match.mode,allowedPeriods:match.allowedPeriods},saturdayPeriods:match.saturdayPeriods};
   policyCache.set(offeringId,entry);
  }
  assertPeriodsAllowed(entry.policy,day,start,count,entry.saturdayPeriods,`Semester ${r.semester_number} section`);
 }
}
export function registerSemesterScheduleHandlers(db:Knex):void{
 protectedHandle('semesterSchedule:list',async(_event,raw:unknown)=>listTermSchedules(db,uuid.parse(raw)));
 protectedHandle('semesterSchedule:save',async(_event,raw:unknown)=>{
  const data=updateSchema.parse(raw),policy=normalizedPolicy(data.mode,data.allowedPeriods);
  return db.transaction(async trx=>{
   const offering=await trx('semester_offerings').where({id:data.offeringId}).first();if(!offering)throw new Error('Semester not found');
   await assertExistingReservationsFit(trx,data.offeringId,policy);
   const saved={mode:policy.mode,allowed_periods_json:JSON.stringify(policy.allowedPeriods),updated_at:trx.fn.now()};
   if(await trx('semester_period_policies').where({offering_id:data.offeringId}).first())
    await trx('semester_period_policies').where({offering_id:data.offeringId}).update(saved);
   else await trx('semester_period_policies').insert({offering_id:data.offeringId,...saved});
   return {offeringId:data.offeringId,...policy};
  });
 });
}
