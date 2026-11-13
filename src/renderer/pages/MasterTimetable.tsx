import React, {useEffect, useMemo, useState} from 'react';
import { Link } from 'react-router-dom';
import { assignmentLabels } from './masterTimetableLabels';

type Term = {id:string;academic_year:string;cycle:string;is_current:number};
type Event = {id:string;source:'Lab'|'Activity'|'Theory';title:string;detail:string;mode:'Weekly'|'Dated';weekday:number;bookingDate:string|null;startPeriod:number;periodCount:number;sectionIds:string[];facultyId:string|null;labId:string|null;languageOne?:boolean};
type Snapshot = {
 term:{id:string;academicYear:string;cycle:string};date:string|null;
 sections:{id:string;label:string}[];faculty:{id:string;name:string;target:number}[];labs:{id:string;code:string}[];
 events:Event[];conflicts:string[];
 scheduleIssues?:{code:string;eventIds:string[];message:string;day:number;period:number}[];
 semesterSchedules?:{offeringId:string;semesterNumber:number;mode:string;allowedPeriods:number[];saturdayPeriods:number}[];
 unplaced:{allocationId:string;sectionId:string;subject:string;kind:string;facultyId:string|null;required:number;placed:number;remaining:number}[];
 clock:{confirmed:boolean;periods:{number:number;start:string;end:string}[]}|null;note:string;
};
type Api={academic:{listTerms():Promise<Term[]>};master:{snapshot(termId:string,date:string|null):Promise<Snapshot>}};
const api=(window as unknown as {electronAPI?:Api}).electronAPI;
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const inputStyle:React.CSSProperties={padding:'8px 10px',border:'1px solid #b8cac5',borderRadius:6,background:'#fff',maxWidth:'100%'};
const formLabel:React.CSSProperties={display:'block',fontWeight:600,fontSize:13,marginBottom:4};
const cell:React.CSSProperties={border:'1px solid #dce4e1',padding:8,verticalAlign:'top',minWidth:145};
const ok=(v:unknown)=>Number(v)===1;
const format=(s:string)=>s.replace(':',' : ');
export default function MasterTimetable(){
 const [terms,setTerms]=useState<Term[]>([]);
 const [termId,setTermId]=useState('');
 const [mode,setMode]=useState<'Weekly'|'Dated'>('Weekly');
 const [date,setDate]=useState('2026-11-03');
 const [scope,setScope]=useState<'Section'|'Faculty'|'Laboratory'>('Section');
 const [selected,setSelected]=useState('');
 const [snap,setSnap]=useState<Snapshot|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [rev,refresh]=useState(0);
 useEffect(()=>{
  if(!api){setError('This view requires the Electron desktop application');return;}
  api.academic.listTerms().then(rows=>{setTerms(rows);setTermId(t=>t||rows.find(x=>ok(x.is_current))?.id||rows[0]?.id||'');}).catch(e=>setError(String(e)));
 },[]);
 useEffect(()=>{
  if(!api||!termId)return;
  let cancelled=false;setBusy(true);setError('');
  api.master.snapshot(termId,mode==='Dated'?date:null).then(data=>{if(!cancelled)setSnap(data);}).catch(e=>{if(!cancelled){setError(String(e));setSnap(null);}}).finally(()=>{if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;};
 },[termId,mode,date,rev]);
 const choices=useMemo(()=>snap?(scope==='Section'?snap.sections:scope==='Faculty'?snap.faculty.map(f=>({id:f.id,label:f.name})):snap.labs.map(l=>({id:l.id,label:l.code}))):[],[snap,scope]);
 useEffect(()=>{if(!choices.some(x=>x.id===selected))setSelected(choices[0]?.id||'');},[choices,selected]);
 const filtered=useMemo(()=>snap?.events.filter(e=>scope==='Section'?e.sectionIds.includes(selected):scope==='Faculty'?e.facultyId===selected:e.labId===selected)||[],[snap,scope,selected]);
 const daysToShow=mode==='Weekly'?[0,1,2,3,4,5]:[snap?.events[0]?.weekday??(() =>{const d=new Date(`${date}T12:00:00Z`);return (d.getUTCDay()+6)%7;})()];
 const clock=snap?.clock?.periods||[1,2,3,4,5,6].map(number=>({number,start:'',end:''}));
 const selectedLabel=choices.find(item=>item.id===selected)?.label||'—';
 const selectedSemester=scope==='Section'?Number(/Semester (\d+)/.exec(selectedLabel)?.[1]||0):0;
 const selectedPolicy=snap?.semesterSchedules?.find(p=>p.semesterNumber===selectedSemester);
 const remaining=snap?.unplaced.filter(a=>a.remaining>0)||[];
 const scopeRemaining=remaining.filter(a=>scope==='Section'?a.sectionId===selected:scope==='Faculty'?a.facultyId===selected:true);
 return <main style={{maxWidth:1500,margin:'0 auto',padding:'36px 42px',color:'#213b36',fontFamily:'system-ui,sans-serif'}}>
  <h1>BCA — Combined Master Timetable (Draft)</h1>
  <p>This projection combines existing laboratory, activity, and saved theory draft periods. <strong>It is not a published or HOD-approved timetable.</strong></p>
  <div style={{border:'1px solid #b8cac5',borderRadius:10,padding:18,background:'#f6faf8',display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
   <div><label style={formLabel}>Academic term</label><select value={termId} style={inputStyle} onChange={e=>setTermId(e.target.value)}>{terms.map(t=><option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}{ok(t.is_current)?' (Current)':''}</option>)}</select></div>
   <div><label style={formLabel}>Schedule</label><select value={mode} style={inputStyle} onChange={e=>setMode(e.target.value as 'Weekly'|'Dated')}><option value="Weekly">Regular weekly</option><option value="Dated">Specific date (with suspensions)</option></select></div>
   {mode==='Dated'&&<div><label style={formLabel}>View date</label><input type="date" style={inputStyle} value={date} onChange={e=>setDate(e.target.value)}/></div>}
   <div><label style={formLabel}>View by</label><select style={inputStyle} value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option>Section</option><option>Faculty</option><option>Laboratory</option></select></div>
   <div><label style={formLabel}>{scope}</label><select style={inputStyle} value={selected} onChange={e=>setSelected(e.target.value)}>{choices.map(c=><option value={c.id} key={c.id}>{c.label}</option>)}</select></div>
   <button style={inputStyle} onClick={()=>refresh(x=>x+1)}>Refresh from database</button>
   <Link to={`/manual-timetable?term=${termId}`} style={{...inputStyle,background:"#175b4e",color:"white",fontWeight:700,textDecoration:"none"}}>Edit Timetable (Draft)</Link>
  </div>
  {busy&&<p>Reading timetable records…</p>}
  {error&&<p role="alert" style={{color:'#a11',background:'#fff2f0',padding:12}}>{error}</p>}
  {snap&&<>
   {!snap.clock?.confirmed&&<p role="alert" style={{color:'#a11'}}>College clock has not been confirmed. Verify timings under Shared Laboratories.</p>}
   <p style={{fontSize:12,color:'#526b64'}}>Semester-specific working periods are enforced for new bookings and generated theory. Classroom assignments are not currently tracked.</p>
   <p style={{marginTop:20}}>Displayed: <strong>{filtered.length}</strong> visible events for {scope.toLowerCase()} <strong>{selectedLabel}</strong>. Each cell shows the recorded class section and assigned faculty. Read-only projection; use Edit Timetable to create a new theory draft version.</p>
   <p style={{fontSize:12,fontWeight:700,color:'#815400'}}>Language 1 periods are highlighted in gold. Sections A/B/C in the same semester must share each Language 1 slot.</p>
   {(snap.scheduleIssues?.length??0)>0&&<div role="alert" style={{margin:'12px 0',background:'#fff0ed',border:'1px solid #c85b50',padding:12,borderRadius:6}}>
    <strong>{snap.scheduleIssues!.length} timetable conflict(s) detected. Affected cells are highlighted in red.</strong>
    <ul>{snap.scheduleIssues!.slice(0,10).map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>
   </div>}
   <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}><thead><tr><th style={cell}>Day</th>{clock.map(p=><th key={p.number} style={cell}>P{p.number}<div style={{fontSize:11,fontWeight:400}}>{p.start}–{p.end}</div></th>)}</tr></thead><tbody>{daysToShow.map(day=><tr key={day}><th style={cell}>{days[day]||'Sunday'}</th>{clock.map(p=>{const here=filtered.filter(e=>e.weekday===day&&e.startPeriod<=p.number&&e.startPeriod+e.periodCount>p.number);const bad=here.some(e=>snap.scheduleIssues?.some(issue=>issue.eventIds.includes(e.id)&&issue.day===day&&p.number>=e.startPeriod&&p.number<e.startPeriod+e.periodCount));const outside=!!selectedPolicy&&(!(selectedPolicy.allowedPeriods.includes(p.number))||(day===5&&p.number>selectedPolicy.saturdayPeriods));return <td key={p.number} title={bad?'Scheduling conflict — review warnings':outside?'Outside the selected semester working schedule':''} style={{...cell,background:bad?'#ffe1dc':outside?'#e9eeec':here.length?'#eaf2ef':'#fff',outline:bad?'2px solid #c84235':undefined}}>{here.length?here.map(e=>{const assigned=assignmentLabels(e,snap.sections,snap.faculty);const langOne=e.languageOne===true||/\b(?:language|lang)[\s_-]*0?1\b/i.test(e.title);return <div key={e.id} style={{marginBottom:7,...(langOne?{background:'#fff0b0',borderLeft:'4px solid #b98200',padding:5,borderRadius:3}:{})}}>
    <strong>{e.title}</strong>
    <div style={{fontSize:11,marginTop:4,color:assigned.missingSections?'#9b4a1c':'#204e43'}}><b>Class:</b> {assigned.sections}</div>
    <div style={{fontSize:11,marginTop:2,color:assigned.missingFaculty?'#9b4a1c':'#204e43'}}><b>Faculty:</b> {assigned.faculty}</div>
    <div style={{fontSize:11,color:'#5b6a66',marginTop:3}}>{e.detail}{e.periodCount>1?` · P${e.startPeriod}–P${e.startPeriod+e.periodCount-1}`:''}</div>
   </div>;}):<span style={{color:'#a7b2af'}}>{outside?'Closed':'—'}</span>}</td>;})}</tr>)}</tbody></table></div>
   {mode==='Dated'&&<p style={{color:'#5c6d67',fontSize:13}}>Dated view applies active certification suspensions. Weekly view always shows the recurring baseline.</p>}
   <section style={{border:'1px solid #d7e2df',borderRadius:10,padding:20,marginTop:24}}>
    <h2 style={{marginTop:0}}>Unplaced teaching hours (including manual lab requirements)</h2>
    <p>These are not free hours or assigned timetable periods. They still require scheduling or manual resolution.</p>
    <div style={{maxHeight:260,overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr><th align="left" style={cell}>Subject</th><th style={cell}>Category</th><th style={cell}>Required</th><th style={cell}>Placed weekly</th><th style={cell}>Remaining</th></tr></thead><tbody>{scopeRemaining.map(a=><tr key={a.allocationId}><td style={cell}>{a.subject}</td><td style={cell}>{a.kind}</td><td style={cell}>{a.required}</td><td style={cell}>{a.placed}</td><td style={cell}><strong>{a.remaining}</strong></td></tr>)}</tbody></table>{!scopeRemaining.length&&<p>No remaining active allocations for this selection.</p>}</div>
   </section>
   <section style={{border:'1px solid #d7e2df',borderRadius:10,padding:20,marginTop:20}}><h2 style={{marginTop:0}}>Potential booking collisions</h2>{snap.conflicts.length?<ul>{snap.conflicts.map((c,i)=><li key={i} style={{color:'#a11'}}>{c}</li>)}</ul>:<p>No collisions detected among the displayed weekly or dated booking records. Unplaced periods are not included.</p>}</section>
   <p style={{fontSize:12,color:'#6b7c76'}}>{snap.note}</p>
  </>}
 </main>;
}
