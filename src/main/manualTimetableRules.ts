/** Phase 2K2 pure rules: manual editing of UNAPPROVED weekly theory draft slots only. */
import { assertLanguageOneComplete, assertTheorySlots, type TheoryInput, type TheorySlot } from './theoryRules.ts';
import { isLanguageOne } from './languageOneRules.ts';
import { inspectTimetable, type ScheduleEvent, type ScheduleIssue, type ScheduleSection } from './semesterScheduleRules.ts';

export type ManualIssue = {code:string;eventIds:string[];message:string;day:number;period:number};
export type ManualValidation = {valid:boolean;issues:ManualIssue[];placed:number;unplacedTheory:number};
export const manualSlotId=(s:TheorySlot,index:number)=>`manual-${index}-${s.allocationId}-${s.day}-${s.period}`;

export function checkManualDraft(input:TheoryInput,slots:TheorySlot[]):ManualValidation {
 const issues:ManualIssue[]=[];
 const allocations=new Map(input.allocations.map(a=>[a.id,a]));
 const sections=new Map(input.sections.map(s=>[s.id,s]));
 const faculty=new Set(input.faculty.map(f=>f.id));
 const counts=new Map<string,number>();
 const add=(code:string,message:string,day=0,period=0,eventIds:string[]=[])=>issues.push({code,message,day,period,eventIds});
 if(!Array.isArray(slots) || slots.length>1200){add('INVALID','Manual timetable exceeds the permitted slot count.');return {valid:false,issues,placed:0,unplacedTheory:0};}
 slots.forEach((s,i)=>{
  const a=allocations.get(s.allocationId),id=manualSlotId(s,i),section=sections.get(s.sectionId);
  if(!Number.isInteger(s.day)||s.day<0||s.day>5||!Number.isInteger(s.period)||s.period<1||s.period>6){add('PERIOD','Invalid weekday or period',s.day,s.period,[id]);return;}
  if(!a||!['Theory','Language'].includes(a.kind)||a.sectionId!==s.sectionId||!section||!a.facultyId||a.facultyId!==s.facultyId||!a.facultyActive||!faculty.has(s.facultyId)){
   add('ALLOCATION',`Invalid or inactive subject/faculty allocation for ${s.subject}`,s.day,s.period,[id]);return;
  }
  if(s.subject!==a.subject||s.languageOne===true!==isLanguageOne(a.subject,a.subjectCode)){
   add('SUBJECT',`Saved subject labels are inconsistent with allocation for ${a.subject}`,s.day,s.period,[id]);return;
  }
  counts.set(a.id,(counts.get(a.id)||0)+1);
  if(counts.get(a.id)!>a.hours)add('HOURS',`${a.subject} exceeds its weekly allocation of ${a.hours} hours`,s.day,s.period,[id]);
 });
 const display:ScheduleEvent[]=[];
 for(const f of [...input.fixed,...input.dateBlocks]){
  display.push({id:f.id,source:f.id.startsWith('lab-')?'Lab':'Activity',title:f.title,weekday:f.day,startPeriod:f.start,periodCount:f.count,sectionIds:f.sectionIds,facultyId:f.facultyId,labId:f.labId});
 }
 slots.forEach((s,i)=>display.push({id:manualSlotId(s,i),source:'Theory',title:s.subject,weekday:s.day,startPeriod:s.period,periodCount:1,sectionIds:[s.sectionId],facultyId:s.facultyId,labId:null,languageOne:s.languageOne===true}));
 const scheduleSections:ScheduleSection[]=input.sections.map(s=>({id:s.id,label:s.label,semesterNumber:s.semesterNumber||0,code:s.code||'',allowedPeriods:s.allowedPeriods||[1,2,3,4,5,6],saturdayPeriods:s.saturdayPeriods}));
 const found:ScheduleIssue[]=inspectTimetable(display,scheduleSections);
 for(const issue of found)add(issue.code,issue.message,issue.day,issue.period,issue.eventIds);
 if(!issues.length){
  try{assertTheorySlots(input,slots);assertLanguageOneComplete(input,slots);}catch(e){add('VALIDATION',e instanceof Error?e.message:String(e));}
 }
 let unplacedTheory=0;
 for(const a of input.allocations.filter(x=>['Theory','Language'].includes(x.kind))) unplacedTheory+=Math.max(0,a.hours-(counts.get(a.id)||0));
 return {valid:issues.length===0,issues,placed:slots.length,unplacedTheory};
}

export function editSummary(before:TheorySlot[],after:TheorySlot[]):{added:number;removed:number;changed:number} {
 const key=(s:TheorySlot)=>`${s.allocationId}|${s.day}|${s.period}`;
 const prev=new Set(before.map(key)),next=new Set(after.map(key));
 let added=0,removed=0;
 for(const s of next)if(!prev.has(s))added++;
 for(const s of prev)if(!next.has(s))removed++;
 return {added,removed,changed:added+removed};
}
