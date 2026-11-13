import { protectedHandle } from './coordinatorAuth.ts';
/** Additive faculty identity and guarded deletion module.
 * Existing UUIDs remain the internal foreign keys; employee_code is a human ID.
 * No existing faculty record is deleted or re-keyed during migration.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { canPermanentlyDelete, normalizeFacultyCode } from './facultyIdentityRules.ts';

const uuid = z.string().uuid();
const recordInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(['HOD', 'Regular', 'New', 'Guest']),
  workloadTarget: z.number().int().min(0).max(60),
  employeeCode: z.string().trim().min(2).max(32),
});
const activeInput = z.object({ id: uuid, active: z.boolean() });

type FacultyRow = {
  id: string;
  name: string;
  category: 'HOD' | 'Regular' | 'New' | 'Guest';
  employee_code: string | null;
  workload_target: number;
  active: number;
};

export async function ensureFacultyIdentitySchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('faculty'))) throw new Error('Faculty table missing');
  if (!(await db.schema.hasColumn('faculty', 'employee_code'))) {
    // Nullable for pre-existing records. Coordinator must fill IDs when editing.
    await db.schema.alterTable('faculty', table => {
      table.string('employee_code', 32).nullable();
    });
  }
  // Unique even when different case is used; old records can remain NULL.
  await db.raw('CREATE UNIQUE INDEX IF NOT EXISTS faculty_employee_code_unique ON faculty (employee_code COLLATE NOCASE) WHERE employee_code IS NOT NULL');
}

/** All rows count as references, including paused historical allocations and activities. */
async function referencesFor(db: Knex, id: string): Promise<string[]> {
  const refs: string[] = [];
  const tables = [
    ['section_subject_allocations', 'Subject allocation'],
    ['lab_bookings', 'Laboratory booking'],
    ['schedule_activities', 'Club, sports or certification activity'],
  ] as const;
  for (const [table, label] of tables) {
    if (!(await db.schema.hasTable(table))) continue;
    const row = await db(table).where({ faculty_id: id }).count({ total: '*' }).first();
    if (Number(row?.total || 0) > 0) refs.push(label);
  }
  // Drafts store serialized faculty IDs, not formal foreign keys; protect them too.
  if (await db.schema.hasTable('theory_draft_runs')) {
    const row = await db('theory_draft_runs').where('plan_json', 'like', `%${id}%`).count({ total: '*' }).first();
    if (Number(row?.total || 0) > 0) refs.push('Saved timetable draft');
  }
  return refs;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerFacultyIdentityHandlers(db: Knex): void {
  protectedHandle('facultyIdentity:list', async () => {
    const rows = await db<FacultyRow>('faculty')
      .select('id', 'name', 'employee_code', 'category', 'workload_target', 'active')
      .orderBy('name').orderBy('id');
    return Promise.all(rows.map(async row => {
      const usedIn = await referencesFor(db, row.id);
      return { ...row, usedIn, canDelete: canPermanentlyDelete(Number(row.active) === 1, usedIn) };
    }));
  });

  protectedHandle('facultyIdentity:create', async (_event, raw: unknown) => {
    const data = recordInput.parse(raw);
    const code = normalizeFacultyCode(data.employeeCode);
    const id = randomUUID();
    try {
      await db('faculty').insert({
        id, name: data.name, employee_code: code, category: data.category,
        workload_target: data.workloadTarget, active: 1,
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(message(error))) throw new Error('This faculty ID is already assigned to another record');
      throw error;
    }
    return db('faculty').where({ id }).first();
  });

  protectedHandle('facultyIdentity:update', async (_event, rawId: unknown, raw: unknown) => {
    const id = uuid.parse(rawId);
    const data = recordInput.parse(raw);
    const code = normalizeFacultyCode(data.employeeCode);
    const current = await db('faculty').where({ id }).first();
    if (!current) throw new Error('Faculty record not found');
    try {
      await db('faculty').where({ id }).update({
        name: data.name, employee_code: code, category: data.category,
        workload_target: data.workloadTarget,
      });
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(message(error))) throw new Error('This faculty ID is already assigned to another record');
      throw error;
    }
    return db('faculty').where({ id }).first();
  });

  protectedHandle('facultyIdentity:setActive', async (_event, raw: unknown) => {
    const data = activeInput.parse(raw);
    const record = await db<FacultyRow>('faculty').where({ id: data.id }).first();
    if (!record) throw new Error('Faculty record not found');
    if (data.active && !record.employee_code) throw new Error('Edit this faculty and assign a unique ID before reactivating');
    await db('faculty').where({ id: data.id }).update({ active: data.active ? 1 : 0 });
    return { success: true };
  });

  protectedHandle('facultyIdentity:delete', async (_event, rawId: unknown) => {
    const id = uuid.parse(rawId);
    return db.transaction(async trx => {
      const record = await trx<FacultyRow>('faculty').where({ id }).first();
      if (!record) throw new Error('Faculty record not found');
      const usedIn = await referencesFor(trx, id);
      if (!canPermanentlyDelete(Number(record.active) === 1, usedIn)) {
        const reason = Number(record.active) === 1
          ? 'Deactivate this faculty before deletion.'
          : `Deletion blocked: linked to ${usedIn.join(', ')}. Keep this record inactive to preserve history.`;
        throw new Error(reason);
      }
      // SQLite foreign-key restrictions remain an additional last-resort guard.
      try {
        await trx('faculty').where({ id }).del();
      } catch (error) {
        if (/FOREIGN KEY constraint failed/i.test(message(error))) {
          throw new Error('Deletion blocked by another historical record. Keep faculty inactive instead.');
        }
        throw error;
      }
      return { success: true };
    });
  });
}
