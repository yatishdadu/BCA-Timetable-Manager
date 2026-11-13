import React, { useState } from 'react';

// All credential operations run in the protected Electron main process.
// This page never stores passwords or recovery codes in localStorage or SQLite.
type SecureAccountApi = {
  rotateRecovery(input: { currentPassword: string }): Promise<{ recoveryCode: string }>;
  transfer(input: { currentPassword: string; name: string; employeeCode: string; username: string; password: string; authorizationReference: string }): Promise<{ recoveryCode: string }>;
};
function authApi(): SecureAccountApi | undefined {
  return (window as unknown as { electronAPI?: { auth?: SecureAccountApi } }).electronAPI?.auth;
}

const field: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #b6cec7', borderRadius: 8, marginTop: 5, fontSize: 14 };
const button: React.CSSProperties = { border: 0, borderRadius: 8, padding: '11px 16px', background: '#176454', color: 'white', fontWeight: 700, cursor: 'pointer' };
const section: React.CSSProperties = { background: '#fff', padding: 24, border: '1px solid #d3e2dc', borderRadius: 14, boxShadow: '0 3px 15px #133c2a0a' };

export default function CoordinatorAccount() {
  const [mode, setMode] = useState<'rotate' | 'transfer'>('rotate');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [username, setUsername] = useState('');
  const [authorizationReference, setAuthorizationReference] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [handoverComplete, setHandoverComplete] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const api = authApi();
    if (!api) { setError('This feature requires the Electron desktop application.'); return; }
    if (mode === 'transfer' && newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const result = mode === 'transfer'
        ? await api.transfer({ currentPassword, name: newName, employeeCode, username, password: newPassword, authorizationReference })
        : await api.rotateRecovery({ currentPassword });
      setHandoverComplete(mode === 'transfer');
      setRecoveryCode(result.recoveryCode);
      setAcknowledged(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  if (recoveryCode) return <main style={{ padding: 28, maxWidth: 800, margin: 'auto', fontFamily: 'system-ui,sans-serif' }}>
    <section style={section}>
      <h1>{handoverComplete ? 'Coordinator handover recorded' : 'New recovery code generated'}</h1>
      <p><strong>This code is displayed only once.</strong> Store it in an approved offline password vault or sealed college recovery record. Never add it to a timetable PDF or email it casually.</p>
      <div role="status" style={{ padding: 16, background: '#e9f4ee', border: '1px solid #a7cfc0', borderRadius: 8, overflowWrap: 'anywhere', fontFamily: 'ui-monospace,monospace', fontWeight: 700, letterSpacing: '0.04em' }}>{recoveryCode}</div>
      <p>{handoverComplete ? 'The previous coordinator is signed out and their credentials are invalid. The new coordinator must sign in with the new credentials.' : 'Your previous recovery code is invalid. Your password remains unchanged.'}</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I have securely saved this recovery code outside the application.</label>
      <button type="button" style={{ ...button, opacity: acknowledged ? 1 : .5 }} disabled={!acknowledged} onClick={() => {
        setRecoveryCode('');
        if (handoverComplete) window.location.reload(); // Recheck main-process login state.
      }}>{handoverComplete ? 'Finish handover and return to sign in' : 'Finish'}</button>
    </section>
  </main>;

  return <main style={{ padding: 28, maxWidth: 870, margin: 'auto', fontFamily: 'system-ui,sans-serif', color: '#1b3d35' }}>
    <h1 style={{ marginBottom: 6 }}>Coordinator Account</h1>
    <p style={{ color: '#526f64', marginTop: 0 }}>Offline security settings · Timetable and academic records are not affected.</p>
    <div style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
      <button type="button" style={{ ...button, background: mode === 'rotate' ? '#176454' : '#e7f0ec', color: mode === 'rotate' ? '#fff' : '#176454' }} onClick={() => { setMode('rotate'); setError(''); }}>Regenerate recovery code</button>
      <button type="button" style={{ ...button, background: mode === 'transfer' ? '#176454' : '#e7f0ec', color: mode === 'transfer' ? '#fff' : '#176454' }} onClick={() => { setMode('transfer'); setError(''); }}>Transfer to new coordinator</button>
    </div>
    <form style={section} onSubmit={e => void submit(e)}>
      <h2 style={{ marginTop: 0 }}>{mode === 'rotate' ? 'Replace your lost recovery code' : 'Transfer coordinator access'}</h2>
      <p style={{ color: '#526f64' }}>{mode === 'rotate' ? 'You must know your current password. This will invalidate the previous recovery code.' : 'Confirm your password and create new credentials for the incoming coordinator. All current sessions will be signed out.'}</p>
      <label>Current coordinator password<input style={field} required type="password" maxLength={128} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
      {mode === 'transfer' ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 16, marginTop: 18 }}>
        <label>Incoming coordinator's full name<input style={field} required maxLength={120} value={newName} onChange={e => setNewName(e.target.value)} autoComplete="off" /></label>
        <label>Incoming employee ID<input style={field} required maxLength={64} value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} autoComplete="off" /></label>
        <label>New username<input style={field} required maxLength={64} value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label>
        <label>New password (minimum 12 characters)<input style={field} required minLength={12} maxLength={128} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
        <label>Confirm new password<input style={field} required minLength={12} maxLength={128} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
        <label>College/HOD handover authorization reference<input style={field} required minLength={5} maxLength={300} value={authorizationReference} onChange={e => setAuthorizationReference(e.target.value)} placeholder="HOD approval date and document reference" autoComplete="off" /></label>
      </div> : null}
      {error ? <p role="alert" style={{ background: '#fff0ed', color: '#a12619', padding: 12, borderRadius: 8 }}>{error}</p> : null}
      <button type="submit" style={{ ...button, marginTop: 22, opacity: busy ? .6 : 1 }} disabled={busy}>{busy ? 'Processing…' : mode === 'rotate' ? 'Generate replacement recovery code' : 'Confirm account handover'}</button>
    </form>
    <p style={{ color: '#63766f', fontSize: 13, marginTop: 20 }}>If the password and the recovery code are both lost, this screen cannot unlock the account. The college will need an authorized offline recovery procedure. Do not reset the timetable database.</p>
  </main>;
}
