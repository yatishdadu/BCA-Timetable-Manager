import { protectedHandle } from './coordinatorAuth.ts';
/** Phase 2D1: coordinator-controlled local review, approval and branded exports.
 * Sources are snapshotted; approval is a COORDINATOR-RECORDED HOD decision,
 * not HOD authentication or an electronic signature.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Knex } from 'knex';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { loadMasterSnapshot } from './masterTimetable.ts';
import type { MasterEvent } from './masterRules.ts';
import {
  documentViews, escapeHtml, hasEvidence, publicationBlockers, safeFilename, snapshotFingerprint, weeklyCells,
  type ApprovalChannel, type CapturedBranding, type FrozenPublication, type PublishScope, type ScheduleData, type ScheduleView
} from './publicationRules.ts';

const uuid = z.string().uuid();
const channelSchema = z.enum(['Printed', 'Digital', 'Both']);
const selectSchema = z.object({ versionId: uuid, scope: z.enum(['Department', 'Section', 'Faculty', 'Laboratory']), resourceId: z.string().max(100).optional(), format: z.enum(['PDF', 'XLSX']) });
const reviewSchema = z.object({ termId: uuid, coordinator: z.string().trim().min(2).max(120), remarks: z.string().trim().max(1500) });
const evidenceSchema = z.object({ versionId: uuid, channel: z.enum(['Printed', 'Digital']) });
const approveSchema = z.object({ versionId: uuid, hodName: z.string().trim().min(2).max(120), approvalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), channel: channelSchema, reference: z.string().trim().min(5).max(300), syllabusChecked: z.literal(true), labHoursChecked: z.literal(true), saturdayChecked: z.literal(true) });
type PublicationRow = { id: string; term_id: string; version: number; status: 'REVIEW' | 'APPROVED' | 'PUBLISHED'; snapshot_json: string; snapshot_hash: string; coordinator: string; remarks: string; created_at: string; approved_at: string | null; published_at: string | null };
type EvidenceRow = { id: string; version_id: string; channel: 'Printed' | 'Digital'; original_name: string; stored_path: string; sha256: string; added_at: string };

export async function ensurePublicationTables(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('timetable_review_versions'))) await db.schema.createTable('timetable_review_versions', t => {
    t.string('id', 36).primary(); t.string('term_id', 36).notNullable(); t.integer('version').notNullable();
    t.string('status', 20).notNullable(); t.text('snapshot_json').notNullable(); t.string('snapshot_hash', 64).notNullable();
    t.string('coordinator', 120).notNullable(); t.text('remarks').notNullable().defaultTo('');
    t.string('created_at', 36).notNullable(); t.string('approved_at', 36).nullable(); t.string('published_at', 36).nullable();
    t.unique(['term_id', 'version']);
  });
  if (!(await db.schema.hasTable('timetable_review_evidence'))) await db.schema.createTable('timetable_review_evidence', t => {
    t.string('id', 36).primary(); t.string('version_id', 36).notNullable().references('id').inTable('timetable_review_versions').onDelete('RESTRICT');
    t.string('channel', 12).notNullable(); t.string('original_name', 255).notNullable(); t.text('stored_path').notNullable();
    t.string('sha256', 64).notNullable(); t.string('added_at', 36).notNullable();
  });
  if (!(await db.schema.hasTable('timetable_approval_audit'))) await db.schema.createTable('timetable_approval_audit', t => {
    t.string('id', 36).primary(); t.string('version_id', 36).notNullable().references('id').inTable('timetable_review_versions').onDelete('RESTRICT');
    t.string('hod_name', 120).notNullable(); t.string('approval_date', 10).notNullable(); t.string('channel', 12).notNullable();
    t.string('reference', 300).notNullable(); t.string('recorded_at', 36).notNullable();
    t.string('recorded_by', 120).notNullable(); t.text('evidence_hashes').notNullable();
  });
}
async function masterForTerm(db: Knex, termId: string): Promise<ScheduleData> {
  const weekly = await loadMasterSnapshot(db, { termId, date: null });
  const rows = await db('schedule_activities').where({ term_id: termId, mode: 'Dated', active: 1 }).orderBy('id').select();
  const participation = rows.length ? await db('schedule_activity_sections').whereIn('activity_id', rows.map(r => r.id)).select() : [];
  const datedEvents: MasterEvent[] = rows.map(r => ({
    id: String(r.id), source: 'Activity', title: String(r.title), detail: String(r.kind), mode: 'Dated',
    weekday: Number(r.weekday), bookingDate: r.booking_date ? String(r.booking_date) : null, startPeriod: Number(r.start_period), periodCount: Number(r.period_count),
    facultyId: r.faculty_id ? String(r.faculty_id) : null, labId: r.lab_id ? String(r.lab_id) : null,
    sectionIds: participation.filter(p => p.activity_id === r.id).map(p => String(p.section_id)),
  }));
  const suspensions = await db('schedule_lab_suspensions as x').join('schedule_activities as a', 'a.id', 'x.activity_id')
    .where('a.term_id', termId).where('a.active', 1).orderBy('x.booking_date').orderBy('x.activity_id').orderBy('x.lab_booking_id').select('x.lab_booking_id as labBookingId', 'x.booking_date as bookingDate');
  const sat = await db('lab_term_saturday').where({ term_id: termId }).first();
  return {
    term: weekly.term, sections: weekly.sections, faculty: weekly.faculty, labs: weekly.labs, events: weekly.events,
    datedEvents, suspensions: suspensions.map(s => ({ labBookingId: String(s.labBookingId), bookingDate: String(s.bookingDate) })),
    unplaced: weekly.unplaced, conflicts: weekly.conflicts, clock: weekly.clock, stale: weekly.note.includes('STALE'), saturdayConfirmed: Number(sat?.confirmed) === 1,
  };
}
async function getBranding(db: Knex): Promise<CapturedBranding> {
  const row = await db('institution_branding').where({ id: 1 }).first();
  return {
    collegeName: String(row?.college_name || ''), departmentName: String(row?.department_name || 'Department of Computer Applications'),
    copyrightText: String(row?.copyright_text || ''), developerName: String(row?.developer_name || ''),
    collegeLogo: row?.college_logo_data ? String(row.college_logo_data) : null, developerLogo: row?.developer_logo_data ? String(row.developer_logo_data) : null
  };
}
async function capture(db: Knex, termId: string): Promise<FrozenPublication> { return { schedule: await masterForTerm(db, termId), branding: await getBranding(db) }; }
async function getVersion(db: Knex, id: string): Promise<PublicationRow> { const row = await db<PublicationRow>('timetable_review_versions').where({ id }).first(); if (!row) throw new Error('Review version was not found.'); return row; }
async function getEvidence(db: Knex, id: string): Promise<EvidenceRow[]> { return db<EvidenceRow>('timetable_review_evidence').where({ version_id: id }).orderBy('added_at'); }
function viewInfo(row: PublicationRow, evidence: EvidenceRow[]) { return { id: row.id, termId: row.term_id, version: row.version, status: row.status, hash: row.snapshot_hash, coordinator: row.coordinator, remarks: row.remarks, createdAt: row.created_at, approvedAt: row.approved_at, publishedAt: row.published_at, evidence: evidence.map(e => ({ id: e.id, channel: e.channel, name: e.original_name, sha256: e.sha256 })) }; }

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function text(v: unknown) { return escapeHtml(v); }
function reportHtml(data: FrozenPublication, row: PublicationRow, views: ScheduleView[], _audit: Record<string, unknown> | undefined, _evidence: EvidenceRow[]): string {
  const { schedule: s, branding: b } = data;
  const times = s.clock?.periods || [];
  const periods = [1, 2, 3, 4, 5, 6];
  const fmtTime = (p: number) => { const t = times.find(x => x.number === p); return t ? `${t.start} - ${t.end}` : ''; };
  const lunchTime = `${times.find(x => x.number === 3)?.end || '12:45'} - ${times.find(x => x.number === 4)?.start || '13:45'}`;
  const status = row.status === 'REVIEW' ? 'DRAFT - NOT APPROVED' : row.status;
  const sheet = (v: ScheduleView) => {
    const rows = days.map((day, i) => {
      const cell = (p: number) => {
        const entries = weeklyCells(v.events, i, p);
        if (!entries.length) return '<td class="free"></td>';
        return `<td class="occupied${entries.some(e=>e.languageOne===true||/\b(?:language|lang)[\s_-]*0?1\b/i.test(e.title))?' language-one':''}">${entries.map(e => `<div class="class-entry"><strong>${text(e.title)}</strong>${e.detail ? `<span class="detail">${text(e.detail)}</span>` : ''}</div>`).join('')}</td>`;
      };
      return `<tr><th scope="row">${text(day)}</th>${periods.slice(0, 3).map(cell).join('')}<td class="lunch"></td>${periods.slice(3).map(cell).join('')}</tr>`;
    }).join('');
    return `<section class="timetable-page">
   <header class="institution-header">
    <div class="logo-space">${b.collegeLogo ? `<img class="college-logo" src="${b.collegeLogo}" alt="College logo">` : ''}</div>
    <div class="institution-title"><div class="college-name">${text(b.collegeName || 'College name not configured')}</div><div class="department">${text(b.departmentName)}</div><div class="academic">${text(s.term.academicYear)} / ${text(s.term.cycle)} semester</div></div>
    <div class="logo-space"></div>
   </header>
   <div class="timetable-title"><h1>${text(v.scope)} Timetable - ${text(v.label)}</h1><div class="version">Version ${row.version} <span class="status">${text(status)}</span></div></div>
   ${v.events.length === 0 ? '<div class="empty-warning">No recurring classes are scheduled for this selection.</div>' : ''}
   <table class="timetable" aria-label="Weekly timetable"><colgroup><col class="day-col"><col span="3"><col class="break-col"><col span="3"></colgroup>
    <thead><tr><th>Day</th>${periods.slice(0, 3).map(p => `<th>P${p}<span class="timing">${text(fmtTime(p))}</span></th>`).join('')}<th class="lunch-head">LUNCH<span class="timing">${text(lunchTime)}</span></th>${periods.slice(3).map(p => `<th>P${p}<span class="timing">${text(fmtTime(p))}</span></th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
   </table>
  </section>`;
  };
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
  @page{size:A4 landscape;margin:11mm 11mm 10mm}
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#173b34;font-family:Arial,Helvetica,sans-serif;font-size:9pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .timetable-page{break-after:page;page-break-after:always;min-height:0}.timetable-page:last-child{break-after:auto;page-break-after:auto}
  .institution-header{display:grid;grid-template-columns:70px 1fr 70px;align-items:center;gap:8px;padding:3px 1px 9px;border-bottom:2px solid #23584a;min-height:76px;text-align:center}
  .logo-space{height:66px;display:flex;align-items:center;justify-content:center}.college-logo{display:block;max-width:65px;max-height:65px;object-fit:contain}
  .college-name{font-weight:700;font-size:18pt;line-height:1.12;color:#143e33}.department{font-size:10pt;font-weight:600;margin-top:4px}.academic{font-size:8.5pt;color:#42675d;margin-top:3px}
  .timetable-title{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin:12px 0 10px}h1{font-size:13pt;margin:0;color:#143e33}.version{font-size:8.5pt;white-space:nowrap;color:#425c56}.status{margin-left:8px;font-weight:700;color:#9f3a32}
  .empty-warning{background:#fff2e9;color:#8d411e;padding:5px 8px;margin:4px 0 9px;font-size:8.5pt}
  table.timetable{table-layout:fixed;width:100%;border-collapse:collapse;page-break-inside:avoid;break-inside:avoid;font-size:8.5pt}
  col.day-col{width:13%}col.break-col{width:7%}
  .timetable th,.timetable td{border:1px solid #b6cfc7;overflow-wrap:anywhere;word-break:normal}
  .timetable thead th{background:#dceae5;text-align:center;padding:9px 3px;font-weight:700;font-size:8.6pt;line-height:1.25}
  .timing{display:block;margin-top:3px;color:#49685f;font-weight:400;font-size:7pt;white-space:nowrap}
  .timetable tbody th{background:#ecf3f0;vertical-align:middle;text-align:center;font-weight:700;padding:8px 4px}
  .timetable tbody td{vertical-align:middle;height:20mm;padding:6px 6px;line-height:1.25}
  .timetable tbody td.occupied{background:#f1f7f3}.timetable tbody td.occupied.language-one{background:#fff0b0;border-left:3px solid #bb8a13}.timetable tbody td.free{background:#fff}
  .timetable .lunch,.timetable .lunch-head{background:#f2f0e9;color:#6c6659;text-align:center}.timetable tbody td.lunch{background:#f5f3ee}
  .class-entry{max-height:100%;display:block}.class-entry + .class-entry{border-top:1px solid #9abbb0;margin-top:4px;padding-top:4px}
  .class-entry strong{display:block;color:#173f34;font-weight:700;font-size:8pt;line-height:1.22}.class-entry .detail{display:block;margin-top:3px;color:#526a62;font-size:7pt;line-height:1.2}
  @media screen{body{padding:12px}.timetable-page{border:1px solid #c9dad3;padding:8px;margin-bottom:20px}}
  </style></head><body>${views.map(sheet).join('')}</body></html>`;
}

function xlsxName(name: string, used: Set<string>): string { let base = name.replace(/[\\\/*?:\[\]]/g, ' ').slice(0, 28) || 'Sheet'; let output = base; let n = 2; while (used.has(output)) { output = `${base.slice(0, 26)} ${n++}`; } used.add(output); return output; }
async function saveWorkbook(frozen: FrozenPublication, row: PublicationRow, views: ScheduleView[], _audit: Record<string, unknown> | undefined, filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BCA Timetable Manager';
  wb.created = new Date(row.created_at);
  const { schedule: s, branding: b } = frozen;
  const used = new Set<string>();
  const imageId = (data: string | null): number | null => {
    if (!data) return null;
    const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(data);
    if (!m) return null;
    return wb.addImage({ base64: m[2], extension: m[1] === 'png' ? 'png' : 'jpeg' });
  };
  const collegeLogo = imageId(b.collegeLogo);
  const timing = (p: number): string => {
    const slot = s.clock?.periods.find(x => x.number === p);
    return slot ? `${slot.start}-${slot.end}` : '';
  };
  const p3 = s.clock?.periods.find(x => x.number === 3);
  const p4 = s.clock?.periods.find(x => x.number === 4);
  const lunch = p3 && p4 ? `${p3.end}-${p4.start}` : 'Lunch';
  const status = row.status === 'REVIEW' ? 'DRAFT - NOT APPROVED' : row.status;

  for (const view of views) {
    const sheet = wb.addWorksheet(xlsxName(`${view.scope}-${view.label}`, used), {
      pageSetup: {
        paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
        margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
      },
    });
    // Day, P1, P2, P3, LUNCH, P4, P5, P6.
    sheet.columns = [{ width: 17 }, { width: 28 }, { width: 28 }, { width: 28 }, { width: 14 }, { width: 28 }, { width: 28 }, { width: 28 }];
    sheet.mergeCells('A1:H1');
    sheet.getCell('A1').value = b.collegeName || 'College name not configured';
    sheet.getCell('A1').font = { size: 17, bold: true, color: { argb: 'FF21463B' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 44;
    sheet.mergeCells('A2:H2');
    sheet.getCell('A2').value = b.departmentName;
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A2').font = { size: 11, bold: true };
    sheet.getRow(2).height = 20;
    sheet.mergeCells('A3:H3');
    sheet.getCell('A3').value = `${view.scope} Timetable - ${view.label} | ${s.term.academicYear} ${s.term.cycle} | Version ${row.version} | ${status}`;
    sheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getCell('A3').font = { size: 10, bold: true };
    sheet.getRow(3).height = 29;
    sheet.getRow(4).height = 9;
    if (collegeLogo !== null) sheet.addImage(collegeLogo, { tl: { col: 0, row: 0 }, ext: { width: 54, height: 54 } });
    sheet.getRow(5).values = ['Day', ...[1, 2, 3].map(p => `P${p}\n${timing(p)}`), `LUNCH\n${lunch}`, ...[4, 5, 6].map(p => `P${p}\n${timing(p)}`)];
    sheet.getRow(5).height = 38;
    for (let day = 0; day < 6; day++) {
      const entries = (p: number) => weeklyCells(view.events, day, p).map(e => e.title + (e.detail ? `\n${e.detail}` : '')).join('\n');
      const line = sheet.getRow(day + 6);
      line.values = [days[day], ...[1, 2, 3].map(entries), '', ...[4, 5, 6].map(entries)];
      line.height = 68;
      line.alignment = { wrapText: true, vertical: 'middle' };
    }
    for (const line of sheet.getRows(5, 7) || []) {
      line.eachCell({ includeEmpty: true }, cell => {
        const edge = { style: 'thin' as const, color: { argb: 'FFCDDBD7' } };
        cell.border = { top: edge, bottom: edge, left: edge, right: edge };
        if (line.number === 5) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFECE8' } };
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        } else if (cell.address === `A${line.number}`) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F6F3' } };
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cell.address === `E${line.number}`) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3EE' } };
        } else if (cell.value && ((()=>{const day=line.number-6;const column=Number(cell.col);const period=({2:1,3:2,4:3,6:4,7:5,8:6} as Record<number,number>)[column];return period?weeklyCells(view.events,day,period).some(e=>e.languageOne===true||/\b(?:language|lang)[\s_-]*0?1\b/i.test(e.title)):false;})())) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEEB0' } };
          cell.font = { bold: true, color: { argb: 'FF614100' } };
        } else if (cell.value) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5FAF7' } };
        }
      });
    }
    // Timetable and institutional header only: no footer or developer logo.
    sheet.headerFooter.oddHeader = '';
    sheet.headerFooter.oddFooter = '';
    sheet.pageSetup.printArea = 'A1:H11';
    sheet.views = [{ state: 'frozen', ySplit: 5 }];
  }
  // Review/approval evidence is retained in the database, not appended to timetable exports.
  await wb.xlsx.writeFile(filePath);
}

export function registerPublicationHandlers(db: Knex): void {
  protectedHandle('publication:list', async (_e, raw: unknown) => {
    const termId = uuid.parse(raw);
    const rows = await db<PublicationRow>('timetable_review_versions').where({ term_id: termId }).orderBy('version', 'desc').select();
    return Promise.all(rows.map(async row => viewInfo(row, await getEvidence(db, row.id))));
  });
  protectedHandle('publication:createReview', async (_e, raw: unknown) => {
    const input = reviewSchema.parse(raw); const frozen = await capture(db, input.termId);
    if (!frozen.branding.collegeName.trim()) throw new Error('Save the official college name in College Branding before creating a review version.');
    if (!frozen.schedule.clock?.confirmed) throw new Error('Confirm period timings first.');
    const hash = snapshotFingerprint(frozen); const now = new Date().toISOString();
    return db.transaction(async trx => {
      const last = await trx('timetable_review_versions').where({ term_id: input.termId }).max({ highest: 'version' }).first();
      const version = Number(last?.highest || 0) + 1; const id = randomUUID();
      await trx('timetable_review_versions').insert({ id, term_id: input.termId, version, status: 'REVIEW', snapshot_json: JSON.stringify(frozen), snapshot_hash: hash, coordinator: input.coordinator, remarks: input.remarks, created_at: now });
      return { id, version, status: 'REVIEW', blockers: publicationBlockers(frozen.schedule) };
    });
  });
  protectedHandle('publication:inspect', async (_e, raw: unknown) => {
    const id = uuid.parse(raw), row = await getVersion(db, id), frozen = JSON.parse(row.snapshot_json) as FrozenPublication;
    const audit = await db('timetable_approval_audit').where({ version_id: id }).first();
    const evidence = await getEvidence(db, id);
    return { ...viewInfo(row, evidence), blockers: publicationBlockers(frozen.schedule), sections: frozen.schedule.sections, faculty: frozen.schedule.faculty, labs: frozen.schedule.labs, datedCount: frozen.schedule.datedEvents.length, audit: audit ? { hodName: audit.hod_name, approvalDate: audit.approval_date, reference: audit.reference, channel: audit.channel } : null };
  });
  protectedHandle('publication:attachEvidence', async (event, raw: unknown) => {
    const { versionId, channel } = evidenceSchema.parse(raw);
    const row = await getVersion(db, versionId); if (row.status !== 'REVIEW') throw new Error('Approval evidence is locked once approved. Create a new review version for changes.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Select HOD approval evidence (PDF, PNG, JPG)', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Approval evidence', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }] };
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (chosen.canceled || !chosen.filePaths.length) return { cancelled: true };
    const original = chosen.filePaths[0], ext = path.extname(original).toLowerCase();
    if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('Evidence must be PDF, PNG or JPG.');
    const bytes = await readFile(original); if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Evidence file must be between 1 byte and 15 MB.');
    if (ext === '.pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Selected file is not a valid PDF header.');
    if (ext === '.png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Selected file is not PNG.');
    if (['.jpg', '.jpeg'].includes(ext) && !(bytes[0] === 255 && bytes[1] === 216)) throw new Error('Selected file is not JPEG.');
    const folder = path.join(app.getPath('userData'), 'approval-evidence', versionId); await mkdir(folder, { recursive: true });
    const id = randomUUID(), destination = path.join(folder, id + ext); await copyFile(original, destination);
    try { await db('timetable_review_evidence').insert({ id, version_id: versionId, channel, original_name: path.basename(original).slice(0, 255), stored_path: destination, sha256: createHash('sha256').update(bytes).digest('hex'), added_at: new Date().toISOString() }); }
    catch (err) { await unlink(destination).catch(() => { }); throw err; }
    return { cancelled: false };
  });
  protectedHandle('publication:approve', async (_e, raw: unknown) => {
    const input = approveSchema.parse(raw);
    if (Number.isNaN(Date.parse(input.approvalDate)) || new Date(input.approvalDate + 'T12:00:00Z').toISOString().slice(0, 10) !== input.approvalDate) throw new Error('Enter a real HOD approval date.');
    const row = await getVersion(db, input.versionId);
    if (row.status !== 'REVIEW') throw new Error('This version is already approved/published.');
    const frozen = JSON.parse(row.snapshot_json) as FrozenPublication;
    const blockers = publicationBlockers(frozen.schedule); if (blockers.length) throw new Error('Cannot approve incomplete timetable: ' + blockers.join(' '));
    const evidence = await getEvidence(db, row.id);
    if (!hasEvidence(input.channel, evidence)) throw new Error('Attach the required printed/digital approval evidence before approval.');
    const live = await capture(db, row.term_id);
    if (snapshotFingerprint(live) !== row.snapshot_hash) throw new Error('Schedules or branding changed since the review snapshot. Create a NEW review version.');
    for (const file of evidence) { const bytes = await readFile(file.stored_path); if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Approval evidence has changed: ${file.original_name}`); }
    return db.transaction(async trx => {
      const updated = await trx('timetable_review_versions').where({ id: row.id, status: 'REVIEW' }).update({ status: 'APPROVED', approved_at: new Date().toISOString() });
      if (updated !== 1) throw new Error('Approval status changed. Refresh.');
      await trx('timetable_approval_audit').insert({ id: randomUUID(), version_id: row.id, hod_name: input.hodName, approval_date: input.approvalDate, channel: input.channel, reference: input.reference, recorded_at: new Date().toISOString(), recorded_by: row.coordinator, evidence_hashes: JSON.stringify(evidence.map(e => e.sha256)) });
      return { status: 'APPROVED' };
    });
  });
  protectedHandle('publication:publish', async (_e, raw: unknown) => {
    const id = uuid.parse(raw); const row = await getVersion(db, id);
    if (row.status !== 'APPROVED') throw new Error('Only approved versions may be published.');
    // Never silently publish an out-of-date schedule.
    const live = await capture(db, row.term_id);
    if (snapshotFingerprint(live) !== row.snapshot_hash) throw new Error('Underlying timetable has changed since approval; create and approve a new version.');
    const n = await db('timetable_review_versions').where({ id, status: 'APPROVED' }).update({ status: 'PUBLISHED', published_at: new Date().toISOString() });
    if (n !== 1) throw new Error('Publication status changed. Refresh.');
    return { status: 'PUBLISHED' };
  });
  protectedHandle('publication:export', async (event, raw: unknown) => {
    const { versionId, scope, resourceId, format } = selectSchema.parse(raw);
    const row = await getVersion(db, versionId); const frozen = JSON.parse(row.snapshot_json) as FrozenPublication;
    if (snapshotFingerprint(frozen) !== row.snapshot_hash) throw new Error('Snapshot failed integrity verification.');
    const views = documentViews(frozen.schedule, scope as PublishScope, resourceId);
    if (!views.length) throw new Error('Select a valid section, faculty, laboratory, or Department.');
    const defaultName = safeFilename(`BCA_${frozen.schedule.term.academicYear}_${frozen.schedule.term.cycle}_v${row.version}_${scope}_${views.length === 1 ? views[0].label : 'All'}`) + '.' + format.toLowerCase();
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { title: `Export ${row.status} ${format} timetable`, defaultPath: defaultName, filters: [{ name: format === 'PDF' ? 'PDF document' : 'Excel workbook', extensions: [format === 'PDF' ? 'pdf' : 'xlsx'] }] };
    const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    const audit = await db('timetable_approval_audit').where({ version_id: versionId }).first() as Record<string, unknown> | undefined;
    const evidence = await getEvidence(db, versionId);
    if (format === 'XLSX') await saveWorkbook(frozen, row, views, audit, choice.filePath);
    else {
      const html = reportHtml(frozen, row, views, audit, evidence);
      const tmp = path.join(app.getPath('temp'), `bca-export-${randomUUID()}.html`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmp, html, 'utf8');
      const hidden = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      try { await hidden.loadFile(tmp); const pdf = await hidden.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true }); await writeFile(choice.filePath, pdf); }
      finally { hidden.destroy(); await unlink(tmp).catch(() => { }); }
    }
    return { cancelled: false, filePath: choice.filePath, status: row.status };
  });
}
