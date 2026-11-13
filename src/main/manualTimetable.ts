/** Manual UNAPPROVED theory-draft editor. No writes to labs, activities, allocations, approved snapshots or userData files. */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { protectedHandle } from './coordinatorAuth.ts';
import { loadTheoryInput, theoryFingerprint, getCurrentTheoryDraft } from './theoryGenerator.ts';
import { checkManualDraft, editSummary } from './manualTimetableRules.ts';
import type { TheoryPlan,TheorySlot,TheoryInput } from './theoryRules.ts';

const uuid=z.string().uuid();
const slotSchema=z.object({allocationId:uuid,sectionId:uuid,facultyId:uuid,subject:z.string().min(1).max(160),day:z.number().int().min(0).max(5),period:z.number().int().min(1).max(6),languageOne:z.boolean().optional()}).strict();
const editSchema=z.object({termId:uuid,expectedRunId:uuid,expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/),slots:z.array(slotSchema).max(1200),reason:z.string().trim().min(5).max(300)}).strict();
const restoreSchema=z.object({termId:uuid,expectedRunId:uuid,sourceRunId:uuid,reason:z.string().trim().min(5).max(300)}).strict();

export async function ensureManualEditSchema(db:Knex):Promise<void>{
 if(!(await db.schema.hasTable('manual_timetable_edits')))await db.schema.createTable('manual_timetable_edits',t=>{
  t.string('id',36).primary();t.string('term_id',36).notNullable();
  t.string('previous_run_id',36).notNullable();t.string('new_run_id',36).notNullable();
  t.text('reason').notNullable();t.integer('added').notNullable();t.integer('removed').notNullable();
  t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
  t.index(['term_id','created_at']);
 });
}
async function currentRun(db:Knex,termId:string){
 const row=await db('theory_draft_runs').where({term_id:termId,active:1}).first();
 if(!row)throw new Error('Save a theory draft from Theory Generator before editing it manually.');
 return row;
}
async function loadEditor(db:Knex,termId:string){
 const input=await loadTheoryInput(db,termId);
 const current=await currentRun(db,termId);
 const expected=theoryFingerprint(input);
 if(String(current.fingerprint)!==expected)throw new Error('This theory draft is stale because faculty, allocations, labs, activities or working hours changed. Generate and save a fresh theory draft first.');
 const slots=(JSON.parse(String(current.plan_json)) as TheoryPlan).slots;
 return {input,current,expected,slots};
}
function revisedPlan(input:TheoryInput,slots:TheorySlot[],oldPlan:TheoryPlan):TheoryPlan {
 const unplaced= input.allocations.flatMap(a=>{
  if(!['Theory','Language'].includes(a.kind))return oldPlan.unplaced.filter(x=>x.allocationId===a.id);
  const remaining=Math.max(0,a.hours-slots.filter(s=>s.allocationId===a.id).length);
  return remaining?[{allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId,subject:a.subject,kind:a.kind,remaining,reason:'Pending manual placement'}]:[];
 });
 const workload=input.faculty.map(f=>{
  const assigned=input.allocations.filter(a=>a.facultyId===f.id).reduce((n,a)=>n+a.hours,0);
  const fixed=input.fixed.filter(x=>x.facultyId===f.id).reduce((n,x)=>n+x.count,0);
  const weekly=slots.filter(s=>s.facultyId===f.id);
  const byDay=Array.from({length:6},(_,d)=>fixedDay(input,f.id,d)+weekly.filter(s=>s.day===d).length);
  return {facultyId:f.id,name:f.name,target:f.target,assigned,scheduled:fixed+weekly.length,byDay,overTarget:Math.max(0,assigned-f.target)};
 });
 return {slots,unplaced,workload,warnings:[`Manually revised theory draft. ${unplaced.reduce((n,a)=>n+a.remaining,0)} teaching hours remain unplaced. Review before HOD approval.`]};
}
function fixedDay(input:TheoryInput,facultyId:string,day:number){return input.fixed.filter(f=>f.facultyId===facultyId&&f.day===day).reduce((n,f)=>n+f.count,0);}
async function commit(db:Knex,data:z.infer<typeof editSchema>){
 return db.transaction(async trx=>{
  const {input,current,expected}=await loadEditor(trx,data.termId);
  if(current.id!==data.expectedRunId||expected!==data.expectedFingerprint)throw new Error('Another edit or scheduling change has occurred. Reload the editor and try again.');
  const result=checkManualDraft(input,data.slots);
  if(!result.valid)throw new Error('Manual changes contain conflicts. Resolve them before saving: '+result.issues.slice(0,3).map(x=>x.message).join('; '));
  const previous=JSON.parse(String(current.plan_json)) as TheoryPlan;
  const delta=editSummary(previous.slots,data.slots);
  if(!delta.changed)throw new Error('No changes were detected.');
  const id=randomUUID();
  const plan=revisedPlan(input,data.slots,previous);
  await trx('theory_draft_runs').where({id:current.id,term_id:data.termId,active:1}).update({active:0});
  await trx('theory_draft_runs').insert({id,term_id:data.termId,fingerprint:expected,plan_json:JSON.stringify(plan),active:1});
  await trx('manual_timetable_edits').insert({id:randomUUID(),term_id:data.termId,previous_run_id:current.id,new_run_id:id,reason:data.reason,added:delta.added,removed:delta.removed});
  return {runId:id,changed:delta.changed,unplacedTheory:result.unplacedTheory,status:'Saved as unapproved draft; earlier versions and approvals remain unchanged.'};
 });
}
export function registerManualTimetableHandlers(db:Knex):void{
 protectedHandle('manual:load',async (_e,raw:unknown)=>{
  const termId=uuid.parse(raw);const {input,current,expected,slots}=await loadEditor(db,termId);
  const draft=await getCurrentTheoryDraft(db,termId);
  return {termId,runId:String(current.id),fingerprint:expected,sections:input.sections,faculty:input.faculty,
    allocations:input.allocations.filter(a=>['Theory','Language'].includes(a.kind)),fixed:[...input.fixed,...input.dateBlocks],slots,
    validation:checkManualDraft(input,slots),createdAt:draft?.createdAt};
 });
 protectedHandle('manual:validate',async (_e,raw:unknown)=>{
  const data=editSchema.parse(raw);const {input,current,expected}=await loadEditor(db,data.termId);
  if(current.id!==data.expectedRunId||expected!==data.expectedFingerprint)throw new Error('Draft changed in another window. Reload before editing.');
  return checkManualDraft(input,data.slots);
 });
 protectedHandle('manual:save',async (_e,raw:unknown)=>commit(db,editSchema.parse(raw)));
 protectedHandle('manual:history',async (_e,raw:unknown)=>{
  const termId=uuid.parse(raw);
  return db('manual_timetable_edits').where({term_id:termId}).select('id','previous_run_id','new_run_id','reason','added','removed','created_at').orderBy('created_at','desc').orderBy('id','desc').limit(25);
 });
 protectedHandle('manual:restore',async (_e,raw:unknown)=>{
  const data=restoreSchema.parse(raw);
  const source=await db('theory_draft_runs').where({id:data.sourceRunId,term_id:data.termId}).first();
  if(!source)throw new Error('Historical draft not found in the selected academic term.');
  const slots=(JSON.parse(String(source.plan_json)) as TheoryPlan).slots;
  const {expected}=await loadEditor(db,data.termId);
  // If a historical draft was generated under different allocations, validation will reject it.
  return commit(db,{termId:data.termId,expectedRunId:data.expectedRunId,expectedFingerprint:expected,slots,reason:data.reason});
 });
}
