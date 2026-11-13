import { protectedHandle } from './coordinatorAuth.ts';
/** Phase 2B2: preview and versioned saving of weekly theory DRAFTS only. */
import { ipcMain } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { GENERATOR_VERSION, assertTheorySlots, generateTheory, type FixedPeriod, type TheoryInput, type TheoryPlan, type TheorySlot, assertLanguageOneComplete } from './theoryRules.ts';
import { readPolicyRow } from './semesterSchedules.ts';

const uuid = z.string().uuid();
const saveInput = z.object({termId: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/)});
export async function ensureTheoryDraftTables(db:Knex):Promise<void>{
  if(!(await db.schema.hasTable('theory_draft_runs'))) {
    await db.schema.createTable('theory_draft_runs',t=>{
      t.string('id',36).primary();
      t.string('term_id',36).notNullable().references('id').inTable('academic_terms').onDelete('RESTRICT');
      t.string('fingerprint',64).notNullable();
      t.text('plan_json').notNullable();
      t.boolean('active').notNullable().defaultTo(false);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.index(['term_id','active']);
    });
  }
}
export async function loadTheoryInput(db:Knex,termId:string):Promise<TheoryInput>{
  const term=await db('academic_terms').where({id:termId}).first();
  if(!term)throw new Error('Academic term not found');
  const clock=await db('lab_clock_times').where({id:1}).first();
  if(!clock||JSON.parse(String(clock.data_json)).confirmed!==true)throw new Error('Confirm college period timings before generating a draft');
  const campus=await db('lab_term_saturday').where({term_id:termId}).first();
  const campusSaturday=campus && Number(campus.confirmed)===1? Number(campus.campus_periods):0;
  const offerings=await db('semester_offerings as so')
    .join('academic_sections as s','s.offering_id','so.id')
    .leftJoin('lab_semester_saturday as sat','sat.offering_id','so.id')
    .leftJoin('semester_period_policies as pol','pol.offering_id','so.id')
    .where('so.term_id',termId).where('so.active',1).where('s.active',1)
    .select('s.id','s.code','so.semester_number','sat.periods as sat_override','pol.mode as policy_mode','pol.allowed_periods_json');
  const sections=offerings.map(s=>({id:String(s.id),label:`Semester ${s.semester_number}-${s.code}`,
    semesterNumber:Number(s.semester_number),code:String(s.code).toUpperCase(),
    allowedPeriods:readPolicyRow(s.policy_mode?{mode:s.policy_mode,allowed_periods_json:s.allowed_periods_json}:null).allowedPeriods,
    saturdayPeriods:Math.max(0,Math.min(campusSaturday,s.sat_override===null||s.sat_override===undefined?campusSaturday:Number(s.sat_override)))}))
    .sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
  const facultyRows=await db('faculty').where({active:1}).select('id','name','workload_target').orderBy('id');
  const faculty=facultyRows.map(f=>({id:String(f.id),name:String(f.name),target:Number(f.workload_target)}));
  const aRows=await db('section_subject_allocations as a')
    .join('academic_sections as sec','sec.id','a.section_id')
    .join('semester_offerings as so','so.id','sec.offering_id')
    .join('term_subjects as sub','sub.id','a.subject_id')
    .leftJoin('faculty as fac','fac.id','a.faculty_id')
    .where('so.term_id',termId).where('sub.term_id',termId)
    .where('so.active',1).where('sec.active',1).where('a.active',1).where('sub.active',1)
    .select('a.id','a.section_id','a.faculty_id','a.weekly_hours','sub.name as subject','sub.code as subject_code','sub.kind','fac.active as faculty_active')
    .orderBy('a.id');
  const allocations=aRows.map(a=>({id:String(a.id),sectionId:String(a.section_id),facultyId:a.faculty_id?String(a.faculty_id):null,
    subject:String(a.subject),subjectCode:String(a.subject_code||''),kind:String(a.kind),hours:Number(a.weekly_hours),facultyActive:Number(a.faculty_active)===1}));
  const labs=await db('lab_bookings as b')
    .leftJoin('section_subject_allocations as a','a.id','b.allocation_id')
    .where('b.term_id',termId).where('b.active',1).where('b.mode','Weekly')
    .select('b.*','a.faculty_id as assigned_faculty_id')
    .orderBy('b.id');
  const fixed:FixedPeriod[]=labs.map(l=>({id:`lab-${l.id}::${l.allocation_id||''}`,title:`${l.booking_type} lab ${l.id}`,
    day:Number(l.weekday),start:Number(l.start_period),count:2,
    sectionIds:l.section_id?[String(l.section_id)]:[],
    facultyId:l.allocation_id?(l.assigned_faculty_id?String(l.assigned_faculty_id):null):(l.faculty_id?String(l.faculty_id):null),
    labId:String(l.lab_id)}));
  const activities=await db('schedule_activities')
    .where({term_id:termId,active:1,mode:'Weekly'}).select().orderBy('id');
  const part=activities.length?await db('schedule_activity_sections').whereIn('activity_id',activities.map(a=>a.id)).select():[];
  for(const e of activities) fixed.push({id:`activity-${e.id}`,title:String(e.title),day:Number(e.weekday),start:Number(e.start_period),count:Number(e.period_count),
    sectionIds:part.filter(p=>p.activity_id===e.id).map(p=>String(p.section_id)).sort(),
    facultyId:e.faculty_id?String(e.faculty_id):null,labId:e.lab_id?String(e.lab_id):null});
  fixed.sort((a,b)=>a.id.localeCompare(b.id));
  const datedActivities=await db('schedule_activities')
    .where({term_id:termId,active:1,mode:'Dated'}).select().orderBy('id');
  const datedPart=datedActivities.length?await db('schedule_activity_sections').whereIn('activity_id',datedActivities.map(a=>a.id)).select():[];
  // Keep date-only sessions from colliding with proposed weekly theory.
  // This version reserves the matching weekday slot every week, intentionally conservative.
  const dateBlocks:FixedPeriod[]=datedActivities.map(e=>({id:`dated-${e.id}`,title:String(e.title),
    day:Number(e.weekday),start:Number(e.start_period),count:Number(e.period_count),
    sectionIds:datedPart.filter(p=>p.activity_id===e.id).map(p=>String(p.section_id)).sort(),
    facultyId:e.faculty_id?String(e.faculty_id):null,labId:null,bookingDate:e.booking_date?String(e.booking_date):null}));
  return {sections,faculty,allocations,fixed,dateBlocks,clockSignature:String(clock.data_json)};
}
export function theoryFingerprint(input:TheoryInput):string{
  return createHash('sha256').update(JSON.stringify({version:GENERATOR_VERSION,input})).digest('hex');
}
export async function getCurrentTheoryDraft(db:Knex,termId:string):Promise<{slots:TheorySlot[];fingerprint:string;stale:boolean;createdAt:string;runId:string}|null>{
  if(!(await db.schema.hasTable('theory_draft_runs')))return null;
  const row=await db('theory_draft_runs').where({term_id:termId,active:1}).first();
  if(!row)return null;
  const plan=JSON.parse(String(row.plan_json)) as TheoryPlan;
  return {runId:String(row.id),slots:plan.slots,fingerprint:String(row.fingerprint),stale:theoryFingerprint(await loadTheoryInput(db,termId))!==String(row.fingerprint),createdAt:String(row.created_at)};
}
export function registerTheoryGeneratorHandlers(db:Knex):void{
  protectedHandle('theory:preview',async (_event,raw:unknown)=>{
    const termId=uuid.parse(raw);
    const input=await loadTheoryInput(db,termId);
    const plan=generateTheory(input);
    assertTheorySlots(input,plan.slots);
    const current=await getCurrentTheoryDraft(db,termId);
    return {fingerprint:theoryFingerprint(input),plan,sections:input.sections,currentDraft:current?{createdAt:current.createdAt,stale:current.stale,count:current.slots.length}:null};
  });
  protectedHandle('theory:saveDraft',async (_event,raw:unknown)=>{
    const {termId,fingerprint:expected}=saveInput.parse(raw);
    return db.transaction(async trx=>{
      const input=await loadTheoryInput(trx,termId);
      const actual=theoryFingerprint(input);
      if(expected!==actual)throw new Error('Scheduling data changed after preview. Refresh the generator before saving.');
      const plan=generateTheory(input);assertTheorySlots(input,plan.slots);assertLanguageOneComplete(input,plan.slots);
      if(!plan.slots.length)throw new Error('No theory periods could be placed. Correct the allocations before saving a draft.');
      // Preserve every previous draft; one active draft per term.
      await trx('theory_draft_runs').where({term_id:termId,active:1}).update({active:0});
      const id=randomUUID();
      await trx('theory_draft_runs').insert({id,term_id:termId,fingerprint:actual,plan_json:JSON.stringify(plan),active:1});
      return {id,placed:plan.slots.length,unplaced:plan.unplaced.reduce((n,x)=>n+x.remaining,0),status:'Draft only — not HOD approved or published'};
    });
  });
}
