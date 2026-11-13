/** Phase 2E3C: coordinator-authorized, backup-first, staged SQLite resets.
 * No live database tables are deleted directly. The existing startup restore
 * mechanism commits a staged, integrity-checked clone and preserves rollback.
 */
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import type { Knex } from 'knex';
import knexFactory from 'knex';
import { z } from 'zod';
import { protectedHandle, verifyCoordinatorPassword } from './coordinatorAuth.ts';
import { checkedRelative, createVerifiedBackup, fingerprint, sqliteIntegrity, verifyBundle } from './dataBackup.ts';
import { assertNoPendingRestore, newLocalResetStage, scheduleLocalResetRestart } from './dataRestore.ts';
import { assertNoUnknownTables, REQUIRED_PHRASES, resetBlockers, type ResetImpact, type ResetMode } from './resetRules.ts';

const resetChoiceSchema = z.object({
  mode: z.enum(['drafts', 'term', 'fresh']),
  termId: z.string().uuid().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.mode !== 'fresh' && !data.termId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the academic term to reset.' });
  if (data.mode === 'fresh' && data.termId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Start Fresh always applies to all academic terms.' });
});
const confirmSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(1).max(128),
  phrase: z.enum(['CLEAR DRAFTS', 'RESET TERM', 'START FRESH']),
  acknowledged: z.literal(true),
}).strict();
type Choice = z.infer<typeof resetChoiceSchema>;
type Pending = {
  id: string; stage: string; backup: string; sourceHash: string;
  choice: Choice; impact: ResetImpact; bytes: number; createdAt: string;
};
let pending: Pending | null = null;
let busy = false;

async function count(query: Knex.QueryBuilder): Promise<number> {
  const rows = await query.count({ n: '*' }).first() as { n?: string | number } | undefined;
  return Number(rows?.n ?? 0);
}
function versionQuery(db: Knex, choice: Choice): Knex.QueryBuilder {
  const q = db('timetable_review_versions');
  if (choice.mode !== 'fresh') q.where('term_id', choice.termId!);
  return q;
}
function allocationQuery(db: Knex, choice: Choice): Knex.QueryBuilder {
  const q = db('section_subject_allocations as a');
  if (choice.mode !== 'fresh') q.join('academic_sections as s', 's.id', 'a.section_id')
    .join('semester_offerings as so', 'so.id', 's.offering_id').where('so.term_id', choice.termId!);
  return q;
}
async function assess(db: Knex, choice: Choice): Promise<ResetImpact> {
  const names = (await db('sqlite_master').where({ type: 'table' }).pluck('name')) as string[];
  assertNoUnknownTables(names);
  if (choice.termId && !(await db('academic_terms').where({ id: choice.termId }).first())) throw new Error('Academic term not found. Refresh the page.');
  const selectedVersions = versionQuery(db, choice);
  const protectedVersions = await count(versionQuery(db, choice).whereIn('status', ['APPROVED', 'PUBLISHED']));
  const evidenceFiles = await count(db('timetable_review_evidence').whereIn('version_id', selectedVersions.clone().select('id')));
  const affected = choice.mode === 'drafts' ? 0 : 1;
  const scoped = (table: string) => {
    const q = db(table);
    if (choice.mode !== 'fresh') q.where('term_id', choice.termId!);
    return q;
  };
  const impact: ResetImpact = {
    mode: choice.mode, termId: choice.termId,
    protectedVersions, approvalEvidence: evidenceFiles,
    draftVersions: await count(versionQuery(db, choice).where({ status: 'REVIEW' })),
    theoryDrafts: await count(scoped('theory_draft_runs')),
    labBookings: affected ? await count(scoped('lab_bookings')) : 0,
    activities: affected ? await count(scoped('schedule_activities')) : 0,
    allocations: affected ? await count(allocationQuery(db, choice)) : 0,
    subjects: affected ? await count(scoped('term_subjects')) : 0,
    faculty: choice.mode === 'fresh' ? await count(db('faculty')) : 0,
    blockers: resetBlockers(protectedVersions, evidenceFiles),
  };
  return impact;
}
async function deleteScoped(trx: Knex.Transaction, table: string, termId: string | undefined): Promise<void> {
  const q = trx(table);
  if (termId) q.where('term_id', termId);
  await q.del();
}
async function applyChange(trx: Knex.Transaction, choice: Choice): Promise<void> {
  // Pending reset is performed only on a closed, staged copy of the database.
  const termId = choice.mode === 'fresh' ? undefined : choice.termId!;
  if (choice.mode !== 'drafts') {
    const activityIds = trx('schedule_activities').select('id');
    const labIds = trx('lab_bookings').select('id');
    if (termId) { activityIds.where('term_id', termId); labIds.where('term_id', termId); }
    await trx('schedule_lab_suspensions').whereIn('activity_id', activityIds)
      .orWhereIn('lab_booking_id', labIds).del();
    const sections = trx('schedule_activities').select('id');
    if (termId) sections.where('term_id', termId);
    await trx('schedule_activity_sections').whereIn('activity_id', sections).del();
    await deleteScoped(trx, 'schedule_activities', termId);
    await deleteScoped(trx, 'lab_bookings', termId);
  }
  // Protected approval evidence is always a blocker, never silently deleted.
  if (choice.mode === 'fresh') await trx('timetable_approval_audit').del();
  await deleteScoped(trx, 'manual_timetable_edits', termId);
  await deleteScoped(trx, 'theory_draft_runs', termId);
  await deleteScoped(trx, 'timetable_review_versions', termId);
  if (choice.mode === 'drafts') return;
  const allocationSections = trx('academic_sections as s')
    .join('semester_offerings as so', 'so.id', 's.offering_id').select('s.id');
  if (termId) allocationSections.where('so.term_id', termId);
  await trx('section_subject_allocations').whereIn('section_id', allocationSections).del();
  await deleteScoped(trx, 'term_subjects', termId);
  if (choice.mode === 'term') return;
  // Fresh: retain only institutional branding, confirmed campus clock/config,
  // current coordinator login and handover audit; remove academic working data.
  await trx('semester_period_policies').del();
  await trx('lab_semester_saturday').del();
  await trx('lab_term_saturday').del();
  await trx('academic_sections').del();
  await trx('semester_offerings').del();
  await trx('academic_terms').del();
  await trx('shared_laboratories').del();
  await trx('faculty').del();
}
async function mutateStagedDatabase(file: string, choice: Choice): Promise<ResetImpact> {
  const clone = knexFactory({ client: 'sqlite3', connection: { filename: file }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  try {
    await clone.raw('PRAGMA foreign_keys = ON');
    const impact = await assess(clone, choice);
    if (impact.blockers.length) throw new Error(impact.blockers.join(' '));
    await clone.transaction(async (trx) => {
      await applyChange(trx, choice);
      const fkRows = await trx.raw('PRAGMA foreign_key_check') as Array<unknown>;
      if (fkRows.length) throw new Error('The reset would create broken database references. Reset cancelled.');
    });
    const after = await assess(clone, choice);
    if (after.draftVersions || after.theoryDrafts || (choice.mode !== 'drafts' &&
      (after.labBookings || after.activities || after.allocations || after.subjects)) ||
      (choice.mode === 'fresh' && after.faculty)) {
      throw new Error('Not all selected records were cleared in the staged database. Reset cancelled.');
    }
    const user = await clone('coordinator_login').where({ id: 1 }).first();
    if (!user) throw new Error('Coordinator login was not preserved. Reset cancelled.');
    return impact;
  } finally { await clone.destroy(); }
}
async function hashCurrentSnapshot(db: Knex): Promise<string> {
  const file = path.join(app.getPath('userData'), `.bca-reset-compare-${randomUUID()}.db`);
  try {
    await db.raw('VACUUM INTO ?', [file]);
    return (await fingerprint(file)).sha256;
  } finally { await rm(file, { force: true }).catch(() => undefined); }
}
async function clearPending(): Promise<void> {
  if (pending) await rm(pending.stage, { recursive: true, force: true }).catch(() => undefined);
  pending = null;
}
export function registerDataResetHandlers(db: Knex, closeDatabase: () => Promise<void>): void {
  protectedHandle('adminReset:preview', async (_event, raw: unknown) => assess(db, resetChoiceSchema.parse(raw)));
  protectedHandle('adminReset:prepare', async (event, raw: unknown) => {
    if (busy || pending) throw new Error('Complete or cancel the pending reset first.');
    await assertNoPendingRestore();
    const choice = resetChoiceSchema.parse(raw);
    const impact = await assess(db, choice);
    if (impact.blockers.length) throw new Error(impact.blockers.join(' '));
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = { title: 'Choose a protected destination for the MANDATORY reset backup',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory'|'createDirectory'> };
    const chosen = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (chosen.canceled || !chosen.filePaths.length) return { cancelled: true };
    busy = true;
    let stage: string | null = null;
    try {
      // Automatically back up the ENTIRE live database and referenced HOD evidence.
      const backup = await createVerifiedBackup(db, chosen.filePaths[0]);
      const sourceHash = (await fingerprint(path.join(backup.folder, 'bca-timetable.db'))).sha256;
      const next = newLocalResetStage(); stage = next.folder;
      await mkdir(stage, { recursive: false });
      const manifest = JSON.parse(await readFile(path.join(backup.folder, 'manifest.json'), 'utf8')) as { evidence: Array<{ path: string }> };
      await copyFile(path.join(backup.folder, 'manifest.json'), path.join(stage, 'manifest.json'));
      await copyFile(path.join(backup.folder, 'bca-timetable.db'), path.join(stage, 'bca-timetable.db'));
      for (const evidence of manifest.evidence) {
        const destination = checkedRelative(stage, evidence.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(checkedRelative(backup.folder, evidence.path), destination);
      }
      const applied = await mutateStagedDatabase(path.join(stage, 'bca-timetable.db'), choice);
      await sqliteIntegrity(path.join(stage, 'bca-timetable.db'));
      pending = { id: next.id, stage, backup: backup.folder, sourceHash,
        choice, impact: applied, bytes: backup.bytes, createdAt: backup.createdAt };
      stage = null;
      return { cancelled: false, id: pending.id, backupFolder: pending.backup, createdAt: pending.createdAt,
        bytes: pending.bytes, ...pending.impact };
    } catch (error) { if (stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined); throw error; }
    finally { busy = false; }
  });
  protectedHandle('adminReset:cancel', async () => {
    if (busy) throw new Error('Reset preparation is busy.');
    await clearPending(); return { cancelled: true };
  });
  protectedHandle('adminReset:confirm', async (event, raw: unknown) => {
    const input = confirmSchema.parse(raw);
    if (busy || !pending || input.id !== pending.id) throw new Error('Prepare a fresh verified backup before resetting.');
    if (input.phrase !== REQUIRED_PHRASES[pending.choice.mode]) throw new Error('The confirmation phrase does not match the chosen reset.');
    busy = true;
    try {
      await verifyCoordinatorPassword(event, db, input.password);
      await assertNoPendingRestore();
      await verifyBundle(pending.backup);
      const sourceHash = await hashCurrentSnapshot(db);
      if (sourceHash !== pending.sourceHash) throw new Error('Live records changed after the reset backup. Cancel this preview and start a new one.');
      const hash = (await fingerprint(path.join(pending.stage, 'bca-timetable.db'))).sha256;
      await scheduleLocalResetRestart(pending.id, hash, closeDatabase);
      pending = null;
      return { restarting: true };
    } finally { busy = false; }
  });
}
