import React, { useEffect, useState } from 'react';
import './CoordinatorGate.css';

type SessionStatus = { configured: boolean; authenticated: boolean; coordinatorName: string | null; collegeName?: string | null; collegeLogo?: string | null };
type AuthApi = {
  status(): Promise<SessionStatus>;
  setup(input: { name: string; employeeCode: string; username: string; password: string }): Promise<{ coordinatorName: string; recoveryCode: string }>;
  login(input: { username: string; password: string }): Promise<{ coordinatorName: string }>;
  recover(input: { recoveryCode: string; newPassword: string }): Promise<{ recoveryCode: string }>;
  logout(): Promise<{ success: boolean }>;
};
function auth(): AuthApi | undefined {
  return (window as unknown as { electronAPI?: { auth?: AuthApi } }).electronAPI?.auth;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function CoordinatorGate({ children }: {
  children: (ctx: { coordinatorName: string; logout(): Promise<void> }) => React.ReactNode;
}) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [mode, setMode] = useState<'setup' | 'login' | 'recover' | 'recovery-code'>('login');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [name, setName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const api = auth();
    if (!api) { setError('This login requires the Windows Electron desktop application.'); return; }
    void api.status().then(info => {
      if (!live) return;
      setStatus(info); setMode(info.configured ? 'login' : 'setup');
    }).catch(e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, []);

  const logout = async () => {
    const api = auth(); if (!api) return;
    try {
      await api.logout();
      setStatus({ configured: true, authenticated: false, coordinatorName: null });
      setPassword(''); setConfirm(''); setMode('login'); setError('');
    } catch (e) { setError(message(e)); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const api = auth(); if (!api) { setError('Electron login bridge unavailable.'); return; }
    if (mode === 'setup' && password !== confirm) { setError('Passwords do not match.'); return; }
    if (mode === 'recover' && password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (mode === 'setup') {
        const result = await api.setup({ name, employeeCode, username, password });
        setStatus({ configured: true, authenticated: true, coordinatorName: result.coordinatorName });
        setRecoveryCode(result.recoveryCode); setRecovered(false); setMode('recovery-code');
      } else if (mode === 'recover') {
        const result = await api.recover({ recoveryCode, newPassword: password });
        setRecoveryCode(result.recoveryCode); setRecovered(true); setMode('recovery-code');
      } else if (mode === 'login') {
        const result = await api.login({ username, password });
        setStatus({ configured: true, authenticated: true, coordinatorName: result.coordinatorName });
      }
      setPassword(''); setConfirm('');
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };

  // Don't render any application routes until the main process reports authenticated.
  if (status?.authenticated && mode !== 'recovery-code') return <>{children({ coordinatorName: status.coordinatorName || 'Coordinator', logout })}</>;

  return <main className="bca-login-shell">
    <div className="bca-login-card">
      <aside className="bca-login-left">
        <div className="bca-login-decoration" aria-hidden="true"><span /><span /><span /></div>
        <div className="bca-login-left-top">{status?.collegeLogo ? <img className="bca-login-college-logo" src={status.collegeLogo} alt="College logo" /> : <span className="bca-login-mark">BCA</span>}<span className="bca-login-label">{status?.collegeName || 'OFFLINE DESKTOP SYSTEM'}</span></div>
        <div className="bca-login-intro"><div className="bca-login-overline">COLLEGE ADMINISTRATION</div><h1>Timetable<br />Manager</h1>
          <p>One secure workspace for academic scheduling, faculty workloads and HOD-approved timetables.</p></div>
        <div className="bca-login-left-bottom">DEPARTMENT OF COMPUTER APPLICATIONS <span>•</span> COORDINATOR ACCESS</div>
      </aside>
      <section className="bca-login-right">
        {mode === 'recovery-code' ? <div className="bca-login-form">
          <div className="bca-login-overline">ONE-TIME RECOVERY KEY</div>
          <h2>Save your recovery code</h2>
          <p className="bca-login-hint">This code is shown only once. Store it somewhere safe outside this computer. It can replace a forgotten password. Never put it into a timetable export.</p>
          <div className="bca-recovery-key" role="status">{recoveryCode}</div>
          <button type="button" className="bca-primary" onClick={() => {
            setMode('login'); setRecoveryCode(''); setPassword(''); setConfirm('');
            if (!recovered && status?.authenticated) { setMode('login'); /* auth session stays signed in; next screen shows app */ }
          }}>I have saved this code</button>
          {recovered ? <p className="bca-login-hint">Your password has been changed. Sign in using the new password.</p> : null}
        </div> : <form className="bca-login-form" onSubmit={e => void submit(e)}>
          <div className="bca-login-overline">{mode === 'setup' ? 'FIRST-TIME CONFIGURATION' : mode === 'recover' ? 'LOCAL ACCOUNT RECOVERY' : 'COORDINATOR ACCESS'}</div>
          <h2>{mode === 'setup' ? 'Create coordinator account' : mode === 'recover' ? 'Recover access' : 'Welcome back'}</h2>
          <p className="bca-login-hint">{mode === 'setup' ? 'Create the one coordinator account for this offline computer.' : mode === 'recover' ? 'Use the recovery code you saved when creating your account.' : 'Sign in with your username or employee ID.'}</p>
          {mode === 'setup' ? <>
            <label>Coordinator name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
            <label>Employee ID<input required maxLength={64} value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} autoComplete="off" /></label>
          </> : null}
          {mode === 'setup' || mode === 'login' ? <label>{mode === 'login' ? 'Username or employee ID' : 'Username'}<input required maxLength={64} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label> : null}
          {mode === 'recover' ? <label>Recovery code<input required value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} autoComplete="off" placeholder="XXXXXXXX-XXXXXXXX-..." /></label> : null}
          <label>{mode === 'recover' ? 'New password' : 'Password'}<div className="bca-password-field"><input required minLength={mode === 'login' ? undefined : 12} maxLength={128} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" onClick={() => setShowPassword(x => !x)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
          {mode !== 'login' ? <label>Confirm password<input required minLength={12} maxLength={128} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></label> : null}
          {error ? <p className="bca-login-error" role="alert">{error}</p> : null}
          <button className="bca-primary" type="submit" disabled={busy}>{busy ? 'Checking…' : mode === 'setup' ? 'Create account' : mode === 'recover' ? 'Reset password' : 'Sign in'}</button>
          {status?.configured ? <div className="bca-login-links">
            {mode === 'login' ? <button type="button" onClick={() => { setMode('recover'); setError(''); setPassword(''); }}>Forgot password?</button> : <button type="button" onClick={() => { setMode('login'); setError(''); setPassword(''); }}>Back to sign in</button>}
          </div> : null}
          <div className="bca-login-bottom">No Google sign-in or internet connection required.</div>
        </form>}
      </section>
    </div>
  </main>;
}
