/**
 * Phase 2E3B: authenticated offline restore from verified Phase 2E3A backups.
 * A selected backup is staged and reverified first. The on-disk switch happens
 * before Knex opens, on the next Electron launch. An interrupted switch rolls
 * back automatically on the following launch. Never use this to reset data.
 */
import { app, BrowserWindow, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { cp, copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { z } from 'zod';
import type { Knex } from 'knex';
import { protectedHandle, verifyCoordinatorPassword } from './coordinatorAuth.ts';
import { checkedRelative, fingerprint, sqliteIntegrity, verifyBundle } from './dataBackup.ts';

const MARKER = '.bca-restore-pending.json';
const UUID = z.string().uuid();
const HASH = z.string().regex(/^[a-f0-9]{64}$/);
const markerSchema = z.object({
  id: UUID,
  phase: z.enum(['prepared', 'committing']),
  stagedHash: HASH,
  createdAt: z.string().datetime(),
}).strict();
type Marker = z.infer<typeof markerSchema>;
type EvidenceEntry = { id: string; versionId: string; path: string; sha256: string };
let staged: { id: string; folder: string; info: { evidenceFiles: number; bytes: number; createdAt: string }; coordinator: string } | null = null;
let busy = false;

function userRoot(): string { return app.getPath('userData'); }
function markerFile(): string { return path.join(userRoot(), MARKER); }
function stagePath(id: string): string { return path.join(userRoot(), `.bca-restore-stage-${UUID.parse(id)}`); }
function rollbackPath(id: string): string { return path.join(userRoot(), `bca-restore-recovery-${UUID.parse(id)}`); }
function liveDb(): string { return path.join(userRoot(), 'bca-timetable.db'); }
function liveEvidence(): string { return path.join(userRoot(), 'approval-evidence'); }
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
async function atomicMarker(marker: Marker): Promise<void> {
  const dest = markerFile(), temporary = dest + '.tmp';
  await writeFile(temporary, JSON.stringify(marker), { encoding: 'utf8', flag: 'w', mode: 0o600 });
  await rename(temporary, dest);
}
async function readMarker(): Promise<Marker | null> {
  if (!(await exists(markerFile()))) return null;
  return markerSchema.parse(JSON.parse(await readFile(markerFile(), 'utf8')));
}
async function allSql<T>(file: string, sql: string, params: unknown[] = [], readOnly = true): Promise<T[]> {
  const conn = new sqlite3.Database(file, readOnly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  try {
    return await new Promise<T[]>((resolve, reject) => conn.all(sql, params, (err: Error | null, rows: T[]) => err ? reject(err) : resolve(rows)));
  } finally {
    await new Promise<void>((resolve, reject) => conn.close(err => err ? reject(err) : resolve()));
  }
}
async function rewriteEvidencePaths(dbFile: string, evidence: EvidenceEntry[]): Promise<void> {
  const conn = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE);
  const run = (sql: string, params: unknown[] = []) => new Promise<void>((resolve, reject) => {
    conn.run(sql, params, function (err: Error | null) { err ? reject(err) : resolve(); });
  });
  try {
    await run('BEGIN IMMEDIATE');
    try {
      for (const file of evidence) {
        const target = checkedRelative(userRoot(), file.path);
        await run('UPDATE timetable_review_evidence SET stored_path = ? WHERE id = ?', [target, file.id]);
      }
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK').catch(() => undefined); throw e; }
  } finally {
    await new Promise<void>((resolve, reject) => conn.close(err => err ? reject(err) : resolve()));
  }
}
async function manifestEvidence(folder: string): Promise<EvidenceEntry[]> {
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')) as { evidence: EvidenceEntry[] };
  return manifest.evidence;
}
async function assertSupportedDatabase(dbFile: string): Promise<string> {
  await sqliteIntegrity(dbFile);
  const tables = await allSql<{ name: string }>(dbFile, "SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(tables.map(t => t.name));
  for (const name of ['faculty', 'academic_terms', 'institution_branding', 'coordinator_login', 'timetable_review_versions', 'timetable_review_evidence']) {
    if (!names.has(name)) throw new Error(`The backup is missing required table '${name}'. Restore was not started.`);
  }
  const account = await allSql<{ name: string }>(dbFile, 'SELECT name FROM coordinator_login WHERE id=1');
  if (account.length !== 1) throw new Error('The backup has no coordinator login. Restore was not started.');
  return String(account[0].name);
}
async function validateStaged(stage: string, marker: Marker): Promise<void> {
  const dbFile = path.join(stage, 'bca-timetable.db');
  const actual = await fingerprint(dbFile);
  if (actual.sha256 !== marker.stagedHash) throw new Error('The staged restore database changed. Nothing was restored.');
  await assertSupportedDatabase(dbFile);
  const evidence = await manifestEvidence(stage);
  for (const file of evidence) {
    const source = checkedRelative(stage, file.path);
    const entry = await lstat(source);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Restore contains an invalid evidence file.');
    const actualEvidence = await fingerprint(source);
    if (actualEvidence.sha256 !== file.sha256) throw new Error('Staged HOD evidence has changed.');
  }
}
/** Recovery keeps the original files untouched until the switch is prepared. */
async function rollback(marker: Marker): Promise<void> {
  const recovery = rollbackPath(marker.id);
  const oldDb = path.join(recovery, 'original.db');
  if (await exists(oldDb)) {
    await rm(liveDb(), { force: true });
    await copyFile(oldDb, liveDb());
    for (const suffix of ['-wal', '-shm', '-journal']) {
      await rm(liveDb() + suffix, { force: true });
      const sidecar = path.join(recovery, `original.db${suffix}`);
      if (await exists(sidecar)) await copyFile(sidecar, liveDb() + suffix);
    }
  }
  const oldEvidence = path.join(recovery, 'approval-evidence');
  if (await exists(oldEvidence)) {
    await rm(liveEvidence(), { recursive: true, force: true });
    await cp(oldEvidence, liveEvidence(), { recursive: true, force: false, errorOnExist: true });
  } else if (await exists(recovery)) {
    // A recorded empty original evidence folder means incoming evidence must be discarded.
    if (await exists(path.join(recovery, 'no-original-evidence'))) await rm(liveEvidence(), { recursive: true, force: true });
  }
  await rm(markerFile(), { force: true });
}

/** Run before the app opens the SQLite database. */
export async function applyOrRecoverPendingRestore(): Promise<'none' | 'restored' | 'rolled-back'> {
  const marker = await readMarker();
  if (!marker) return 'none';
  if (marker.phase === 'committing') {
    await rollback(marker);
    return 'rolled-back';
  }
  const stage = stagePath(marker.id), recovery = rollbackPath(marker.id);
  try { await validateStaged(stage, marker); }
  catch (err) {
    // Still PREPARED: no live files have been touched, so simply abandon the
    // staged restore and open the original database rather than locking out the college.
    console.error('[restore] Staged backup rejected; original data preserved:', err);
    await rm(markerFile(), { force: true });
    return 'rolled-back';
  }
  // The prepared phase has NOT replaced live files yet. A failed prior attempt
  // may have left an incomplete recovery folder, which is safe to discard.
  if (await exists(recovery)) await rm(recovery, { recursive: true, force: true });
  await mkdir(recovery, { recursive: false });
  try {
    // This process has not opened Knex. The prior Electron process has exited.
    if (!(await exists(liveDb()))) throw new Error('The current database does not exist; refusing restore without rollback data.');
    if (await exists(liveDb())) {
      // Attempt to flush any WAL before copying; do not silently drop sidecar data.
      const checkpoint = await allSql<{ busy: number }>(liveDb(), 'PRAGMA wal_checkpoint(TRUNCATE)', [], false);
      if (checkpoint.some(x => Number(x.busy) !== 0)) throw new Error('The current database is busy. Close other application instances.');
      await copyFile(liveDb(), path.join(recovery, 'original.db'));
      await sqliteIntegrity(path.join(recovery, 'original.db'));
    }
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (await exists(liveDb() + suffix)) await copyFile(liveDb() + suffix, path.join(recovery, `original.db${suffix}`));
    }
    if (await exists(liveEvidence())) {
      await cp(liveEvidence(), path.join(recovery, 'approval-evidence'), { recursive: true, force: false, errorOnExist: true });
    } else {
      await writeFile(path.join(recovery, 'no-original-evidence'), '', { flag: 'wx' });
    }
    // Mark committing BEFORE replacing anything. A crash here will trigger rollback.
    await atomicMarker({ ...marker, phase: 'committing' });
    for (const suffix of ['-wal', '-shm', '-journal']) await rm(liveDb() + suffix, { force: true });
    await rm(liveDb(), { force: true });
    await copyFile(path.join(stage, 'bca-timetable.db'), liveDb());
    await rm(liveEvidence(), { recursive: true, force: true });
    if (await exists(path.join(stage, 'approval-evidence'))) {
      await cp(path.join(stage, 'approval-evidence'), liveEvidence(), { recursive: true, force: false, errorOnExist: true });
    }
    await sqliteIntegrity(liveDb());
    for (const file of await manifestEvidence(stage)) {
      const actual = await fingerprint(checkedRelative(userRoot(), file.path));
      if (actual.sha256 !== file.sha256) throw new Error('Restored approval evidence checksum mismatch.');
    }
    // Leave committing marker until full application initialization succeeds.
    return 'restored';
  } catch (e) {
    // Recover original files if the switch did not finish successfully.
    const current = await readMarker().catch(() => null);
    if (current?.phase === 'committing') await rollback(marker).catch(() => undefined);
    else await rm(recovery, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
}

export async function finishSuccessfulRestore(): Promise<string | null> {
  const marker = await readMarker();
  if (!marker || marker.phase !== 'committing') return null;
  const recovery = rollbackPath(marker.id);
  await rm(markerFile(), { force: true });
  await rm(stagePath(marker.id), { recursive: true, force: true });
  return recovery;
}

export async function rollbackFailedRestore(): Promise<void> {
  const marker = await readMarker();
  if (marker?.phase === 'committing') await rollback(marker);
}

/** Reuse the already-tested restart/rollback switch for a staged reset.
 * stage folder must have been created inside userData with a verified SQLite DB,
 * a manifest, and all referenced evidence files. */
export function newLocalResetStage(): { id: string; folder: string } {
  const id = randomUUID();
  return { id, folder: stagePath(id) };
}
export async function assertNoPendingRestore(): Promise<void> {
  if (busy || staged || await readMarker()) throw new Error('Complete or cancel the pending restore before preparing a reset.');
}
export async function scheduleLocalResetRestart(id: string, expectedHash: string, closeDatabase: () => Promise<void>): Promise<void> {
  await assertNoPendingRestore();
  const folder = stagePath(UUID.parse(id));
  const marker: Marker = { id, phase: 'prepared', stagedHash: HASH.parse(expectedHash), createdAt: new Date().toISOString() };
  await validateStaged(folder, marker);
  await atomicMarker(marker);
  // The handler returns before app exit, allowing the UI to display confirmation.
  setTimeout(() => {
    void (async () => {
      try {
        await closeDatabase();
        app.relaunch({ args: process.argv.slice(1) });
        app.exit(0);
      } catch (error) {
        console.error('[reset] Database close failed; automatic restart was not completed:', error);
      }
    })();
  }, 1100);
}

export function registerDataRestoreHandlers(db: Knex, closeDatabase: () => Promise<void>): void {
  protectedHandle('adminBackup:prepareRestore', async event => {
    if (busy || staged) throw new Error('Finish or cancel the previous restore preview first.');
    if (await readMarker()) throw new Error('A restore is pending a restart. Complete it before starting another.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = { title: 'Select a verified BCA-Backup folder to restore', properties: ['openDirectory'] as Array<'openDirectory'> };
    const chosen = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (chosen.canceled || !chosen.filePaths[0]) return { cancelled: true };
    busy = true;
    let candidate: string | null = null;
    try {
      const folder = await realpath(chosen.filePaths[0]);
      const root = await realpath(userRoot());
      if (isInside(root, folder) || isInside(folder, root)) throw new Error('Choose a protected backup OUTSIDE the application data directory.');
      const info = await verifyBundle(folder);
      const coordinator = await assertSupportedDatabase(path.join(folder, 'bca-timetable.db'));
      const id = randomUUID();
      candidate = stagePath(id);
      await mkdir(candidate, { recursive: false });
      const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')) as { evidence: EvidenceEntry[] };
      await copyFile(path.join(folder, 'manifest.json'), path.join(candidate, 'manifest.json'));
      await copyFile(path.join(folder, 'bca-timetable.db'), path.join(candidate, 'bca-timetable.db'));
      for (const file of manifest.evidence) {
        const target = checkedRelative(candidate, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(checkedRelative(folder, file.path), target);
      }
      // Reverify AFTER copying; the selected source could change while being copied.
      await verifyBundle(candidate);
      await rewriteEvidencePaths(path.join(candidate, 'bca-timetable.db'), manifest.evidence);
      await assertSupportedDatabase(path.join(candidate, 'bca-timetable.db'));
      staged = { id, folder: candidate, info, coordinator };
      return { cancelled: false, id, coordinator, ...info };
    } catch (e) {
      if (candidate) await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    } finally { busy = false; }
  });

  protectedHandle('adminBackup:cancelRestore', async () => {
    if (busy) throw new Error('Restore preview is busy.');
    if (staged) await rm(staged.folder, { recursive: true, force: true });
    staged = null;
    return { cancelled: true };
  });

  protectedHandle('adminBackup:confirmRestore', async (event, raw: unknown) => {
    const input = z.object({ id: UUID, password: z.string().min(1).max(128), confirmation: z.literal('RESTORE BACKUP'), understandsLoginReplacement: z.literal(true) }).strict().parse(raw);
    if (busy || !staged || staged.id !== input.id) throw new Error('Prepare and verify a backup before restoring it.');
    busy = true;
    try {
      await verifyCoordinatorPassword(event, db, input.password);
      const file = path.join(staged.folder, 'bca-timetable.db');
      const sha = (await fingerprint(file)).sha256;
      const marker: Marker = { id: staged.id, phase: 'prepared', stagedHash: sha, createdAt: new Date().toISOString() };
      await atomicMarker(marker);
      staged = null;
      // Let the renderer receive the response, then fully close SQLite before relaunch.
      setTimeout(() => {
        void (async () => {
          try {
            await closeDatabase();
            app.relaunch({ args: process.argv.slice(1) });
            app.exit(0);
          } catch (e) {
            console.error('[restore] could not close database; restart was not initiated:', e);
          }
        })();
      }, 1100);
      return { restarting: true };
    } finally { busy = false; }
  });
}
