import React, {useEffect,useMemo,useRef,useState} from 'react';
import { Link, useLocation } from 'react-router-dom';

type Term={id:string;academic_year:string;cycle:string;is_current:number};
type Slot={allocationId:string;sectionId:string;facultyId:string;subject:string;day:number;period:number;languageOne?:boolean};
type Allocation={id:string;sectionId:string;facultyId:string|null;subject:string;kind:string;hours:number;facultyActive:boolean;subjectCode?:string};
type Fixed={id:string;title:string;day:number;start:number;count:number;sectionIds:string[];facultyId:string|null;labId:string|null};
type Issue={code:string;message:string;day:number;period:number;eventIds:string[]};
type Validation={valid:boolean;issues:Issue[];placed:number;unplacedTheory:number};
type Draft={termId:string;runId:string;fingerprint:string;sections:{id:string;label:string;code?:string;semesterNumber?:number;allowedPeriods?:number[];saturdayPeriods:number}[];
 faculty:{id:string;name:string}[];allocations:Allocation[];fixed:Fixed[];slots:Slot[];validation:Validation;createdAt?:string};
type History={id:string;previous_run_id:string;new_run_id:string;reason:string;added:number;removed:number;created_at:string};
type Api={academic:{listTerms():Promise<Term[]>};manual:{load(termId:string):Promise<Draft>;validate(data:unknown):Promise<Validation>;save(data:unknown):Promise<{runId:string;changed:number;status:string}>;history(termId:string):Promise<History[]>;restore(data:unknown):Promise<{runId:string;changed:number;status:string}>}};
const api=(window as unknown as {electronAPI?:Api}).electronAPI;
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const control:React.CSSProperties={padding:'8px 10px',border:'1px solid #a7c0b8',borderRadius:6,background:'#fff',maxWidth:'100%'};
const button:React.CSSProperties={...control,cursor:'pointer',fontWeight:600,color:'#175b4e'};
const tableCell:React.CSSProperties={border:'1px solid #d7e2dd',padding:'8px',minWidth:145,verticalAlign:'top'};
const exact=(s:Slot)=>`${s.allocationId}|${s.day}|${s.period}`;
const copy=(s:Slot[])=>s.map(x=>({...x}));
export default function ManualTimetable(){
 const loc=useLocation();
 const initialTerm=new URLSearchParams(loc.search).get('term')||'';
 const [terms,setTerms]=useState<Term[]>([]),[term,setTerm]=useState(initialTerm),[draft,setDraft]=useState<Draft|null>(null);
 const [section,setSection]=useState(''),[allocation,setAllocation]=useState('');
 const [slots,setSlots]=useState<Slot[]>([]),[undos,setUndos]=useState<Slot[][]>([]),[chosen,setChosen]=useState<number|null>(null);
 const [validation,setValidation]=useState<Validation|null>(null),[history,setHistory]=useState<History[]>([]);
 const [reason,setReason]=useState('Manual timetable adjustment'),[notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
 const revision=useRef(0);
 useEffect(()=>{if(!api){setError('The manual editor requires the Electron application.');return;}
  api.academic.listTerms().then(rows=>{setTerms(rows);setTerm(t=>t||rows.find(x=>Number(x.is_current)===1)?.id||rows[0]?.id||'')}).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!api||!term)return;let cancelled=false;
  setBusy(true);setError('');setNotice('');setDraft(null);setValidation(null);setSlots([]);setUndos([]);setChosen(null);
  Promise.all([api.manual.load(term),api.manual.history(term)]).then(([d,h])=>{if(cancelled)return;
    setDraft(d);setSlots(copy(d.slots));setValidation(d.validation);setHistory(h);setSection(s=>d.sections.some(x=>x.id===s)?s:d.sections[0]?.id||'');
  }).catch(e=>{if(!cancelled)setError(String(e))}).finally(()=>{if(!cancelled)setBusy(false)});
  return()=>{cancelled=true;};
 },[term]);
 useEffect(()=>{if(!draft||!api)return;let cancelled=false;const myRev=++revision.current;
  setValidation(null);
  api.manual.validate({termId:draft.termId,expectedRunId:draft.runId,expectedFingerprint:draft.fingerprint,slots,reason}).then(v=>{
    if(!cancelled&&myRev===revision.current)setValidation(v);
  }).catch(e=>{if(!cancelled&&myRev===revision.current){setValidation(null);setError(String(e))}});
  return()=>{cancelled=true};
 },[draft,slots]);
 const sectionAllocations=useMemo(()=>draft?.allocations.filter(a=>a.sectionId===section)||[],[draft,section]);
 useEffect(()=>{if(!sectionAllocations.some(a=>a.id===allocation))setAllocation(sectionAllocations[0]?.id||'');},[sectionAllocations,allocation]);
 const sectionSlots=useMemo(()=>slots.map((s,i)=>({...s,i})).filter(s=>s.sectionId===section),[slots,section]);
 const fixed=useMemo(()=>draft?.fixed.filter(f=>f.sectionIds.includes(section))||[],[draft,section]);
 const hasChanges=useMemo(()=>draft?JSON.stringify([...slots].sort((a,b)=>exact(a).localeCompare(exact(b))))!==JSON.stringify([...draft.slots].sort((a,b)=>exact(a).localeCompare(exact(b)))):false,[draft,slots]);
 const selectedSection=draft?.sections.find(s=>s.id===section);
 const apply=(next:Slot[])=>{setUndos(prev=>[...prev.slice(-39),copy(slots)]);setSlots(next);setError('');setNotice('');};
 const clickSlot=(index:number)=>{setChosen(index);setNotice('Selected a theory slot. Click another cell to move it, or choose Remove selected.');};
 const clickCell=(day:number,period:number)=>{
  if(!draft)return;
  const policy=selectedSection;
  if(!policy||!(policy.allowedPeriods||[1,2,3,4,5,6]).includes(period)||day===5&&period>policy.saturdayPeriods){setNotice('This period is closed for the selected semester. Change its schedule only in Academic Setup.');return;}
  if(chosen!==null){const old=slots[chosen];if(!old){setChosen(null);return;}
   if(old.sectionId!==section){setNotice('Move a slot within its section. Select the source again after switching sections.');return;}
   if(old.day===day&&old.period===period){setChosen(null);return;}
   // A Language 1 session is one atomic cross-section timetable commitment.
   // Move matching A/B/C sessions of this semester together, never leave a half-shifted pair.
   const sourceSection=draft.sections.find(s=>s.id===old.sectionId);
   const isGrouped=old.languageOne===true&&!!sourceSection&&['A','B','C'].includes((sourceSection.code||'').toUpperCase());
   const match=(x:Slot,i:number)=>{
    if(i===chosen)return true;
    if(!isGrouped||x.languageOne!==true||x.day!==old.day||x.period!==old.period)return false;
    const peer=draft.sections.find(s=>s.id===x.sectionId);
    return !!peer&&peer.semesterNumber===sourceSection?.semesterNumber&&['A','B','C'].includes((peer.code||'').toUpperCase());
   };
   apply(slots.map((x,i)=>match(x,i)?{...x,day,period}:x));setChosen(null);return;
  }
  const a=sectionAllocations.find(a=>a.id===allocation);
  if(!a){setNotice('Choose a theory or Language 1 allocation from the dropdown before adding a class.');return;}
  if(!a.facultyId||!a.facultyActive){setNotice('This subject has no active faculty assignment. Correct it in Subjects & Workload first.');return;}
  const slot:Slot={allocationId:a.id,sectionId:a.sectionId,facultyId:a.facultyId,subject:a.subject,day,period,languageOne:/\b(?:language|lang)[\s_-]*0?1\b/i.test(a.subject)||/^(?:L1|LANG1|LANGUAGE1)$/i.test(a.subjectCode||'')};
  apply([...slots,slot]);
 };
 const remove=()=>{if(chosen===null||!slots[chosen])return;if(!window.confirm('Remove this theory period from the working draft? You can undo before saving.'))return;
  apply(slots.filter((_,i)=>i!==chosen));setChosen(null);};
 const undo=()=>{if(!undos.length)return;setSlots(undos[undos.length-1]);setUndos(p=>p.slice(0,-1));setChosen(null);};
 const reset=()=>{if(!draft||!window.confirm('Discard all UNSAVED manual changes?'))return;setSlots(copy(draft.slots));setUndos([]);setChosen(null);};
 const save=async()=>{if(!api||!draft||!hasChanges||!validation?.valid||saving)return;
  setSaving(true);setError('');try{
   await api.manual.save({termId:term,expectedRunId:draft.runId,expectedFingerprint:draft.fingerprint,slots,reason});
   const [d,h]=await Promise.all([api.manual.load(term),api.manual.history(term)]);
   setDraft(d);setSlots(copy(d.slots));setHistory(h);setUndos([]);setChosen(null);setNotice('Saved a NEW unapproved theory draft. Previous versions and HOD reviews were preserved.');
  }catch(e){setError(String(e))}finally{setSaving(false)};
 };
 const restore=async(runId:string)=>{if(!api||!draft||saving)return;
  if(hasChanges){setNotice('Save or discard unsaved edits before restoring a prior draft.');return;}
  if(!window.confirm('Create a NEW draft from this earlier version? Existing approval snapshots will NOT be changed.'))return;
  setSaving(true);setError('');try{await api.manual.restore({termId:term,expectedRunId:draft.runId,sourceRunId:runId,reason:'Restored previous editable theory version'});
   const [d,h]=await Promise.all([api.manual.load(term),api.manual.history(term)]);
   setDraft(d);setSlots(copy(d.slots));setHistory(h);setUndos([]);setChosen(null);setNotice('Earlier theory arrangement was restored into a NEW unapproved draft.');
  }catch(e){setError(String(e))}finally{setSaving(false)};
 };
 const clock=[1,2,3,4,5,6];
 const valid=validation?.valid===true;
 const issueAt=(day:number,period:number)=>validation?.issues.some(x=>x.day===day&&x.period===period)||false;
 return <main style={{maxWidth:1520,margin:'0 auto',padding:'30px 36px',color:'#213b36',fontFamily:'system-ui,sans-serif'}}>
  <h1>Manual Timetable Editor <span style={{fontSize:14,color:'#71817c'}}>— Unapproved theory draft</span></h1>
  <p>This editor moves, adds or removes <b>theory and Language 1</b> periods. Existing laboratory bookings, certifications, activities and HOD-approved versions are <b>read-only and protected</b>. Faculty assignments are controlled in <Link to="/subjects">Subjects &amp; Workload</Link>.</p>
  <div style={{padding:14,background:'#eef5f1',border:'1px solid #c9dcd5',borderRadius:8,display:'flex',flexWrap:'wrap',gap:12,alignItems:'end'}}>
   <label>Academic term<div><select style={control} value={term} onChange={e=>setTerm(e.target.value)}>{terms.map(t=><option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}</option>)}</select></div></label>
   <label>Class section<div><select style={control} value={section} onChange={e=>{setSection(e.target.value);setChosen(null)}}>{draft?.sections.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></div></label>
   <label>Add subject (faculty comes from allocation)<div><select style={{...control,maxWidth:330}} value={allocation} onChange={e=>setAllocation(e.target.value)}>{sectionAllocations.map(a=><option key={a.id} value={a.id}>{a.subject} — {draft?.faculty.find(f=>f.id===a.facultyId)?.name||'UNASSIGNED'}</option>)}</select></div></label>
   <Link to={`/master`} style={{...button,textDecoration:'none'}}>Back to Master Timetable</Link>
  </div>
  {busy&&<p>Loading current timetable draft…</p>}
  {error&&<p role="alert" style={{border:'1px solid #b92c2c',background:'#fff0ed',padding:10,color:'#97211d'}}>{error}</p>}
  {notice&&<p role="status" style={{background:'#e7f5eb',padding:10,borderRadius:6}}>{notice}</p>}
  {draft&&<>
   <p style={{fontSize:13,color:'#516961'}}>Current draft: {draft.runId} · Edit permissions: theory and language only. Click an existing subject to select it, then another cell to move it. Linked Language 1 sections move together. Click an empty cell to add the selected allocation.</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'14px 0'}}>
    <button style={button} onClick={undo} disabled={!undos.length}>Undo ({undos.length})</button>
    <button style={button} onClick={remove} disabled={chosen===null}>Remove selected</button>
    <button style={button} onClick={reset} disabled={!hasChanges}>Discard unsaved changes</button>
    <button style={button} onClick={()=>{if(!draft)return;setValidation(null);api?.manual.validate({termId:term,expectedRunId:draft.runId,expectedFingerprint:draft.fingerprint,slots,reason}).then(setValidation).catch(e=>setError(String(e)))}}>Validate Timetable</button>
    <Link to="/publication" style={{...button,textDecoration:'none'}}>HOD Review &amp; Publishing</Link>
   </div>
   <div role="status" style={{padding:10,background:validation===null?'#f3f3f3':valid?'#e4f4eb':'#fff0ed',borderRadius:7,margin:'12px 0'}}>
    <b>{validation===null?'Checking clashes…':valid?'No hard conflicts detected':`${validation.issues.length} conflict(s) — saving blocked`}</b>
    {validation&&<span> · {validation.placed} theory periods · {validation.unplacedTheory} unplaced theory periods</span>}
    {!!validation?.issues.length&&<ul style={{marginBottom:0}}>{validation.issues.slice(0,12).map((x,i)=><li key={i}>{x.message}</li>)}</ul>}
   </div>
   <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}><thead><tr><th style={tableCell}>Day</th>{clock.map(p=><th key={p} style={tableCell}>P{p}</th>)}</tr></thead><tbody>{dayNames.map((d,day)=><tr key={d}><th style={tableCell}>{d}</th>{clock.map(period=>{
    const outside=!(selectedSection?.allowedPeriods||clock).includes(period)||(day===5&&period>(selectedSection?.saturdayPeriods||0));
    const locked=fixed.filter(x=>x.day===day&&x.start<=period&&period<x.start+x.count);
    const here=sectionSlots.filter(x=>x.day===day&&x.period===period);
    const bad=issueAt(day,period);
    return <td key={period} style={{...tableCell,background:bad?'#ffdcd6':outside?'#e9edeb':locked.length?'#e4edf1':'#fff',outline:bad?'2px solid #b92c2c':undefined}}>
     {locked.map(f=><div key={f.id} style={{padding:5,background:'#dee9ed',borderRadius:4,marginBottom:5}}><strong>{f.title}</strong><div style={{fontSize:11}}>Booked · cannot modify here</div></div>)}
     {here.map(s=><button key={s.i} type="button" onClick={()=>clickSlot(s.i)} style={{width:'100%',textAlign:'left',marginBottom:5,padding:7,background:s.languageOne?'#fff0b0':'#e9f3ec',border:chosen===s.i?'2px solid #175b4e':'1px solid #b7c6bc',borderRadius:5,cursor:'pointer'}}><b>{s.subject}</b><div style={{fontSize:11}}>{draft.faculty.find(f=>f.id===s.facultyId)?.name||'Unknown faculty'}</div>{s.languageOne&&<div style={{fontSize:10,color:'#795000'}}>Synchronized Language 1</div>}</button>)}
     {!outside&&<button type="button" style={{fontSize:11,background:'transparent',border:'1px dashed #a4bcb2',borderRadius:4,padding:6,width:'100%',cursor:'pointer'}} onClick={()=>clickCell(day,period)}>{chosen!==null?'Move here':here.length?'Add another (validate first)':'＋ Add period'}</button>}
     {outside&&<span style={{color:'#75847f',fontSize:11}}>Closed</span>}
    </td>;})}</tr>)}</tbody></table></div>
   <section style={{border:'1px solid #ccdcd6',borderRadius:8,padding:16,marginTop:18}}><h2 style={{marginTop:0,fontSize:18}}>Save manual changes</h2>
    <p>Saving creates another version of the theory draft. Previously saved versions and HOD approval snapshots are never rewritten.</p>
    <label>Reason for modification<div><input style={{...control,width:'min(600px,100%)'}} value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></div></label>
    <button type="button" style={{...button,marginTop:12,background:valid&&hasChanges?'#175b4e':'#b4c3bd',color:'#fff'}} disabled={!valid||!hasChanges||saving||reason.trim().length<5} onClick={()=>void save()}>{saving?'Saving…':'Save Changes as New Draft'}</button>
    {!hasChanges&&<p style={{fontSize:12,color:'#657972'}}>No unsaved modifications.</p>}
   </section>
   <section style={{marginTop:24,border:'1px solid #d3e0db',borderRadius:8,padding:16}}><h2 style={{fontSize:18,marginTop:0}}>Manual modification history</h2>
    {history.length===0?<p>No manual edits saved for this term yet.</p>:<table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}><thead><tr><th align="left">Recorded at</th><th align="left">Reason</th><th>Added</th><th>Removed</th><th>Restore older draft</th></tr></thead><tbody>{history.map(h=><tr key={h.id}><td style={tableCell}>{h.created_at}</td><td style={tableCell}>{h.reason}</td><td style={tableCell}>{h.added}</td><td style={tableCell}>{h.removed}</td><td style={tableCell}><button type="button" style={button} disabled={saving||hasChanges} onClick={()=>void restore(h.previous_run_id)}>Restore previous</button></td></tr>)}</tbody></table>}
    <p style={{fontSize:12,color:'#526963'}}>Restore creates a new unapproved draft. It does not roll back approval history or change previously published versions.</p>
   </section>
  </>}
  {!busy&&!draft&&<p>Generate and save an initial timetable in <Link to="/theory-generator">Theory Generator</Link>, then return here for manual editing.</p>}
 </main>;
}
