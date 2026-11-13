import React, { useEffect, useMemo, useState } from 'react';

type Toggle = number | boolean;
type Term = { id:string; academic_year:string; cycle:string; is_current:Toggle };
type Offering = { id:string; term_id:string; semester_number:number; active:Toggle };
type Section = { id:string; offering_id:string; code:string; active:Toggle; semester_number:number };
type Faculty = { id:string; name:string; active:Toggle };
type Laboratory = { id:string; code:string; name:string; active:Toggle };
type Mode = 'Weekly'|'Dated';
type Kind = 'Club'|'Sports'|'Certification';
type Activity = {
  id:string; term_id:string; kind:Kind; title:string; organizer:string; notes:string;
  mode:Mode; weekday:number; booking_date:string|null; start_period:number; period_count:number;
  section_ids:string[]; section_labels:string[]; faculty_id:string|null; lab_id:string|null;
  faculty_name:string|null; lab_code:string|null; active:Toggle;
};
type ActivityInput = { id?:string; termId:string; kind:Kind; title:string; organizer:string; notes:string;
  mode:Mode; weekday:number; dates:string[]; startPeriod:number; periodCount:number;
  sectionIds:string[]; facultyId:string|null; labId:string|null;
  suspendConflictingBcaLabs?:boolean;hodInstructionReference?:string;hodInstructionChannel?:'Printed'|'Digital'|'Both' };
type API = {
  academic:{listTerms():Promise<Term[]>;listSemesters(termId:string):Promise<Offering[]>;listSections(offeringId:string):Promise<Omit<Section,'semester_number'>[]>};
  faculty:{list():Promise<Faculty[]>};
  labs:{list():Promise<Laboratory[]>;getClock():Promise<{confirmed:boolean;periods:{number:number;start:string;end:string}[]}>};
  activities:{list(termId:string):Promise<Activity[]>;save(input:ActivityInput):Promise<Activity[]>;cancel(id:string):Promise<{success:boolean}>;
    preview(input:ActivityInput):Promise<ConflictReport>;listSuspensions(termId:string):Promise<Suspension[]>};
};
type ConflictReport={replacements:{date:string;labBookingId:string;weekday:number;startPeriod:number;endPeriod:number;ownerLabel:string;reason:string}[];
  blockers:{date:string;source:string;reason:string}[]};
type Suspension={booking_date:string;activity_id:string;lab_booking_id:string;hod_reference:string;hod_channel:string;
  activity_title:string;activity_active:Toggle;booking_active:Toggle;start_period:number;lab_code:string;
  semester_number:number|null;section_code:string|null};
const api = (window as unknown as {electronAPI?:API}).electronAPI;
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const roman=['','I','II','III','IV','V','VI'];
const active=(n:Toggle)=>Number(n)===1;
const control:React.CSSProperties={padding:'8px 10px',border:'1px solid #b9cac5',borderRadius:6,width:'100%',boxSizing:'border-box',fontSize:14};
const label:React.CSSProperties={display:'block',fontSize:13,fontWeight:600,marginBottom:5};
const card:React.CSSProperties={background:'#fff',border:'1px solid #d7e2df',borderRadius:10,padding:20,marginTop:18};
const grid:React.CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:15};
const button:React.CSSProperties={padding:'9px 15px',cursor:'pointer'};
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const validStart=(p:number,n:number)=>p+n-1<=6 && !(p<=3 && p+n-1>=4);

export default function Activities() {
  const [terms,setTerms]=useState<Term[]>([]);
  const [termId,setTermId]=useState('');
  const [sections,setSections]=useState<Section[]>([]);
  const [faculty,setFaculty]=useState<Faculty[]>([]);
  const [labs,setLabs]=useState<Laboratory[]>([]);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [suspensions,setSuspensions]=useState<Suspension[]>([]);
  const [preview,setPreview]=useState<ConflictReport|null>(null);
  const [suspendLabs,setSuspendLabs]=useState(false);
  const [hodReference,setHodReference]=useState('');
  const [hodChannel,setHodChannel]=useState<'Printed'|'Digital'|'Both'>('Both');
  const [clockConfirmed,setClockConfirmed]=useState(false);
  const [periodTimes,setPeriodTimes]=useState<{number:number;start:string;end:string}[]>([]);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [id,setId]=useState<string|undefined>();
  const [kind,setKind]=useState<Kind>('Club');
  const [title,setTitle]=useState('');
  const [organizer,setOrganizer]=useState('');
  const [notes,setNotes]=useState('');
  const [mode,setMode]=useState<Mode>('Weekly');
  const [weekday,setWeekday]=useState(0);
  const [datesText,setDatesText]=useState('');
  const [start,setStart]=useState(1);
  const [count,setCount]=useState(1);
  const [selectedSections,setSelectedSections]=useState<string[]>([]);
  const [facultyId,setFacultyId]=useState('');
  const [labId,setLabId]=useState('');

  useEffect(()=>{
    if(!api) {setError('This page requires the Electron desktop application');return;}
    Promise.all([api.academic.listTerms(),api.faculty.list(),api.labs.list(),api.labs.getClock()])
      .then(([t,f,l,c])=>{
        setTerms(t);setFaculty(f);setLabs(l);setClockConfirmed(c.confirmed);setPeriodTimes(c.periods);
        setTermId(old=>old||t.find(x=>active(x.is_current))?.id||t[0]?.id||'');
      }).catch(e=>setError(errorText(e)));
  },[]);
  useEffect(()=>{
    if(!api||!termId) return;
    let canceled=false;
    Promise.all([api.academic.listSemesters(termId),api.activities.list(termId),api.activities.listSuspensions(termId)])
      .then(async([offerings,items,exceptions])=>{
        const offered=offerings.filter(o=>active(o.active));
        const parts=await Promise.all(offered.map(async o=>{
          const list=await api.academic.listSections(o.id);
          return list.filter(s=>active(s.active)).map(s=>({...s,semester_number:o.semester_number}));
        }));
        if(!canceled) {setSections(parts.flat());setActivities(items);setSuspensions(exceptions);}
      }).catch(e=>{if(!canceled)setError(errorText(e));});
    return ()=>{canceled=true;};
  },[termId,revision]);

  useEffect(()=>{setPreview(null);setSuspendLabs(false);},
    [termId,kind,title,organizer,notes,mode,weekday,datesText,start,count,selectedSections,facultyId,labId]);

  const availableSections=useMemo(()=>sections.slice().sort((a,b)=>a.semester_number-b.semester_number||a.code.localeCompare(b.code)),[sections]);
  const activeFaculty=useMemo(()=>faculty.filter(x=>active(x.active)),[faculty]);
  const activeLabs=useMemo(()=>labs.filter(x=>active(x.active)),[labs]);
  const starts=useMemo(()=>[1,2,3,4,5,6].filter(p=>validStart(p,count)),[count]);
  function reset() {
    setId(undefined);setKind('Club');setTitle('');setOrganizer('');setNotes('');setMode('Weekly');
    setWeekday(0);setDatesText('');setStart(1);setCount(1);setSelectedSections([]);setFacultyId('');setLabId('');
    setPreview(null);setSuspendLabs(false);setHodReference('');setHodChannel('Both');
  }
  function edit(row:Activity) {
    setId(row.id);setKind(row.kind);setTitle(row.title);setOrganizer(row.organizer);setNotes(row.notes);
    setMode(row.mode);setWeekday(row.weekday);setDatesText(row.booking_date||'');
    setStart(row.start_period);setCount(row.period_count);setSelectedSections(row.section_ids);
    setFacultyId(row.faculty_id||'');setLabId(row.lab_id||'');setPreview(null);setSuspendLabs(false);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function toggleSection(sid:string,checked:boolean) {
    setSelectedSections(old=>checked?[...old,sid]:old.filter(x=>x!==sid));
  }
  function candidate():ActivityInput {
    return {id,termId,kind,title,organizer,notes,mode,weekday,
      dates:mode==='Dated'?datesText.trim().split(/[\s,;]+/).filter(Boolean):[],
      startPeriod:start,periodCount:count,sectionIds:selectedSections,
      facultyId:facultyId||null,labId:labId||null,
      suspendConflictingBcaLabs:suspendLabs,hodInstructionReference:hodReference,
      hodInstructionChannel:hodChannel};
  }
  async function checkConflicts() {
    if(!api||!termId)return;
    setError('');setMessage('');setBusy(true);setPreview(null);setSuspendLabs(false);
    try {setPreview(await api.activities.preview(candidate()));}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function save(e:React.FormEvent) {
    e.preventDefault();if(!api||!termId)return;
    setError('');setMessage('');setBusy(true);
    try {
      if(kind==='Certification' && suspendLabs && !preview) {
        throw new Error('Preview the conflicting sessions before authorizing a suspension');
      }
      const results=await api.activities.save(candidate());
      setMessage(`${results.length} activity session${results.length===1?'':'s'} saved. These are planned records, not proof of HOD approval.`);
      reset();setRevision(v=>v+1);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function cancel(activityId:string) {
    if(!api||!window.confirm('Cancel this activity session? It will be retained as inactive history.'))return;
    setError('');setMessage('');setBusy(true);
    try{await api.activities.cancel(activityId);setMessage('Session canceled; history retained.');setRevision(v=>v+1);}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  if(!api)return <div style={{padding:30}}>Open this module in the BCA Timetable Manager desktop application.</div>;
  return <main style={{padding:'30px 44px',maxWidth:1500,margin:'0 auto',color:'#203733'}}>
    <h1 style={{fontSize:32,margin:'4px 0 10px'}}>BCA — Activities &amp; Certification</h1>
    <p style={{color:'#48635c'}}>Reserve club activities and sports on the weekly timetable; enter certification sessions on the dates allotted by the HOD.</p>
    <div style={{background:'#fff8e7',border:'1px solid #eed18d',padding:14,borderRadius:8}}>
      <strong>Scheduling scope:</strong> Faculty, participating sections and optionally a shared laboratory are checked against existing lab and activity bookings.
      Theory-period conflicts, holidays/examinations, approval authorization and published-timetable overrides are not yet implemented. Do not publish these as a final timetable.
    </div>
    {error&&<div role="alert" style={{background:'#fff0ed',color:'#8c2417',padding:12,marginTop:12,borderRadius:6}}>{error}</div>}
    {message&&<div role="status" style={{background:'#e8f5eb',color:'#185c39',padding:12,marginTop:12,borderRadius:6}}>{message}</div>}
    <section style={card}>
      <h2 style={{marginTop:0}}>1. Academic term</h2>
      <div style={{maxWidth:430}}><label style={label}>Academic term</label>
        <select style={control} value={termId} onChange={e=>{setTermId(e.target.value);reset();}}>
          {terms.map(t=><option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}{active(t.is_current)?' (Current)':''}</option>)}
        </select></div>
      {!clockConfirmed&&<p style={{color:'#9c4c00'}}>The college clock must be confirmed in Shared Laboratories before adding activities.</p>}
    </section>
    <section style={card}>
      <h2 style={{marginTop:0}}>2. {id?'Edit session':'Schedule an activity'}</h2>
      <form onSubmit={save}>
        <div style={grid}>
          <div><label style={label}>Category</label><select style={control} value={kind} onChange={e=>{const k=e.target.value as Kind;setKind(k);if(k==='Certification')setMode('Dated');}}>
            <option value="Club">Club activity</option><option value="Sports">Sports</option><option value="Certification">Certification course</option>
          </select></div>
          <div><label style={label}>Activity / course title</label><input style={control} required maxLength={140} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Coding Club / Placement Certificate" /></div>
          <div><label style={label}>Organizer / HOD allocation reference</label><input style={control} maxLength={120} value={organizer} onChange={e=>setOrganizer(e.target.value)} placeholder="e.g. HOD allotted schedule" /></div>
          <div><label style={label}>Frequency</label><select style={control} value={mode} disabled={kind==='Certification'} onChange={e=>setMode(e.target.value as Mode)}>
            <option value="Weekly">Repeat weekly</option><option value="Dated">Specific calendar dates</option>
          </select></div>
          {mode==='Weekly'?<div><label style={label}>Weekday</label><select style={control} value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>
            {days.map((d,i)=><option key={d} value={i}>{d}</option>)}
          </select></div>:<div><label style={label}>HOD-allotted date(s) — YYYY-MM-DD</label>
            <textarea style={{...control,minHeight:52}} required value={datesText} onChange={e=>setDatesText(e.target.value)} placeholder="2026-11-03, 2026-11-10" />
            <small>Up to 30 distinct dates, separated by commas or spaces. Each date becomes one session. When editing, enter only one date.</small>
          </div>}
          <div><label style={label}>Duration</label><select style={control} value={count} onChange={e=>{const n=Number(e.target.value);setCount(n);if(!validStart(start,n))setStart(1);}}>
            <option value={1}>1 period (60 minutes)</option><option value={2}>2 periods (120 minutes)</option><option value={3}>3 periods (180 minutes)</option>
          </select></div>
          <div><label style={label}>Starting period</label><select style={control} value={start} onChange={e=>setStart(Number(e.target.value))}>
            {starts.map(p=><option value={p} key={p}>P{p} — {periodTimes[p-1]?.start||''}–{periodTimes[p-1]?.end||''}</option>)}
          </select></div>
          <div><label style={label}>Faculty / facilitator (optional)</label><select style={control} value={facultyId} onChange={e=>setFacultyId(e.target.value)}>
            <option value="">Not assigned yet</option>{activeFaculty.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
          <div><label style={label}>Shared laboratory (optional)</label><select style={control} value={labId} onChange={e=>setLabId(e.target.value)}>
            <option value="">No laboratory required</option>{activeLabs.map(l=><option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
          </select></div>
        </div>
        <div style={{marginTop:18}}><label style={label}>Participating BCA sections (select one or more)</label>
          {availableSections.length===0?<p>No active sections in this term. Create and activate sections in Academic Setup.</p>:
            <div style={{display:'flex',flexWrap:'wrap',gap:10}}>{availableSections.map(s=><label key={s.id} style={{border:'1px solid #d2ded8',borderRadius:6,padding:9,cursor:'pointer'}}>
              <input type="checkbox" checked={selectedSections.includes(s.id)} onChange={e=>toggleSection(s.id,e.target.checked)} />{' '}Sem {roman[s.semester_number]} — {s.code}
            </label>)}</div>}
        </div>
        <div style={{marginTop:16}}><label style={label}>Notes (optional)</label>
          <textarea style={{...control,minHeight:65}} value={notes} maxLength={300} onChange={e=>setNotes(e.target.value)} placeholder="Details, room arrangements, certification provider..." /></div>
        {kind==='Certification'&&mode==='Dated'&&<div style={{...card,background:'#f6fbfa'}}>
          <h3 style={{marginTop:0}}>Date-specific lab replacement (optional)</h3>
          <p style={{fontSize:13}}>Use this only when a HOD instruction explicitly replaces a recurring BCA lab. No weekly lab booking is deleted. External and dated laboratory reservations cannot be overridden.</p>
          <button type="button" style={button} disabled={busy||!selectedSections.length} onClick={()=>void checkConflicts()}>
            Check faculty, section and laboratory conflicts
          </button>
          {preview&&<div style={{marginTop:12}}>
            {preview.blockers.length>0&&<div role="alert" style={{padding:10,background:'#ffedeb',color:'#862c20'}}>
              <strong>Blocking conflicts — cannot override:</strong>
              <ul>{preview.blockers.map((c,i)=><li key={i}>{c.date}: {c.source} — {c.reason}</li>)}</ul>
            </div>}
            {preview.replacements.length>0&&<div style={{padding:10,background:'#fff4d7'}}>
              <strong>Recurring BCA lab occurrences that would be suspended:</strong>
              <ul>{preview.replacements.map((c,i)=><li key={i}>{c.date}: {c.ownerLabel}, P{c.startPeriod}–P{c.endPeriod} ({c.reason})</li>)}</ul>
              <p>Each occurrence represents 2 missed lab teaching periods requiring follow-up.</p>
              {preview.blockers.length===0&&<>
                <label style={{display:'block',marginBottom:10}}><input type="checkbox" checked={suspendLabs} onChange={e=>setSuspendLabs(e.target.checked)} />{' '}I confirm the HOD instructed the suspension of every occurrence listed above.</label>
                <div style={grid}>
                  <div><label style={label}>HOD instruction / approval reference</label><input style={control} required={suspendLabs} maxLength={200} value={hodReference} onChange={e=>setHodReference(e.target.value)} placeholder="Signed memo number / email date / WhatsApp record" /></div>
                  <div><label style={label}>Evidence channel</label><select style={control} value={hodChannel} onChange={e=>setHodChannel(e.target.value as 'Printed'|'Digital'|'Both')}><option value="Printed">Printed</option><option value="Digital">Digital</option><option value="Both">Printed and digital</option></select></div>
                </div>
              </>}
            </div>}
            {preview.blockers.length===0&&preview.replacements.length===0&&<p style={{color:'#185c39'}}>No conflicts found. Save without selecting suspension.</p>}
          </div>}
        </div>}
        <div style={{display:'flex',gap:10,marginTop:14}}>
          <button style={button} type="submit" disabled={busy||!termId||!clockConfirmed||!selectedSections.length||!!preview?.blockers.length||(!!preview?.replacements.length&&!suspendLabs)}>{busy?'Saving...':id?'Update session':'Save planned session(s)'}</button>
          <button style={button} type="button" disabled={busy} onClick={reset}>Clear / cancel editing</button>
        </div>
      </form>
    </section>
    <section style={card}>
      <h2 style={{marginTop:0}}>3. Scheduled sessions and dated exceptions</h2>
      {activities.length===0?<p>No activities booked for this term.</p>:<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',minWidth:900}}>
        <thead><tr style={{background:'#eff4f2',textAlign:'left'}}>{['Activity','When','Sections','Faculty','Lab','Status','Actions'].map(h=><th key={h} style={{padding:10}}>{h}</th>)}</tr></thead>
        <tbody>{activities.map(a=><tr key={a.id} style={{borderBottom:'1px solid #e2ebe7',opacity:active(a.active)?1:0.55}}>
          <td style={{padding:10}}><strong>{a.title}</strong><br/><small>{a.kind}{a.organizer?' · '+a.organizer:''}</small></td>
          <td style={{padding:10}}>{a.mode==='Weekly'?`Weekly ${days[a.weekday]}`:a.booking_date}<br/>P{a.start_period}{a.period_count>1?`–P${a.start_period+a.period_count-1}`:''}</td>
          <td style={{padding:10}}>{a.section_labels.join(', ')}</td><td style={{padding:10}}>{a.faculty_name||'Unassigned'}</td>
          <td style={{padding:10}}>{a.lab_code||'—'}</td><td style={{padding:10}}>{active(a.active)?'Planned':'Canceled'}</td>
          <td style={{padding:10}}><button style={button} disabled={busy} onClick={()=>edit(a)}>Edit</button>{active(a.active)&&<> <button style={button} disabled={busy} onClick={()=>void cancel(a.id)}>Cancel</button></>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <section style={card}>
      <h2 style={{marginTop:0}}>4. Date-specific suspended BCA laboratory sessions</h2>
      <p>Only the listed dates are suspended. The weekly laboratory timetable remains intact. Canceling the certification restores the recurring lab on those dates. Makeup requirements must be resolved separately.</p>
      {suspensions.length===0?<p>No date-specific laboratory suspensions have been recorded for this term.</p>:<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%',minWidth:750}}>
      <thead><tr>{['Date','Certification','Suspended lab','Original class','Periods missed','HOD reference','Status'].map(h=><th key={h} style={{textAlign:'left',padding:8}}>{h}</th>)}</tr></thead>
      <tbody>{suspensions.map((x,i)=><tr key={`${x.activity_id}-${x.lab_booking_id}-${x.booking_date}-${i}`} style={{borderBottom:'1px solid #ddd'}}>
        <td style={{padding:8}}>{x.booking_date}</td><td style={{padding:8}}>{x.activity_title}</td>
        <td style={{padding:8}}>{x.lab_code}</td>
        <td style={{padding:8}}>{x.semester_number?`Semester ${roman[x.semester_number]}-${x.section_code}`:'BCA'}</td>
        <td style={{padding:8}}>P{x.start_period}–P{x.start_period+1} (2)</td>
        <td style={{padding:8}}>{x.hod_reference} ({x.hod_channel})</td>
        <td style={{padding:8}}>{active(x.activity_active)&&active(x.booking_active)?'Suspended — makeup review due':'Historical — weekly lab restored/inactive'}</td>
      </tr>)}</tbody></table></div>}
    </section>
    <p style={{color:'#617973',fontSize:13,marginTop:16}}>Certification dates are manually recorded as provided by the HOD; this module does not authenticate HOD approval. The exact term start/end dates, exam calendar and holidays still need a separate calendar configuration.</p>
  </main>;
}
