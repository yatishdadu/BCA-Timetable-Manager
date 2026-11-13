import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type BrandingSettings = {
  collegeName: string;
  departmentName: string;
  copyrightText: string;
  developerName: string;
  collegeLogo: string | null;
  developerLogo: string | null;
  updatedAt?: string | null;
};

export const initialBranding: BrandingSettings = {
  collegeName: '', departmentName: 'Department of Computer Applications',
  copyrightText: '', developerName: '', collegeLogo: null, developerLogo: null,
};

export type BrandingApi = {
  get(): Promise<BrandingSettings>;
  save(input: Omit<BrandingSettings, 'updatedAt'>): Promise<BrandingSettings>;
  chooseLogo(): Promise<string | null>;
};

export function brandingApi(): BrandingApi | undefined {
  return (window as unknown as { electronAPI?: { branding?: BrandingApi } }).electronAPI?.branding;
}

type BrandingState = {
  current: BrandingSettings;
  reload(): Promise<void>;
  replace(value: BrandingSettings): void;
  error: string;
};
const Context = createContext<BrandingState | undefined>(undefined);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<BrandingSettings>(initialBranding);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const api = brandingApi();
    if (!api) { setError('College branding requires the Electron desktop application.'); return; }
    try { setCurrent(await api.get()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const value = useMemo(() => ({ current, reload, replace: setCurrent, error }), [current, reload, error]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBranding(): BrandingState {
  const value = useContext(Context);
  if (!value) throw new Error('BrandingProvider is missing');
  return value;
}

export function BrandingHeader() {
  const { current } = useBranding();
  return <header style={{display:'flex',alignItems:'center',justifyContent:'center',gap:18,padding:'16px 28px',minHeight:95,boxSizing:'border-box',borderBottom:'1px solid #d5e4df',background:'#fff'}}>
    {current.collegeLogo ? <img src={current.collegeLogo} alt="College logo" style={{width:72,height:72,objectFit:'contain'}} /> : null}
    <div style={{textAlign:'center',lineHeight:1.35}}>
      <div style={{fontSize:23,fontWeight:800}}>{current.collegeName || 'BCA Timetable Manager'}</div>
      <div style={{fontSize:15,color:'#48645e'}}>{current.departmentName}</div>
    </div>
  </header>;
}

export function BrandingFooter() {
  const { current } = useBranding();
  const notice = current.copyrightText || `© ${new Date().getFullYear()} ${current.collegeName || 'BCA Timetable Manager'}. All rights reserved.`;
  return <footer style={{marginTop:'auto',padding:'15px 24px',borderTop:'1px solid #d5e4df',display:'flex',flexWrap:'wrap',gap:14,alignItems:'center',justifyContent:'space-between',background:'#f7faf9',color:'#48645e',fontSize:12}}>
    <span>{current.departmentName}</span>
    <span>{notice}</span>
    {(current.developerName || current.developerLogo) ? <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
      {current.developerName ? `Developed by ${current.developerName}` : 'Developer'}
      {current.developerLogo ? <img src={current.developerLogo} alt="Developer logo" style={{width:30,height:30,objectFit:'contain'}} /> : null}
    </span> : null}
  </footer>;
}
