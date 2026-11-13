import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Cycle = 'Odd' | 'Even';
type Term = { id: string; academic_year: string; cycle: Cycle; is_current: number | boolean };
type Offering = { id: string; term_id: string; semester_number: number; active: number | boolean };
type Section = { id: string; offering_id: string; code: string; active: number | boolean };
type WorkingMode='Morning Only'|'Full Day'|'Custom Timing';
type PolicyRow={offeringId:string;semesterNumber:number;active:boolean;mode:WorkingMode;allowedPeriods:number[];saturdayPeriods:number};
type SemesterScheduleAPI={list(termId:string):Promise<PolicyRow[]>;save(input:{offeringId:string;mode:WorkingMode;allowedPeriods:number[]}):Promise<unknown>};
type AcademicAPI = {
  listTerms(): Promise<Term[]>;
  createTerm(input: { academicYear: string; cycle: Cycle }): Promise<Term>;
  setCurrentTerm(id: string): Promise<{ success: boolean }>;
  listSemesters(termId: string): Promise<Offering[]>;
  setSemester(input: { termId: string; semesterNumber: number; active: boolean }): Promise<Offering>;
  listSections(offeringId: string): Promise<Section[]>;
  createSection(input: { offeringId: string; code: string }): Promise<Section>;
  updateSection(input: { id: string; code: string; active: boolean }): Promise<Section>;
};

const bridge=(window as unknown as {electronAPI?:{academic?:AcademicAPI;semesterSchedule?:SemesterScheduleAPI}}).electronAPI;
const api=bridge?.academic;
const scheduleApi=bridge?.semesterSchedule;
const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const isActive = (value: number | boolean) => Number(value) === 1;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const inputStyle: React.CSSProperties = { padding: 9, border: '1px solid #bbb', borderRadius: 5 };
const panelStyle: React.CSSProperties = { padding: 18, border: '1px solid #ddd', borderRadius: 8, marginTop: 16 };

export default function AcademicSetup() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState('');
  const [year, setYear] = useState('');
  const [cycle, setCycle] = useState<Cycle>('Odd');
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [semesterNumber, setSemesterNumber] = useState(1);
  const [sections, setSections] = useState<Section[]>([]);
  const [newCode, setNewCode] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offerRefresh, setOfferRefresh] = useState(0);
  const [sectionRefresh, setSectionRefresh] = useState(0);
  const [policies,setPolicies]=useState<PolicyRow[]>([]);
  const [policyMode,setPolicyMode]=useState<WorkingMode>('Full Day');
  const [customPeriods,setCustomPeriods]=useState<number[]>([1,2,3,4,5,6]);
  const [policySaved,setPolicySaved]=useState('');

  const showError = useCallback((err: unknown) => setError(messageOf(err)), []);
  const reloadTerms = useCallback(async (preferredId?: string) => {
    if (!api) return;
    const rows = await api.listTerms();
    setTerms(rows);
    setTermId((current) => {
      const preferred = preferredId && rows.some((r) => r.id === preferredId) ? preferredId : undefined;
      return preferred ?? (rows.some((r) => r.id === current) ? current :
        (rows.find((r) => isActive(r.is_current))?.id ?? rows[0]?.id ?? ''));
    });
  }, []);

  useEffect(() => { void reloadTerms().catch(showError); }, [reloadTerms, showError]);

  useEffect(() => {
    if (!api || !termId) { setOfferings([]); return; }
    let cancelled = false;
    setOfferings([]);
    void api.listSemesters(termId).then((rows) => {
      if (!cancelled) setOfferings(rows);
    }).catch((err: unknown) => { if (!cancelled) showError(err); });
    return () => { cancelled = true; };
  }, [termId, offerRefresh, showError]);

  useEffect(()=>{
    if(!scheduleApi||!termId){setPolicies([]);return;}
    let cancelled=false;
    void scheduleApi.list(termId).then(rows=>{if(!cancelled)setPolicies(rows);}).catch(err=>{if(!cancelled)showError(err);});
    return ()=>{cancelled=true;};
  },[termId,offerRefresh,showError]);
  const selectedOffering = useMemo(() => offerings.find((s) => s.semester_number === semesterNumber), [offerings, semesterNumber]);
  const selectedPolicy=policies.find(p=>p.offeringId===selectedOffering?.id);
  useEffect(()=>{
    setPolicyMode(selectedPolicy?.mode??'Full Day');
    setCustomPeriods(selectedPolicy?.allowedPeriods??[1,2,3,4,5,6]);
    setPolicySaved('');
  },[selectedOffering?.id,selectedPolicy?.mode,JSON.stringify(selectedPolicy?.allowedPeriods)]);
  useEffect(() => {
    if (!api || !selectedOffering) { setSections([]); return; }
    let cancelled = false;
    setSections([]);
    void api.listSections(selectedOffering.id).then((rows) => {
      if (!cancelled) setSections(rows);
    }).catch((err: unknown) => { if (!cancelled) showError(err); });
    return () => { cancelled = true; };
  }, [selectedOffering?.id, sectionRefresh, showError]);

  const selectedTerm = terms.find((term) => term.id === termId);

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await work(); } catch (err: unknown) { showError(err); } finally { setBusy(false); }
  }

  function submitTerm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const result = await api!.createTerm({ academicYear: year.trim(), cycle });
      await reloadTerms(result.id);
      setYear('');
    });
  }

  function activateTerm() {
    if (!termId) return;
    void perform(async () => { await api!.setCurrentTerm(termId); await reloadTerms(termId); });
  }

  function changeSemester(number: number, active: boolean) {
    if (!termId) return;
    void perform(async () => {
      await api!.setSemester({ termId, semesterNumber: number, active });
      setOfferRefresh((n) => n + 1);
    });
  }

  function saveWorkingSchedule(){
    if(!selectedOffering||!scheduleApi)return;
    void perform(async()=>{
      const allowedPeriods=policyMode==='Morning Only'?[1,2,3]:policyMode==='Full Day'?[1,2,3,4,5,6]:customPeriods;
      await scheduleApi.save({offeringId:selectedOffering.id,mode:policyMode,allowedPeriods});
      setPolicies(await scheduleApi.list(termId));
      setPolicySaved('Schedule saved. Existing saved theory drafts may be stale; regenerate before approval.');
    });
  }

  function submitSection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOffering || !isActive(selectedOffering.active)) return;
    void perform(async () => {
      await api!.createSection({ offeringId: selectedOffering.id, code: newCode.trim().toUpperCase() });
      setNewCode('');
      setSectionRefresh((n) => n + 1);
    });
  }

  function saveSection(section: Section, code: string, active: boolean) {
    void perform(async () => {
      await api!.updateSection({ id: section.id, code: code.trim().toUpperCase(), active });
      setEditId(null);
      setSectionRefresh((n) => n + 1);
    });
  }

  return (
    <main style={{ padding: 30, maxWidth: 1100, fontFamily: 'system-ui, sans-serif' }}>
      <h1>BCA — Academic Setup</h1>
      <p>Set up academic years and terms, select active semesters, and manage sections independently for each term.</p>
      {!api && <p role="alert" style={{ color: 'firebrick' }}>Academic management is available in the Electron desktop application.</p>}
      {error && <p role="alert" style={{ color: 'firebrick' }}>{error}</p>}

      <section style={panelStyle}>
        <h2>1. Academic term</h2>
        <form onSubmit={submitTerm} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5 }}>
            Academic year
            <input value={year} onChange={(e) => setYear(e.target.value)} style={inputStyle}
              placeholder="2026-27" pattern="[0-9]{4}-([0-9]{2}|[0-9]{4})" maxLength={9} required />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            Term
            <select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)} style={inputStyle}>
              <option value="Odd">Odd</option><option value="Even">Even</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !api} style={{ padding: 10 }}>Create term</button>
        </form>
        {terms.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <label>Select term{' '}
              <select value={termId} onChange={(e) => { setTermId(e.target.value); setEditId(null); }} style={inputStyle}>
                {terms.map((term) => <option key={term.id} value={term.id}>
                  {term.academic_year} — {term.cycle}{isActive(term.is_current) ? ' (Current)' : ''}
                </option>)}
              </select>
            </label>
            <button type="button" disabled={busy || !api || !termId || !!selectedTerm && isActive(selectedTerm.is_current)} onClick={activateTerm}>
              Set as current term
            </button>
          </div>
        )}
        {terms.length === 0 && <p>No academic terms yet. Create the first one above.</p>}
      </section>

      <section style={panelStyle}>
        <h2>2. Active BCA semesters</h2>
        <p>Multiple semesters may be active in the same term. Typical groups: Odd (I, III, V); Even (II, IV, VI). Other combinations are allowed.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10 }}>
          {roman.map((label, idx) => {
            const number = idx + 1;
            const offering = offerings.find((s) => s.semester_number === number);
            return <div key={number} style={{ border: semesterNumber === number ? '2px solid #236961' : '1px solid #ccc', padding: 12, borderRadius: 7 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <input type="checkbox" disabled={busy || !api || !termId}
                  checked={!!offering && isActive(offering.active)}
                  onChange={(e) => changeSemester(number, e.target.checked)} />
                Semester {label}
              </label>
              <button type="button" disabled={!termId} onClick={() => { setSemesterNumber(number); setEditId(null); }}
                style={{ marginTop: 10 }}>Manage sections</button>
            </div>;
          })}
        </div>
      </section>

      <section style={panelStyle}>
        <h2>3. Semester {roman[semesterNumber-1]} — Working schedule</h2>
        <p>Each term and semester has its own allowed teaching periods. The college clock and lunch break stay unchanged. Saturday limits still apply.</p>
        {!selectedOffering?<p>Activate this semester in section 2 to configure its working schedule.</p>:<>
          <p><strong>Current saved policy:</strong> {selectedPolicy?.mode??'Full Day (default)'} — {(selectedPolicy?.allowedPeriods??[1,2,3,4,5,6]).map(p=>`P${p}`).join(', ')}.</p>
          <label style={{display:'grid',gap:5,maxWidth:300}}>Working schedule
            <select value={policyMode} onChange={e=>{setPolicyMode(e.target.value as WorkingMode);setPolicySaved('');}} style={inputStyle} disabled={busy}>
              <option>Morning Only</option><option>Full Day</option><option>Custom Timing</option>
            </select>
          </label>
          {policyMode==='Custom Timing'&&<fieldset style={{border:'1px solid #ddd',borderRadius:6,marginTop:12}}>
            <legend>Allowed periods (choose at least one)</legend>
            <div style={{display:'flex',flexWrap:'wrap',gap:18}}>{[1,2,3,4,5,6].map(p=><label key={p}>
              <input type="checkbox" checked={customPeriods.includes(p)} onChange={e=>{
                setCustomPeriods(current=>e.target.checked?[...current,p].sort((a,b)=>a-b):current.filter(x=>x!==p));setPolicySaved('');
              }}/> P{p}
            </label>)}</div>
          </fieldset>}
          <p style={{fontSize:13,color:'#566'}}>Morning Only = 9:45–12:45 (P1–P3). Full Day = 9:45–16:45 (P1–P6). Custom uses selected periods only; no class may cross lunch.</p>
          <p style={{fontSize:13,color:'#835012'}}>Saving is blocked if an existing lab or activity for this semester would fall outside the proposed periods. Saved theory drafts are preserved but must be regenerated if stale.</p>
          <button type="button" style={{...inputStyle,background:'#e4f2ed',fontWeight:700}} disabled={busy||!scheduleApi||(policyMode==='Custom Timing'&&!customPeriods.length)} onClick={saveWorkingSchedule}>Save semester working schedule</button>
          {policySaved&&<p role="status" style={{color:'#16613e'}}>{policySaved}</p>}
        </>}
      </section>

      <section style={panelStyle}>
        <h2>4. Semester {roman[semesterNumber - 1]} — Sections</h2>
        {!termId ? <p>Select an academic term first.</p> : !selectedOffering || !isActive(selectedOffering.active) ?
          <p>Activate this semester above to create sections. Existing sections are retained if it is deactivated.</p> :
          <>
            <form onSubmit={submitSection} style={{ display: 'flex', alignItems: 'end', gap: 12, marginBottom: 16 }}>
              <label style={{ display: 'grid', gap: 5 }}>Section code
                <input value={newCode} onChange={(e) => setNewCode(e.target.value)} style={inputStyle}
                  placeholder="A, B, C or A1" maxLength={8} pattern="[A-Za-z0-9-]+" required />
              </label>
              <button type="submit" disabled={!api || busy}>Add section</button>
            </form>
            {sections.length === 0 ? <p>No sections created for this semester and term.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead><tr><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{sections.map((section) => (
                  <tr key={section.id} style={{ borderTop: '1px solid #ddd' }}>
                    <td style={{ padding: 10 }}>{editId === section.id ?
                      <input aria-label="Edit section code" value={editCode} onChange={(e) => setEditCode(e.target.value)} style={inputStyle} maxLength={8} /> :
                      section.code}</td>
                    <td>{isActive(section.active) ? 'Active' : 'Inactive'}</td>
                    <td style={{ padding: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {editId === section.id ? <>
                        <button type="button" disabled={busy || !editCode.trim()} onClick={() => saveSection(section, editCode, isActive(section.active))}>Save</button>
                        <button type="button" disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
                      </> : <>
                        <button type="button" disabled={busy} onClick={() => { setEditId(section.id); setEditCode(section.code); }}>Rename</button>
                        <button type="button" disabled={busy} onClick={() => saveSection(section, section.code, !isActive(section.active))}>
                          {isActive(section.active) ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        }
      </section>
      <p style={{ fontSize: 13, color: '#666', marginTop: 20 }}>
        Records are saved locally in the existing BCA Timetable database. No existing faculty records are changed.
      </p>
    </main>
  );
}
