/**
 * Phase 2E1: single offline coordinator account. An untrusted renderer cannot
 * bypass login by changing routes or directly invoking faculty/lab/publication IPC.
 * This protects app operations, not an OS administrator who has filesystem access.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import type { Knex } from 'knex';
import { z } from 'zod';
import {
  normalizeIdentity, validUsername, validEmployeeCode, validPassword,
  validRecoveryCode, normalizeRecoveryCode, groupRecoveryCode
} from './coordinatorAuthRules.ts';


const HASH_BYTES = 64;
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const sessions = new Set<number>();
const appWindows = new Set<number>();
const failedAttempts = new Map<number, { count: number; blockedUntil: number }>();
type Coordinator = {
  id: number; name: string; employee_code: string; username: string;
  password_salt: string; password_hash: string; recovery_sha256: string; created_at: string;
};

const setupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  employeeCode: z.string().trim().refine(validEmployeeCode, 'Use 2–64 letters, digits, dots, underscores or hyphens.'),
  username: z.string().trim().refine(validUsername, 'Use 3–64 letters, digits, dots, underscores or hyphens.'),
  password: z.string().refine(validPassword, 'Use a password of 12–128 characters, without control characters.'),
});
const loginSchema = z.object({ username: z.string().max(128), password: z.string().max(128) });
const recoverySchema = z.object({
  recoveryCode: z.string().refine(validRecoveryCode, 'Enter the recovery code provided at initial setup.'),
  newPassword: z.string().refine(validPassword, 'New password must have 12–128 characters.'),
});


const rotateRecoverySchema = z.object({
  currentPassword: z.string().max(128),
});
const transferCoordinatorSchema = setupSchema.extend({
  currentPassword: z.string().max(128),
  authorizationReference: z.string().trim().min(5).max(300),
});

function assertAppWindow(event: IpcMainInvokeEvent): void {
  if (!appWindows.has(event.sender.id) || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Request was not sent from the BCA Timetable Manager window.');
  }
}
function assertLoggedIn(event: IpcMainInvokeEvent): void {
  assertAppWindow(event);
  if (!sessions.has(event.sender.id)) throw new Error('Coordinator login required. Please sign in.');
}

/** Every non-authentication handler must register with this wrapper. */
export function protectedHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  if (channel.startsWith('auth:')) throw new Error('Do not register auth channels with protectedHandle.');
  ipcMain.handle(channel, (event, ...args) => {
    assertLoggedIn(event);
    return handler(event, ...args);
  });
}

export function allowCoordinatorWindow(contents: WebContents): void {
  appWindows.add(contents.id);
  contents.on('destroyed', () => { appWindows.delete(contents.id); sessions.delete(contents.id); failedAttempts.delete(contents.id); });
  contents.on('render-process-gone', () => { sessions.delete(contents.id); });
}

export async function ensureCoordinatorAuthTable(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('coordinator_login'))) {
    await db.schema.createTable('coordinator_login', (table) => {
      table.integer('id').primary();
      table.string('name', 120).notNullable();
      table.string('employee_code', 64).notNullable();
      table.string('username', 64).notNullable();
      table.string('password_salt', 32).notNullable();
      table.string('password_hash', 128).notNullable();
      table.string('recovery_sha256', 64).notNullable();
      table.string('created_at', 36).notNullable();
    });
  }

  if (!(await db.schema.hasTable('coordinator_handover_audit'))) {
    await db.schema.createTable('coordinator_handover_audit', (table) => {
      table.string('id', 36).primary();
      table.string('previous_name', 120).notNullable();
      table.string('previous_employee_code', 64).notNullable();
      table.string('incoming_name', 120).notNullable();
      table.string('incoming_employee_code', 64).notNullable();
      table.string('changed_at', 36).notNullable();
      table.string('authorization_reference', 300).notNullable();
    });
  }
}

async function hashPassword(password: string, salt?: string): Promise<{ salt: string; hash: string }> {
  const realSalt = salt || randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      Buffer.from(realSalt, 'hex'),
      HASH_BYTES,
      options,
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
  return { salt: realSalt, hash: derived.toString('hex') };
}
function equalHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function makeRecovery(): { code: string; digest: string } {
  const raw = randomBytes(24).toString('hex').toUpperCase();
  return { code: groupRecoveryCode(raw), digest: createHash('sha256').update(raw).digest('hex') };
}
function assertNotBlocked(id: number): void {
  const entry = failedAttempts.get(id);
  if (entry && entry.blockedUntil > Date.now()) throw new Error('Too many unsuccessful attempts. Try again after the temporary lockout.');
}
function recordFailure(id: number): void {
  const old = failedAttempts.get(id) || { count: 0, blockedUntil: 0 };
  const count = old.count + 1;
  failedAttempts.set(id, { count, blockedUntil: count >= 10 ? Date.now() + 5 * 60_000 : count >= 5 ? Date.now() + 30_000 : 0 });
}
function clearFailure(id: number): void { failedAttempts.delete(id); }

/** Reauthenticate an already signed-in coordinator before a destructive restore. */
export async function verifyCoordinatorPassword(event: IpcMainInvokeEvent, db: Knex, password: string): Promise<void> {
  assertLoggedIn(event);
  assertNotBlocked(event.sender.id);
  if (typeof password !== 'string' || password.length > 128 || !password.length) throw new Error('Enter your coordinator password.');
  const current = await db<Coordinator>('coordinator_login').where({ id: 1 }).first();
  if (!current) throw new Error('Coordinator account is not configured.');
  const candidate = await hashPassword(password, current.password_salt);
  if (!equalHex(candidate.hash, current.password_hash)) {
    recordFailure(event.sender.id);
    throw new Error('Coordinator password is incorrect.');
  }
  clearFailure(event.sender.id);
}

export function registerCoordinatorAuthHandlers(db: Knex): void {
  const account = () => db<Coordinator>('coordinator_login').where({ id: 1 });
  ipcMain.handle('auth:status', async event => {
    assertAppWindow(event);
    const current = await account().first();
    // College branding is public on the local login screen; all editing remains locked.
    const branding = await db('institution_branding').where({ id: 1 }).first();
    return {
      configured: !!current, authenticated: !!current && sessions.has(event.sender.id),
      coordinatorName: current && sessions.has(event.sender.id) ? current.name : null,
      collegeName: branding?.college_name ? String(branding.college_name) : null,
      collegeLogo: branding?.college_logo_data ? String(branding.college_logo_data) : null
    };
  });
  ipcMain.handle('auth:setup', async (event, raw: unknown) => {
    assertAppWindow(event);
    const input = setupSchema.parse(raw);
    if (await account().first()) throw new Error('Coordinator account already exists. Use Sign In.');
    const { salt, hash } = await hashPassword(input.password);
    const recovery = makeRecovery();
    // Fixed primary key prevents a second account in case of a concurrent setup request.
    await db('coordinator_login').insert({
      id: 1, name: input.name, employee_code: input.employeeCode,
      username: normalizeIdentity(input.username), password_salt: salt, password_hash: hash,
      recovery_sha256: recovery.digest, created_at: new Date().toISOString()
    });
    sessions.add(event.sender.id);
    clearFailure(event.sender.id);
    return { coordinatorName: input.name, recoveryCode: recovery.code };
  });
  ipcMain.handle('auth:login', async (event, raw: unknown) => {
    assertAppWindow(event); assertNotBlocked(event.sender.id);
    const input = loginSchema.parse(raw);
    const current = await account().first();
    if (!current) throw new Error('Create the coordinator account before signing in.');
    const matchedIdentity = normalizeIdentity(input.username) === normalizeIdentity(current.username)
      || normalizeIdentity(input.username) === normalizeIdentity(current.employee_code);
    const guess = await hashPassword(input.password, current.password_salt);
    if (!matchedIdentity || !equalHex(guess.hash, current.password_hash)) {
      recordFailure(event.sender.id);
      throw new Error('Invalid coordinator ID or password.');
    }
    sessions.add(event.sender.id); clearFailure(event.sender.id);
    return { coordinatorName: current.name };
  });
  ipcMain.handle('auth:logout', event => {
    assertAppWindow(event);
    sessions.delete(event.sender.id);
    return { success: true };
  });

  // Authenticated recovery-key rotation; old key becomes invalid immediately.
  ipcMain.handle('auth:rotateRecovery', async (event, raw: unknown) => {
    assertLoggedIn(event); assertNotBlocked(event.sender.id);
    const input = rotateRecoverySchema.parse(raw);
    const current = await account().first();
    if (!current) throw new Error('Coordinator account is unavailable.');
    const guess = await hashPassword(input.currentPassword, current.password_salt);
    if (!equalHex(guess.hash, current.password_hash)) {
      recordFailure(event.sender.id);
      throw new Error('Current password is incorrect.');
    }
    clearFailure(event.sender.id);
    const replacement = makeRecovery();
    const updated = await db('coordinator_login').where({ id: 1, password_hash: current.password_hash })
      .update({ recovery_sha256: replacement.digest });
    if (updated !== 1) throw new Error('Account changed. Sign in again and retry.');
    return { recoveryCode: replacement.code };
  });

  // Coordinator-controlled account handover. No timetable or faculty rows are modified.
  ipcMain.handle('auth:transfer', async (event, raw: unknown) => {
    assertLoggedIn(event); assertNotBlocked(event.sender.id);
    const input = transferCoordinatorSchema.parse(raw);
    const current = await account().first();
    if (!current) throw new Error('Coordinator account is unavailable.');
    const guess = await hashPassword(input.currentPassword, current.password_salt);
    if (!equalHex(guess.hash, current.password_hash)) {
      recordFailure(event.sender.id);
      throw new Error('Current password is incorrect.');
    }
    clearFailure(event.sender.id);
    const { salt, hash } = await hashPassword(input.password);
    const replacement = makeRecovery();
    await db.transaction(async (trx) => {
      const changed = await trx('coordinator_login').where({ id: 1, password_hash: current.password_hash })
        .update({ name: input.name, employee_code: input.employeeCode,
          username: normalizeIdentity(input.username), password_salt: salt,
          password_hash: hash, recovery_sha256: replacement.digest });
      if (changed !== 1) throw new Error('Coordinator account changed. Handover cancelled.');
      await trx('coordinator_handover_audit').insert({
        id: randomBytes(16).toString('hex'),
        previous_name: current.name,
        previous_employee_code: current.employee_code,
        incoming_name: input.name,
        incoming_employee_code: input.employeeCode,
        changed_at: new Date().toISOString(),
        authorization_reference: input.authorizationReference,
      });
    });
    // Revoke all app sessions, including the outgoing coordinator's session.
    sessions.clear();
    return { recoveryCode: replacement.code };
  });
  ipcMain.handle('auth:recover', async (event, raw: unknown) => {
    assertAppWindow(event); assertNotBlocked(event.sender.id);
    const input = recoverySchema.parse(raw);
    const current = await account().first();
    const digest = createHash('sha256').update(normalizeRecoveryCode(input.recoveryCode)).digest('hex');
    if (!current || !equalHex(digest, current.recovery_sha256)) {
      recordFailure(event.sender.id);
      throw new Error('Invalid recovery code.');
    }
    const { salt, hash } = await hashPassword(input.newPassword);
    const replacement = makeRecovery();
    await account().update({ password_salt: salt, password_hash: hash, recovery_sha256: replacement.digest });
    sessions.clear(); clearFailure(event.sender.id);
    return { recoveryCode: replacement.code };
  });
}
