import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Term={id:string;academic_year:string;cycle:string;is_current:number};
type Evidence={id:string;channel:'Printed'|'Digital';name:string;sha256:string};
type Version={id:string;termId:string;version:number;status:'REVIEW'|'APPROVED'|'PUBLISHED';hash:string;coordinator:string;remarks:string;createdAt:string;approvedAt:string|null;publishedAt:string|null;evidence:Evidence[]};
type Details=Version & {blockers:string[];sections:{id:string;label:string}[];faculty:{id:string;name:string}[];labs:{id:string;code:string}[];datedCount:number;audit:{hodName:string;approvalDate:string;channel:string;reference:string}|null};
type Api={academic:{listTerms():Promise<Term[]>};publication:{list(termId:string):Promise<Version[]>;createReview(input:{termId:string;coordinator:string;remarks:string}):Promise<unknown>;inspect(id:string):Promise<Details>;attachEvidence(id:string,channel:'Printed'|'Digital'):Promise<{cancelled:boolean}>;approve(input:{versionId:string;hodName:string;approvalDate:string;channel:'Printed'|'Digital'|'Both';reference:string;syllabusChecked:true;labHoursChecked:true;saturdayChecked:true}):Promise<unknown>;publish(id:string):Promise<unknown>;export(input:{versionId:string;scope:'Department'|'Section'|'Faculty'|'Laboratory';resourceId?:string;format:'PDF'|'XLSX'}):Promise<{cancelled:boolean;filePath?:string;status?:string}>}};
const api=(window as unknown as {electronAPI?:Api}).electronAPI;
const field:React.CSSProperties={padding:'9px 10px',border:'1px solid #b8cac5',borderRadius:7,background:'#fff',width:'100%',boxSizing:'border-box'};
const panel:React.CSSProperties={border:'1px solid #d6e5df',borderRadius:10,padding:22,marginTop:20};
const label:React.CSSProperties={display:'block',fontSize:13,fontWeight:600,marginBottom:5};
const action:React.CSSProperties={background:'#e4eeeb',color:'#124438',padding:'10px 15px',border:'1px solid #b6c8c2',borderRadius:7,cursor:'pointer'};
const ok=(val:unknown)=>Number(val)===1;
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const today=()=>new Date().toISOString().slice(0,10);
export default function TimetablePublication(){
 const [terms,setTerms]=useState<Term[]>([]);const [termId,setTermId]=useState('');
 const [versions,setVersions]=useState<Version[]>([]);const [versionId,setVersionId]=useState('');const [details,setDetails]=useState<Details|null>(null);
 const [coordinator,setCoordinator]=useState('');const [remarks,setRemarks]=useState('');
 const [hodName,setHodName]=useState('');const [approvalDate,setApprovalDate]=useState(today());const [channel,setChannel]=useState<'Printed'|'Digital'|'Both'>('Both');const [reference,setReference]=useState('');
 const [checks,setChecks]=useState({syllabus:false,lab:false,saturday:false});
 const [scope,setScope]=useState<'Department'|'Section'|'Faculty'|'Laboratory'>('Department');const [resource,setResource]=useState('');const [format,setFormat]=useState<'PDF'|'XLSX'>('PDF');
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
 const refresh=useCallback(async(t:string,prefer?:string)=>{if(!api)return;const list=await api.publication.list(t);setVersions(list);setVersionId(prefer&&list.some(v=>v.id===prefer)?prefer:old=>list.some(v=>v.id===old)?old:(list[0]?.id||''));},[]);
 useEffect(()=>{if(!api){setError('Use this page in the Electron desktop application.');return;}api.academic.listTerms().then(rows=>{setTerms(rows);setTermId(rows.find(x=>ok(x.is_current))?.id||rows[0]?.id||'');}).catch(e=>setError(err(e)));},[]);
 useEffect(()=>{if(!termId)return;void refresh(termId).catch(e=>setError(err(e)));},[termId,refresh]);
 useEffect(()=>{if(!api||!versionId){setDetails(null);return;}let alive=true;api.publication.inspect(versionId).then(d=>{if(alive)setDetails(d);}).catch(e=>{if(alive)setError(err(e));});return()=>{alive=false;};},[versionId,versions]);
 const choices=useMemo(()=>!details?[]:scope==='Section'?details.sections.map(x=>({id:x.id,label:x.label})):scope==='Faculty'?details.faculty.map(x=>({id:x.id,label:x.name})):scope==='Laboratory'?details.labs.map(x=>({id:x.id,label:x.code})):[],[scope,details]);
 useEffect(()=>{if(!choices.some(c=>c.id===resource))setResource(choices[0]?.id||'');},[choices,resource]);
 async function doAction(work:()=>Promise<unknown>,success:string){setBusy(true);setError('');setMessage('');try{const result=await work();if(result&&typeof result==='object'&&'cancelled' in result&&(result as {cancelled:boolean}).cancelled){setMessage('Selection cancelled; no changes made.');return;}setMessage(success);if(termId)await refresh(termId);}catch(e){setError(err(e));}finally{setBusy(false);}}
 const canApprove=!!details&&details.status==='REVIEW'&&details.blockers.length===0&&checks.syllabus&&checks.lab&&checks.saturday&&Boolean(hodName.trim())&&Boolean(reference.trim());
 const evidence=details?.evidence||[];
 return <main style={{maxWidth:1450,margin:'0 auto',padding:'34px 42px',fontFamily:'system-ui,sans-serif',color:'#23423b'}}>
  <h1 style={{marginTop:0}}>BCA — HOD Review & Timetable Exports</h1>
  <p>This is a <strong>coordinator-operated, offline</strong> approval register. The HOD signs printed documents or sends approval externally; recording it here is not a verified electronic signature.</p>
  {error&&<div role="alert" style={{color:'#961c1c',background:'#fff0ee',padding:14,borderRadius:7,marginBottom:16}}>{error}</div>}
  {message&&<div role="status" style={{background:'#e7f5ed',color:'#186043',padding:14,borderRadius:7,marginBottom:16}}>{message}</div>}
  <section style={panel}><h2 style={{marginTop:0}}>1. Select academic term and capture a review version</h2>
   <label style={label}>Academic term</label><select style={{...field,maxWidth:400}} value={termId} onChange={e=>{setTermId(e.target.value);setVersionId('');setDetails(null);}}>{terms.map(t=><option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}{ok(t.is_current)?' (Current)':''}</option>)}</select>
   <p style={{color:'#65766f',fontSize:13}}>Capturing a review version freezes the master timetable, dated exceptions and college branding. It does not approve or publish anything.</p>
   <div style={{display:'grid',gridTemplateColumns:'minmax(200px,1fr) minmax(200px,2fr)',gap:16}}><div><label style={label}>Coordinator name</label><input style={field} value={coordinator} onChange={e=>setCoordinator(e.target.value)} placeholder="Timetable Coordinator"/></div><div><label style={label}>Review notes (optional)</label><input style={field} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Draft changes and details for HOD"/></div></div>
   <button style={{...action,marginTop:14}} disabled={busy||!termId||coordinator.trim().length<2} onClick={()=>void doAction(async()=>{const r=await api!.publication.createReview({termId,coordinator,remarks}) as {id:string};await refresh(termId,r.id);return r;},'New frozen REVIEW version created. Export its DRAFT PDF/Excel for the HOD.')}>Capture new review version</button>
  </section>
  <section style={panel}><h2 style={{marginTop:0}}>2. Select review / approved version</h2>
   <select style={{...field,maxWidth:570}} value={versionId} onChange={e=>setVersionId(e.target.value)}><option value="">Select a captured version</option>{versions.map(v=><option key={v.id} value={v.id}>Version {v.version} — {v.status} — {new Date(v.createdAt).toLocaleString()}</option>)}</select>
   {details&&<><p><strong>Version {details.version} — {details.status}</strong> · Captured by {details.coordinator}<br/><small>SHA-256: {details.hash}</small></p>
     <p>Schedule contains {details.sections.length} BCA sections, {details.faculty.length} active faculty, {details.labs.length} labs, and {details.datedCount} dated activities.</p>
     <h3>Approval blockers</h3>{details.blockers.length?<ul>{details.blockers.map((s,i)=><li key={i} style={{color:'#971e1e'}}>{s}</li>)}</ul>:<p style={{color:'#166647'}}>No machine-detected blockers. The coordinator must still verify full university syllabus coverage and Saturday policy.</p>}
    </>}
  </section>
  {details&&<section style={panel}><h2 style={{marginTop:0}}>3. Record printed / digital HOD approval</h2>
   {details.status!=='REVIEW' ? <p>Approval evidence is locked for this version. {details.audit?`HOD: ${details.audit.hodName}; reference: ${details.audit.reference}`:'Approval record unavailable.'}</p> : <>
    <p>Attach the signed printout scan and/or the email/WhatsApp approval image or PDF. These files are copied into the local application data folder and hashed.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button style={action} disabled={busy} onClick={()=>void doAction(()=>api!.publication.attachEvidence(details.id,'Printed'),'Printed evidence attached.')}>Attach signed printout / scan</button><button style={action} disabled={busy} onClick={()=>void doAction(()=>api!.publication.attachEvidence(details.id,'Digital'),'Digital approval evidence attached.')}>Attach digital approval</button></div>
    {evidence.length>0&&<ul>{evidence.map(e=><li key={e.id}>{e.channel}: {e.name}</li>)}</ul>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:14,marginTop:14}}>
      <div><label style={label}>HOD name</label><input style={field} value={hodName} onChange={e=>setHodName(e.target.value)}/></div>
      <div><label style={label}>Approval date</label><input type="date" style={field} value={approvalDate} onChange={e=>setApprovalDate(e.target.value)}/></div>
      <div><label style={label}>Evidence channel</label><select style={field} value={channel} onChange={e=>setChannel(e.target.value as typeof channel)}><option>Both</option><option>Printed</option><option>Digital</option></select></div>
      <div><label style={label}>HOD memo/email/approval reference</label><input style={field} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Real authorization reference"/></div>
    </div>
    <div style={{display:'grid',gap:9,marginTop:16}}><label><input type="checkbox" checked={checks.syllabus} onChange={e=>setChecks(c=>({...c,syllabus:e.target.checked}))}/> I checked all required syllabus subjects, languages and sections against the approved curriculum.</label>
    <label><input type="checkbox" checked={checks.lab} onChange={e=>setChecks(c=>({...c,lab:e.target.checked}))}/> I verified the correct lab hours and any approved exceptions.</label>
    <label><input type="checkbox" checked={checks.saturday} onChange={e=>setChecks(c=>({...c,saturday:e.target.checked}))}/> I verified this term's Saturday working hours and sections.</label></div>
    <button style={{...action,marginTop:15}} disabled={busy||!canApprove} onClick={()=>void doAction(()=>api!.publication.approve({versionId:details.id,hodName,approvalDate,channel,reference,syllabusChecked:true,labHoursChecked:true,saturdayChecked:true}),'HOD approval RECORDED by coordinator. Evidence and version are locked.')}>Record HOD approval (requires evidence and checks)</button>
   </>}
   {details.status==='APPROVED'&&<div style={{marginTop:16}}><button style={action} disabled={busy} onClick={()=>void doAction(()=>api!.publication.publish(details.id),'Approved version marked PUBLISHED. Official exports are available below.')}>Publish frozen approved version</button></div>}
  </section>}
  {details&&<section style={panel}><h2 style={{marginTop:0}}>4. Export branded timetable (PDF / Excel)</h2>
   <p>Exports always use the captured version, not a newly recalculated schedule. REVIEW versions are marked <strong>DRAFT — NOT APPROVED</strong>.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14}}>
    <div><label style={label}>View</label><select style={field} value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option>Department</option><option>Section</option><option>Faculty</option><option>Laboratory</option></select></div>
    {scope!=='Department'&&<div><label style={label}>Select {scope.toLowerCase()}</label><select style={field} value={resource} onChange={e=>setResource(e.target.value)}>{choices.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></div>}
    <div><label style={label}>Format</label><select style={field} value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="PDF">PDF (printable)</option><option value="XLSX">Excel workbook (.xlsx)</option></select></div>
   </div>
   <button style={{...action,marginTop:15}} disabled={busy||(scope!=='Department'&&!resource)} onClick={()=>void doAction(async()=>{const r=await api!.publication.export({versionId:details.id,scope,resourceId:scope==='Department'?undefined:resource,format});if(!r.cancelled)setMessage(`Saved ${r.status} ${format} to ${r.filePath}.`);return r;},'Export created.')}>Choose local destination and export</button>
   <p style={{fontSize:12,color:'#63786e'}}>The approval evidence is stored separately in the application data folder. Back up the database AND approval-evidence folder together.</p>
  </section>}
 </main>;
}
