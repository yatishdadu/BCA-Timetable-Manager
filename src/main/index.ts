import { protectedHandle, ensureCoordinatorAuthTable, registerCoordinatorAuthHandlers, allowCoordinatorWindow } from './coordinatorAuth.ts';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import knexFactory, { type Knex } from 'knex';
import { z } from 'zod';
import { ensureCollegeBrandingSchema, registerCollegeBrandingHandlers } from './collegeBranding.ts';
import { ensureFacultyIdentitySchema, registerFacultyIdentityHandlers } from './facultyIdentity.ts';
import { ensureLabTables, registerLabHandlers } from './laboratories.ts';

import { registerMasterTimetableHandlers } from './masterTimetable.ts';
import { registerDataBackupHandlers } from './dataBackup.ts';
import { registerDataResetHandlers } from './dataReset.ts';
import { applyOrRecoverPendingRestore, finishSuccessfulRestore, rollbackFailedRestore, registerDataRestoreHandlers } from './dataRestore.ts';
import { ensurePublicationTables, registerPublicationHandlers } from './timetablePublication.ts';
import { ensureTheoryDraftTables, registerTheoryGeneratorHandlers } from './theoryGenerator.ts';
import { ensureSemesterScheduleSchema, registerSemesterScheduleHandlers } from './semesterSchedules.ts';
import { ensureManualEditSchema, registerManualTimetableHandlers } from './manualTimetable.ts';

// ESM entry location: source directory in development, dist/main after packaging.
// The production build preserves import.meta.url when bundling into index.mjs.
const sourceDir = path.dirname(fileURLToPath(import.meta.url));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());

let database: Knex | undefined;

const facultyInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  category: z.enum(['HOD', 'Regular', 'New', 'Guest']),
  workloadTarget: z.number().int().min(0).max(60),
});
const facultyId = z.string().uuid();

type FacultyRow = {
  id: string;
  name: string;
  category: 'HOD' | 'Regular' | 'New' | 'Guest';
  workload_target: number;
  active: number;
};

async function openDatabase(): Promise<Knex> {
  const filename = path.join(app.getPath('userData'), 'bca-timetable.db');
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  try {
    await db.raw('PRAGMA foreign_keys = ON');
    // First working module only. Replace with versioned migrations before release.
    if (!(await db.schema.hasTable('faculty'))) {
      await db.schema.createTable('faculty', (table) => {
        table.string('id', 36).primary();
        table.string('name', 120).notNullable();
        table.string('category', 20).notNullable();
        table.integer('workload_target').notNullable();
        table.boolean('active').notNullable().defaultTo(true);
      });
    }

    // Additive development schema. Do not remove the existing faculty table or its data.
    // Versioned migrations will replace these existence checks before production release.
    if (!(await db.schema.hasTable('academic_terms'))) {
      await db.schema.createTable('academic_terms', (table) => {
        table.string('id', 36).primary();
        table.string('academic_year', 9).notNullable();
        table.string('cycle', 10).notNullable();
        table.boolean('is_current').notNullable().defaultTo(false);
        table.unique(['academic_year', 'cycle']);
      });
    }
    if (!(await db.schema.hasTable('semester_offerings'))) {
      await db.schema.createTable('semester_offerings', (table) => {
        table.string('id', 36).primary();
        table.string('term_id', 36).notNullable().references('id').inTable('academic_terms').onDelete('RESTRICT');
        table.integer('semester_number').notNullable();
        table.boolean('active').notNullable().defaultTo(true);
        table.unique(['term_id', 'semester_number']);
      });
    }
    if (!(await db.schema.hasTable('academic_sections'))) {
      await db.schema.createTable('academic_sections', (table) => {
        table.string('id', 36).primary();
        table.string('offering_id', 36).notNullable().references('id').inTable('semester_offerings').onDelete('RESTRICT');
        table.string('code', 8).notNullable();
        table.boolean('active').notNullable().defaultTo(true);
        table.unique(['offering_id', 'code']);
      });
    }
    // Subject catalog and allocation tables are additive: faculty/term/section data is untouched.
    // DEVELOPMENT SCHEMA: replace hasTable checks with ordered migrations before release.
    if (!(await db.schema.hasTable('term_subjects'))) {
      await db.schema.createTable('term_subjects', (table) => {
        table.string('id', 36).primary();
        table.string('term_id', 36).notNullable().references('id').inTable('academic_terms').onDelete('RESTRICT');
        table.integer('semester_number').notNullable();
        table.string('code', 32).notNullable();
        table.string('name', 160).notNullable();
        table.string('kind', 20).notNullable();
        table.integer('weekly_hours').notNullable();
        table.integer('block_periods').notNullable().defaultTo(1);
        table.string('source_label', 100).notNullable().defaultTo('Manual');
        table.boolean('active').notNullable().defaultTo(true);
        table.unique(['term_id', 'semester_number', 'code']);
      });
    }
    if (!(await db.schema.hasTable('section_subject_allocations'))) {
      await db.schema.createTable('section_subject_allocations', (table) => {
        table.string('id', 36).primary();
        table.string('section_id', 36).notNullable().references('id').inTable('academic_sections').onDelete('RESTRICT');
        table.string('subject_id', 36).notNullable().references('id').inTable('term_subjects').onDelete('RESTRICT');
        table.string('faculty_id', 36).nullable().references('id').inTable('faculty').onDelete('RESTRICT');
        table.integer('weekly_hours').notNullable();
        table.boolean('active').notNullable().defaultTo(true);
        table.unique(['section_id', 'subject_id']);
      });
    }
    await ensureLabTables(db);
    await ensureSemesterScheduleSchema(db);
    console.log('[database] Ready:', filename);
    return db;
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

function registerFacultyHandlers(db: Knex): void {
  const query = () => db<FacultyRow>('faculty');

  protectedHandle('faculty:list', async () =>
    query().select('id', 'name', 'category', 'workload_target', 'active').orderBy('name')
  );

  protectedHandle('faculty:create', async (_event, raw: unknown) => {
    const data = facultyInput.parse(raw);
    const id = randomUUID();
    await query().insert({
      id,
      name: data.name,
      category: data.category,
      workload_target: data.workloadTarget,
      active: 1,
    });
    return query().where({ id }).first();
  });

  protectedHandle('faculty:update', async (_event, rawId: unknown, raw: unknown) => {
    const id = facultyId.parse(rawId);
    const data = facultyInput.parse(raw);
    const existing = await query().where({ id }).first();
    if (!existing) throw new Error('Faculty record not found');
    await query().where({ id }).update({
      name: data.name,
      category: data.category,
      workload_target: data.workloadTarget,
    });
    return query().where({ id }).first();
  });

  protectedHandle('faculty:deactivate', async (_event, rawId: unknown) => {
    const id = facultyId.parse(rawId);
    const changed = await query().where({ id }).update({ active: 0 });
    if (!changed) throw new Error('Faculty record not found');
    return { success: true };
  });
}


// Academic years and terms are separate from semester numbers. Each term can contain
// several active semesters; sections belong to an offering in that particular term.
type AcademicTermRow = { id: string; academic_year: string; cycle: 'Odd' | 'Even'; is_current: number };
type OfferingRow = { id: string; term_id: string; semester_number: number; active: number };
type SectionRow = { id: string; offering_id: string; code: string; active: number };

const academicUuid = z.string().uuid();
const academicTermInput = z.object({
  academicYear: z.string().trim().regex(/^\d{4}-(?:\d{2}|\d{4})$/, 'Use academic year like 2026-27'),
  cycle: z.enum(['Odd', 'Even']),
});
const semesterInput = z.object({
  termId: academicUuid,
  semesterNumber: z.number().int().min(1).max(6),
  active: z.boolean(),
});
const sectionCode = z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits or hyphens').transform((value) => value.toUpperCase());
const sectionInput = z.object({ offeringId: academicUuid, code: sectionCode });
const sectionUpdate = z.object({ id: academicUuid, code: sectionCode, active: z.boolean() });

function registerAcademicHandlers(db: Knex): void {
  const termQuery = () => db<AcademicTermRow>('academic_terms');
  const offeringQuery = () => db<OfferingRow>('semester_offerings');
  const sectionQuery = () => db<SectionRow>('academic_sections');

  protectedHandle('academic:listTerms', async () =>
    termQuery().select('id', 'academic_year', 'cycle', 'is_current')
      .orderBy('academic_year', 'desc').orderBy('cycle')
  );

  protectedHandle('academic:createTerm', async (_event, raw: unknown) => {
    const data = academicTermInput.parse(raw);
    const existing = await termQuery().where({ academic_year: data.academicYear, cycle: data.cycle }).first();
    if (existing) throw new Error('That academic year and term already exist');
    const anyCurrent = await termQuery().where({ is_current: 1 }).first();
    const id = randomUUID();
    await termQuery().insert({ id, academic_year: data.academicYear, cycle: data.cycle, is_current: anyCurrent ? 0 : 1 });
    return termQuery().where({ id }).first();
  });

  protectedHandle('academic:setCurrentTerm', async (_event, rawId: unknown) => {
    const id = academicUuid.parse(rawId);
    await db.transaction(async (trx) => {
      const exists = await trx('academic_terms').where({ id }).first();
      if (!exists) throw new Error('Academic term not found');
      await trx('academic_terms').update({ is_current: 0 });
      await trx('academic_terms').where({ id }).update({ is_current: 1 });
    });
    return { success: true };
  });

  protectedHandle('academic:listSemesters', async (_event, rawTermId: unknown) => {
    const termId = academicUuid.parse(rawTermId);
    return offeringQuery().where({ term_id: termId })
      .select('id', 'term_id', 'semester_number', 'active').orderBy('semester_number');
  });

  protectedHandle('academic:setSemester', async (_event, raw: unknown) => {
    const data = semesterInput.parse(raw);
    return db.transaction(async (trx) => {
      const term = await trx('academic_terms').where({ id: data.termId }).first();
      if (!term) throw new Error('Academic term not found');
      const current = await trx<OfferingRow>('semester_offerings')
        .where({ term_id: data.termId, semester_number: data.semesterNumber }).first();
      if (current) {
        await trx('semester_offerings').where({ id: current.id }).update({ active: data.active ? 1 : 0 });
        return trx('semester_offerings').where({ id: current.id }).first();
      }
      const id = randomUUID();
      await trx('semester_offerings').insert({
        id, term_id: data.termId, semester_number: data.semesterNumber, active: data.active ? 1 : 0,
      });
      return trx('semester_offerings').where({ id }).first();
    });
  });

  protectedHandle('academic:listSections', async (_event, rawOfferingId: unknown) => {
    const offeringId = academicUuid.parse(rawOfferingId);
    return sectionQuery().where({ offering_id: offeringId })
      .select('id', 'offering_id', 'code', 'active').orderBy('code');
  });

  protectedHandle('academic:createSection', async (_event, raw: unknown) => {
    const data = sectionInput.parse(raw);
    const offering = await offeringQuery().where({ id: data.offeringId }).first();
    if (!offering || Number(offering.active) !== 1) throw new Error('Activate the semester before adding sections');
    const duplicate = await sectionQuery().where({ offering_id: data.offeringId, code: data.code }).first();
    if (duplicate) throw new Error('This section code already exists for the selected semester and term');
    const id = randomUUID();
    await sectionQuery().insert({ id, offering_id: data.offeringId, code: data.code, active: 1 });
    return sectionQuery().where({ id }).first();
  });

  protectedHandle('academic:updateSection', async (_event, raw: unknown) => {
    const data = sectionUpdate.parse(raw);
    const existing = await sectionQuery().where({ id: data.id }).first();
    if (!existing) throw new Error('Section not found');
    const duplicate = await sectionQuery()
      .where({ offering_id: existing.offering_id, code: data.code }).whereNot({ id: data.id }).first();
    if (duplicate) throw new Error('This section code already exists for the selected semester and term');
    await sectionQuery().where({ id: data.id }).update({ code: data.code, active: data.active ? 1 : 0 });
    return sectionQuery().where({ id: data.id }).first();
  });
}

function createWindow(): void {
  // Development loads the compiled local preload; installed builds load it
  // next to the bundled Electron main process inside dist/main.
  const preloadPath = app.isPackaged
    ? path.join(sourceDir, 'preload.js')
    : path.resolve(sourceDir, '../../dist/main/preload.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  allowCoordinatorWindow(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const trustedUrl = app.isPackaged
      ? pathToFileURL(path.resolve(sourceDir, '../renderer/index.html')).href
      : 'http://localhost:5173/';
    if (url.split('#')[0] !== trustedUrl) event.preventDefault();
  });

  if (app.isPackaged) {
    void win.loadFile(path.resolve(sourceDir, '../renderer/index.html'));
  } else {
    void win.loadURL('http://localhost:5173/');
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  let restoredOnStartup = false;
  try {
    const restoreResult = await applyOrRecoverPendingRestore();
    restoredOnStartup = restoreResult === 'restored';
    if (restoreResult === 'rolled-back') console.warn('[restore] Interrupted restore rolled back to the previous data.');
    database = await openDatabase();
    await ensureCoordinatorAuthTable(database);
    registerCoordinatorAuthHandlers(database);
    await ensureFacultyIdentitySchema(database);
    registerFacultyIdentityHandlers(database);
    await ensureCollegeBrandingSchema(database);
    registerCollegeBrandingHandlers(database);
    registerFacultyHandlers(database);
    registerAcademicHandlers(database);
    registerSemesterScheduleHandlers(database);
    registerSubjectsHandlers(database);
    registerLabHandlers(database);
    await ensureTheoryDraftTables(database);
    registerTheoryGeneratorHandlers(database);
    await ensureManualEditSchema(database);
    registerManualTimetableHandlers(database);
    registerMasterTimetableHandlers(database);
    await ensurePublicationTables(database);
    registerPublicationHandlers(database);
    registerDataBackupHandlers(database);
    registerDataRestoreHandlers(database, async () => {
      if (database) { await database.destroy(); database = undefined; }
    });
    registerDataResetHandlers(database, async () => {
      if (database) { await database.destroy(); database = undefined; }
    });
    if (restoredOnStartup) {
      const recovery = await finishSuccessfulRestore();
      console.log('[restore] Restore completed and original data preserved at:', recovery);
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error('[startup] Database or Electron initialization failed:', message);
    if (restoredOnStartup) {
      try { await database?.destroy(); await rollbackFailedRestore(); console.error('[restore] Previous data recovered after initialization error.'); }
      catch (rollbackError) { console.error('[restore] Automatic rollback also failed:', rollbackError); }
    }
    dialog.showErrorBox('BCA Timetable Manager could not start', message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (database) void database.destroy();
});

// SUBJECTS & FACULTY ALLOCATIONS — BCA-only, term-scoped.
// NOTE: No timetable slots are generated here. A lab with odd weekly hours
// retains the syllabus figure and is flagged for manual resolution.
type SubjectKind = 'Theory' | 'Lab' | 'Language' | 'Project' | 'Internship' | 'Other';
type SubjectRow = {
  id: string; term_id: string; semester_number: number; code: string;
  name: string; kind: SubjectKind; weekly_hours: number;
  block_periods: number; source_label: string; active: number;
};
type AllocationRow = {
  id: string; section_id: string; subject_id: string;
  faculty_id: string | null; weekly_hours: number; active: number;
};

const subjectUuid = z.string().uuid();
const subjectKind = z.enum(['Theory', 'Lab', 'Language', 'Project', 'Internship', 'Other']);
const subjectInput = z.object({
  id: subjectUuid.optional(),
  termId: subjectUuid,
  semesterNumber: z.number().int().min(1).max(6),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9-]+$/).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  kind: subjectKind,
  weeklyHours: z.number().int().min(1).max(40),
});
const referenceInput = z.object({ termId: subjectUuid, semesterNumber: z.number().int().min(1).max(6) });
const assignmentInput = z.object({
  id: subjectUuid.optional(), sectionId: subjectUuid, subjectId: subjectUuid,
  facultyId: subjectUuid.nullable(), weeklyHours: z.number().int().min(1).max(40),
});
const statusInput = z.object({ id: subjectUuid, active: z.boolean() });

// From the BCU BCA (General) course-structure tables in the supplied syllabuses.
// I–II: SEP 2024-25; III–IV: SEP 2025-26; V–VI: SEP 2026-27.
// VI internship: overview indicates 3* hours, later detail indicates 2;
// 3 is a REFERENCE ONLY and must be checked by the timetable coordinator.
type RefItem = [number, string, string, SubjectKind, number];
const referenceSubjects: RefItem[] = [
  [1, '24BCA11', 'Discrete Structure', 'Theory', 3],
  [1, '24BCA12', 'Problem Solving Technique', 'Theory', 3],
  [1, '24BCA13', 'Computer Architecture', 'Theory', 3],
  [1, '24BCA11P', 'Problem Solving Technique Lab', 'Lab', 4],
  [1, '24BCA12P', 'Computer Architecture Lab', 'Lab', 4],
  [1, '24BCA13P', 'Office Automation Tools', 'Lab', 4],
  [1, '24BCAL11', 'Language 1 (configure actual language)', 'Language', 4],
  [1, '24BCAL12', 'Language 2 (configure actual language)', 'Language', 4],
  [1, '24BCACV1', 'Constitutional Values I', 'Theory', 2],
  [2, '24BCA21', 'Data Structures', 'Theory', 3],
  [2, '24BCA22', 'Object Oriented Programming Using Java', 'Theory', 3],
  [2, '24BCA23', 'Operating System', 'Theory', 3],
  [2, '24BCA21P', 'Data Structures Lab', 'Lab', 4],
  [2, '24BCA22P', 'Java Programming Lab', 'Lab', 4],
  [2, '24BCA23P', 'Unix and Shell Programming Lab', 'Lab', 4],
  [2, '24BCAL21', 'Language 1 (configure actual language)', 'Language', 4],
  [2, '24BCAL22', 'Language 2 (configure actual language)', 'Language', 4],
  [2, '24BCACV2', 'Constitutional Values II', 'Theory', 2],
  [2, '24BCAES', 'Environmental Studies', 'Theory', 2],
  [3, '24BCA31', 'Database Management System', 'Theory', 4],
  [3, '24BCA32', 'Python Programming', 'Theory', 4],
  [3, '24BCA33', 'Computer Networks', 'Theory', 4],
  [3, '24BCA34', 'Cyber Security', 'Theory', 2],
  [3, '24BCA31P', 'Database Management System Lab', 'Lab', 3],
  [3, '24BCA32P', 'Python Programming Lab', 'Lab', 3],
  [3, '24BCA33P', 'Computer Networks Lab', 'Lab', 3],
  [3, '24BCAL31', 'Language 1 (configure actual language)', 'Language', 4],
  [3, '24BCAL32', 'Language 2 (configure actual language)', 'Language', 4],
  [4, '24BCA41', 'Artificial Intelligence', 'Theory', 4],
  [4, '24BCA42', 'Design and Analysis of Algorithms', 'Theory', 4],
  [4, '24BCA43', 'Internet Technologies', 'Theory', 4],
  [4, '24BCA44', 'Ethical Hacking', 'Theory', 2],
  [4, '24BCA41P', 'Artificial Intelligence Lab', 'Lab', 3],
  [4, '24BCA42P', 'Design and Analysis of Algorithms Lab', 'Lab', 3],
  [4, '24BCA43P', 'Internet Technologies Lab', 'Lab', 3],
  [4, '24BCASE1', 'Probability and Statistics', 'Theory', 2],
  [4, '24BCAL41', 'Language 1 (configure actual language)', 'Language', 4],
  [4, '24BCAL42', 'Language 2 (configure actual language)', 'Language', 4],
  [5, '24BCA51', 'Web Programming', 'Theory', 4],
  [5, '24BCA52', 'Data Analytics', 'Theory', 4],
  [5, '24BCA53', 'Software Engineering', 'Theory', 4],
  [5, '24BCA54', 'Cryptography and Network Security', 'Theory', 4],
  [5, '24BCA51P', 'Web Programming Lab', 'Lab', 3],
  [5, '24BCA52P', 'Data Analytics Lab', 'Lab', 3],
  [5, '24BCASE2', 'Quantitative Techniques', 'Theory', 2],
  [5, '24BCAPJ', 'Project', 'Project', 8],
  [6, '24BCA61', 'Machine Learning', 'Theory', 4],
  [6, '24BCA62', 'Cloud Computing', 'Theory', 4],
  [6, '24BCA63', 'Data Mining', 'Theory', 4],
  [6, '24BCA64', 'Theory of Computation', 'Theory', 4],
  [6, '24BCA61P', 'Machine Learning Lab', 'Lab', 3],
  [6, '24BCAIS', 'Internship supervision (verify 2 vs 3 hours)', 'Internship', 3],
];
const referenceSource = (semester: number) => semester <= 2 ? 'BCU SEP 2024-25' : semester <= 4 ? 'BCU SEP 2025-26' : 'BCU SEP 2026-27';

function registerSubjectsHandlers(db: Knex): void {
  const catalog = () => db<SubjectRow>('term_subjects');
  const allocations = () => db<AllocationRow>('section_subject_allocations');

  const assertTerm = async (id: string) => {
    if (!(await db('academic_terms').where({ id }).first())) throw new Error('Academic term not found');
  };

  protectedHandle('subjects:list', async (_event, raw: unknown) => {
    const { termId, semesterNumber } = referenceInput.parse(raw);
    return catalog().where({ term_id: termId, semester_number: semesterNumber }).orderBy('code');
  });

  protectedHandle('subjects:save', async (_event, raw: unknown) => {
    const data = subjectInput.parse(raw);
    await assertTerm(data.termId);
    const blockPeriods = data.kind === 'Lab' ? 2 : 1;
    const fields = {
      term_id: data.termId, semester_number: data.semesterNumber,
      code: data.code, name: data.name, kind: data.kind,
      weekly_hours: data.weeklyHours, block_periods: blockPeriods,
    };
    return db.transaction(async (trx) => {
      const matching = await trx('term_subjects').where({ term_id: data.termId, semester_number: data.semesterNumber, code: data.code }).first();
      if (matching && matching.id !== data.id) throw new Error('This subject code already exists in the selected semester and term');
      if (data.id) {
        const existing = await trx('term_subjects').where({ id: data.id }).first();
        if (!existing) throw new Error('Subject not found');
        if (existing.term_id !== data.termId || existing.semester_number !== data.semesterNumber) {
          throw new Error('Moving a subject to another term or semester is not allowed; create a separate record');
        }
        await trx('term_subjects').where({ id: data.id }).update(fields);
        return trx('term_subjects').where({ id: data.id }).first();
      }
      const id = randomUUID();
      await trx('term_subjects').insert({ id, ...fields, source_label: 'Manual', active: 1 });
      return trx('term_subjects').where({ id }).first();
    });
  });

  protectedHandle('subjects:setActive', async (_event, raw: unknown) => {
    const { id, active } = statusInput.parse(raw);
    const subject = await catalog().where({ id }).first();
    if (!subject) throw new Error('Subject not found');
    if (!active && (await allocations().where({ subject_id: id, active: 1 }).first())) {
      throw new Error('Deactivate the subject’s section allocations first');
    }
    await catalog().where({ id }).update({ active: active ? 1 : 0 });
    return { success: true };
  });

  protectedHandle('subjects:importReference', async (_event, raw: unknown) => {
    const { termId, semesterNumber } = referenceInput.parse(raw);
    await assertTerm(termId);
    const source = referenceSubjects.filter((item) => item[0] === semesterNumber);
    return db.transaction(async (trx) => {
      let inserted = 0;
      let skipped = 0;
      for (const [, code, name, kind, weeklyHours] of source) {
        const exists = await trx('term_subjects').where({ term_id: termId, semester_number: semesterNumber, code }).first();
        if (exists) { skipped++; continue; }
        await trx('term_subjects').insert({
          id: randomUUID(), term_id: termId, semester_number: semesterNumber,
          code, name, kind, weekly_hours: weeklyHours, block_periods: kind === 'Lab' ? 2 : 1,
          source_label: referenceSource(semesterNumber), active: 1,
        });
        inserted++;
      }
      return {
        inserted, skipped, warnings: [
          ...(source.some((s) => s[3] === 'Lab' && s[4] % 2 !== 0) ? ['Some lab subjects have odd weekly hours: check how to fit 2-period blocks.'] : []),
          ...(semesterNumber === 6 ? ['Semester VI internship hours are inconsistent between the syllabus overview and detail; verify before allocation.'] : []),
        ]
      };
    });
  });

  protectedHandle('allocations:list', async (_event, rawTermId: unknown) => {
    const termId = subjectUuid.parse(rawTermId);
    return db('section_subject_allocations as a')
      .join('academic_sections as sec', 'sec.id', 'a.section_id')
      .join('semester_offerings as so', 'so.id', 'sec.offering_id')
      .join('term_subjects as s', 's.id', 'a.subject_id')
      .leftJoin('faculty as f', 'f.id', 'a.faculty_id')
      .where('so.term_id', termId)
      .select('a.id', 'a.section_id', 'a.subject_id', 'a.faculty_id', 'a.weekly_hours', 'a.active',
        's.code as subject_code', 's.name as subject_name', 's.kind as kind',
        's.block_periods as block_periods', 's.active as subject_active',
        'sec.code as section_code', 'sec.active as section_active',
        'so.semester_number as semester_number', 'so.active as semester_active',
        'f.name as faculty_name', 'f.active as faculty_active')
      .orderBy('so.semester_number').orderBy('sec.code').orderBy('s.code');
  });

  protectedHandle('allocations:save', async (_event, raw: unknown) => {
    const data = assignmentInput.parse(raw);
    return db.transaction(async (trx) => {
      const section = await trx('academic_sections as sec')
        .join('semester_offerings as so', 'so.id', 'sec.offering_id')
        .where('sec.id', data.sectionId)
        .select('so.term_id', 'so.semester_number', 'so.active as semester_active', 'sec.active as section_active').first();
      if (!section) throw new Error('Section not found');
      if (Number(section.section_active) !== 1 || Number(section.semester_active) !== 1) throw new Error('Activate the semester and section first');
      const subject = await trx('term_subjects').where({ id: data.subjectId }).first();
      if (!subject || Number(subject.active) !== 1) throw new Error('Active subject not found');
      if (subject.term_id !== section.term_id || subject.semester_number !== section.semester_number) {
        throw new Error('Subject and section must belong to the same term and semester');
      }
      if (data.facultyId) {
        const faculty = await trx('faculty').where({ id: data.facultyId }).first();
        if (!faculty || Number(faculty.active) !== 1) throw new Error('Choose an active faculty member or leave unassigned');
      }
      const duplicate = await trx('section_subject_allocations').where({ section_id: data.sectionId, subject_id: data.subjectId }).first();
      if (duplicate && duplicate.id !== data.id) throw new Error('This subject is already allocated to that section');
      if (data.id) {
        const existing = await trx('section_subject_allocations').where({ id: data.id }).first();
        if (!existing) throw new Error('Allocation not found');
        if (existing.section_id !== data.sectionId || existing.subject_id !== data.subjectId) {
          throw new Error('Editing cannot move allocations; deactivate and create a new allocation');
        }
        await trx('section_subject_allocations').where({ id: data.id }).update({ faculty_id: data.facultyId, weekly_hours: data.weeklyHours, active: 1 });
        return trx('section_subject_allocations').where({ id: data.id }).first();
      }
      const id = randomUUID();
      await trx('section_subject_allocations').insert({
        id, section_id: data.sectionId, subject_id: data.subjectId,
        faculty_id: data.facultyId, weekly_hours: data.weeklyHours, active: 1,
      });
      return trx('section_subject_allocations').where({ id }).first();
    });
  });

  protectedHandle('allocations:setActive', async (_event, raw: unknown) => {
    const { id, active } = statusInput.parse(raw);
    const row = await allocations().where({ id }).first();
    if (!row) throw new Error('Allocation not found');
    if (active) {
      const subject = await catalog().where({ id: row.subject_id }).first();
      const section = await db('academic_sections as sec').join('semester_offerings as so', 'so.id', 'sec.offering_id')
        .where('sec.id', row.section_id).select('sec.active as sec_active', 'so.active as sem_active').first();
      if (!subject || Number(subject.active) !== 1 || !section || Number(section.sec_active) !== 1 || Number(section.sem_active) !== 1) {
        throw new Error('Activate the subject, semester, and section before restoring the allocation');
      }
      if (row.faculty_id) {
        const faculty = await db('faculty').where({ id: row.faculty_id }).first();
        if (!faculty || Number(faculty.active) !== 1) throw new Error('Assigned faculty is inactive; edit the allocation instead');
      }
    }
    await allocations().where({ id }).update({ active: active ? 1 : 0 });
    return { success: true };
  });

  protectedHandle('workload:summary', async (_event, rawTermId: unknown) => {
    const termId = subjectUuid.parse(rawTermId);
    const faculty = await db('faculty').select('id', 'name', 'category', 'workload_target', 'active').orderBy('name');
    // Only live allocations within active sections/semesters/subjects contribute.
    const planned = await db('section_subject_allocations as a')
      .join('academic_sections as sec', 'sec.id', 'a.section_id')
      .join('semester_offerings as so', 'so.id', 'sec.offering_id')
      .join('term_subjects as s', 's.id', 'a.subject_id')
      .where('so.term_id', termId)
      .where('a.active', 1).where('sec.active', 1).where('so.active', 1).where('s.active', 1)
      .select('a.faculty_id', 'a.weekly_hours');
    const totals = new Map<string, number>();
    let unassignedHours = 0;
    for (const item of planned) {
      const hrs = Number(item.weekly_hours);
      if (item.faculty_id) totals.set(item.faculty_id, (totals.get(item.faculty_id) || 0) + hrs);
      else unassignedHours += hrs;
    }
    return {
      faculty: faculty.map((f) => ({
        ...f, allocated_hours: totals.get(f.id) || 0,
        remaining_hours: Number(f.workload_target) - (totals.get(f.id) || 0),
      })),
      unassignedHours,
      totalPlannedHours: planned.reduce((sum, row) => sum + Number(row.weekly_hours), 0),
    };
  });
}
