import React from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AcademicSetup from './pages/AcademicSetup';
import FacultyManagement from './pages/FacultyManagement';
import SubjectsWorkload from './pages/SubjectsWorkload';
import Laboratories from './pages/Laboratories';
import Activities from './pages/Activities';
import MasterTimetable from './pages/MasterTimetable';
import ManualTimetable from './pages/ManualTimetable';
import TheoryGenerator from './pages/TheoryGenerator';
import CollegeBranding from './pages/CollegeBranding';
import TimetablePublication from './pages/TimetablePublication';
import { BrandingProvider, BrandingHeader, BrandingFooter } from './branding/BrandingContext';
import { CoordinatorGate } from './auth/CoordinatorGate';
import CoordinatorAccount from './pages/CoordinatorAccount';
import BackupReset from './pages/BackupReset';

const items = [
  { path: '/', label: 'Dashboard', end: true },
  { path: '/academic', label: 'Academic Setup', end: false },
  { path: '/faculty', label: 'Faculty Management', end: false },
  { path: '/subjects', label: 'Subjects & Workload', end: false },
  { path: '/labs', label: 'Shared Laboratories', end: false },
  { path: '/activities', label: 'Activities & Certification', end: false },
  { path: '/master', label: 'Master Timetable', end: false },
  { path: '/manual-timetable', label: 'Manual Editor', end: false },
  { path: '/theory-generator', label: 'Theory Generator', end: false },
  { path: '/branding', label: 'College Branding', end: false },
  { path: '/publication', label: 'HOD Approval & Exports', end: false },
  { path: '/coordinator-account', label: 'Coordinator Account', end: false },
  { path: '/backup-reset', label: 'Backup & Reset', end: false },
];

const App: React.FC = () => (
  <CoordinatorGate>
  {({ logout, coordinatorName }) => (
  <HashRouter>
    <BrandingProvider>
    <div style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif', color: '#21312f' }}>
      <BrandingHeader />
      <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:16,padding:'5px 22px',background:'#f8fbfa',borderBottom:'1px solid #dae5e1',fontSize:12}}>
        <span>Coordinator: <strong>{coordinatorName}</strong></span>
        <button type="button" onClick={() => void logout()} style={{background:'#174f4a',border:0,borderRadius:6,padding:'7px 12px',color:'#fff',cursor:'pointer'}}>Log out</button>
      </div>
      <nav aria-label="Main navigation" style={{ background: '#e9f0ee', padding: '14px 22px', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {items.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.end} style={({ isActive }) => ({
            color: '#15594f', fontWeight: isActive ? 750 : 500,
            textDecoration: isActive ? 'underline' : 'none',
            textUnderlineOffset: 5,
          })}>{item.label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/academic" element={<AcademicSetup />} />
        <Route path="/faculty" element={<FacultyManagement />} />
        <Route path="/subjects" element={<SubjectsWorkload />} />
        <Route path="/labs" element={<Laboratories />} />
        <Route path="/activities" element={<Activities />} />
        <Route path="/master" element={<MasterTimetable />} />
        <Route path="/manual-timetable" element={<ManualTimetable />} />
        <Route path="/theory-generator" element={<TheoryGenerator />} />
        <Route path="/branding" element={<CollegeBranding />} />
        <Route path="/publication" element={<TimetablePublication />} />
        <Route path="/coordinator-account" element={<CoordinatorAccount />} />
        <Route path="/backup-reset" element={<BackupReset />} />
      </Routes>
      <BrandingFooter />
    </div>
    </BrandingProvider>
  </HashRouter>
  )}
  </CoordinatorGate>
);
export default App;
