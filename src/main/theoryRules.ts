/** Pure theory generator: atomic active-section Language 1 groups, faculty/section collision checks. */
import { assertLanguageOneSynchronization, isLanguageOne, requireLanguageOneGroups } from './languageOneRules.ts';
export type FixedPeriod = {id:string;title:string;day:number;start:number;count:number;sectionIds:string[];facultyId:string|null;labId:string|null;bookingDate?:string|null};
export type TeachingAllocation = {id:string;sectionId:string;facultyId:string|null;subject:string;subjectCode?:string;kind:string;hours:number;facultyActive:boolean};
export type TheorySection = {id:string;label:string;saturdayPeriods:number;semesterNumber?:number;code?:string;allowedPeriods?:number[]};
export type TheoryFaculty = {id:string;name:string;target:number};
export type TheorySlot = {allocationId:string;sectionId:string;facultyId:string;subject:string;day:number;period:number;languageOne?:boolean};
export type UnplacedTheory = {allocationId:string;sectionId:string;facultyId:string|null;subject:string;kind:string;remaining:number;reason:string};
export type TheoryInput = {sections:TheorySection[];faculty:TheoryFaculty[];allocations:TeachingAllocation[];fixed:FixedPeriod[];dateBlocks:FixedPeriod[];clockSignature:string};
export type TheoryPlan = {slots:TheorySlot[];unplaced:UnplacedTheory[];warnings:string[];workload:{facultyId:string;name:string;target:number;assigned:number;scheduled:number;byDay:number[];overTarget:number}[]};
export const GENERATOR_VERSION = '2K1-SEMESTER-PERIOD-POLICY-v1';
const TEACHABLE = new Set(['Theory','Language']);
export function eventsOverlap(a:FixedPeriod,b:FixedPeriod):boolean {return a.day===b.day&&a.start<b.start+b.count&&b.start<a.start+a.count;}
export function conflictingFixedEvents(fixed:FixedPeriod[]):string[]{
 const conflicts:string[]=[];
 for(let i=0;i<fixed.length;i++)for(let j=i+1;j<fixed.length;j++){
  const a=fixed[i],b=fixed[j];if(!eventsOverlap(a,b))continue;
  const section=a.sectionIds.some(id=>b.sectionIds.includes(id));
  const faculty=!!(a.facultyId&&a.facultyId===b.facultyId);
  const lab=!!(a.labId&&a.labId===b.labId);
  if(section||faculty||lab)conflicts.push(`${a.title} / ${b.title} on day ${a.day+1}: ${[section?'section':'',faculty?'faculty':'',lab?'lab':''].filter(Boolean).join(', ')}`);
 }
 return conflicts;
}
const key=(id:string,day:number,p:number)=>`${id}|${day}|${p}`;
function generateAttempt(input:TheoryInput,variation:number):TheoryPlan {
 const sections = new Map(input.sections.map(s=>[s.id,s]));
 const faculty = new Map(input.faculty.map(f=>[f.id,f]));
 const groups = requireLanguageOneGroups(input);
 const occupiedSection=new Set<string>(),occupiedFaculty=new Set<string>();
 const sectionDay=new Map<string,number>(),facultyDay=new Map<string,number>(),subjectDay=new Map<string,number>();
 const slots:TheorySlot[]=[],unplaced:UnplacedTheory[]=[],warnings:string[]=[];
 const bump=(map:Map<string,number>,id:string,day:number)=>map.set(key(id,day,0),(map.get(key(id,day,0))||0)+1);
 for(const f of input.fixed){for(let p=f.start;p<f.start+f.count;p++){
  for(const sid of f.sectionIds){occupiedSection.add(key(sid,f.day,p));}
  if(f.facultyId)occupiedFaculty.add(key(f.facultyId,f.day,p));
 }
 for(const sid of f.sectionIds)for(let p=0;p<f.count;p++)bump(sectionDay,sid,f.day);
 if(f.facultyId)for(let p=0;p<f.count;p++)bump(facultyDay,f.facultyId,f.day);
 }
 // Dated events are treated as weekly reservations, as in the existing planner.
 for(const f of input.dateBlocks)for(let p=f.start;p<f.start+f.count;p++){
  for(const sid of f.sectionIds){occupiedSection.add(key(sid,f.day,p));}
  if(f.facultyId)occupiedFaculty.add(key(f.facultyId,f.day,p));
 }
 type Pending=TeachingAllocation&{left:number};
 const pending:Pending[]=input.allocations.filter(a=>TEACHABLE.has(a.kind)).map(a=>({...a,left:a.hours}));
 // Faculty and section identity must be present; classrooms are not tracked.
 for(const a of pending){
  if(!sections.has(a.sectionId)||!a.facultyId||!faculty.has(a.facultyId)||!a.facultyActive){
   unplaced.push({allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId,subject:a.subject,kind:a.kind,remaining:a.hours,reason:!a.facultyId?'Faculty unassigned':'Faculty or section inactive/missing'});
   a.left=0;
  }
 }
 const free=(a:Pending,day:number,period:number)=>{
  const section=sections.get(a.sectionId)!;
  if(period>(day===5?section.saturdayPeriods:6)||!(section.allowedPeriods??[1,2,3,4,5,6]).includes(period))return false;
  return !occupiedSection.has(key(a.sectionId,day,period))&&!occupiedFaculty.has(key(a.facultyId!,day,period));
 };
 const add=(a:Pending,day:number,period:number)=>{
  slots.push({allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId!,subject:a.subject,day,period,languageOne:isLanguageOne(a.subject,a.subjectCode)});
  occupiedSection.add(key(a.sectionId,day,period));occupiedFaculty.add(key(a.facultyId!,day,period));
  bump(sectionDay,a.sectionId,day);bump(facultyDay,a.facultyId!,day);
  subjectDay.set(key(a.id,day,0),(subjectDay.get(key(a.id,day,0))||0)+1);
  a.left--;
 };
 const score=(a:Pending,day:number,period:number)=>
   (subjectDay.get(key(a.id,day,0))||0)*15+(facultyDay.get(key(a.facultyId!,day,0))||0)*3
   +(sectionDay.get(key(a.sectionId,day,0))||0)*1.8+(day===5?2.5:0)
   +(((day*7+period*5+variation*11)%13)/100);
 // Lock active-section language session atomically BEFORE allocating other theory subjects.
 for(const group of groups){
  const members=group.allocations.map(a=>pending.find(x=>x.id===a.id)!);
  for(let i=0;i<group.hours;i++){
   const possible:{day:number;period:number;score:number}[]=[];
   for(let day=0;day<6;day++)for(let period=1;period<=6;period++){
    if(members.every(a=>free(a,day,period)))possible.push({day,period,score:members.reduce((n,a)=>n+score(a,day,period),0)});
   }
   possible.sort((a,b)=>a.score-b.score||a.day-b.day||a.period-b.period);
   if(!possible.length)break;
   for(const a of members)add(a,possible[0].day,possible[0].period);
  }
  if(members[0].left>0){
   for(const a of members){
    unplaced.push({allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId,subject:a.subject,kind:a.kind,remaining:a.left,reason:`No common free section/faculty period for active sections ${group.sections.map(s=>s.code||s.label).join(', ')}`});
    a.left=0;
   }
  }
 }
 // Other allocations cannot displace the Language 1 reserved active-section group.
 const groupAllocationIds=new Set(groups.flatMap(g=>g.allocations.map(a=>a.id)));
 const ordinary=pending.filter(a=>!groupAllocationIds.has(a.id));
 while(ordinary.some(a=>a.left>0)){
  const choices=ordinary.filter(a=>a.left>0).map(a=>{
   const possible:{day:number;period:number;score:number}[]=[];
   for(let day=0;day<6;day++)for(let period=1;period<=6;period++)if(free(a,day,period))possible.push({day,period,score:score(a,day,period)});
   possible.sort((x,y)=>x.score-y.score||x.day-y.day||x.period-y.period);
   return {a,possible};
  });
  choices.sort((x,y)=>(x.possible.length/x.a.left)-(y.possible.length/y.a.left)||y.a.left-x.a.left||x.a.id.localeCompare(y.a.id));
  const choice=choices[0];
  if(!choice.possible.length){unplaced.push({allocationId:choice.a.id,sectionId:choice.a.sectionId,facultyId:choice.a.facultyId,subject:choice.a.subject,kind:choice.a.kind,remaining:choice.a.left,reason:'No free section/faculty period'});choice.a.left=0;continue;}
  add(choice.a,choice.possible[0].day,choice.possible[0].period);
 }
 for(const a of input.allocations.filter(a=>!TEACHABLE.has(a.kind))){
  const placed=a.kind==='Lab'?input.fixed.filter(f=>f.id.startsWith('lab-')&&f.sectionIds.includes(a.sectionId)&&f.id.split('::')[1]===a.id).reduce((n,f)=>n+f.count,0):0;
  const remaining=Math.max(0,a.hours-placed);
  if(remaining)unplaced.push({allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId,subject:a.subject,kind:a.kind,remaining,reason:a.kind==='Lab'?'Requires manual two-period practical booking':'Requires manual scheduling'});
 }
 const workload=input.faculty.map(f=>{
  const assigned=input.allocations.filter(a=>a.facultyId===f.id).reduce((n,a)=>n+a.hours,0);
  const fixed=input.fixed.filter(a=>a.facultyId===f.id).reduce((n,a)=>n+a.count,0);
  const generated=slots.filter(x=>x.facultyId===f.id).length;
  const byDay=Array.from({length:6},(_,day)=>facultyDay.get(key(f.id,day,0))||0);
  return {facultyId:f.id,name:f.name,target:f.target,assigned,scheduled:fixed+generated,byDay,overTarget:Math.max(0,assigned-f.target)};
 });
 for(const f of workload)if(f.overTarget)warnings.push(`${f.name}: ${f.assigned} assigned vs ${f.target} target (+${f.overTarget}). Review faculty workload.`);
 if(input.dateBlocks.length)warnings.push('Dated activities conservatively reserve their weekday slots throughout the draft.');
 if(unplaced.length)warnings.push(`${unplaced.reduce((n,a)=>n+a.remaining,0)} allocated teaching periods remain unplaced.`);
 return {slots,unplaced,warnings,workload};
}
export function generateTheory(input:TheoryInput):TheoryPlan {
 const groups=requireLanguageOneGroups(input);
 const fixedConflicts=conflictingFixedEvents(input.fixed);
 if(fixedConflicts.length)throw new Error(`Resolve existing timetable conflicts: ${fixedConflicts.slice(0,3).join('; ')}`);
 let best:TheoryPlan|null=null,bestScore=-Infinity;
 for(let v=0;v<24;v++){
  const result=generateAttempt(input,v);
  assertTheorySlots(input,result.slots);
  assertLanguageOneSynchronization(groups,result.slots,false);
  const missingLanguage=groups.reduce((n,g)=>n+g.allocations.reduce((m,a)=>m+Math.max(0,a.hours-result.slots.filter(s=>s.allocationId===a.id).length),0),0);
  const distribution=result.workload.reduce((n,f)=>{const total=f.byDay.reduce((a,b)=>a+b,0);return n+f.byDay.reduce((a,b)=>a+(b-total/6)**2,0);},0);
  const score=-missingLanguage*1e7+result.slots.length*1e4-distribution;
  if(score>bestScore){best=result;bestScore=score;}
 }
 return best!;
}
export function assertTheorySlots(input:TheoryInput,slots:TheorySlot[]):void {
 const allocations=new Map(input.allocations.map(a=>[a.id,a]));
 const sections=new Map(input.sections.map(s=>[s.id,s]));
 const sectionBusy=new Set<string>(),facultyBusy=new Set<string>();
 for(const s of slots){
  const a=allocations.get(s.allocationId),sec=sections.get(s.sectionId);
  if(!a||!sec||!TEACHABLE.has(a.kind)||a.sectionId!==s.sectionId||a.facultyId!==s.facultyId||!a.facultyActive)throw new Error('Invalid saved theory allocation or section');
  if(!Number.isInteger(s.day)||s.day<0||s.day>5||!Number.isInteger(s.period)||s.period<1||s.period>(s.day===5?sec.saturdayPeriods:6)||!(sec.allowedPeriods??[1,2,3,4,5,6]).includes(s.period))throw new Error('Theory period outside confirmed college working hours');
  if(sectionBusy.has(key(s.sectionId,s.day,s.period))||facultyBusy.has(key(s.facultyId,s.day,s.period)))throw new Error('Theory has a faculty or section clash');
  if([...input.fixed,...input.dateBlocks].some(f=>s.day===f.day&&s.period>=f.start&&s.period<f.start+f.count&&(
   f.sectionIds.includes(s.sectionId)||f.facultyId===s.facultyId)))throw new Error('Theory overlaps an existing class or activity');
  sectionBusy.add(key(s.sectionId,s.day,s.period));facultyBusy.add(key(s.facultyId,s.day,s.period));
 }
 for(const a of input.allocations.filter(a=>TEACHABLE.has(a.kind)))if(slots.filter(s=>s.allocationId===a.id).length>a.hours)throw new Error('Draft exceeds allocated weekly subject hours');
 assertLanguageOneSynchronization(requireLanguageOneGroups(input),slots,false);
}
export function assertLanguageOneComplete(input:TheoryInput,slots:TheorySlot[]):void {
 assertLanguageOneSynchronization(requireLanguageOneGroups(input),slots,true);
}
