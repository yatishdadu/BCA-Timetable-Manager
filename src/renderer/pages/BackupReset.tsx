import React, { useEffect, useState } from 'react';

/** Phase 2E3C: backup, verified restore, and staged protected reset. */
type BackupResponse = { cancelled: boolean; folder?: string; evidenceFiles?: number; bytes?: number; createdAt?: string };
type PreparedRestore = { cancelled: boolean; id?: string; coordinator?: string; evidenceFiles?: number; bytes?: number; createdAt?: string };
type ResetMode = 'drafts' | 'term' | 'fresh';
type Impact = {mode:ResetMode;termId?:string;protectedVersions:number;approvalEvidence:number;draftVersions:number;theoryDrafts:number;labBookings:number;activities:number;allocations:number;subjects:number;faculty:number;blockers:string[]};
type PreparedReset = Impact & {cancelled:boolean;id?:string;backupFolder?:string;createdAt?:string;bytes?:number};
type Term = {id:string;academicYear?:string;academic_year?:string;cycle?:string;isCurrent?:boolean;is_current?:number};
type BackupApi = {
  create: () => Promise<BackupResponse>;
  verify: () => Promise<BackupResponse>;
  prepareRestore: () => Promise<PreparedRestore>;
  cancelRestore: () => Promise<{cancelled: boolean}>;
  confirmRestore: (input: {id: string; password: string; confirmation: 'RESTORE BACKUP'; understandsLoginReplacement: true}) => Promise<{restarting: boolean}>;
  previewReset: (input: {mode:ResetMode;termId?:string}) => Promise<Impact>;
  prepareReset: (input: {mode:ResetMode;termId?:string}) => Promise<PreparedReset>;
  cancelReset: () => Promise<{cancelled:boolean}>;
  confirmReset: (input: {id:string;password:string;phrase:'CLEAR DRAFTS'|'RESET TERM'|'START FRESH';acknowledged:true}) => Promise<{restarting:boolean}>;
};
function api(): BackupApi | undefined {
  return (window as unknown as { electronAPI?: { adminBackup?: BackupApi } }).electronAPI?.adminBackup;
}
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #dae6e1', borderRadius: 16, padding: 24, boxShadow: '0 8px 24px #133a2b0a' };
const button: React.CSSProperties = { background: '#176454', color: '#fff', border: 0, borderRadius: 9, padding: '12px 19px', fontWeight: 700, fontSize: 14, cursor: 'pointer' };

export default function BackupReset() {
  const [busy, setBusy] = useState<'backup' | 'verify' | 'prepare' | 'confirm' | 'reset-preview' | 'reset-prepare' | 'reset-confirm' | null>(null);
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [ack, setAck] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ action: string; data: BackupResponse } | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [mode, setMode] = useState<ResetMode>('drafts');
  const [termId, setTermId] = useState('');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [preparedReset, setPreparedReset] = useState<PreparedReset | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAcknowledge, setResetAcknowledge] = useState(false);
  const [resetRestarting, setResetRestarting] = useState(false);
  useEffect(() => {
    const academic = (window as unknown as {electronAPI?:{academic?:{listTerms:()=>Promise<Term[]>}}}).electronAPI?.academic;
    if (!academic) return;
    void academic.listTerms().then(rows => {
      setTerms(rows);
      setTermId(current => current || String((rows.find(r => r.isCurrent || r.is_current) || rows[0])?.id || ''));
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const resetChoice = () => mode === 'fresh' ? {mode} : {mode, termId};
  const requiredPhrase = mode === 'drafts' ? 'CLEAR DRAFTS' : mode === 'term' ? 'RESET TERM' : 'START FRESH';
  function changeResetMode(next: ResetMode) { setMode(next); setImpact(null); setResetPhrase(''); }
  function changeResetTerm(next: string) { setTermId(next); setImpact(null); setResetPhrase(''); }
  async function previewReset() {
    const client = api(); if (!client) return setError('Reset is only available in Electron.');
    setError(''); setBusy('reset-preview');
    try { setImpact(await client.previewReset(resetChoice())); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally {setBusy(null);}
  }
  async function prepareReset() {
    const client = api(); if (!client) return setError('Reset is only available in Electron.');
    setError(''); setBusy('reset-prepare');
    try {
      const result = await client.prepareReset(resetChoice());
      if (!result.cancelled) { setPreparedReset(result); setImpact(result); }
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally {setBusy(null);}
  }
  async function cancelReset() {
    const client=api(); if(!client) return;
    try { await client.cancelReset(); setPreparedReset(null); setResetPassword(''); setResetPhrase(''); setResetAcknowledge(false); setError(''); }
    catch(e) {setError(e instanceof Error ? e.message : String(e));}
  }
  async function confirmReset() {
    const client=api(); if(!client || !preparedReset?.id || !resetAcknowledge || resetPhrase!==requiredPhrase) return;
    setError(''); setBusy('reset-confirm');
    try {
      const res=await client.confirmReset({id:preparedReset.id,password:resetPassword,phrase:requiredPhrase,acknowledged:true});
      if(res.restarting) {setResetRestarting(true);setResetPassword('');setPreparedReset(null);}
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setBusy(null);}
  }

  async function run(action: 'backup' | 'verify') {
    const client = api();
    if (!client) { setError('Backup is available only inside the Electron desktop app.'); return; }
    setBusy(action); setError(''); setResult(null);
    try {
      const data = action === 'backup' ? await client.create() : await client.verify();
      if (!data.cancelled) setResult({ action, data });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function prepareRestore() {
    const client = api();
    if (!client) { setError('Restore is available only in the Electron application.'); return; }
    setBusy('prepare'); setError(''); setResult(null);
    try {
      const preview = await client.prepareRestore();
      if (!preview.cancelled) setPrepared(preview);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function cancelRestore() {
    const client = api();
    if (!client) return;
    try { await client.cancelRestore(); setPrepared(null); setPassword(''); setPhrase(''); setAck(false); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function confirmRestore() {
    const client = api();
    if (!client || !prepared?.id || !ack || phrase !== 'RESTORE BACKUP') return;
    setBusy('confirm'); setError('');
    try {
      const answer = await client.confirmRestore({ id: prepared.id, password, confirmation: 'RESTORE BACKUP', understandsLoginReplacement: true });
      if (answer.restarting) { setRestarting(true); setPassword(''); setPrepared(null); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  return <main style={{ maxWidth: 1120, margin: 'auto', padding: '35px 24px 70px', fontFamily: 'system-ui,sans-serif', color: '#183c34' }}>
    <header style={{ marginBottom: 24 }}>
      <p style={{ color: '#237064', textTransform: 'uppercase', letterSpacing: '.12em', fontSize: 12, fontWeight: 800 }}>Coordinator admin tools</p>
      <h1 style={{ fontSize: 34, margin: '4px 0' }}>Backup &amp; Reset</h1>
      <p style={{ color: '#526a64', maxWidth: 780 }}>Protect the timetable database, saved college branding, coordinator credentials and HOD approval attachments. Only signed-in coordinators can use these controls.</p>
    </header>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(310px,1fr))', gap: 20 }}>
      <section style={panel}>
        <div style={{ fontSize: 32 }} aria-hidden="true">📦</div>
        <h2 style={{ marginBottom: 8 }}>Backup Now</h2>
        <p style={{ color: '#526a64', lineHeight: 1.6 }}>Choose a separate folder or secure external drive. The app creates a new dated backup folder containing a consistent SQLite snapshot, referenced approval documents and a checksum manifest. It verifies the backup automatically before reporting success.</p>
        <button type="button" style={{ ...button, opacity: busy ? .65 : 1 }} disabled={busy !== null} onClick={() => void run('backup')}>{busy === 'backup' ? 'Creating & verifying…' : 'Choose folder & back up'}</button>
      </section>
      <section style={panel}>
        <div style={{ fontSize: 32 }} aria-hidden="true">🔎</div>
        <h2 style={{ marginBottom: 8 }}>Verify Existing Backup</h2>
        <p style={{ color: '#526a64', lineHeight: 1.6 }}>Select a previously created <strong>BCA-Backup</strong> folder. The app checks its SQLite file and compares checksums for the database and all recorded approval attachments. No data is restored or changed.</p>
        <button type="button" style={{ ...button, background: '#e3f0eb', color: '#17554a', opacity: busy ? .65 : 1 }} disabled={busy !== null} onClick={() => void run('verify')}>{busy === 'verify' ? 'Verifying…' : 'Choose backup to verify'}</button>
      </section>
    </div>
    {error && <div role="alert" style={{ ...panel, background: '#fff2ee', borderColor: '#fac5b5', color: '#9b2e1c', marginTop: 20 }}><strong>Operation failed.</strong><p style={{ overflowWrap: 'anywhere' }}>{error}</p><p>Your live timetable records were not reset or restored.</p></div>}
    {result && <section role="status" style={{ ...panel, background: '#e9f5ee', borderColor: '#abd2bc', marginTop: 20 }}>
      <h2 style={{ margin: '0 0 12px' }}>{result.action === 'backup' ? 'Backup created and verified' : 'Backup verification passed'}</h2>
      <p><strong>Backup folder:</strong> <span style={{ overflowWrap: 'anywhere' }}>{result.data.folder}</span></p>
      <p><strong>Approval files:</strong> {result.data.evidenceFiles ?? 0} &nbsp; <strong>Size:</strong> {((result.data.bytes ?? 0) / (1024 * 1024)).toFixed(2)} MB</p>
      <p style={{ fontSize: 13 }}>Keep a separate protected copy. The backup includes coordinator password hashes and may contain confidential HOD approval documents.</p>
    </section>}
    <section style={{ ...panel, background: '#f4f8f7', marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Restore Verified Backup</h2>
      <p style={{ lineHeight: 1.65, color: '#526a64' }}>Use this only to recover a lost or damaged working database. The app checks and stages the backup before asking for confirmation, then restarts to switch databases while SQLite is closed. It preserves a local rollback copy of the data replaced.</p>
      <p style={{ lineHeight: 1.65, color: '#85412b', fontWeight: 700 }}>A restore replaces all current academic data, college branding, approval history, and coordinator login with the contents of the chosen backup. Be sure you know the password or recovery code for that saved account. Export an independent backup first.</p>
      {!prepared && !restarting && <button type="button" style={button} disabled={busy !== null} onClick={() => void prepareRestore()}>{busy === 'prepare' ? 'Checking backup…' : 'Select backup to restore'}</button>}
      {prepared && <div style={{ border: '1px solid #b4cfc3', borderRadius: 12, background: 'white', padding: 18, marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Review the staged backup</h3>
        <p>Created: <strong>{prepared.createdAt}</strong> · Attachment files: <strong>{prepared.evidenceFiles}</strong> · Size: <strong>{((prepared.bytes ?? 0)/(1024*1024)).toFixed(2)} MB</strong></p>
        <p>Coordinator name stored in this backup: <strong>{prepared.coordinator}</strong></p>
        <label style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I understand this replaces the current coordinator login, and I have the restored account's password or recovery code.</label>
        <label style={{ display: 'block', marginBottom: 12 }}>Current signed-in coordinator password
          <input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} style={{ display: 'block', padding: 10, marginTop: 5, width: '100%', maxWidth: 430, border: '1px solid #a8bbb4', borderRadius: 8 }} />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>Type <strong>RESTORE BACKUP</strong> to confirm
          <input type="text" value={phrase} onChange={e => setPhrase(e.target.value)} style={{ display: 'block', padding: 10, marginTop: 5, width: '100%', maxWidth: 430, border: '1px solid #a8bbb4', borderRadius: 8 }} />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...button, background: '#a53b30', opacity: (busy !== null || !ack || !password || phrase !== 'RESTORE BACKUP') ? .5 : 1 }} disabled={busy !== null || !ack || !password || phrase !== 'RESTORE BACKUP'} onClick={() => void confirmRestore()}>{busy === 'confirm' ? 'Preparing restart…' : 'Confirm restore and restart'}</button>
          <button type="button" style={{ ...button, background: '#e3ede9', color: '#17554a' }} disabled={busy !== null} onClick={() => void cancelRestore()}>Cancel restore</button>
        </div>
      </div>}
      {restarting && <p role="status" style={{ fontWeight: 700 }}>Restore authorized. The app is closing the current database and restarting. Sign in with the coordinator account stored in the restored backup.</p>}
    </section>
    <section style={{ ...panel, background: '#f5f8f7', marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Reset academic working data</h2>
      <p style={{ lineHeight: 1.6, color: '#526a64' }}>Each reset creates a <strong>new, automatically verified backup</strong> first, then prepares a separate database copy. No live rows are erased while the application is open. A restart activates the reset and retains the original database as a local recovery copy.</p>
      <p style={{ fontWeight: 700, color: '#91452e' }}>Approved or published timetables and their HOD approval evidence are protected. If any affected review contains these, the reset will be refused.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'end', marginBottom: 18 }}>
        <label style={{ display: 'grid', gap: 7, minWidth: 240 }}>Reset type
          <select disabled={!!preparedReset || busy !== null} value={mode} onChange={e=>changeResetMode(e.target.value as ResetMode)} style={{ padding: 11, borderRadius: 8, border: '1px solid #a8bbb4' }}>
            <option value="drafts">Clear generated and review drafts</option>
            <option value="term">Reset one term's teaching data</option>
            <option value="fresh">Start fresh (all academic data)</option>
          </select>
        </label>
        {mode !== 'fresh' && <label style={{ display: 'grid', gap: 7, minWidth: 270 }}>Academic term
          <select disabled={!!preparedReset || busy !== null} value={termId} onChange={e=>changeResetTerm(e.target.value)} style={{ padding: 11, borderRadius: 8, border: '1px solid #a8bbb4' }}>
            {!terms.length && <option value="">No academic terms</option>}
            {terms.map(t=><option key={t.id} value={t.id}>{t.academicYear || t.academic_year || 'Academic year'} — {t.cycle}</option>)}
          </select>
        </label>}
      </div>
      <p style={{ color: '#435e54', lineHeight: 1.6 }}>
        {mode === 'drafts' ? 'Clears saved theory draft runs and unapproved REVIEW snapshots for the selected term. Keeps faculty, courses, allocations, laboratories, activities and other academic terms.' :
        mode === 'term' ? 'Clears the selected term’s subject catalogue, faculty allocations, laboratory bookings, activities/certifications, saved drafts and REVIEW history. Keeps the academic term, semester/section definitions, faculty register and institutional settings.' :
        'Clears faculty, terms, sections, subjects, allocations, labs, bookings, activities and REVIEW drafts. Keeps coordinator login and handover audit, college branding, and the college-wide period clock/configuration.'}
      </p>
      {!preparedReset && !resetRestarting && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" style={{...button,background:'#e3f0eb',color:'#17554a'}} disabled={busy !== null || (mode !== 'fresh' && !termId)} onClick={()=>void previewReset()}>{busy==='reset-preview'?'Checking…':'Check what will be removed'}</button>
        <button type="button" style={{...button,background:'#9e4036'}} disabled={busy !== null || (mode !== 'fresh' && !termId) || !impact || impact.mode!==mode || impact.termId!==(mode==='fresh'?undefined:termId) || impact.blockers.length>0 || !!prepared} onClick={()=>void prepareReset()}>{busy==='reset-prepare'?'Creating verified backup…':'Back up and prepare reset'}</button>
      </div>}
      {impact && <div role="status" style={{border:'1px solid #c5d8cf',background:'#fff',borderRadius:12,padding:16,marginTop:16}}>
        <h3 style={{margin:'0 0 8px'}}>Reset impact preview</h3>
        <p style={{lineHeight:1.7}}>Theory draft versions: <strong>{impact.theoryDrafts}</strong> · REVIEW snapshots: <strong>{impact.draftVersions}</strong> · Lab bookings: <strong>{impact.labBookings}</strong> · Activities: <strong>{impact.activities}</strong> · Subject allocations: <strong>{impact.allocations}</strong> · Subjects: <strong>{impact.subjects}</strong> · Faculty: <strong>{impact.faculty}</strong></p>
        {impact.blockers.length>0 && <div role="alert" style={{color:'#a13729'}}>{impact.blockers.map((message,i)=><p key={i}><strong>Blocked:</strong> {message}</p>)}</div>}
        {!impact.blockers.length && <p style={{color:'#246a56'}}>No protected approval records detected in the selected reset scope.</p>}
      </div>}
      {preparedReset && <div style={{border:'1px solid #b4cfc3',borderRadius:12,background:'#fff',padding:18,marginTop:16}}>
        <h3 style={{marginTop:0}}>Final confirmation — {requiredPhrase}</h3>
        <p><strong>Verified backup created:</strong> <span style={{overflowWrap:'anywhere'}}>{preparedReset.backupFolder}</span></p>
        <p>Copy this backup folder to protected external storage. The selected reset will activate after restart. The original working data is also retained locally for rollback.</p>
        <label style={{display:'block',marginBottom:12}}><input type="checkbox" checked={resetAcknowledge} onChange={e=>setResetAcknowledge(e.target.checked)}/> I have reviewed the affected records, know this is destructive, and have a verified recovery backup.</label>
        <label style={{display:'block',marginBottom:12}}>Coordinator password
          <input type="password" autoComplete="off" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} style={{display:'block',padding:10,marginTop:5,width:'100%',maxWidth:430,border:'1px solid #a8bbb4',borderRadius:8}}/>
        </label>
        <label style={{display:'block',marginBottom:12}}>Type <strong>{requiredPhrase}</strong> exactly
          <input type="text" value={resetPhrase} onChange={e=>setResetPhrase(e.target.value)} style={{display:'block',padding:10,marginTop:5,width:'100%',maxWidth:430,border:'1px solid #a8bbb4',borderRadius:8}}/>
        </label>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button type="button" style={{...button,background:'#9e4036',opacity:(!resetAcknowledge||!resetPassword||resetPhrase!==requiredPhrase||busy!==null) ? .5 : 1}} disabled={busy!==null||!resetAcknowledge||!resetPassword||resetPhrase!==requiredPhrase} onClick={()=>void confirmReset()}>{busy==='reset-confirm'?'Finalizing…':'Confirm reset and restart'}</button>
          <button type="button" style={{...button,background:'#e3ede9',color:'#17554a'}} disabled={busy!==null} onClick={()=>void cancelReset()}>Cancel without resetting</button>
        </div>
      </div>}
      {resetRestarting && <p role="status" style={{fontWeight:700}}>Reset authorized. The application will restart, preserving the coordinator account and creating a recovery copy of the pre-reset data. Sign in normally afterward.</p>}
    </section>
  </main>;
}
