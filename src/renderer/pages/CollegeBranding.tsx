import React, { useEffect, useState } from 'react';
import { brandingApi, initialBranding, useBranding, type BrandingSettings } from '../branding/BrandingContext';

const field: React.CSSProperties = {padding:'10px 12px',border:'1px solid #b9c9c5',borderRadius:6,width:'100%',boxSizing:'border-box',fontSize:15};
const card: React.CSSProperties = {border:'1px solid #d6e1dc',borderRadius:12,padding:20,background:'#fff',marginBottom:20};
const label: React.CSSProperties = {display:'block',fontWeight:650,marginBottom:7};
const action: React.CSSProperties = {padding:'10px 14px',marginRight:9,marginTop:7,cursor:'pointer'};

type LogoKey = 'collegeLogo' | 'developerLogo';
export default function CollegeBranding() {
  const { current, replace, error: loadError } = useBranding();
  const [form, setForm] = useState<BrandingSettings>(initialBranding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setForm(current); }, [current]);
  const change = (key: keyof BrandingSettings, value: string) => setForm(prev=>({...prev,[key]:value}));

  async function choose(key:LogoKey) {
    const api = brandingApi(); if (!api) {setError('Open the Electron desktop application.');return;}
    setBusy(true);setError('');setMessage('');
    try { const logo = await api.chooseLogo(); if (logo !== null) setForm(prev=>({...prev,[key]:logo})); }
    catch(e) {setError(e instanceof Error?e.message:String(e));}
    finally {setBusy(false);}
  }
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api=brandingApi();if(!api){setError('Open the Electron desktop application.');return;}
    setBusy(true);setError('');setMessage('');
    try {
      const result=await api.save({collegeName:form.collegeName,departmentName:form.departmentName,copyrightText:form.copyrightText,developerName:form.developerName,collegeLogo:form.collegeLogo,developerLogo:form.developerLogo});
      replace(result);setMessage('College branding saved to the local SQLite database.');
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:1200,margin:'0 auto',padding:'30px 32px',fontFamily:'system-ui,sans-serif'}}>
    <h1>College Branding & Institutional Settings</h1>
    <p>Enter official institutional details and choose logos once. Settings are stored offline in the existing application database.</p>
    <p style={{color:'#5d736c'}}>This page updates the app header and footer. PDF/Excel publication templates will be integrated when export functionality is implemented.</p>
    {loadError && <p role="alert" style={{color:'#9b2323'}}>{loadError}</p>}
    {error && <p role="alert" style={{padding:12,background:'#fdecec',color:'#9b2323'}}>{error}</p>}
    {message && <p role="status" style={{padding:12,background:'#eaf7ef',color:'#155d3c'}}>{message}</p>}
    <form onSubmit={save}>
      <section style={card}>
        <h2>Institution details</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:16}}>
          <div><label style={label} htmlFor="college-name">Official college name</label><input id="college-name" style={field} required maxLength={200} value={form.collegeName} onChange={e=>change('collegeName',e.target.value)} placeholder="Enter official name" /></div>
          <div><label style={label} htmlFor="department-name">Department name</label><input id="department-name" style={field} required maxLength={160} value={form.departmentName} onChange={e=>change('departmentName',e.target.value)} /></div>
          <div><label style={label} htmlFor="copyright">Copyright statement</label><input id="copyright" style={field} maxLength={300} value={form.copyrightText} onChange={e=>change('copyrightText',e.target.value)} placeholder="Leave blank for automatic college copyright line" /></div>
          <div><label style={label} htmlFor="developer">Developer name or credit</label><input id="developer" style={field} maxLength={160} value={form.developerName} onChange={e=>change('developerName',e.target.value)} placeholder="Optional developer name" /></div>
        </div>
      </section>
      <section style={card}>
        <h2>Logos</h2>
        <p>PNG or JPG only, maximum 2 MB per logo. Logos are stored inside the application's SQLite database and travel with its backup.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:22}}>
          {(['collegeLogo','developerLogo'] as LogoKey[]).map(key=><div key={key} style={{border:'1px solid #d6e1dc',borderRadius:8,padding:16}}>
            <h3>{key==='collegeLogo'?'College logo':'Developer logo'}</h3>
            <div style={{height:115,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8faf9'}}>
              {form[key] ? <img src={form[key]!} alt={key==='collegeLogo'?'Selected college logo':'Selected developer logo'} style={{maxHeight:104,maxWidth:220,objectFit:'contain'}} /> : <span style={{color:'#84958e'}}>No logo selected</span>}
            </div>
            <button type="button" style={action} disabled={busy} onClick={()=>void choose(key)}>Choose image</button>
            <button type="button" style={action} disabled={busy || !form[key]} onClick={()=>setForm(prev=>({...prev,[key]:null}))}>Remove image</button>
          </div>)}
        </div>
      </section>
      <section style={card}>
        <h2>Preview</h2>
        <div style={{border:'1px solid #d6e1dc',borderRadius:8,overflow:'hidden'}}>
          <div style={{display:'flex',gap:16,alignItems:'center',justifyContent:'center',padding:20}}>
            {form.collegeLogo && <img src={form.collegeLogo} alt="College logo preview" style={{width:70,height:70,objectFit:'contain'}} />}
            <div style={{textAlign:'center'}}><strong style={{fontSize:21}}>{form.collegeName||'College name'}</strong><div>{form.departmentName}</div><small>Faculty / Section Timetable - DRAFT</small></div>
          </div>
          <div style={{height:60,background:'#f6faf8',display:'flex',alignItems:'center',justifyContent:'center',color:'#698078'}}>Timetable content</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:9,padding:12,fontSize:12}}>
            <span>{form.departmentName}</span><span>{form.copyrightText || `© ${new Date().getFullYear()} ${form.collegeName||'College name'}. All rights reserved.`}</span>
            <span style={{display:'flex',alignItems:'center',gap:8}}>{form.developerName ? `Developed by ${form.developerName}`:''}{form.developerLogo&&<img src={form.developerLogo} alt="Developer logo preview" style={{height:26,maxWidth:50,objectFit:'contain'}}/>}</span>
          </div>
        </div>
      </section>
      <button type="submit" disabled={busy} style={{...action,padding:'13px 22px',background:'#176257',color:'#fff',border:'none',borderRadius:6,fontWeight:700}}>{busy?'Saving...':'Save Branding Settings'}</button>
      <button type="button" disabled={busy} style={action} onClick={()=>{setForm(current);setError('');setMessage('Changes discarded.');}}>Discard unsaved changes</button>
    </form>
  </main>;
}
