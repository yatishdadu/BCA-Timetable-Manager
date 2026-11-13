/**
 * Phase 2E3A: authenticated, non-destructive offline backups.
 * Does not modify the live database, approve a timetable, restore, or reset data.
 * An SQLite VACUUM INTO snapshot avoids copying a live WAL/journal database file.
 * Original evidence files are copied and SHA-256 verified against the snapshot.
 */
import { app, BrowserWindow, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { protectedHandle } from './coordinatorAuth.ts';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import type { Knex } from 'knex';
import { z } from 'zod';

const HASH = /^[a-f0-9]{64}$/;
const evidenceSchema = z.object({
  id: z.string().uuid(), versionId: z.string().uuid(), originalName: z.string(),
  path: z.string().regex(/^approval-evidence\/[a-f0-9-]+\/[a-f0-9-]+\.(?:pdf|png|jpe?g)$/i),
  sha256: z.string().regex(HASH), size: z.number().int().nonnegative(),
}).strict();
const manifestSchema = z.object({
  kind: z.literal('BCA-TIMETABLE-OFFLINE-BACKUP'),
  formatVersion: z.literal(1),
  createdAt: z.string().datetime(),
  database: z.object({ path: z.literal('bca-timetable.db'), size: z.number().int().positive(), sha256: z.string().regex(HASH) }).strict(),
  evidence: z.array(evidenceSchema),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type EvidenceFromSnapshot = { id: string; version_id: string; original_name: string; stored_path: string; sha256: string };
let operationRunning = false;

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

export async function fingerprint(filePath: string): Promise<{ size: number; sha256: string }> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('Backup component is not a normal file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return { size: info.size, sha256: hash.digest('hex') };
}

export async function sqliteIntegrity(filePath: string): Promise<void> {
  const conn = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
  try {
    const rows = await new Promise<Array<{ integrity_check: string }>>((resolve, reject) => {
      conn.all('PRAGMA integrity_check', (error: Error | null, result: Array<{ integrity_check: string }>) => {
        if (error) reject(error); else resolve(result);
      });
    });
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check did not pass.');
  } finally {
    await new Promise<void>((resolve, reject) => {
      conn.close((error: Error | null) => error ? reject(error) : resolve());
    });
  }
}

async function snapshotEvidence(filePath: string): Promise<EvidenceFromSnapshot[]> {
  const conn = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
  try {
    return await new Promise<EvidenceFromSnapshot[]>((resolve, reject) => {
      conn.all('SELECT id, version_id, original_name, stored_path, sha256 FROM timetable_review_evidence ORDER BY id',
        (error: Error | null, rows: EvidenceFromSnapshot[]) => error ? reject(error) : resolve(rows));
    });
  } finally {
    await new Promise<void>((resolve, reject) => conn.close((error: Error | null) => error ? reject(error) : resolve()));
  }
}

export function checkedRelative(root: string, relative: string): string {
  const parts = relative.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes(':'))) {
    throw new Error('Backup manifest contains an unsafe path.');
  }
  const full = path.resolve(root, ...parts);
  if (!inside(root, full) || full === root) throw new Error('Backup file escapes its folder.');
  return full;
}

/** Verifies on-disk bytes, file paths and SQLite integrity. No live data changes. */
export async function verifyBundle(folder: string): Promise<{ evidenceFiles: number; bytes: number; createdAt: string }> {
  const root = await realpath(folder);
  const manifestFile = path.join(root, 'manifest.json');
  const manifestStat = await lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Invalid backup manifest file.');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8'))) as Manifest;
  const entries = [manifest.database, ...manifest.evidence];
  const used = new Set<string>();
  let totalBytes = 0;
  for (const item of entries) {
    const relative = item.path;
    if (used.has(relative.toLowerCase())) throw new Error('Duplicate file in backup manifest.');
    used.add(relative.toLowerCase());
    const file = checkedRelative(root, relative);
    const real = await realpath(file);
    if (!inside(root, real)) throw new Error('Backup contains a link outside its folder.');
    const fileStat = await lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Backup contains a non-file or symbolic link.');
    const actual = await fingerprint(file);
    if (actual.size !== item.size || actual.sha256 !== item.sha256) throw new Error(`Backup checksum mismatch: ${relative}`);
    totalBytes += actual.size;
  }
  const databaseFile = path.join(root, 'bca-timetable.db');
  await sqliteIntegrity(databaseFile);
  const rows = await snapshotEvidence(databaseFile);
  if (rows.length !== manifest.evidence.length) throw new Error('Approval-evidence count does not match the snapshot database.');
  const byId = new Map(manifest.evidence.map(item => [item.id, item]));
  for (const row of rows) {
    const file = byId.get(row.id);
    if (!file || file.versionId !== row.version_id || file.sha256 !== row.sha256 || file.originalName !== row.original_name
      || file.path !== `approval-evidence/${row.version_id}/${path.basename(row.stored_path)}`) {
      throw new Error('Approval evidence manifest does not match the database.');
    }
  }
  return { evidenceFiles: manifest.evidence.length, bytes: totalBytes, createdAt: manifest.createdAt };
}

async function captureSnapshot(db: Knex, root: string): Promise<Manifest> {
  const dbFile = path.join(root, 'bca-timetable.db');
  // Use the existing single SQLite connection for an atomic online snapshot.
  await db.raw('VACUUM INTO ?', [dbFile]);
  await sqliteIntegrity(dbFile);
  const database = { path: 'bca-timetable.db' as const, ...await fingerprint(dbFile) };
  const evidenceRoot = path.join(app.getPath('userData'), 'approval-evidence');
  const originalEvidence = await snapshotEvidence(dbFile);
  const evidence: Manifest['evidence'] = [];
  for (const row of originalEvidence) {
    if (!z.string().uuid().safeParse(row.id).success || !z.string().uuid().safeParse(row.version_id).success) {
      throw new Error('Approval evidence contains an invalid identifier.');
    }
    const original = await realpath(row.stored_path);
    const home = await realpath(evidenceRoot);
    if (!inside(home, original)) throw new Error('Approval evidence was found outside the protected application folder.');
    const name = path.basename(original);
    if (!/^[a-f0-9-]{36}\.(pdf|png|jpg|jpeg)$/i.test(name)) throw new Error('Approval evidence has an unexpected filename.');
    const relative = `approval-evidence/${row.version_id}/${name}`;
    const destination = checkedRelative(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(original, destination);
    const actual = await fingerprint(destination);
    if (actual.sha256.toLowerCase() !== String(row.sha256).toLowerCase()) {
      throw new Error(`Approval evidence checksum differs from its recorded value (${row.original_name}).`);
    }
    evidence.push({ id: row.id, versionId: row.version_id, originalName: row.original_name, path: relative, ...actual });
  }
  return { kind: 'BCA-TIMETABLE-OFFLINE-BACKUP', formatVersion: 1, createdAt: new Date().toISOString(), database, evidence };
}

function appWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}
async function chooseFolder(event: IpcMainInvokeEvent, title: string, createDirectory = false): Promise<string | null> {
  const options = { title, properties: (createDirectory ? ['openDirectory', 'createDirectory'] : ['openDirectory']) as Array<'openDirectory' | 'createDirectory'> };
  const win = appWindow(event);
  const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return chosen.canceled || !chosen.filePaths.length ? null : chosen.filePaths[0];
}

/** Shared with the Reset workflow. Creates and independently verifies a new backup
 * BEFORE any staged reset is prepared. No live database records are modified. */
export async function createVerifiedBackup(db: Knex, selected: string): Promise<{folder:string;evidenceFiles:number;bytes:number;createdAt:string}> {
  if (operationRunning) throw new Error('Another backup operation is already running.');
  operationRunning = true;
  let temporary: string | null = null;
  try {
    const parent = await realpath(selected);
    const userData = await realpath(app.getPath('userData'));
    if (inside(userData, parent) || inside(parent, userData)) {
      throw new Error('Choose a separate backup destination, not the application data folder or its parent.');
    }
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const suffix = randomBytes(4).toString('hex');
    const name = `BCA-Backup-${timestamp}-${suffix}`;
    temporary = path.join(parent, `.${name}.incomplete`);
    const complete = path.join(parent, name);
    await mkdir(temporary, { recursive: false });
    const manifest = await captureSnapshot(db, temporary);
    await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
    const proof = await verifyBundle(temporary);
    await rename(temporary, complete);
    temporary = null;
    return { folder: complete, ...proof };
  } catch (error) {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally { operationRunning = false; }
}

export function registerDataBackupHandlers(db: Knex): void {
  protectedHandle('adminBackup:create', async event => {
    const selected = await chooseFolder(event, 'Choose a safe folder for the BCA backup', true);
    if (!selected) return { cancelled: true };
    return { cancelled: false, ...await createVerifiedBackup(db, selected) };
  });

  protectedHandle('adminBackup:verify', async event => {
    if (operationRunning) throw new Error('A backup operation is already running.');
    const selected = await chooseFolder(event, 'Select the BCA-Backup folder to verify');
    if (!selected) return { cancelled: true };
    operationRunning = true;
    try { return { cancelled: false, folder: selected, ...await verifyBundle(selected) }; }
    finally { operationRunning = false; }
  });
}
