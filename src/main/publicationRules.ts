/** Side-effect-free validation and report layout helpers. */
import { createHash } from 'node:crypto';
import type { MasterEvent } from './masterRules.ts';

export type PublishScope = 'Department' | 'Section' | 'Faculty' | 'Laboratory';
export type ApprovalChannel = 'Printed' | 'Digital' | 'Both';
export type ScheduleData = {
  term: { id: string; academicYear: string; cycle: string };
  sections: { id: string; label: string }[];
  faculty: { id: string; name: string; target: number }[];
  labs: { id: string; code: string }[];
  events: MasterEvent[];
  datedEvents: MasterEvent[];
  suspensions: { labBookingId: string; bookingDate: string }[];
  unplaced: { sectionId: string; subject: string; remaining: number; required: number; placed: number }[];
  conflicts: string[];
  clock: { confirmed: boolean; periods: { number: number; start: string; end: string }[] } | null;
  stale: boolean; saturdayConfirmed: boolean;
};
export type CapturedBranding = {
  collegeName: string; departmentName: string; copyrightText: string;
  developerName: string; collegeLogo: string | null; developerLogo: string | null;
};
export type FrozenPublication = { schedule: ScheduleData; branding: CapturedBranding };
export type ScheduleView = { scope: Exclude<PublishScope, 'Department'>; id: string; label: string; events: MasterEvent[] };

export function snapshotFingerprint(value: FrozenPublication): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function publicationBlockers(data: ScheduleData): string[] {
  const problems: string[] = [];
  if (!data.clock?.confirmed || data.clock.periods.length < 6) problems.push('Confirmed college clock timings are required.');
  if (data.stale) problems.push('The saved theory draft is stale. Regenerate and save it.');
  if (!data.saturdayConfirmed) problems.push('Saturday campus policy must be confirmed for this term.');
  if (!data.events.some(e => e.source === 'Theory')) problems.push('No saved theory periods are present.');
  if (data.conflicts.length) problems.push(`${data.conflicts.length} weekly booking collision(s) must be resolved.`);
  const remain = data.unplaced.reduce((n,x)=>n+Math.max(0,x.remaining),0);
  if (remain) problems.push(`${remain} active allocated teaching period(s) remain unplaced.`);
  for (const sec of data.sections) {
    if (!data.events.some(e=>e.sectionIds.includes(sec.id))) problems.push(`${sec.label} has no scheduled classes.`);
  }
  if (!data.sections.length) problems.push('No active BCA sections in the selected term.');
  for (const e of data.datedEvents) {
    const y = Number(e.bookingDate?.slice(0,4));
    const start = Number(data.term.academicYear.slice(0,4));
    if (!e.bookingDate || !/^\d{4}-\d{2}-\d{2}$/.test(e.bookingDate) || y < start || y > start+1)
      problems.push(`Dated activity "${e.title}" is outside the academic-year window.`);
  }
  return [...new Set(problems)];
}
export function documentViews(data: ScheduleData, scope: PublishScope, resourceId?: string): ScheduleView[] {
  const all: ScheduleView[] = [
    ...data.sections.map(s=>({scope:'Section' as const,id:s.id,label:s.label,events:data.events.filter(e=>e.sectionIds.includes(s.id))})),
    ...data.faculty.map(f=>({scope:'Faculty' as const,id:f.id,label:f.name,events:data.events.filter(e=>e.facultyId===f.id)})),
    ...data.labs.map(l=>({scope:'Laboratory' as const,id:l.id,label:l.code,events:data.events.filter(e=>e.labId===l.id)})),
  ];
  if (scope==='Department') return all;
  return all.filter(v=>v.scope===scope && v.id===resourceId);
}
export function weeklyCells(events: MasterEvent[], day:number, period:number): MasterEvent[] {
  return events.filter(e=>e.mode==='Weekly' && e.weekday===day && e.startPeriod<=period && e.startPeriod+e.periodCount>period);
}
export function escapeHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}
export function safeFilename(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^[_\.]+|[_\.]+$/g,'').slice(0,65) || 'Timetable';
}
export function hasEvidence(channel:ApprovalChannel, items:{channel:'Printed'|'Digital'}[]):boolean {
  return channel==='Both' ? items.some(x=>x.channel==='Printed') && items.some(x=>x.channel==='Digital')
    : items.some(x=>x.channel===channel);
}
