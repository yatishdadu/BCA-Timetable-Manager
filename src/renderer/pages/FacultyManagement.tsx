import React, { useCallback, useEffect, useState } from 'react';

type Category = 'HOD' | 'Regular' | 'New' | 'Guest';
type Faculty = {
  id: string;
  name: string;
  category: Category;
  employee_code: string | null;
  workload_target: number;
  active: number | boolean;
  usedIn: string[];
  canDelete: boolean;
};
type FacultyInput = {
  name: string;
  category: Category;
  employeeCode: string;
  workloadTarget: number;
};
type FacultyIdentityAPI = {
  list: () => Promise<Faculty[]>;
  create: (record: FacultyInput) => Promise<Faculty>;
  update: (id: string, record: FacultyInput) => Promise<Faculty>;
  setActive: (id: string, active: boolean) => Promise<{success: boolean}>;
  delete: (id: string) => Promise<{success: boolean}>;
};
const api = (window as unknown as { electronAPI?: { facultyIdentity?: FacultyIdentityAPI } })
  .electronAPI?.facultyIdentity;
const targets: Record<Category, number> = { HOD: 12, Regular: 18, New: 0, Guest: 0 };
const field: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginTop: 5, boxSizing: 'border-box' };
const cell: React.CSSProperties = { padding: 10, borderTop: '1px solid #d7e1e0', verticalAlign: 'top' };
const button: React.CSSProperties = { marginRight: 7, marginBottom: 5 };

export default function FacultyManagement() {
  const [records, setRecords] = useState<Faculty[]>([]);
  const [name, setName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [category, setCategory] = useState<Category>('Regular');
  const [workloadTarget, setWorkloadTarget] = useState(18);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const reload = useCallback(async () => { if (api) setRecords(await api.list()); }, []);
  useEffect(() => { void reload().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [reload]);

  function clearForm() {
    setName(''); setEmployeeCode(''); setCategory('Regular'); setWorkloadTarget(18); setEditingId(null);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const data: FacultyInput = { name: name.trim(), category, employeeCode: employeeCode.trim().toUpperCase(), workloadTarget };
      if (editingId) await api.update(editingId, data);
      else await api.create(data);
      setInfo(editingId ? 'Faculty changes saved.' : 'Faculty created.');
      clearForm(); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function edit(row: Faculty) {
    setEditingId(row.id); setName(row.name); setEmployeeCode(row.employee_code || '');
    setCategory(row.category); setWorkloadTarget(row.workload_target); setError(''); setInfo('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function changeActive(row: Faculty) {
    if (!api) return;
    const next = Number(row.active) !== 1;
    if (!window.confirm(`${next ? 'Reactivate' : 'Deactivate'} ${row.name} (${row.employee_code || 'ID not assigned'})?`)) return;
    setBusy(true); setError(''); setInfo('');
    try {
      await api.setActive(row.id, next);
      await reload(); setInfo(next ? 'Faculty reactivated.' : 'Faculty deactivated; history preserved.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function remove(row: Faculty) {
    if (!api || !row.canDelete) return;
    if (!window.confirm(`PERMANENTLY DELETE inactive, unused faculty ${row.name} (${row.employee_code || 'no ID'})?\n\nThis action cannot be undone.`)) return;
    setBusy(true); setError(''); setInfo('');
    try {
      await api.delete(row.id);
      if (editingId === row.id) clearForm();
      await reload(); setInfo('Unused faculty record permanently deleted.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ padding: 30, maxWidth: 1170, fontFamily: 'system-ui, sans-serif' }}>
      <h1>BCA — Faculty Management</h1>
      <p>Permanent faculty use their official college employee ID. Guest or temporary faculty use an ID assigned by the coordinator, such as GUEST-001. IDs are unique even if two faculty names match.</p>
      <p>Legacy faculty records are retained with a blank ID until edited. Internal database UUIDs never change when an employee ID is added.</p>
      {!api && <p role="alert" style={{ color: 'firebrick' }}>Faculty identity management is only available inside the Electron desktop app. Rebuild preload after installing the patch.</p>}
      {error && <p role="alert" style={{ color: 'firebrick' }}>{error}</p>}
      {info && <p role="status" style={{ color: '#166534' }}>{info}</p>}
      <form onSubmit={e => { void save(e); }} style={{ border: '1px solid #d7e1e0', padding: 22, borderRadius: 10, marginBottom: 25 }}>
        <h2>{editingId ? 'Edit faculty record' : 'Add faculty'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.25fr 1fr 1fr', gap: 14 }}>
          <label>Faculty name
            <input style={field} value={name} maxLength={120} required placeholder="Full name" onChange={e => setName(e.target.value)} />
          </label>
          <label>Employee / faculty ID
            <input style={field} value={employeeCode} maxLength={32} required placeholder={category === 'Guest' ? 'GUEST-001' : 'Official employee ID'} onChange={e => setEmployeeCode(e.target.value)} />
          </label>
          <label>Category
            <select style={field} value={category} onChange={e => { const next = e.target.value as Category; setCategory(next); setWorkloadTarget(targets[next]); }}>
              <option value="HOD">HOD</option><option value="Regular">Regular</option>
              <option value="New">New faculty</option><option value="Guest">Guest faculty</option>
            </select>
          </label>
          <label>Weekly target (hours)
            <input style={field} type="number" min={0} max={60} required step={1} value={workloadTarget} onChange={e => setWorkloadTarget(Number(e.target.value))} />
          </label>
        </div>
        <p style={{ fontSize: 13, color: '#516263' }}>IDs accept letters, digits, hyphens, underscores and slashes (2–32 characters). They're stored in uppercase; leading zeroes are preserved. Use your college's exact employee ID format.</p>
        <button type="submit" disabled={busy || !api}>{editingId ? 'Save changes' : 'Add faculty'}</button>
        {editingId && <button type="button" disabled={busy} onClick={clearForm} style={{ marginLeft: 9 }}>Cancel edit</button>}
      </form>
      <h2>Faculty directory</h2>
      <p style={{ fontSize: 14 }}>Permanent Delete is available only after deactivation and only when the record has no references. Assigned or historically used faculty must remain in the database to protect timetable records.</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead><tr><th style={cell}>Faculty</th><th style={cell}>Employee / faculty ID</th><th style={cell}>Category</th><th style={cell}>Target</th><th style={cell}>Status</th><th style={cell}>Actions</th></tr></thead>
          <tbody>{records.map(row => (
            <tr key={row.id}>
              <td style={cell}>{row.name}</td>
              <td style={cell}>{row.employee_code || <span style={{ color: '#b45309' }}>ID required — Edit</span>}</td>
              <td style={cell}>{row.category}</td>
              <td style={cell}>{row.workload_target}</td>
              <td style={cell}>{Number(row.active) === 1 ? 'Active' : 'Inactive'}</td>
              <td style={cell}>
                <button style={button} type="button" disabled={busy} onClick={() => edit(row)}>Edit</button>
                <button style={button} type="button" disabled={busy} onClick={() => { void changeActive(row); }}>{Number(row.active) === 1 ? 'Deactivate' : 'Reactivate'}</button>
                <button style={button} type="button" disabled={busy || !row.canDelete} title={row.canDelete ? 'Delete unused inactive record permanently' : Number(row.active) === 1 ? 'Deactivate before deleting' : `Cannot delete: ${row.usedIn.join(', ')}`} onClick={() => { void remove(row); }}>Delete</button>
                {row.usedIn.length > 0 && <div style={{ fontSize: 12, color: '#59666a', marginTop: 3 }}>Retained: {row.usedIn.join(', ')}</div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {records.length === 0 && <p>No faculty records yet.</p>}
    </main>
  );
}
