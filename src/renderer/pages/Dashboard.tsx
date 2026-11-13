import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './Dashboard.css';

// The dashboard deliberately reads only existing authenticated IPC methods.
// No writable IPC endpoints, database migrations, or new permissions are needed.
type AcademicTerm = { id: string; academic_year: string; cycle: 'Odd' | 'Even'; is_current: number };
type Faculty = { id: string; name: string; active: number };
type Laboratory = { id: string; active: number };
type ScheduleEvent = { source: 'Lab' | 'Activity' | 'Theory'; mode: 'Weekly' | 'Dated' };
type Unplaced = { allocationId: string; sectionId: string; subject: string; kind: string; required: number; placed: number; remaining: number };
type MasterSnapshot = {
  term: { id: string; academicYear: string; cycle: string };
  sections: Array<{ id: string; label: string }>;
  events: ScheduleEvent[];
  unplaced: Unplaced[];
  conflicts: string[];
  note: string;
  clock: { confirmed?: boolean } | null;
};
type Publication = { id: string; version: number; status: 'REVIEW' | 'APPROVED' | 'PUBLISHED'; createdAt: string };
type SaturdayPolicy = { confirmed: boolean };
type Activity = { active: number; mode: 'Weekly' | 'Dated' };
type DashboardApi = {
  academic: { listTerms(): Promise<AcademicTerm[]> };
  facultyIdentity: { list(): Promise<Faculty[]> };
  labs: { list(): Promise<Laboratory[]>; getSaturdayPolicy(termId: string): Promise<SaturdayPolicy> };
  master: { snapshot(termId: string, date: null): Promise<MasterSnapshot> };
  publication: { list(termId: string): Promise<Publication[]> };
  activities: { list(termId: string): Promise<Activity[]> };
};
function desktopApi(): DashboardApi | undefined {
  return (window as unknown as { electronAPI?: DashboardApi }).electronAPI;
}
function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function Icon({ name }: { name: 'calendar' | 'people' | 'building' | 'grid' | 'clock' | 'alert' | 'check' | 'arrow' | 'file' | 'refresh' | 'shield' | 'bolt' }) {
  const common = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<typeof name, React.ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/></>,
    building: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-6h4v6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
    alert: <><path d="M10.3 4.4 2.5 18.1A2 2 0 0 0 4.2 21h15.6a2 2 0 0 0 1.7-2.9L13.7 4.4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.4 9A8 8 0 0 1 19 7l1 5M4 12l1 5a8 8 0 0 0 13.6-2"/></>,
    shield: <><path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></>,
    bolt: <><path d="M13 2 4 14h7l-1 8 10-13h-7z"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Metric({ label, value, note, icon, intent }: { label: string; value: number | string; note: string; icon: Parameters<typeof Icon>[0]['name']; intent?: 'warning' | 'good' }) {
  return <div className={`bca-db-metric ${intent ? `bca-db-metric--${intent}` : ''}`}>
    <div className="bca-db-metric-top"><span>{label}</span><span className="bca-db-metric-icon"><Icon name={icon}/></span></div>
    <div className="bca-db-number">{value}</div>
    <div className="bca-db-muted">{note}</div>
  </div>;
}

export default function Dashboard() {
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [labs, setLabs] = useState<Laboratory[]>([]);
  const [snapshot, setSnapshot] = useState<MasterSnapshot | null>(null);
  const [versions, setVersions] = useState<Publication[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [saturday, setSaturday] = useState<SaturdayPolicy | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const api = desktopApi(); let mounted = true;
    if (!api) { setError('The dashboard is available in the Electron desktop application after signing in.'); setBusy(false); return; }
    void Promise.all([api.academic.listTerms(), api.facultyIdentity.list(), api.labs.list()])
      .then(([t, f, l]) => { if (!mounted) return; setTerms(t); setFaculty(f); setLabs(l); setSelectedTerm(prev => t.some(x => x.id === prev) ? prev : (t.find(x => Number(x.is_current) === 1)?.id || t[0]?.id || '')); })
      .catch(e => { if (mounted) setError(errorText(e)); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, [refreshKey]);

  useEffect(() => {
    const api = desktopApi(); let mounted = true;
    if (!selectedTerm || !api) { setSnapshot(null); setVersions([]); setActivities([]); setSaturday(null); return; }
    setBusy(true); setError(''); setSnapshot(null);
    void Promise.all([
      api.master.snapshot(selectedTerm, null), api.publication.list(selectedTerm),
      api.activities.list(selectedTerm), api.labs.getSaturdayPolicy(selectedTerm),
    ]).then(([s, v, a, sat]) => {
      if (!mounted) return; setSnapshot(s); setVersions(v); setActivities(a); setSaturday(sat);
    }).catch(e => { if (mounted) setError(errorText(e)); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, [selectedTerm, refreshKey]);

  const stats = useMemo(() => {
    const unplaced = snapshot?.unplaced.reduce((n, row) => n + Math.max(0, Number(row.remaining) || 0), 0) ?? 0;
    const required = snapshot?.unplaced.reduce((n, row) => n + Math.max(0, Number(row.required) || 0), 0) ?? 0;
    const labPending = snapshot?.unplaced.filter(x => x.kind === 'Lab').reduce((n, r) => n + Math.max(0, Number(r.remaining) || 0), 0) ?? 0;
    const clashes = snapshot?.conflicts.length ?? 0;
    const draftStale = snapshot?.note.includes('STALE') ?? false;
    const theory = snapshot?.events.filter(x => x.source === 'Theory').length ?? 0;
    const labsWeekly = snapshot?.events.filter(x => x.source === 'Lab').length ?? 0;
    const weeklyActivities = snapshot?.events.filter(x => x.source === 'Activity').length ?? 0;
    const datedActivities = activities.filter(a => Number(a.active) === 1 && a.mode === 'Dated').length;
    const latest = [...versions].sort((a, b) => b.version - a.version)[0];
    return { unplaced, required, labPending, clashes, draftStale, theory, labsWeekly, weeklyActivities, datedActivities, latest };
  }, [snapshot, activities, versions]);

  const alerts = useMemo(() => {
    if (!snapshot) return [] as { severity: 'warn' | 'info'; title: string; message: string; path: string }[];
    const list: { severity: 'warn' | 'info'; title: string; message: string; path: string }[] = [];
    if (stats.clashes > 0) list.push({ severity: 'warn', title: `${stats.clashes} scheduling collision(s)`, message: 'Review overlapping faculty, section, or laboratory periods.', path: '/master' });
    if (stats.unplaced > 0) list.push({ severity: 'warn', title: `${stats.unplaced} allocated period(s) remain unplaced`, message: 'Check faculty allocations and laboratory bookings before preparing an official review.', path: '/master' });
    if (stats.draftStale) list.push({ severity: 'warn', title: 'Saved theory draft is outdated', message: 'The underlying allocations changed. Regenerate and save a new theory draft.', path: '/theory-generator' });
    if (!snapshot.clock?.confirmed) list.push({ severity: 'warn', title: 'Period clock not confirmed', message: 'Confirm the college teaching periods and breaks.', path: '/labs' });
    if (!saturday?.confirmed) list.push({ severity: 'warn', title: 'Saturday policy not confirmed', message: 'Set this term’s approved Saturday campus schedule.', path: '/labs' });
    if (snapshot.sections.length === 0) list.push({ severity: 'warn', title: 'No active sections in this term', message: 'Activate the relevant BCA semesters and sections.', path: '/academic' });
    if (stats.required === 0 && snapshot.sections.length > 0) list.push({ severity: 'info', title: 'No active subject allocations found', message: 'Import the syllabus and allocate the required teaching hours.', path: '/subjects' });
    if (!stats.latest) list.push({ severity: 'info', title: 'No review version created', message: 'After the timetable is complete, prepare a draft for HOD review.', path: '/publication' });
    return list;
  }, [snapshot, stats, saturday]);

  const term = terms.find(t => t.id === selectedTerm);
  const status = !snapshot ? 'No timetable loaded' : stats.clashes > 0 ? 'Collisions to resolve' : stats.unplaced > 0 || stats.draftStale ? 'Scheduling in progress' : 'Allocated hours placed';
  const steps = [
    { title: 'Academic setup', desc: `${snapshot?.sections.length || 0} active section(s)`, path: '/academic', ready: Boolean(snapshot?.sections.length) },
    { title: 'Faculty & workload', desc: `${stats.required} allocated period(s)`, path: '/subjects', ready: stats.required > 0 },
    { title: 'Shared laboratories', desc: stats.labPending ? `${stats.labPending} lab period(s) left` : stats.required ? 'Allocated lab hours reconciled' : 'Check lab allocations', path: '/labs', ready: stats.required > 0 && stats.labPending === 0 },
    { title: 'Theory generation', desc: stats.draftStale ? 'Draft needs regeneration' : `${stats.theory} saved theory period(s)`, path: '/theory-generator', ready: stats.theory > 0 && !stats.draftStale },
    { title: 'HOD review & exports', desc: stats.latest ? `Version ${stats.latest.version} · ${stats.latest.status}` : 'No review version', path: '/publication', ready: stats.latest?.status === 'APPROVED' || stats.latest?.status === 'PUBLISHED' },
  ];
  const actions = [
    { title: 'Academic Setup', text: 'Semesters and sections', path: '/academic', icon: 'calendar' as const },
    { title: 'Faculty Management', text: 'Employee IDs and workload', path: '/faculty', icon: 'people' as const },
    { title: 'Book Laboratory', text: 'Shared resources and periods', path: '/labs', icon: 'grid' as const },
    { title: 'Generate Theory', text: 'Create a new timetable draft', path: '/theory-generator', icon: 'bolt' as const },
    { title: 'Master Timetable', text: 'Class, faculty and lab views', path: '/master', icon: 'calendar' as const },
    { title: 'HOD Approval & Exports', text: 'Versioned review documents', path: '/publication', icon: 'file' as const },
  ];

  return <main className="bca-db" aria-label="Timetable coordinator dashboard">
    <section className="bca-db-hero">
      <div className="bca-db-eyebrow"><Icon name="shield"/> COORDINATOR WORKSPACE</div>
      <h1>Department timetable dashboard</h1>
      <p>One overview of BCA scheduling, teaching allocations, laboratory reservations and HOD review. Figures come from saved records, not from sample data.</p>
      <div className="bca-db-controls">
        <label htmlFor="bca-db-term">Academic term</label>
        <select id="bca-db-term" value={selectedTerm} onChange={e => setSelectedTerm(e.target.value)} disabled={busy || terms.length === 0}>
          {terms.length === 0 ? <option value="">No academic term</option> : terms.map(t => <option key={t.id} value={t.id}>{t.academic_year} — {t.cycle}{Number(t.is_current) === 1 ? ' (Current)' : ''}</option>)}
        </select>
        <button type="button" onClick={() => setRefreshKey(x => x + 1)} disabled={busy}><Icon name="refresh"/>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
    </section>

    {error && <div className="bca-db-error" role="alert">Unable to load dashboard: {error}</div>}
    {!busy && !selectedTerm && !error && <div className="bca-db-empty">No academic term exists yet. <Link to="/academic">Create an academic term</Link> to begin.</div>}

    <div className="bca-db-section-heading"><h2>At a glance</h2><span>{term ? `${term.academic_year} · ${term.cycle}` : 'Select an academic term'}</span></div>
    <div className="bca-db-metrics">
      <Metric label="Active faculty" value={faculty.filter(f => Number(f.active) === 1).length} note="Across the faculty register" icon="people" />
      <Metric label="Active sections" value={snapshot?.sections.length ?? '—'} note="Selected academic term" icon="calendar" />
      <Metric label="Shared laboratories" value={labs.filter(l => Number(l.active) === 1).length} note="Active college lab records" icon="building" />
      <Metric label="Weekly lab reservations" value={snapshot ? stats.labsWeekly : '—'} note="BCA and external bookings" icon="grid" />
      <Metric label="Theory periods" value={snapshot ? stats.theory : '—'} note="Saved weekly theory draft" icon="clock" />
      <Metric label="Unplaced periods" value={snapshot ? stats.unplaced : '—'} note="Only active allocated hours" icon="alert" intent={stats.unplaced > 0 ? 'warning' : snapshot ? 'good' : undefined} />
    </div>

    <div className="bca-db-two-col">
      <section className="bca-db-panel">
        <div className="bca-db-panel-title"><div><h2>Scheduling readiness</h2><p>Checks based on current application records</p></div><span className="bca-db-status">{status}</span></div>
        <div className="bca-db-progress-track" aria-hidden="true"><div style={{ width: `${steps.filter(s => s.ready).length / steps.length * 100}%` }}/></div>
        <p className="bca-db-progress-caption">{steps.filter(s => s.ready).length} of {steps.length} workflow indicators met. This is not syllabus-completeness or approval certification.</p>
        <div className="bca-db-step-list">{steps.map((s, i) => <Link to={s.path} key={s.path} className="bca-db-step"><span className={`bca-db-step-index ${s.ready ? 'is-ready' : ''}`}>{s.ready ? <Icon name="check"/> : i + 1}</span><span><strong>{s.title}</strong><small>{s.desc}</small></span><Icon name="arrow"/></Link>)}</div>
      </section>
      <section className="bca-db-panel">
        <div className="bca-db-panel-title"><div><h2>Needs attention</h2><p>Priority checks for the selected term</p></div><span className="bca-db-attention-count">{alerts.length}</span></div>
        {!snapshot && <div className="bca-db-placeholder">{busy ? 'Loading scheduling checks…' : 'Choose a term to see alerts.'}</div>}
        {snapshot && alerts.length === 0 && <div className="bca-db-okay"><Icon name="check"/><div><strong>No detected setup alerts</strong><p>Review the syllabus and workload manually before requesting HOD approval.</p></div></div>}
        {snapshot && alerts.length > 0 && <div className="bca-db-alerts">{alerts.slice(0, 6).map((a, i) => <Link to={a.path} key={i} className="bca-db-alert"><span className={a.severity === 'warn' ? 'bca-db-alert-icon' : 'bca-db-info-icon'}><Icon name="alert"/></span><span><strong>{a.title}</strong><small>{a.message}</small></span><Icon name="arrow"/></Link>)}</div>}
      </section>
    </div>

    <div className="bca-db-section-heading"><h2>Quick actions</h2><span>Open a workspace</span></div>
    <div className="bca-db-actions">{actions.map(a => <Link to={a.path} key={a.path} className="bca-db-action"><span className="bca-db-action-icon"><Icon name={a.icon}/></span><span><strong>{a.title}</strong><small>{a.text}</small></span><Icon name="arrow"/></Link>)}</div>

    <section className="bca-db-bottom-note">
      <div><strong>Current review status</strong><p>{stats.latest ? `Most recent review: version ${stats.latest.version}, ${stats.latest.status.toLowerCase()}.` : 'No review version exists for this term yet.'} · {stats.datedActivities} active dated activity record(s); {stats.weeklyActivities} recurring activity reservation(s).</p></div>
      <Link to="/publication">Open approval register <Icon name="arrow"/></Link>
    </section>
    <p className="bca-db-disclaimer">Dashboard figures exclude subjects not yet allocated. Zero unplaced hours does not prove compliance with the approved university syllabus or college workload policy.</p>
  </main>;
}
