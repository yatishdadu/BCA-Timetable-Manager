import { contextBridge, ipcRenderer } from 'electron';

type FacultyCategory = 'HOD' | 'Regular' | 'New' | 'Guest';
type FacultyInput = {
  name: string;
  category: FacultyCategory;
  workloadTarget: number;
};

// No arbitrary IPC channel access is exposed to untrusted renderer code.
contextBridge.exposeInMainWorld('electronAPI', {
  status: () => 'preload connected',
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    setup: (input: { name: string; employeeCode: string; username: string; password: string }) => ipcRenderer.invoke('auth:setup', input),
    login: (input: { username: string; password: string }) => ipcRenderer.invoke('auth:login', input),
    logout: () => ipcRenderer.invoke('auth:logout'),

    rotateRecovery: (input: { currentPassword: string }) => ipcRenderer.invoke('auth:rotateRecovery', input),
    transfer: (input: { currentPassword: string; name: string; employeeCode: string; username: string; password: string; authorizationReference: string }) => ipcRenderer.invoke('auth:transfer', input),
    recover: (input: { recoveryCode: string; newPassword: string }) => ipcRenderer.invoke('auth:recover', input),
  },
  adminBackup: {
    create: () => ipcRenderer.invoke('adminBackup:create'),
    verify: () => ipcRenderer.invoke('adminBackup:verify'),
    prepareRestore: () => ipcRenderer.invoke('adminBackup:prepareRestore'),
    cancelRestore: () => ipcRenderer.invoke('adminBackup:cancelRestore'),
    confirmRestore: (input: { id: string; password: string; confirmation: 'RESTORE BACKUP'; understandsLoginReplacement: true }) => ipcRenderer.invoke('adminBackup:confirmRestore', input),
    previewReset: (input: { mode: 'drafts' | 'term' | 'fresh'; termId?: string }) => ipcRenderer.invoke('adminReset:preview', input),
    prepareReset: (input: { mode: 'drafts' | 'term' | 'fresh'; termId?: string }) => ipcRenderer.invoke('adminReset:prepare', input),
    cancelReset: () => ipcRenderer.invoke('adminReset:cancel'),
    confirmReset: (input: { id: string; password: string; phrase: 'CLEAR DRAFTS' | 'RESET TERM' | 'START FRESH'; acknowledged: true }) => ipcRenderer.invoke('adminReset:confirm', input),
  },
  publication: {
    list: (termId: string) => ipcRenderer.invoke('publication:list', termId),
    createReview: (input: { termId: string; coordinator: string; remarks: string }) => ipcRenderer.invoke('publication:createReview', input),
    inspect: (versionId: string) => ipcRenderer.invoke('publication:inspect', versionId),
    attachEvidence: (versionId: string, channel: 'Printed'|'Digital') => ipcRenderer.invoke('publication:attachEvidence', {versionId, channel}),
    approve: (input: {versionId: string; hodName: string; approvalDate: string; channel: 'Printed'|'Digital'|'Both'; reference: string; syllabusChecked: true; labHoursChecked: true; saturdayChecked: true}) => ipcRenderer.invoke('publication:approve', input),
    publish: (versionId: string) => ipcRenderer.invoke('publication:publish', versionId),
    export: (input: {versionId: string; scope: 'Department'|'Section'|'Faculty'|'Laboratory'; resourceId?: string; format: 'PDF'|'XLSX'}) => ipcRenderer.invoke('publication:export', input),
  },
  branding: {
    get: () => ipcRenderer.invoke('branding:get'),
    chooseLogo: () => ipcRenderer.invoke('branding:chooseLogo'),
    save: (input: { collegeName: string; departmentName: string; copyrightText: string; developerName: string; collegeLogo: string | null; developerLogo: string | null }) => ipcRenderer.invoke('branding:save', input),
  },
  academic: {
    listTerms: () => ipcRenderer.invoke('academic:listTerms'),
    createTerm: (input: { academicYear: string; cycle: 'Odd' | 'Even' }) => ipcRenderer.invoke('academic:createTerm', input),
    setCurrentTerm: (id: string) => ipcRenderer.invoke('academic:setCurrentTerm', id),
    listSemesters: (termId: string) => ipcRenderer.invoke('academic:listSemesters', termId),
    setSemester: (input: { termId: string; semesterNumber: number; active: boolean }) => ipcRenderer.invoke('academic:setSemester', input),
    listSections: (offeringId: string) => ipcRenderer.invoke('academic:listSections', offeringId),
    createSection: (input: { offeringId: string; code: string }) => ipcRenderer.invoke('academic:createSection', input),
    updateSection: (input: { id: string; code: string; active: boolean }) => ipcRenderer.invoke('academic:updateSection', input),
  },
  semesterSchedule: {
    list: (termId: string) => ipcRenderer.invoke('semesterSchedule:list', termId),
    save: (input: { offeringId: string; mode: 'Morning Only' | 'Full Day' | 'Custom Timing'; allowedPeriods: number[] }) => ipcRenderer.invoke('semesterSchedule:save', input),
  },
  subjects: {
    list: (termId: string, semesterNumber: number) => ipcRenderer.invoke('subjects:list', { termId, semesterNumber }),
    save: (input: { id?: string; termId: string; semesterNumber: number; code: string; name: string; kind: string; weeklyHours: number }) => ipcRenderer.invoke('subjects:save', input),
    setActive: (id: string, active: boolean) => ipcRenderer.invoke('subjects:setActive', { id, active }),
    importReference: (termId: string, semesterNumber: number) => ipcRenderer.invoke('subjects:importReference', { termId, semesterNumber }),
  },
  allocations: {
    list: (termId: string) => ipcRenderer.invoke('allocations:list', termId),
    save: (input: { id?: string; sectionId: string; subjectId: string; facultyId: string | null; weeklyHours: number }) => ipcRenderer.invoke('allocations:save', input),
    setActive: (id: string, active: boolean) => ipcRenderer.invoke('allocations:setActive', { id, active }),
  },
  workload: {
    summary: (termId: string) => ipcRenderer.invoke('workload:summary', termId),
  },
  labs: {
    list: () => ipcRenderer.invoke('labs:list'),
    seedThree: () => ipcRenderer.invoke('labs:seedThree'),
    save: (input: { id?: string; code: string; name: string; notes: string }) => ipcRenderer.invoke('labs:save', input),
    setActive: (id: string, active: boolean) => ipcRenderer.invoke('labs:setActive', id, active),
    getConfig: () => ipcRenderer.invoke('labs:getConfig'),
    getClock: () => ipcRenderer.invoke('labs:getClock'),
    saveClock: (input: { periods: { number: number; start: string; end: string }[]; lunchStart: string; lunchEnd: string; confirmed: boolean }) => ipcRenderer.invoke('labs:saveClock', input),
    getSaturdayPolicy: (termId: string) => ipcRenderer.invoke('labs:getSaturdayPolicy', termId),
    saveSaturdayPolicy: (input: { termId: string; campusPeriods: 0 | 3 | 6 }) => ipcRenderer.invoke('labs:saveSaturdayPolicy', input),
    saveSemesterSaturday: (input: { termId: string; offeringId: string; periods: 0 | 3 | 6 | null }) => ipcRenderer.invoke('labs:saveSemesterSaturday', input),
    saveConfig: (input: { days: 5 | 6; periodsPerDay: number; saturdayPeriods: number; breakAfter: number }) => ipcRenderer.invoke('labs:saveConfig', input),
    listBookings: (termId: string) => ipcRenderer.invoke('labs:listBookings', termId),
    saveBooking: (input: {
      id?: string; termId: string; labId: string; bookingType: 'BCA' | 'External' | 'Maintenance';
      mode: 'Weekly' | 'Dated'; weekday: number; bookingDate: string | null;
      startPeriod: number; allocationId: string | null; ownerLabel: string; notes: string;
    }) => ipcRenderer.invoke('labs:saveBooking', input),
    cancelBooking: (id: string) => ipcRenderer.invoke('labs:cancelBooking', id),
  },
  activities: {
    list: (termId: string) => ipcRenderer.invoke('activities:list', termId),
    preview: (input: unknown) => ipcRenderer.invoke('activities:preview', input),
    listSuspensions: (termId: string) => ipcRenderer.invoke('activities:listSuspensions', termId),
    save: (input: { id?: string; termId: string; kind: 'Club' | 'Sports' | 'Certification';
      title: string; organizer: string; notes: string; mode: 'Weekly' | 'Dated';
      weekday: number; dates: string[]; startPeriod: number; periodCount: number;
      sectionIds: string[]; facultyId: string | null; labId: string | null;
      suspendConflictingBcaLabs?: boolean; hodInstructionReference?: string;
      hodInstructionChannel?: 'Printed'|'Digital'|'Both' }) => ipcRenderer.invoke('activities:save', input),
    cancel: (id: string) => ipcRenderer.invoke('activities:cancel', id),
  },
  theory: {
    preview: (termId: string) => ipcRenderer.invoke('theory:preview', termId),
    saveDraft: (termId: string, fingerprint: string) => ipcRenderer.invoke('theory:saveDraft', {termId, fingerprint}),
  },
  manual: {
    load: (termId:string) => ipcRenderer.invoke('manual:load',termId),
    validate: (input:unknown) => ipcRenderer.invoke('manual:validate',input),
    save: (input:unknown) => ipcRenderer.invoke('manual:save',input),
    history: (termId:string) => ipcRenderer.invoke('manual:history',termId),
    restore: (input:{termId:string;expectedRunId:string;sourceRunId:string;reason:string}) => ipcRenderer.invoke('manual:restore',input),
  },
  master: {
    snapshot: (termId: string, date: string | null) => ipcRenderer.invoke('master:snapshot', { termId, date }),
  },
  facultyIdentity: {
    list: () => ipcRenderer.invoke('facultyIdentity:list'),
    create: (input: { name: string; category: 'HOD' | 'Regular' | 'New' | 'Guest'; employeeCode: string; workloadTarget: number }) => ipcRenderer.invoke('facultyIdentity:create', input),
    update: (id: string, input: { name: string; category: 'HOD' | 'Regular' | 'New' | 'Guest'; employeeCode: string; workloadTarget: number }) => ipcRenderer.invoke('facultyIdentity:update', id, input),
    setActive: (id: string, active: boolean) => ipcRenderer.invoke('facultyIdentity:setActive', {id, active}),
    delete: (id: string) => ipcRenderer.invoke('facultyIdentity:delete', id),
  },
  faculty: {
    list: () => ipcRenderer.invoke('faculty:list'),
    create: (record: FacultyInput) => ipcRenderer.invoke('faculty:create', record),
    update: (id: string, record: FacultyInput) => ipcRenderer.invoke('faculty:update', id, record),
    deactivate: (id: string) => ipcRenderer.invoke('faculty:deactivate', id),
  },
});
