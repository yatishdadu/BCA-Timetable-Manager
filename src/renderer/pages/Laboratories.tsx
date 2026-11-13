import React, { useEffect, useMemo, useState } from 'react';

type Toggle = number | boolean;
type Term = { id: string; academic_year: string; cycle: string; is_current: Toggle };
type Lab = { id: string; code: string; name: string; notes: string; active: Toggle };
type Configuration = { days: 5 | 6; periodsPerDay: number; saturdayPeriods: number; breakAfter: number };
type Clock = { periods: { number: number; start: string; end: string }[]; lunchStart: string; lunchEnd: string; confirmed: boolean };
type SaturdayPolicy = { campusPeriods: 0 | 3 | 6; confirmed: boolean;
  offerings: { offeringId: string; semesterNumber: number; active: boolean; override: 0 | 3 | 6 | null; effective: number }[] };
const referenceClock: Clock = {
  periods: [
    { number: 1, start: '09:45', end: '10:45' }, { number: 2, start: '10:45', end: '11:45' },
    { number: 3, start: '11:45', end: '12:45' }, { number: 4, start: '13:45', end: '14:45' },
    { number: 5, start: '14:45', end: '15:45' }, { number: 6, start: '15:45', end: '16:45' },
  ], lunchStart: '12:45', lunchEnd: '13:45', confirmed: false,
};
const showTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const timeMins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const clockBlockOK = (clock: Clock, p: number) => p !== 3 && p >= 1 && p < 6 &&
  clock.periods[p - 1] && clock.periods[p] &&
  clock.periods[p - 1].end === clock.periods[p].start &&
  timeMins(clock.periods[p].end) - timeMins(clock.periods[p - 1].start) === 120;

type Allocation = {
  id: string; section_id: string; subject_id: string; faculty_id: string | null;
  weekly_hours: number; active: Toggle; kind: string; subject_name: string;
  subject_code: string; section_code: string; semester_number: number;
  section_active: Toggle; semester_active: Toggle; subject_active: Toggle;
  faculty_name: string | null; faculty_active: Toggle | null;
};
type BookingType = 'BCA' | 'External' | 'Maintenance';
type Mode = 'Weekly' | 'Dated';
type Booking = {
  id: string; term_id: string; lab_id: string; lab_name: string; lab_code: string;
  booking_type: BookingType; mode: Mode; weekday: number; booking_date: string | null;
  start_period: number; period_count: number; allocation_id: string | null;
  section_id: string | null; faculty_id: string | null; owner_label: string; notes: string;
  active: Toggle; current_faculty_id: string | null; allocation_active: Toggle | null; subject_name: string | null; semester_number: number | null;
  section_code: string | null; faculty_name: string | null;
};
type BookingInput = {
  id?: string; termId: string; labId: string; bookingType: BookingType; mode: Mode;
  weekday: number; bookingDate: string | null; startPeriod: number;
  allocationId: string | null; ownerLabel: string; notes: string;
};
type LabAPI = {
  list(): Promise<Lab[]>;
  seedThree(): Promise<{ added: number }>;
  save(input: { id?: string; code: string; name: string; notes: string }): Promise<Lab>;
  setActive(id: string, active: boolean): Promise<{ success: boolean }>;
  getConfig(): Promise<Configuration>;
  getClock(): Promise<Clock>;
  saveClock(clock: Clock): Promise<Clock>;
  getSaturdayPolicy(termId: string): Promise<SaturdayPolicy>;
  saveSaturdayPolicy(input: { termId: string; campusPeriods: 0 | 3 | 6 }): Promise<SaturdayPolicy>;
  saveSemesterSaturday(input: { termId: string; offeringId: string; periods: 0 | 3 | 6 | null }): Promise<SaturdayPolicy>;
  saveConfig(input: Configuration): Promise<Configuration>;
  listBookings(termId: string): Promise<Booking[]>;
  saveBooking(input: BookingInput): Promise<Booking>;
  cancelBooking(id: string): Promise<{ success: boolean }>;
};
type API = {
  academic: { listTerms(): Promise<Term[]> };
  allocations: { list(termId: string): Promise<Allocation[]> };
  labs: LabAPI;
};
const api = (window as unknown as { electronAPI?: API }).electronAPI;
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const enabled = (x: Toggle | null | undefined) => Number(x) === 1;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const control: React.CSSProperties = { display: 'block', marginTop: 5, padding: '8px 10px', border: '1px solid #b6c5c1', borderRadius: 6, boxSizing: 'border-box', width: '100%' };
const card: React.CSSProperties = { border: '1px solid #d7e2df', borderRadius: 10, padding: 18, marginTop: 16, background: '#fff' };
const rowCell: React.CSSProperties = { padding: '8px 10px', borderTop: '1px solid #e0e7e5', verticalAlign: 'middle', fontSize: 13 };
const titleStyle: React.CSSProperties = { margin: '0 0 9px', fontSize: 19 };
const button: React.CSSProperties = { padding: '8px 13px', cursor: 'pointer' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const labelFor = (a: Allocation) => `Sem ${romans[a.semester_number]}-${a.section_code} · ${a.subject_name} · ${a.weekly_hours} periods/week${a.faculty_name ? ` · ${a.faculty_name}` : ' · Faculty unassigned'}`;

export default function Laboratories() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState('');
  const [labs, setLabs] = useState<Lab[]>([]);
  const [configuration, setConfiguration] = useState<Configuration>({ days: 6, periodsPerDay: 6, saturdayPeriods: 3, breakAfter: 3 });
  const [clock, setClock] = useState<Clock>(referenceClock);
  const [saturday, setSaturday] = useState<SaturdayPolicy>({ campusPeriods: 3, confirmed: false, offerings: [] });
  const [satCampusEdit, setSatCampusEdit] = useState<0 | 3 | 6>(3);
  const [satSemesterEdits, setSatSemesterEdits] = useState<Record<string, string>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Lab editor
  const [editLabId, setEditLabId] = useState<string | undefined>();
  const [labCode, setLabCode] = useState('');
  const [labName, setLabName] = useState('');
  const [labNotes, setLabNotes] = useState('');

  // Booking editor
  const [editBookingId, setEditBookingId] = useState<string | undefined>();
  const [selectedLabId, setSelectedLabId] = useState('');
  const [bookingType, setBookingType] = useState<BookingType>('External');
  const [mode, setMode] = useState<Mode>('Weekly');
  const [weekday, setWeekday] = useState(0);
  const [bookingDate, setBookingDate] = useState(today());
  const [startPeriod, setStartPeriod] = useState(1);
  const [allocationId, setAllocationId] = useState('');
  const [ownerLabel, setOwnerLabel] = useState('');
  const [bookingNotes, setBookingNotes] = useState('');
  const [gridLabId, setGridLabId] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); setRevision(n => n + 1); }
    catch (err: unknown) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all([api.labs.list(), api.labs.getConfig(), api.labs.getClock(), api.academic.listTerms()]).then(([labsFound, config, fetchedClock, allTerms]) => {
      if (cancelled) return;
      setLabs(labsFound);
      setConfiguration(config);
      setClock(fetchedClock);
      setTerms(allTerms);
      setTermId(prev => allTerms.some(t => t.id === prev) ? prev : allTerms.find(t => enabled(t.is_current))?.id || allTerms[0]?.id || '');
      setSelectedLabId(prev => labsFound.some(l => l.id === prev) ? prev : labsFound.find(l => enabled(l.active))?.id || '');
      setGridLabId(prev => labsFound.some(l => l.id === prev) ? prev : labsFound[0]?.id || '');
    }).catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    if (!api || !termId) { setBookings([]); setAllocations([]); return; }
    let cancelled = false;
    void Promise.all([api.labs.listBookings(termId), api.allocations.list(termId)]).then(([bs, as]) => {
      if (cancelled) return;
      setBookings(bs); setAllocations(as);
    }).catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [termId, revision]);

  useEffect(() => {
    if (!api || !termId) return;
    let cancelled = false;
    void api.labs.getSaturdayPolicy(termId).then(policy => {
      if (cancelled) return;
      setSaturday(policy);
      setSatCampusEdit(policy.campusPeriods);
      setSatSemesterEdits(Object.fromEntries(policy.offerings.map(o => [o.offeringId, o.override === null ? 'inherit' : String(o.override)])));
    }).catch(err => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [termId, revision]);

  const activeLabs = labs.filter(l => enabled(l.active));
  const practicals = allocations.filter(a => a.kind === 'Lab' && enabled(a.active) && enabled(a.subject_active) && enabled(a.section_active) && enabled(a.semester_active));
  const activeBookings = bookings.filter(b => enabled(b.active));
  const scheduledWeekly = useMemo(() => {
    const result = new Map<string, number>();
    for (const b of activeBookings) if (b.booking_type === 'BCA' && b.mode === 'Weekly' && b.allocation_id) {
      result.set(b.allocation_id, (result.get(b.allocation_id) || 0) + 2);
    }
    return result;
  }, [bookings]);
  const selectedGridLab = labs.find(l => l.id === gridLabId);

  function resetLab() { setEditLabId(undefined); setLabCode(''); setLabName(''); setLabNotes(''); }
  function editLab(lab: Lab) { setEditLabId(lab.id); setLabCode(lab.code); setLabName(lab.name); setLabNotes(lab.notes); }
  function resetBooking() {
    setEditBookingId(undefined); setBookingType('External'); setMode('Weekly');
    setWeekday(0); setBookingDate(today()); setStartPeriod(1);
    setAllocationId(''); setOwnerLabel(''); setBookingNotes('');
  }
  function editBooking(b: Booking) {
    setEditBookingId(b.id); setSelectedLabId(b.lab_id); setBookingType(b.booking_type);
    setMode(b.mode); setWeekday(Number(b.weekday)); setBookingDate(b.booking_date || today());
    setStartPeriod(Number(b.start_period)); setAllocationId(b.allocation_id || '');
    setOwnerLabel(b.owner_label); setBookingNotes(b.notes);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function saveLab(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!api) return;
    void run(async () => {
      await api.labs.save({ id: editLabId, code: labCode, name: labName, notes: labNotes });
      resetLab(); setSuccess('Laboratory saved.');
    });
  }
  function saveBooking(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!api || !termId || !selectedLabId) return;
    void run(async () => {
      await api.labs.saveBooking({ id: editBookingId, termId, labId: selectedLabId,
        bookingType, mode, weekday, bookingDate: mode === 'Dated' ? bookingDate : null,
        startPeriod, allocationId: bookingType === 'BCA' ? allocationId || null : null,
        ownerLabel, notes: bookingNotes });
      setSuccess('Two-period laboratory reservation saved.'); resetBooking();
    });
  }
  const selectedDay = mode === 'Dated' && /^\d{4}-\d{2}-\d{2}$/.test(bookingDate)
    ? (new Date(`${bookingDate}T12:00:00Z`).getUTCDay() + 6) % 7 : weekday;
  const isSaturday = selectedDay === 5;
  const selectedPractical = practicals.find(a => a.id === allocationId);
  const semesterPolicy = saturday.offerings.find(o => o.semesterNumber === selectedPractical?.semester_number);
  const maxPeriods = isSaturday
    ? (!saturday.confirmed ? 0 : (bookingType === 'BCA' ? (semesterPolicy?.effective ?? 0) : saturday.campusPeriods))
    : configuration.periodsPerDay;

  return (
    <main style={{ maxWidth: 1300, margin: '0 auto', padding: '24px 28px', fontFamily: 'system-ui, sans-serif', color: '#213b35' }}>
      <h1 style={{ marginBottom: 6 }}>BCA — Shared Laboratories</h1>
      <p style={{ color: '#536b64', marginTop: 0 }}>Register the college's shared labs, reserve them for other departments, and allocate continuous two-period BCA practical sessions.</p>
      <p style={{ background: '#f0f8f5', padding: 12, borderRadius: 7, border: '1px solid #c8e0d5' }}>
        <strong>College clock confirmed:</strong> Six 60-minute teaching periods, 9:45 AM–4:45 PM,
        with lunch from 12:45 PM–1:45 PM. Saturday is configured per academic term and (if needed) per BCA semester.
        Different Saturday dates and holidays are not yet modelled; do not use this as a finalized calendar.
      </p>
      {!api && <p role="alert" style={{ color: '#ad312c' }}>Open this module in the Electron desktop application.</p>}
      {error && <p role="alert" style={{ color: '#ad312c', background: '#fff0ee', padding: 13 }}>{error}</p>}
      {success && <p role="status" style={{ color: '#205d46', background: '#edf8ef', padding: 13 }}>{success}</p>}

      <section style={card}>
        <h2 style={titleStyle}>1. College period timings and Saturday schedule</h2>
        <label style={{ display: 'block', maxWidth: 360 }}>Academic term
          <select style={control} value={termId} onChange={e => { setTermId(e.target.value); resetBooking(); }}>
            {terms.map(t => <option value={t.id} key={t.id}>{t.academic_year} — {t.cycle}{enabled(t.is_current) ? ' (Current)' : ''}</option>)}
          </select>
        </label>
        {!terms.length && <p>Create an academic term in Academic Setup first.</p>}
        <h3>Shared teaching-period clock</h3>
        <p style={{ fontSize: 13, color: '#536b64' }}>These clock times apply to all BCA semesters. The initial values are based on your confirmed faculty timetable. Save once to mark them verified.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', maxWidth: 630, gap: 10 }}>
          {clock.periods.map((period, index) => <React.Fragment key={period.number}>
            <label style={{ alignSelf: 'end', fontWeight: 600 }}>P{period.number}</label>
            <label>Start<input style={control} type="time" value={period.start} onChange={e => setClock(c => ({ ...c, confirmed: false, periods: c.periods.map((p, i) => i === index ? { ...p, start: e.target.value } : p) }))} /></label>
            <label>End<input style={control} type="time" value={period.end} onChange={e => setClock(c => ({ ...c, confirmed: false, periods: c.periods.map((p, i) => i === index ? { ...p, end: e.target.value } : p) }))} /></label>
          </React.Fragment>)}
          <label style={{ alignSelf: 'end', fontWeight: 600 }}>Lunch break</label>
          <label>Start<input style={control} type="time" value={clock.lunchStart} onChange={e => setClock(c => ({ ...c, confirmed: false, lunchStart: e.target.value }))} /></label>
          <label>End<input style={control} type="time" value={clock.lunchEnd} onChange={e => setClock(c => ({ ...c, confirmed: false, lunchEnd: e.target.value }))} /></label>
        </div>
        <button style={{ ...button, marginTop: 12 }} disabled={busy || !api} onClick={() => { if (api) void run(async () => {
          const saved = await api.labs.saveClock(clock); setClock(saved); setSuccess('College period times saved and verified.');
        }); }}>Save and confirm period timings</button>
        <div style={{ marginTop: 8, fontSize: 13 }}>Verification status: <strong>{clock.confirmed ? 'Confirmed and saved' : 'Needs confirmation'}</strong>. Only 120-minute uninterrupted lab blocks may be booked.</div>

        <h3 style={{ marginTop: 24 }}>Saturday campus hours for the selected term</h3>
        <p style={{ fontSize: 13, color: '#536b64' }}>Choose the campus-wide maximum for this term. The legacy 3-period value is provisional until you save it; Semester II, IV and VI may have different Saturday schedules.</p>
        <div style={{ display: 'flex', alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
          <label>Campus Saturday timetable
            <select style={control} value={satCampusEdit} onChange={e => setSatCampusEdit(Number(e.target.value) as 0 | 3 | 6)}>
              <option value={0}>Closed — 0 periods</option>
              <option value={3}>Half day — P1 to P3 (ends 12:45 PM)</option>
              <option value={6}>Full day — P1 to P6 (ends 4:45 PM)</option>
            </select>
          </label>
          <button style={button} disabled={!api || !termId || busy} onClick={() => { if (api && termId) void run(async () => {
            const saved = await api.labs.saveSaturdayPolicy({ termId, campusPeriods: satCampusEdit });
            setSaturday(saved); setSuccess('Saturday campus policy saved for this academic term.');
          }); }}>Confirm Saturday campus hours</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13 }}>Term Saturday policy: <strong>{saturday.confirmed ? 'Confirmed' : 'NOT confirmed — Saturday bookings blocked'}</strong></div>
        <h3 style={{ marginTop: 22 }}>Semester-specific Saturday overrides</h3>
        <p style={{ fontSize: 13, color: '#536b64' }}>Use “Follow campus” unless a semester follows a different Saturday pattern. Semester hours cannot exceed campus hours. Changes that invalidate bookings are rejected.</p>
        {saturday.offerings.filter(o => o.active).map(o => <div key={o.offeringId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 10 }}>
          <strong style={{ minWidth: 105 }}>Semester {romans[o.semesterNumber]}</strong>
          <select style={{ ...control, maxWidth: 270 }} value={satSemesterEdits[o.offeringId] ?? 'inherit'} onChange={e => setSatSemesterEdits(prev => ({ ...prev, [o.offeringId]: e.target.value }))}>
            <option value="inherit">Follow campus hours</option>
            <option value="0">Closed — 0 periods</option>
            <option value="3">Half day — P1–P3</option>
            <option value="6">Full day — P1–P6</option>
          </select>
          <button style={button} disabled={!api || !termId || busy || !saturday.confirmed} onClick={() => {
            if (!api || !termId) return;
            const raw = satSemesterEdits[o.offeringId] ?? 'inherit';
            void run(async () => {
              const saved = await api.labs.saveSemesterSaturday({ termId, offeringId: o.offeringId, periods: raw === 'inherit' ? null : Number(raw) as 0 | 3 | 6 });
              setSaturday(saved); setSuccess(`Semester ${romans[o.semesterNumber]} Saturday policy saved.`);
            });
          }}>Save semester</button>
          <span style={{ fontSize: 13 }}>Current: P1–P{o.effective} {o.effective === 0 ? '(closed)' : ''}</span>
        </div>)}
        {!saturday.offerings.some(o => o.active) && <p>Activate semesters in Academic Setup to configure their Saturday schedules.</p>}
        <small>Saturday patterns are weekly templates, not date-specific exceptions. Do not assume college holidays or special Saturdays have been accounted for.</small>
      </section>
      <section style={card}>
        <h2 style={titleStyle}>2. Laboratory register</h2>
        <p style={{ color: '#536b64', fontSize: 13 }}>The college currently has 3 shared physical laboratories. Their names, codes, and availability are editable. Additional rooms can be entered if facilities change.</p>
        {!labs.length && <button disabled={busy || !api} style={button} onClick={() => { if (api && window.confirm('Create three editable placeholders: Laboratory 1, 2 and 3?')) void run(async () => { await api.labs.seedThree(); setSuccess('Three editable laboratory placeholders created.'); }); }}>Create three laboratory placeholders</button>}
        <form onSubmit={saveLab} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 1fr) minmax(160px, 2fr) minmax(160px, 2fr) auto', alignItems: 'end', gap: 10, marginTop: 14 }}>
          <label>Code<input style={control} value={labCode} required maxLength={16} onChange={e => setLabCode(e.target.value)} placeholder="LAB1" /></label>
          <label>Name<input style={control} value={labName} required maxLength={100} onChange={e => setLabName(e.target.value)} placeholder="Computer Lab 1" /></label>
          <label>Notes<input style={control} value={labNotes} maxLength={240} onChange={e => setLabNotes(e.target.value)} placeholder="Special equipment or restrictions" /></label>
          <div><button disabled={busy || !api} style={button} type="submit">{editLabId ? 'Update' : 'Add'} lab</button>{editLabId && <button style={button} type="button" onClick={resetLab}>Cancel</button>}</div>
        </form>
        <div style={{ overflowX: 'auto', marginTop: 15 }}><table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left' }}>
          <thead><tr><th>Code</th><th>Laboratory</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{labs.map(l => <tr key={l.id}>
            <td style={rowCell}>{l.code}</td><td style={rowCell}>{l.name}</td><td style={rowCell}>{l.notes}</td>
            <td style={rowCell}>{enabled(l.active) ? 'Active' : 'Inactive'}</td>
            <td style={rowCell}><button style={button} onClick={() => editLab(l)}>Edit</button>{' '}
              <button style={button} disabled={busy} onClick={() => { if (api && window.confirm(`Change ${l.name} to ${enabled(l.active) ? 'inactive' : 'active'}?`)) void run(async () => { await api.labs.setActive(l.id, !enabled(l.active)); }); }}>{enabled(l.active) ? 'Deactivate' : 'Reactivate'}</button>
            </td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section style={card}>
        <h2 style={titleStyle}>3. Book two consecutive periods</h2>
        <form onSubmit={saveBooking} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 13 }}>
          <label>Laboratory<select style={control} required value={selectedLabId} onChange={e => setSelectedLabId(e.target.value)}>
            <option value="">Choose lab</option>{activeLabs.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
          </select></label>
          <label>Reserved for<select style={control} value={bookingType} onChange={e => setBookingType(e.target.value as BookingType)}>
            <option value="External">Other department</option><option value="BCA">BCA practical</option><option value="Maintenance">Maintenance/unavailable</option>
          </select></label>
          <label>Frequency<select style={control} value={mode} onChange={e => setMode(e.target.value as Mode)}>
            <option value="Weekly">Repeat weekly during this term</option><option value="Dated">Specific calendar date</option>
          </select></label>
          {mode === 'Weekly' ? <label>Weekday<select style={control} value={weekday} onChange={e => setWeekday(Number(e.target.value))}>
            {days.slice(0, configuration.days).map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select></label> : <label>Calendar date<input style={control} required type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} /></label>}
          <label>Starting period<select style={control} value={startPeriod} onChange={e => setStartPeriod(Number(e.target.value))}>
            {Array.from({ length: Math.max(0, maxPeriods - 1) }, (_, index) => index + 1)
              .filter(p => clockBlockOK(clock, p)).map(p => <option key={p} value={p}>
                P{p} + P{p + 1} ({showTime(clock.periods[p - 1].start)}–{showTime(clock.periods[p].end)})
              </option>)}
          </select></label>
          {bookingType === 'BCA' ? <label style={{ gridColumn: '1 / -1' }}>BCA practical allocation
            <select style={control} value={allocationId} required onChange={e => setAllocationId(e.target.value)}>
              <option value="">Choose an active lab allocation</option>
              {practicals.map(a => <option key={a.id} value={a.id}>{labelFor(a)}</option>)}
            </select>
          </label> : <label>Department / owner<input style={control} value={ownerLabel} required={bookingType === 'External'} maxLength={100} onChange={e => setOwnerLabel(e.target.value)} placeholder={bookingType === 'External' ? 'e.g. Commerce Department' : 'Maintenance'} /></label>}
          <label style={{ gridColumn: '1 / -1' }}>Notes<input style={control} value={bookingNotes} maxLength={240} onChange={e => setBookingNotes(e.target.value)} placeholder="Optional equipment, approval, or reason" /></label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
            <button style={{ ...button, background: '#1d6b67', color: '#fff', border: 0, borderRadius: 6 }} type="submit" disabled={!api || !termId || !selectedLabId || busy}>{editBookingId ? 'Update / restore reservation' : 'Reserve 2 periods'}</button>
            {editBookingId && <button style={button} type="button" onClick={resetBooking}>Cancel editing</button>}
          </div>
        </form>
        <p style={{ fontSize: 13, color: '#586c65' }}>Lab bookings cannot overlap another booking for the same lab, BCA section, or assigned faculty; nor cross a break. External bookings block lab availability. This does not yet check clashes with theory classes, clubs, sports or certification events in the future complete timetable.</p>
      </section>

      <section style={card}>
        <h2 style={titleStyle}>4. Bookings for selected academic term</h2>
        <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left' }}>
          <thead><tr><th>Lab</th><th>Time</th><th>Reserved for</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{bookings.map(b => <tr key={b.id}>
            <td style={rowCell}>{b.lab_code}</td>
            <td style={rowCell}>{b.mode === 'Dated' ? b.booking_date : `${days[b.weekday]} (weekly)`} · P{b.start_period}–P{Number(b.start_period) + 1}</td>
            <td style={rowCell}>{b.booking_type === 'BCA' ? `BCA Sem ${romans[b.semester_number || 0]}-${b.section_code} · ${b.subject_name || ''} · ${b.faculty_name || 'Faculty unassigned'}` : `${b.booking_type}: ${b.owner_label}`}{b.notes && <div style={{ color: '#637b74', fontSize: 12 }}>{b.notes}</div>}{b.booking_type === 'BCA' && (b.faculty_id !== b.current_faculty_id || !enabled(b.allocation_active)) && <div style={{ color: '#a54427', fontSize: 12 }}>Allocation changed or deactivated since this booking: review and re-save.</div>}</td>
            <td style={rowCell}>{enabled(b.active) ? 'Active' : 'Cancelled'}</td>
            <td style={rowCell}><button style={button} disabled={busy} onClick={() => editBooking(b)}>Edit{enabled(b.active) ? '' : ' / restore'}</button>{' '}
              {enabled(b.active) && <button style={button} disabled={busy} onClick={() => { if (api && window.confirm('Cancel this lab reservation? It will remain in the history.')) void run(async () => { await api.labs.cancelBooking(b.id); }); }}>Cancel booking</button>}
            </td>
          </tr>)}</tbody>
        </table></div>
        {!bookings.length && <p>No lab bookings have been entered for this term.</p>}
      </section>

      <section style={card}>
        <h2 style={titleStyle}>5. Weekly laboratory availability preview</h2>
        <label style={{ display: 'block', maxWidth: 300 }}>Laboratory<select style={control} value={gridLabId} onChange={e => setGridLabId(e.target.value)}>
          <option value="">Choose lab</option>{labs.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
        </select></label>
        {selectedGridLab && <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 650, textAlign: 'center' }}>
            <thead><tr><th>Day</th>{Array.from({ length: configuration.periodsPerDay }, (_, i) => <th key={i}>P{i + 1}</th>)}</tr></thead>
            <tbody>{days.slice(0, configuration.days).map((day, d) => <tr key={day}>
              <th style={rowCell}>{day}</th>
              {Array.from({ length: configuration.periodsPerDay }, (_, i) => {
                const p = i + 1;
                const off = d === 5 && (!saturday.confirmed || p > saturday.campusPeriods);
                const hits = activeBookings.filter(b => b.lab_id === selectedGridLab.id && b.mode === 'Weekly' && Number(b.weekday) === d && p >= b.start_period && p < Number(b.start_period) + 2);
                return <td key={i} style={{ ...rowCell, background: off ? '#f2f2f2' : hits.length ? '#fce9e4' : '#edf7f1', minWidth: 75 }}>
                  {off ? '—' : hits.length ? hits.map(b => b.booking_type === 'BCA' ? 'BCA' : b.booking_type === 'External' ? 'External' : 'Blocked').join(', ') : 'Free'}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>}
        <small>This grid shows recurring weekly lab reservations against campus open hours. Semester-specific Saturday teaching restrictions are validated when creating BCA bookings. Dated bookings appear separately; holiday/date exceptions are not yet configured.</small>
      </section>

      <section style={card}>
        <h2 style={titleStyle}>6. Lab workload reconciliation</h2>
        <p style={{ fontSize: 13, color: '#586c65' }}>Compare the subject allocation's required weekly periods with the reserved weekly lab periods. A 3-period subject cannot be fully scheduled using only two-period blocks.</p>
        <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left' }}>
          <thead><tr><th>Section · Practical</th><th>Required</th><th>Reserved weekly</th><th>Remaining</th><th>Warning</th></tr></thead>
          <tbody>{practicals.map(a => {
            const placed = scheduledWeekly.get(a.id) || 0;
            const remaining = Number(a.weekly_hours) - placed;
            return <tr key={a.id}>
              <td style={rowCell}>{labelFor(a)}</td>
              <td style={rowCell}>{a.weekly_hours}</td><td style={rowCell}>{placed}</td>
              <td style={rowCell}>{remaining}</td>
              <td style={{ ...rowCell, color: remaining < 0 || Number(a.weekly_hours) % 2 !== 0 ? '#9e3d28' : '#3c6a4d' }}>
                {Number(a.weekly_hours) % 2 !== 0 ? 'Odd-hour requirement: manual resolution needed' : remaining > 0 ? 'Not fully booked' : remaining < 0 ? 'Overbooked' : 'Matched'}
                {!a.faculty_id ? ' · Faculty unassigned' : ''}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
        {!practicals.length && <p>Assign a BCA laboratory subject to a section under Subjects & Workload first.</p>}
      </section>
    </main>
  );
}
