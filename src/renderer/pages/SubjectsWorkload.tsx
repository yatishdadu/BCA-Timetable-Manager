import React, { useEffect, useMemo, useState } from 'react';

type Kind = 'Theory' | 'Lab' | 'Language' | 'Project' | 'Internship' | 'Other';
type Term = { id: string; academic_year: string; cycle: 'Odd' | 'Even'; is_current: number | boolean };
type Offering = { id: string; term_id: string; semester_number: number; active: number | boolean };
type Section = { id: string; offering_id: string; code: string; active: number | boolean };
type Subject = {
  id: string; term_id: string; semester_number: number; code: string; name: string;
  kind: Kind; weekly_hours: number; block_periods: number; source_label: string;
  active: number | boolean;
};
type Faculty = { id: string; name: string; category: string; workload_target: number; active: number | boolean };
type Allocation = {
  id: string; section_id: string; subject_id: string; faculty_id: string | null;
  weekly_hours: number; active: number | boolean;
  subject_code: string; subject_name: string; kind: Kind; block_periods: number;
  subject_active: number | boolean; section_code: string; section_active: number | boolean;
  semester_number: number; semester_active: number | boolean;
  faculty_name: string | null; faculty_active: number | boolean | null;
};
type FacultySummary = Faculty & { allocated_hours: number; remaining_hours: number };
type WorkloadSummary = { faculty: FacultySummary[]; unassignedHours: number; totalPlannedHours: number };
type SubjectInput = { id?: string; termId: string; semesterNumber: number; code: string; name: string; kind: Kind; weeklyHours: number };
type AllocationInput = { id?: string; sectionId: string; subjectId: string; facultyId: string | null; weeklyHours: number };
type SubjectAPI = {
  list(termId: string, semesterNumber: number): Promise<Subject[]>;
  save(input: SubjectInput): Promise<Subject>;
  setActive(id: string, active: boolean): Promise<{success: boolean}>;
  importReference(termId: string, semesterNumber: number): Promise<{inserted: number; skipped: number; warnings: string[]}>;
};
type AllocationAPI = {
  list(termId: string): Promise<Allocation[]>;
  save(input: AllocationInput): Promise<Allocation>;
  setActive(id: string, active: boolean): Promise<{success: boolean}>;
};
type API = {
  academic: {
    listTerms(): Promise<Term[]>;
    listSemesters(termId: string): Promise<Offering[]>;
    listSections(offeringId: string): Promise<Section[]>;
  };
  faculty: { list(): Promise<Faculty[]> };
  subjects: SubjectAPI;
  allocations: AllocationAPI;
  workload: { summary(termId: string): Promise<WorkloadSummary> };
};
const api = (window as unknown as { electronAPI?: API }).electronAPI;
const enabled = (value: number | boolean | null | undefined) => Number(value) === 1;
const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const kinds: Kind[] = ['Theory', 'Lab', 'Language', 'Project', 'Internship', 'Other'];
const field: React.CSSProperties = { display: 'block', width: '100%', padding: 9, border: '1px solid #bbc9c5', borderRadius: 5, boxSizing: 'border-box', marginTop: 5 };
const panel: React.CSSProperties = { border: '1px solid #d9e1df', borderRadius: 9, padding: 18, marginTop: 18 };
const cell: React.CSSProperties = { padding: '9px 8px', borderTop: '1px solid #e1e6e5', verticalAlign: 'top' };
const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

export default function SubjectsWorkload() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState('');
  const [semester, setSemester] = useState(2);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [summary, setSummary] = useState<WorkloadSummary | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Subject form
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('Theory');
  const [subjectHours, setSubjectHours] = useState(4);

  // Section allocation form
  const [allocationId, setAllocationId] = useState<string | undefined>();
  const [pickedSubjectId, setPickedSubjectId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [allocationHours, setAllocationHours] = useState(4);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all([api.academic.listTerms(), api.faculty.list()]).then(([termRows, facultyRows]) => {
      if (cancelled) return;
      setTerms(termRows);
      setFaculty(facultyRows);
      setTermId((prev) => termRows.some((t) => t.id === prev) ? prev :
        (termRows.find((t) => enabled(t.is_current))?.id || termRows[0]?.id || ''));
    }).catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!api || !termId) { setOfferings([]); setAllocations([]); setSummary(null); return; }
    let cancelled = false;
    void Promise.all([
      api.academic.listSemesters(termId),
      api.allocations.list(termId),
      api.workload.summary(termId),
    ]).then(([offerRows, allocationRows, stats]) => {
      if (cancelled) return;
      setOfferings(offerRows);
      setAllocations(allocationRows);
      setSummary(stats);
    }).catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [termId, refresh]);

  const selectedOffering = offerings.find((o) => o.semester_number === semester);
  useEffect(() => {
    if (!api || !selectedOffering) { setSections([]); setSectionId(''); return; }
    let cancelled = false;
    void api.academic.listSections(selectedOffering.id).then((rows) => {
      if (cancelled) return;
      setSections(rows);
      setSectionId((previous) => rows.some((s) => s.id === previous) ? previous :
        (rows.find((s) => enabled(s.active))?.id || rows[0]?.id || ''));
    }).catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [selectedOffering?.id, refresh]);

  useEffect(() => {
    if (!api || !termId) { setSubjects([]); return; }
    let cancelled = false;
    setSubjects([]);
    void api.subjects.list(termId, semester).then((rows) => { if (!cancelled) setSubjects(rows); })
      .catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [termId, semester, refresh]);

  const section = sections.find((s) => s.id === sectionId);
  const semesterReady = !!selectedOffering && enabled(selectedOffering.active);
  const sectionReady = semesterReady && !!section && enabled(section.active);
  const currentAllocations = useMemo(() => allocations.filter((a) => a.section_id === sectionId), [allocations, sectionId]);
  const eligibleSubjects = subjects.filter((s) => enabled(s.active));
  const activeFaculty = faculty.filter((f) => enabled(f.active));
  const flaggedLabs = subjects.filter((s) => enabled(s.active) && s.kind === 'Lab' && s.weekly_hours % 2 !== 0);
  const flaggedAssignments = currentAllocations.filter((a) => enabled(a.active) && a.kind === 'Lab' && a.weekly_hours % 2 !== 0);

  function clearSubject() { setSubjectId(undefined); setCode(''); setName(''); setKind('Theory'); setSubjectHours(4); }
  function editSubject(row: Subject) { setSubjectId(row.id); setCode(row.code); setName(row.name); setKind(row.kind); setSubjectHours(row.weekly_hours); }
  function clearAllocation() { setAllocationId(undefined); setPickedSubjectId(''); setFacultyId(''); setAllocationHours(4); }
  function editAllocation(row: Allocation) {
    setAllocationId(row.id); setPickedSubjectId(row.subject_id);
    setFacultyId(row.faculty_id || ''); setAllocationHours(row.weekly_hours);
  }
  async function perform(task: () => Promise<void>) {
    setLoading(true); setError(''); setNotice('');
    try { await task(); setRefresh((n) => n + 1); }
    catch (err: unknown) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }
  function saveSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !termId) return;
    void perform(async () => {
      await api.subjects.save({ id: subjectId, termId, semesterNumber: semester, code, name, kind, weeklyHours: subjectHours });
      clearSubject(); setNotice('Subject saved.');
    });
  }
  function importReference() {
    if (!api || !termId || !window.confirm(`Import reference subjects for Semester ${roman[semester]} into this term? Existing codes will be skipped. Review languages and practical hours before use.`)) return;
    void perform(async () => {
      const result = await api.subjects.importReference(termId, semester);
      setNotice(`Imported ${result.inserted} subjects; skipped ${result.skipped} existing codes. ${result.warnings.join(' ')}`);
    });
  }
  function setSubjectActive(row: Subject) {
    if (!api) return;
    void perform(async () => { await api.subjects.setActive(row.id, !enabled(row.active)); });
  }
  function saveAllocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !sectionId || !pickedSubjectId) return;
    void perform(async () => {
      await api.allocations.save({ id: allocationId, sectionId, subjectId: pickedSubjectId,
        facultyId: facultyId || null, weeklyHours: allocationHours });
      clearAllocation(); setNotice('Section allocation saved.');
    });
  }
  function setAllocationActive(row: Allocation) {
    if (!api) return;
    void perform(async () => { await api.allocations.setActive(row.id, !enabled(row.active)); });
  }

  return (
    <main style={{ padding: '24px 28px', maxWidth: 1250, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>BCA — Subjects & Workload</h1>
      <p>Manage term-specific subjects, faculty allocations and weekly workload. This page does not generate timetable periods.</p>
      {!api && <p role="alert" style={{ color: 'firebrick' }}>This module requires the Electron desktop application.</p>}
      {error && <p role="alert" style={{ background: '#fff1f0', color: '#a72520', padding: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ background: '#edf6f2', color: '#215744', padding: 12 }}>{notice}</p>}

      <section style={panel}>
        <h2>1. Select academic term and semester</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'end' }}>
          <label style={{ minWidth: 210 }}>Academic term
            <select style={field} value={termId} onChange={(e) => { setTermId(e.target.value); clearSubject(); clearAllocation(); }}>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}{enabled(t.is_current) ? ' (Current)' : ''}</option>)}
            </select>
          </label>
          <label>Semester
            <select style={field} value={semester} onChange={(e) => { setSemester(Number(e.target.value)); clearSubject(); clearAllocation(); }}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{roman[n]}</option>)}
            </select>
          </label>
          <span style={{ fontSize: 13, color: '#52625f' }}>
            {semesterReady ? 'Semester is active in this term' : 'Semester is not active in this term'}
          </span>
        </div>
        {terms.length === 0 && <p>Create an academic term in Academic Setup first.</p>}
      </section>

      <section style={panel}>
        <h2>2. Subject catalogue — Semester {roman[semester]}</h2>
        <p style={{ color: '#53645e', fontSize: 13 }}>Reference import is optional. It never overwrites an existing subject code. Edit languages and university hour discrepancies before assigning.</p>
        <button type="button" onClick={importReference} disabled={!api || !termId || loading}>Import BCU reference subjects for this semester</button>
        <form onSubmit={saveSubject} style={{ background: '#f5f8f7', padding: 16, borderRadius: 7, marginTop: 14 }}>
          <h3>{subjectId ? 'Edit subject' : 'Add subject'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 12 }}>
            <label>Code<input style={field} value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} pattern="[A-Za-z0-9-]+" required /></label>
            <label>Subject name<input style={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required /></label>
            <label>Category<select style={field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {kinds.map((v) => <option key={v} value={v}>{v}</option>)}
            </select></label>
            <label>Weekly hours<input style={field} type="number" min={1} max={40} value={subjectHours} onChange={(e) => setSubjectHours(Number(e.target.value))} required /></label>
          </div>
          {kind === 'Lab' && <p style={{ color: '#805922', fontSize: 13 }}>Labs use 2 consecutive periods per session. Odd weekly hours require manual resolution before timetable generation.</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={loading || !api || !termId}>{subjectId ? 'Update subject' : 'Add subject'}</button>
            {subjectId && <button type="button" onClick={clearSubject} disabled={loading}>Cancel edit</button>}
          </div>
        </form>
        {flaggedLabs.length > 0 && <p role="alert" style={{ color: '#986100' }}>
          Needs scheduling review: {flaggedLabs.map((s) => `${s.code} (${s.weekly_hours} hrs)`).join(', ')}.
        </p>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: 15 }}>
            <thead><tr><th>Code</th><th>Subject</th><th>Type</th><th>Hours/week</th><th>Block</th><th>Source</th><th>Status / Actions</th></tr></thead>
            <tbody>{subjects.map((s) => <tr key={s.id}>
              <td style={cell}>{s.code}</td><td style={cell}>{s.name}</td><td style={cell}>{s.kind}</td>
              <td style={cell}>{s.weekly_hours}</td><td style={cell}>{s.block_periods}</td>
              <td style={cell}>{s.source_label}</td><td style={cell}>{enabled(s.active) ? 'Active' : 'Inactive'}{' '}
                <button type="button" disabled={loading} onClick={() => editSubject(s)}>Edit</button>{' '}
                <button type="button" disabled={loading} onClick={() => setSubjectActive(s)}>{enabled(s.active) ? 'Deactivate' : 'Reactivate'}</button>
              </td>
            </tr>)}</tbody>
          </table>
          {subjects.length === 0 && <p>No subjects yet for this term and semester.</p>}
        </div>
      </section>

      <section style={panel}>
        <h2>3. Section-wise faculty allocation</h2>
        {!semesterReady ? <p>Activate Semester {roman[semester]} in Academic Setup before creating section allocations.</p> : <>
          <label style={{ display: 'block', maxWidth: 300 }}>Section
            <select style={field} value={sectionId} onChange={(e) => { setSectionId(e.target.value); clearAllocation(); }}>
              {sections.map((s) => <option value={s.id} key={s.id}>Section {s.code}{enabled(s.active) ? '' : ' (inactive)'}</option>)}
            </select>
          </label>
          {!sectionReady && <p>Select an active section, or create one in Academic Setup.</p>}
          {sectionReady && <>
            <form onSubmit={saveAllocation} style={{ background: '#f5f8f7', padding: 16, borderRadius: 7, marginTop: 14 }}>
              <h3>{allocationId ? 'Edit assignment' : 'Assign subject'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 12 }}>
                <label>Subject<select style={field} value={pickedSubjectId} disabled={!!allocationId} required onChange={(e) => {
                  const nextId = e.target.value;
                  setPickedSubjectId(nextId);
                  const picked = subjects.find((s) => s.id === nextId);
                  if (picked) setAllocationHours(picked.weekly_hours);
                }}>
                  <option value="">Select subject</option>
                  {eligibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                </select></label>
                <label>Faculty<select style={field} value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
                  <option value="">Unassigned — allocate later</option>
                  {activeFaculty.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.category})</option>)}
                </select></label>
                <label>Allocated hours/week<input style={field} type="number" min={1} max={40} value={allocationHours} onChange={(e) => setAllocationHours(Number(e.target.value))} required /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={loading || !api || !pickedSubjectId}>{allocationId ? 'Update allocation' : 'Add allocation'}</button>
                {allocationId && <button type="button" onClick={clearAllocation}>Cancel edit</button>}
              </div>
            </form>
            {flaggedAssignments.length > 0 && <p role="alert" style={{ color: '#986100' }}>
              Odd-hour practical allocations: {flaggedAssignments.map((a) => a.subject_code).join(', ')}. Do not generate isolated lab periods.
            </p>}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: 15 }}>
                <thead><tr><th>Subject</th><th>Faculty</th><th>Hours</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{currentAllocations.map((a) => <tr key={a.id}>
                  <td style={cell}>{a.subject_code} — {a.subject_name}</td>
                  <td style={cell}>{a.faculty_name || 'Unassigned'}{a.faculty_id && !enabled(a.faculty_active) ? ' (inactive faculty)' : ''}</td>
                  <td style={cell}>{a.weekly_hours}</td><td style={cell}>{enabled(a.active) ? 'Active' : 'Paused'}</td>
                  <td style={cell}>
                    <button type="button" disabled={loading || !enabled(a.active)} onClick={() => editAllocation(a)}>Edit</button>{' '}
                    <button type="button" disabled={loading} onClick={() => setAllocationActive(a)}>{enabled(a.active) ? 'Pause' : 'Restore'}</button>
                  </td>
                </tr>)}</tbody>
              </table>
              {currentAllocations.length === 0 && <p>No subjects assigned to this section yet.</p>}
            </div>
          </>}
        </>}
      </section>

      <section style={panel}>
        <h2>4. Faculty workload — selected term</h2>
        <p style={{ fontSize: 13, color: '#53645e' }}>Totals count active allocations in active sections and semesters. Targets are configurable preferences, not automatic assignment limits. Separate terms are not added together.</p>
        {summary && <>
          <p><strong>Assigned teaching hours:</strong> {summary.totalPlannedHours - summary.unassignedHours} &nbsp; | &nbsp;
            <strong>Unassigned teaching hours:</strong> {summary.unassignedHours} &nbsp; | &nbsp;
            <strong>Total allocated section hours:</strong> {summary.totalPlannedHours}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead><tr><th>Faculty</th><th>Category</th><th>Target</th><th>Assigned</th><th>Difference</th><th>Status</th></tr></thead>
              <tbody>{summary.faculty.map((f) => {
                const overflow = f.workload_target > 0 && f.allocated_hours > f.workload_target;
                return <tr key={f.id} style={{ background: overflow ? '#fff1ef' : 'transparent' }}>
                  <td style={cell}>{f.name}</td><td style={cell}>{f.category}</td>
                  <td style={cell}>{f.workload_target === 0 ? 'Not set' : f.workload_target}</td>
                  <td style={cell}>{f.allocated_hours}</td>
                  <td style={cell}>{f.workload_target === 0 ? '—' : f.remaining_hours}</td>
                  <td style={cell}>{!enabled(f.active) && f.allocated_hours > 0 ? 'Assigned but inactive' : overflow ? 'Over target — review' : enabled(f.active) ? 'Within target' : 'Inactive'}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </section>
      <p style={{ fontSize: 13, color: '#52625f', marginTop: 18 }}>
        Draft development module. No timetable slots, shared lab reservations, certification dates or approval workflow are generated here.
      </p>
    </main>
  );
}
