/** Phase 2K1: pure period policy and display diagnostics. No database or Electron. */
export type SemesterScheduleMode = 'Morning Only' | 'Full Day' | 'Custom Timing';
export type SemesterPeriodPolicy = { mode: SemesterScheduleMode; allowedPeriods: number[] };
export type ScheduleEvent = {
 id:string; source:'Lab'|'Activity'|'Theory'; title:string;
 weekday:number; startPeriod:number; periodCount:number;
 sectionIds:string[]; facultyId:string|null; labId:string|null; languageOne?:boolean;
};
export type ScheduleIssue = { code:'SECTION'|'FACULTY'|'LAB'|'OUTSIDE_HOURS'|'LANGUAGE_1'; eventIds:string[]; message:string; day:number; period:number };
export type ScheduleSection = {id:string;label:string;semesterNumber:number;code:string;allowedPeriods:number[];saturdayPeriods:number};
const FULL = [1,2,3,4,5,6];
export function normalizedPolicy(mode:SemesterScheduleMode, proposed:number[]):SemesterPeriodPolicy {
 if(!['Morning Only','Full Day','Custom Timing'].includes(mode))throw new Error('Choose a valid semester working schedule');
 if(!Array.isArray(proposed)||proposed.some(n=>!Number.isInteger(n)||n<1||n>6)||new Set(proposed).size!==proposed.length)
  throw new Error('Custom periods must be unique numbers P1–P6');
 const allowedPeriods=mode==='Morning Only'?[1,2,3]:mode==='Full Day'?[...FULL]:[...proposed].sort((a,b)=>a-b);
 if(!allowedPeriods.length)throw new Error('Select at least one teaching period in Custom Timing');
 return {mode,allowedPeriods};
}
export function assertPeriodsAllowed(policy:SemesterPeriodPolicy,day:number,start:number,count:number,saturdayMax:number,label:string):void {
 if(!Number.isInteger(day)||day<0||day>5||!Number.isInteger(start)||!Number.isInteger(count)||count<1||start<1||start+count-1>6)
  throw new Error(`${label}: invalid weekday or period range`);
 if(start<=3&&start+count-1>=4)throw new Error(`${label}: a multi-period session cannot cross the P3/P4 lunch break`);
 for(let p=start;p<start+count;p++){
  if(!policy.allowedPeriods.includes(p)||day===5&&p>saturdayMax)
   throw new Error(`${label}: P${p} on ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day]} is outside this semester's allowed periods`);
 }
}
export function inspectTimetable(events:ScheduleEvent[], sections:ScheduleSection[]):ScheduleIssue[] {
 const issues:ScheduleIssue[]=[];const byId=new Map(sections.map(s=>[s.id,s]));
 for(const e of events){
  for(const sid of e.sectionIds){const sec=byId.get(sid);if(!sec)continue;
   try{assertPeriodsAllowed({mode:'Custom Timing',allowedPeriods:sec.allowedPeriods},e.weekday,e.startPeriod,e.periodCount,sec.saturdayPeriods,sec.label)}
   catch(err){issues.push({code:'OUTSIDE_HOURS',eventIds:[e.id],day:e.weekday,period:e.startPeriod,message:`${e.title} (${sec.label}): ${err instanceof Error?err.message:String(err)}`});}
  }
 }
 for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){
  const a=events[i],b=events[j];if(a.weekday!==b.weekday||a.startPeriod>=b.startPeriod+b.periodCount||b.startPeriod>=a.startPeriod+a.periodCount)continue;
  const base={eventIds:[a.id,b.id],day:a.weekday,period:Math.max(a.startPeriod,b.startPeriod)};
  if(a.sectionIds.some(id=>b.sectionIds.includes(id)))issues.push({...base,code:'SECTION',message:`${a.title} and ${b.title} overlap the same class section`});
  if(a.facultyId&&a.facultyId===b.facultyId)issues.push({...base,code:'FACULTY',message:`${a.title} and ${b.title} require the same faculty simultaneously`});
  if(a.labId&&a.labId===b.labId)issues.push({...base,code:'LAB',message:`${a.title} and ${b.title} use the same laboratory simultaneously`});
 }
 // Language 1 is synchronized among the ACTIVE A/B/C sections of each semester.
 // A standalone A/B/C section does not require other sections to be created or activated.
 const groups=new Map<number,ScheduleSection[]>();
 for(const s of sections)if(['A','B','C'].includes(s.code.toUpperCase()))groups.set(s.semesterNumber,[...(groups.get(s.semesterNumber)||[]),s]);
 for(const [semester,members] of groups){if(members.length<2)continue;
  const memberIds=new Set(members.map(s=>s.id));
  const lang=events.filter(e=>(e.languageOne===true||/\b(?:language|lang)[\s_-]*0?1\b/i.test(e.title))&&e.sectionIds.some(id=>memberIds.has(id)));
  // Evaluate occupied Language 1 slots by section; only where at least one Language 1 period exists.
  const keys=new Set(lang.flatMap(e=>Array.from({length:e.periodCount},(_,i)=>`${e.weekday}|${e.startPeriod+i}`)));
  for(const k of keys){const [day,period]=k.split('|').map(Number);
   const present=new Set(lang.filter(e=>e.weekday===day&&e.startPeriod<=period&&e.startPeriod+e.periodCount>period).flatMap(e=>e.sectionIds));
   const missing=members.filter(s=>!present.has(s.id));if(missing.length){
    const eventIds=lang.filter(e=>e.weekday===day&&e.startPeriod<=period&&e.startPeriod+e.periodCount>period).map(e=>e.id);
    issues.push({code:'LANGUAGE_1',eventIds,day,period,message:`Semester ${semester} Language 1 is not synchronized: missing ${missing.map(s=>s.code).join(', ')} at P${period}`});
   }
  }
 }
 return issues;
}
