import React, {useEffect, useMemo, useState} from 'react';

type Term={id:string;academic_year:string;cycle:string;is_current:number};
type Slot={allocationId:string;sectionId:string;facultyId:string;subject:string;day:number;period:number;languageOne?:boolean};
type Unplaced={allocationId:string;sectionId:string;subject:string;kind:string;facultyId:string|null;remaining:number;reason:string};
type Workload={facultyId:string;name:string;target:number;assigned:number;scheduled:number;byDay:number[];overTarget:number};
type Preview={fingerprint:string;sections:{id:string;label:string;saturdayPeriods:number;allowedPeriods?:number[]}[];plan:{slots:Slot[];unplaced:Unplaced[];warnings:string[];workload:Workload[]};currentDraft:{createdAt:string;stale:boolean;count:number}|null};
type Api={academic:{listTerms():Promise<Term[]>};theory:{preview(termId:string):Promise<Preview>;saveDraft(termId:string,fingerprint:string):Promise<{placed:number;unplaced:number;status:string}>}};
const api=(window as unknown as {electronAPI?:Api}).electronAPI;
const days=['Mon','Tue','Wed','Thu','Fri','Sat'];
const inputStyle:React.CSSProperties={padding:'9px 12px',border:'1px solid #bed0ca',borderRadius:6,background:'white'};
const cell:React.CSSProperties={padding:9,border:'1px solid #dae5e1',textAlign:'left',verticalAlign:'top',fontSize:13};
export default function TheoryGenerator(){
 const [terms,setTerms]=useState<Term[]>([]);const [term,setTerm]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);const [section,setSection]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{if(!api){setError('Requires the desktop Electron application');return;}api.academic.listTerms().then(rows=>{setTerms(rows);setTerm(rows.find(t=>Number(t.is_current)===1)?.id||rows[0]?.id||'');}).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!term||!api)return;let cancelled=false;setBusy(true);setPreview(null);setError('');
  api.theory.preview(term).then(p=>{if(!cancelled)setPreview(p);}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};
 },[term,revision]);
 useEffect(()=>{if(preview&&!preview.sections.some(x=>x.id===section))setSection(preview.sections[0]?.id||'');},[preview,section]);
 const slots=useMemo(()=>preview?.plan.slots.filter(x=>x.sectionId===section)||[],[preview,section]);
 const sectionPolicy=preview?.sections.find(s=>s.id===section);
 const remaining=preview?.plan.unplaced.reduce((a,b)=>a+b.remaining,0)||0;
 const warnings=preview?.plan.warnings||[];
 async function save(){if(!api||!preview||!term)return;setBusy(true);setError('');setNotice('');try{const result=await api.theory.saveDraft(term,preview.fingerprint);setNotice(`Saved ${result.placed} theory periods as a DRAFT; ${result.unplaced} remain unplaced. Not approved or published.`);setRevision(x=>x+1);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <main style={{maxWidth:1450,margin:'0 auto',padding:'36px 40px',fontFamily:'system-ui,sans-serif',color:'#173e36'}}>
  <h1>BCA — Automatic Theory Timetable (Draft)</h1>
  <p>Creates proposed weekly periods for <strong>Theory and Language</strong> allocations. Existing laboratories and recurring activities remain fixed. Faculty assignments are never changed automatically.</p>
  <section style={{padding:20,border:'1px solid #cbdad5',borderRadius:10,background:'#f5faf8',display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
   <label>Academic term <select value={term} style={{...inputStyle,marginLeft:10}} onChange={e=>{setNotice('');setTerm(e.target.value);}}>{terms.map(t=><option value={t.id} key={t.id}>{t.academic_year} — {t.cycle}{Number(t.is_current)===1?' (Current)':''}</option>)}</select></label>
   <button style={inputStyle} disabled={busy} onClick={()=>setRevision(x=>x+1)}>Recalculate preview</button>
   <strong style={{fontSize:13}}>Only an explicitly saved draft appears in Master Timetable.</strong>
  </section>
  <p style={{background:'#fff4db',padding:12,borderRadius:7}}><strong>Language 1 rule:</strong> Only active Sections A, B and/or C participate. If two or three are active, Language 1 must have equal weekly hours and matching time slots, with a different assigned faculty for each. If only one is active, Language 1 is scheduled normally. Inactive sections are never required. Rooms are not tracked. Existing labs, activities and Saturday limits remain reserved. Use the subject label “Language 1” or “Lang 1”, or catalogue code L1/LANG1 for recognition.</p>
  {busy&&<p>Validating constraints and calculating available slots…</p>}
  {error&&<p role="alert" style={{padding:13,background:'#fff0ee',color:'#9d231b'}}>{error}</p>}
  {notice&&<p role="status" style={{padding:13,background:'#eaf8ef',color:'#155f34'}}>{notice}</p>}
  {preview&&<>
   <section style={{marginTop:22,border:'1px solid #ccdcd6',borderRadius:10,padding:20}}>
    <h2 style={{marginTop:0}}>Draft review</h2>
    <p><strong>{preview.plan.slots.length} proposed theory periods</strong> · {remaining} teaching periods not placed · {warnings.length} warnings</p>
    {preview.currentDraft&&<p>Current saved draft: {preview.currentDraft.count} periods · {preview.currentDraft.stale?'STALE — source records changed':'Source records unchanged'} · created {preview.currentDraft.createdAt}</p>}
    <p style={{fontSize:13}}>An over-target faculty load is reported, not reassigned. Saturdays are excluded unless the campus and semester policy are confirmed. Lab, internship, project and other practical hours are not automatically placed.</p>
    <label>Preview section <select style={{...inputStyle,marginLeft:10}} value={section} onChange={e=>setSection(e.target.value)}>{preview.sections.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <div style={{overflowX:'auto',marginTop:16}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr><th style={cell}>Day</th>{[1,2,3,4,5,6].map(p=><th style={cell} key={p}>P{p}</th>)}</tr></thead><tbody>{days.map((day,d)=><tr key={d}><th style={cell}>{day}</th>{[1,2,3,4,5,6].map(p=>{const blocked=!!sectionPolicy&&(!(sectionPolicy.allowedPeriods??[1,2,3,4,5,6]).includes(p)||(d===5&&p>sectionPolicy.saturdayPeriods));return <td style={{...cell,background:blocked?'#ebeeee':slots.some(s=>s.day===d&&s.period===p)?'#e2f1eb':'white'}} key={p}>{blocked?<span style={{fontSize:11,color:'#7a8683'}}>Outside semester schedule</span>:null}{slots.filter(s=>s.day===d&&s.period===p).map(s=><span key={s.allocationId} style={(s.languageOne===true||/\b(?:language|lang)[\s_-]*0?1\b/i.test(s.subject))?{display:'block',background:'#fff0ad',padding:4,borderLeft:'3px solid #ba8500',fontWeight:800}:{}}>{s.subject}</span>)}</td>})}</tr>)}</tbody></table></div>
    <p style={{fontSize:12,color:'#62746e'}}>This grid shows proposed theory only. Existing lab and activity periods are reserved but not drawn here; use Master Timetable for the combined view after saving.</p>
   </section>
   <section style={{marginTop:20,border:'1px solid #ccdcd6',borderRadius:10,padding:20}}>
    <h2 style={{marginTop:0}}>Faculty period load (weekly)</h2>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Faculty','Target','Allocated','Scheduled in draft','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{preview.plan.workload.map(f=><tr key={f.facultyId}><td style={cell}>{f.name}</td><td style={cell}>{f.target}</td><td style={cell}>{f.assigned}{f.overTarget?` (+${f.overTarget})`:''}</td><td style={cell}>{f.scheduled}</td>{f.byDay.map((x,i)=><td style={cell} key={i}>{x}</td>)}</tr>)}</tbody></table></div>
    <p style={{fontSize:12}}>“Allocated” is based on subject assignments. “Scheduled” includes recurring labs and activities plus proposed theory periods; it is not an official payroll or contact-hour calculation.</p>
   </section>
   <section style={{marginTop:20,border:'1px solid #ccdcd6',borderRadius:10,padding:20}}>
    <h2 style={{marginTop:0}}>Warnings and unplaced hours</h2>
    {warnings.length?<ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>:<p>No planner warnings for the current input.</p>}
    {preview.plan.unplaced.length>0&&<div style={{maxHeight:300,overflowY:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Subject','Type','Remaining','Reason'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{preview.plan.unplaced.map(u=><tr key={u.allocationId}><td style={cell}>{u.subject}</td><td style={cell}>{u.kind}</td><td style={cell}>{u.remaining}</td><td style={cell}>{u.reason}</td></tr>)}</tbody></table></div>}
   </section>
   <section style={{marginTop:20,padding:18,border:'2px solid #a6c1b6',borderRadius:10}}>
    <h2 style={{marginTop:0}}>Save a new draft version</h2>
    <p>This preserves previous draft versions and updates the current draft view. It does <strong>not</strong> publish or approve a timetable. If allocations or bookings changed since preview, saving is rejected.</p>
    <button style={{...inputStyle,background:'#e7f1ed',fontWeight:700}} disabled={busy||!preview.plan.slots.length} onClick={save}>Save generated draft for Master Timetable</button>
   </section>
  </>}
 </main>;
}
