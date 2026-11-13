import { protectedHandle } from './coordinatorAuth.ts';
/** BCA-only shared laboratory register and term-scoped lab bookings.
 * Development schema: additive, never destructive to existing faculty/academic/subject tables.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { resourceConflict, validateSlot, weekdayOfISODate, type BookingSlot, type SlotConfig } from './labRules.ts';
import { checkClock, confirmedReferenceClock, effectiveSaturdayPeriods, requireTwoHours, type CollegeClock } from './clockRules.ts';
import { ensureActivityTables, registerActivityHandlers, assertLabHasNoActivityClash, assertActivitySpansValidForClock, assertActivitiesFitSaturday } from './activities.ts';
import { assertSectionsWithinSchedule } from './semesterSchedules.ts';

const uuid = z.string().uuid();
const code = z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9-]+$/).transform(s => s.toUpperCase());
const labInput = z.object({
  id: uuid.optional(), code, name: z.string().trim().min(2).max(100),
  notes: z.string().trim().max(240),
});
const settingInput = z.object({
  days: z.union([z.literal(5), z.literal(6)]),
  periodsPerDay: z.number().int().min(2).max(10),
  saturdayPeriods: z.number().int().min(0).max(10),
  breakAfter: z.number().int().min(0).max(9),
});
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingInput = z.object({
  id: uuid.optional(),
  termId: uuid, labId: uuid,
  bookingType: z.enum(['BCA', 'External', 'Maintenance']),
  mode: z.enum(['Weekly', 'Dated']),
  weekday: z.number().int().min(0).max(5),
  bookingDate: dateString.nullable(),
  startPeriod: z.number().int().min(1).max(10),
  allocationId: uuid.nullable(),
  ownerLabel: z.string().trim().max(100),
  notes: z.string().trim().max(240),
});

const clockInput = z.object({
  periods: z.array(z.object({ number: z.number().int(), start: z.string(), end: z.string() })).length(6),
  lunchStart: z.string(), lunchEnd: z.string(), confirmed: z.boolean(),
});
const saturdayPeriodsInput = z.union([z.literal(0), z.literal(3), z.literal(6)]);
const saturdayPolicyInput = z.object({ termId: uuid, campusPeriods: saturdayPeriodsInput });
const semesterPolicyInput = z.object({
  termId: uuid, offeringId: uuid,
  periods: saturdayPeriodsInput.nullable(), // null inherits the campus policy
});

export async function ensureLabTables(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('shared_laboratories'))) {
    await db.schema.createTable('shared_laboratories', t => {
      t.string('id', 36).primary();
      t.string('code', 16).notNullable().unique();
      t.string('name', 100).notNullable();
      t.string('notes', 240).notNullable().defaultTo('');
      t.boolean('active').notNullable().defaultTo(true);
    });
  }
  if (!(await db.schema.hasTable('lab_schedule_config'))) {
    await db.schema.createTable('lab_schedule_config', t => {
      t.integer('id').primary();
      t.integer('days').notNullable();
      t.integer('periods_per_day').notNullable();
      t.integer('saturday_periods').notNullable();
      t.integer('break_after').notNullable();
    });
  }
  if (!(await db('lab_schedule_config').where({ id: 1 }).first())) {
    // These are PROVISIONAL based on the original prototype, NOT confirmed college timings.
    await db('lab_schedule_config').insert({ id: 1, days: 6, periods_per_day: 6, saturday_periods: 3, break_after: 3 });
  }
  if (!(await db.schema.hasTable('lab_clock_times'))) {
    await db.schema.createTable('lab_clock_times', t => {
      t.integer('id').primary();
      t.text('data_json').notNullable();
    });
  }
  if (!(await db('lab_clock_times').where({ id: 1 }).first())) {
    await db('lab_clock_times').insert({ id: 1, data_json: JSON.stringify(confirmedReferenceClock) });
  }
  if (!(await db.schema.hasTable('lab_term_saturday'))) {
    await db.schema.createTable('lab_term_saturday', t => {
      t.string('term_id', 36).primary().references('id').inTable('academic_terms').onDelete('RESTRICT');
      t.integer('campus_periods').notNullable();
      t.boolean('confirmed').notNullable().defaultTo(false);
    });
  }
  if (!(await db.schema.hasTable('lab_semester_saturday'))) {
    await db.schema.createTable('lab_semester_saturday', t => {
      t.string('offering_id', 36).primary().references('id').inTable('semester_offerings').onDelete('RESTRICT');
      t.integer('periods').notNullable();
    });
  }
  if (!(await db.schema.hasTable('lab_bookings'))) {
    await db.schema.createTable('lab_bookings', t => {
      t.string('id', 36).primary();
      t.string('term_id', 36).notNullable().references('id').inTable('academic_terms').onDelete('RESTRICT');
      t.string('lab_id', 36).notNullable().references('id').inTable('shared_laboratories').onDelete('RESTRICT');
      t.string('booking_type', 16).notNullable();
      t.string('mode', 8).notNullable();
      t.integer('weekday').notNullable();
      t.string('booking_date', 10).nullable();
      t.integer('start_period').notNullable();
      t.integer('period_count').notNullable().defaultTo(2);
      t.string('allocation_id', 36).nullable().references('id').inTable('section_subject_allocations').onDelete('RESTRICT');
      t.string('section_id', 36).nullable().references('id').inTable('academic_sections').onDelete('RESTRICT');
      t.string('faculty_id', 36).nullable().references('id').inTable('faculty').onDelete('RESTRICT');
      t.string('owner_label', 100).notNullable().defaultTo('');
      t.string('notes', 240).notNullable().defaultTo('');
      t.boolean('active').notNullable().defaultTo(true);
    });
    await db.schema.alterTable('lab_bookings', t => {
      t.index(['term_id', 'weekday', 'start_period']);
      t.index(['lab_id', 'active']);
    });
  }
  await ensureActivityTables(db);
}

// Register additive activity tables only after the existing laboratory tables are ready.
// Called from the existing Electron startup; no change to main/index.ts required.
const numeric = (n: unknown) => Number(n);
async function getConfig(db: Knex): Promise<SlotConfig> {
  const row = await db('lab_schedule_config').where({ id: 1 }).first();
  if (!row) throw new Error('Missing laboratory schedule configuration');
  return {
    days: numeric(row.days) as 5 | 6,
    periodsPerDay: numeric(row.periods_per_day),
    saturdayPeriods: numeric(row.saturday_periods),
    breakAfter: numeric(row.break_after),
  };
}

async function getClock(db: Knex): Promise<CollegeClock> {
  const row = await db('lab_clock_times').where({ id: 1 }).first();
  if (!row) throw new Error('Missing college period clock');
  const clock = clockInput.parse(JSON.parse(String(row.data_json))) as CollegeClock;
  checkClock(clock);
  return clock;
}

type SaturdaySchedule = {
  campusPeriods: 0 | 3 | 6;
  confirmed: boolean;
  offerings: { offeringId: string; semesterNumber: number; active: boolean; override: 0 | 3 | 6 | null; effective: number }[];
};
async function getSaturdaySchedule(db: Knex, termId: string): Promise<SaturdaySchedule> {
  if (!(await db('academic_terms').where({ id: termId }).first())) throw new Error('Academic term not found');
  const row = await db('lab_term_saturday').where({ term_id: termId }).first();
  // Legacy prototype setting is a visible suggestion, NOT confirmed college policy.
  const legacy = await getConfig(db);
  const campusPeriods = (row ? Number(row.campus_periods) : legacy.saturdayPeriods) as 0 | 3 | 6;
  if (![0, 3, 6].includes(campusPeriods)) throw new Error('Select an approved Saturday campus schedule');
  const offerings = await db('semester_offerings as so')
    .leftJoin('lab_semester_saturday as ss', 'ss.offering_id', 'so.id')
    .where('so.term_id', termId)
    .select('so.id as offering_id', 'so.semester_number', 'so.active', 'ss.periods')
    .orderBy('so.semester_number');
  return {
    campusPeriods, confirmed: row ? Number(row.confirmed) === 1 : false,
    offerings: offerings.map(o => {
      const override = o.periods === null || o.periods === undefined ? null : Number(o.periods) as 0 | 3 | 6;
      return { offeringId: String(o.offering_id), semesterNumber: Number(o.semester_number),
        active: Number(o.active) === 1, override, effective: effectiveSaturdayPeriods(campusPeriods, override) };
    }),
  };
}

// Check existing Saturdays when the college or semester policy is changed.
async function activeSaturdayBookings(db: Knex, termId: string) {
  return db('lab_bookings as b')
    .leftJoin('academic_sections as sec', 'sec.id', 'b.section_id')
    .where('b.term_id', termId).where('b.active', 1).where('b.weekday', 5)
    .select('b.id', 'b.start_period', 'b.booking_type', 'sec.offering_id');
}

type ActiveBooking = BookingSlot & { id: string; allocation_id: string | null; active: number | boolean };
function asSlot(row: Record<string, unknown>): ActiveBooking {
  return {
    id: String(row.id), term_id: String(row.term_id),
    lab_id: String(row.lab_id), mode: row.mode as 'Weekly' | 'Dated',
    weekday: Number(row.weekday), booking_date: row.booking_date ? String(row.booking_date) : null,
    start_period: Number(row.start_period),
    section_id: row.section_id ? String(row.section_id) : null,
    faculty_id: row.faculty_id ? String(row.faculty_id) : null,
    allocation_id: row.allocation_id ? String(row.allocation_id) : null,
    active: Number(row.active),
  };
}

export function registerLabHandlers(db: Knex): void {
  registerActivityHandlers(db);
  protectedHandle('labs:getClock', async () => getClock(db));
  protectedHandle('labs:saveClock', async (_event, raw: unknown) => {
    const clock = clockInput.parse(raw) as CollegeClock;
    checkClock(clock);
    return db.transaction(async trx => {
      const baseline = await getConfig(trx);
      // The college clock is six periods with lunch after P3; preserve the legacy
      // Saturday limit here only as a fallback for terms not yet confirmed.
      // The clock update must not reinterpret an existing Saturday reservation
      // using an obsolete global Saturday limit; the term policy governs that.
      const current = { ...baseline, days: 6 as const, periodsPerDay: 6, saturdayPeriods: 6, breakAfter: 3 };
      const active = await trx('lab_bookings').where({ active: 1 }).select();
      for (const b of active) {
        try {
          validateSlot(current, asSlot(b));
          requireTwoHours(clock, Number(b.start_period));
        } catch (err) {
          throw new Error(`Cannot update times: existing booking ${b.id} would be invalid. ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await assertActivitySpansValidForClock(trx, clock);
      await trx('lab_schedule_config').where({ id: 1 }).update({ days: 6, periods_per_day: 6, break_after: 3 });
      await trx('lab_clock_times').where({ id: 1 }).update({ data_json: JSON.stringify({ ...clock, confirmed: true }) });
      return getClock(trx);
    });
  });
  protectedHandle('labs:getSaturdayPolicy', async (_event, rawTermId: unknown) =>
    getSaturdaySchedule(db, uuid.parse(rawTermId)));
  protectedHandle('labs:saveSaturdayPolicy', async (_event, raw: unknown) => {
    const { termId, campusPeriods } = saturdayPolicyInput.parse(raw);
    return db.transaction(async trx => {
      const existing = await getSaturdaySchedule(trx, termId);
      if (existing.offerings.some(o => o.override !== null && o.override > campusPeriods)) {
        throw new Error('Change semester overrides that exceed the new campus Saturday hours first');
      }
      await assertActivitiesFitSaturday(trx, termId, campusPeriods);
      for (const booking of await activeSaturdayBookings(trx, termId)) {
        if (Number(booking.start_period) + 1 > campusPeriods) {
          throw new Error(`Cannot shorten Saturday: booking ${booking.id} is still active`);
        }
      }
      if (await trx('lab_term_saturday').where({ term_id: termId }).first()) {
        await trx('lab_term_saturday').where({ term_id: termId }).update({ campus_periods: campusPeriods, confirmed: 1 });
      } else {
        await trx('lab_term_saturday').insert({ term_id: termId, campus_periods: campusPeriods, confirmed: 1 });
      }
      return getSaturdaySchedule(trx, termId);
    });
  });
  protectedHandle('labs:saveSemesterSaturday', async (_event, raw: unknown) => {
    const { termId, offeringId, periods } = semesterPolicyInput.parse(raw);
    return db.transaction(async trx => {
      const policy = await getSaturdaySchedule(trx, termId);
      if (!policy.confirmed) throw new Error('Confirm the campus Saturday policy first');
      const offering = policy.offerings.find(o => o.offeringId === offeringId);
      if (!offering) throw new Error('Semester does not belong to this academic term');
      const effective = effectiveSaturdayPeriods(policy.campusPeriods, periods);
      for (const booking of await activeSaturdayBookings(trx, termId)) {
        if (booking.offering_id !== offeringId || booking.booking_type !== 'BCA') continue;
        if (Number(booking.start_period) + 1 > effective) {
          throw new Error(`Cannot shorten the semester's Saturday: booking ${booking.id} is still active`);
        }
      }
      await assertActivitiesFitSaturday(trx, termId, policy.campusPeriods, offeringId, effective);
      await trx('lab_semester_saturday').where({ offering_id: offeringId }).delete();
      if (periods !== null) await trx('lab_semester_saturday').insert({ offering_id: offeringId, periods });
      return getSaturdaySchedule(trx, termId);
    });
  });

  protectedHandle('labs:list', async () =>
    db('shared_laboratories').select().orderBy('code')
  );
  protectedHandle('labs:seedThree', async () => db.transaction(async trx => {
    if (await trx('shared_laboratories').first()) {
      throw new Error('Laboratories already exist. Edit them instead of creating duplicates.');
    }
    for (let n = 1; n <= 3; n++) {
      await trx('shared_laboratories').insert({ id: randomUUID(), code: `LAB${n}`, name: `Laboratory ${n}`, notes: 'Rename to actual college laboratory name', active: 1 });
    }
    return { added: 3 };
  }));
  protectedHandle('labs:save', async (_event, raw: unknown) => {
    const data = labInput.parse(raw);
    return db.transaction(async trx => {
      const matching = await trx('shared_laboratories').where({ code: data.code }).first();
      if (matching && matching.id !== data.id) throw new Error('This laboratory code is already used');
      if (data.id) {
        if (!(await trx('shared_laboratories').where({ id: data.id }).first())) throw new Error('Laboratory does not exist');
        await trx('shared_laboratories').where({ id: data.id }).update({ code: data.code, name: data.name, notes: data.notes });
        return trx('shared_laboratories').where({ id: data.id }).first();
      }
      const id = randomUUID();
      await trx('shared_laboratories').insert({ id, code: data.code, name: data.name, notes: data.notes, active: 1 });
      return trx('shared_laboratories').where({ id }).first();
    });
  });
  protectedHandle('labs:setActive', async (_event, rawId: unknown, rawActive: unknown) => {
    const id = uuid.parse(rawId), active = z.boolean().parse(rawActive);
    const row = await db('shared_laboratories').where({ id }).first();
    if (!row) throw new Error('Laboratory not found');
    if (!active && await db('lab_bookings').where({ lab_id: id, active: 1 }).first()) {
      throw new Error('Cancel existing active bookings before deactivating this laboratory');
    }
    if (!active && await db('schedule_activities').where({ lab_id: id, active: 1 }).first()) {
      throw new Error('Cancel active club, sports or certification reservations before deactivating this laboratory');
    }
    await db('shared_laboratories').where({ id }).update({ active: active ? 1 : 0 });
    return { success: true };
  });
  protectedHandle('labs:getConfig', async () => getConfig(db));
  protectedHandle('labs:saveConfig', async (_event, raw: unknown) => {
    const config = settingInput.parse(raw);
    if (config.days !== 6 || config.periodsPerDay !== 6 || config.breakAfter !== 3) {
      throw new Error('Confirmed college clock uses Monday–Saturday, six periods, and lunch after P3. Use College Period Timings to change the clock.');
    }
    if (config.days === 6 && (config.saturdayPeriods < 2 || config.saturdayPeriods > config.periodsPerDay)) {
      throw new Error('Saturday must have at least 2 periods and no more than weekdays');
    }
    if (config.breakAfter > config.periodsPerDay) throw new Error('Break position is outside the working day');
    const currentBookings = await db('lab_bookings').where({ active: 1 }).select();
    for (const row of currentBookings) {
      try { validateSlot(config, asSlot(row)); }
      catch (err) { throw new Error(`Cannot change settings: booking ${row.id} becomes invalid. ${err instanceof Error ? err.message : String(err)}`); }
    }
    await db('lab_schedule_config').where({ id: 1 }).update({
      days: config.days, periods_per_day: config.periodsPerDay,
      saturday_periods: config.saturdayPeriods, break_after: config.breakAfter,
    });
    return getConfig(db);
  });
  protectedHandle('labs:listBookings', async (_event, rawTermId: unknown) => {
    const termId = uuid.parse(rawTermId);
    return db('lab_bookings as b')
      .join('shared_laboratories as l', 'l.id', 'b.lab_id')
      .leftJoin('section_subject_allocations as a', 'a.id', 'b.allocation_id')
      .leftJoin('term_subjects as s', 's.id', 'a.subject_id')
      .leftJoin('academic_sections as sec', 'sec.id', 'b.section_id')
      .leftJoin('semester_offerings as so', 'so.id', 'sec.offering_id')
      .leftJoin('faculty as f', 'f.id', 'a.faculty_id')
      .where('b.term_id', termId)
      .select('b.*', 'a.faculty_id as current_faculty_id', 'a.active as allocation_active', 'l.code as lab_code', 'l.name as lab_name', 's.name as subject_name',
        'sec.code as section_code', 'so.semester_number as semester_number', 'f.name as faculty_name')
      .orderBy('b.weekday').orderBy('b.start_period').orderBy('l.code');
  });
  protectedHandle('labs:saveBooking', async (_event, raw: unknown) => {
    const data = bookingInput.parse(raw);
    // Do not silently change the recurring session that a dated certification
    // was approved to suspend. The coordinator must revise the certification first.
    if (data.id) {
      const affected = await db('schedule_lab_suspensions as x')
        .join('schedule_activities as a','a.id','x.activity_id')
        .where('x.lab_booking_id',data.id).where('a.active',1).first();
      if (affected) throw new Error('This lab booking has an active dated certification replacement. Cancel the affected certification before editing the recurring lab.');
    }
    const config = await getConfig(db);
    const clock = await getClock(db);
    if (!clock.confirmed) throw new Error('Confirm and save the college period timings before adding a new lab booking');
    const weekday = data.mode === 'Dated' ? weekdayOfISODate(data.bookingDate ?? '') : data.weekday;
    const proposed: BookingSlot = {
      term_id: data.termId, lab_id: data.labId, mode: data.mode,
      weekday, booking_date: data.mode === 'Dated' ? data.bookingDate : null,
      start_period: data.startPeriod, section_id: null, faculty_id: null,
    };
    requireTwoHours(clock, proposed.start_period);
    if (weekday === 5) {
      const saturday = await getSaturdaySchedule(db, data.termId);
      if (!saturday.confirmed) throw new Error('Confirm this academic term’s Saturday campus hours before booking Saturday');
      config.saturdayPeriods = saturday.campusPeriods;
    }
    validateSlot(config, proposed);
    if (data.bookingType === 'External' && !data.ownerLabel) {
      throw new Error('Enter the external department or organization');
    }
    if (data.bookingType !== 'BCA' && data.allocationId) {
      throw new Error('Only BCA bookings may have a teaching allocation');
    }
    if (data.bookingType === 'BCA' && !data.allocationId) {
      throw new Error('Choose an assigned BCA practical subject');
    }
    return db.transaction(async trx => {
      if (!(await trx('academic_terms').where({ id: data.termId }).first())) throw new Error('Academic term not found');
      const lab = await trx('shared_laboratories').where({ id: data.labId }).first();
      if (!lab || Number(lab.active) !== 1) throw new Error('Choose an active laboratory');
      if (data.id && !(await trx('lab_bookings').where({ id: data.id }).first())) throw new Error('Booking not found');
      if (data.bookingType === 'BCA') {
        const allocation = await trx('section_subject_allocations as a')
          .join('academic_sections as sec', 'sec.id', 'a.section_id')
          .join('semester_offerings as so', 'so.id', 'sec.offering_id')
          .join('term_subjects as s', 's.id', 'a.subject_id')
          .leftJoin('faculty as f', 'f.id', 'a.faculty_id')
          .where('a.id', data.allocationId)
          .select('a.id', 'a.weekly_hours', 'a.section_id', 'a.faculty_id', 'a.active as allocation_active',
            'sec.active as section_active', 'so.active as semester_active',
            'so.term_id', 'so.id as offering_id', 's.kind', 's.active as subject_active', 'f.active as faculty_active')
          .first();
        if (!allocation || allocation.term_id !== data.termId || allocation.kind !== 'Lab') {
          throw new Error('Select a laboratory allocation from this academic term');
        }
        if (![allocation.allocation_active, allocation.section_active, allocation.semester_active, allocation.subject_active].every(v => Number(v) === 1)) {
          throw new Error('The selected practical allocation, subject, semester, or section is inactive');
        }
        if (allocation.faculty_id && Number(allocation.faculty_active) !== 1) throw new Error('Assigned faculty is inactive');
        if (weekday === 5) {
          const saturday = await getSaturdaySchedule(trx, data.termId);
          const offering = saturday.offerings.find(o => o.offeringId === allocation.offering_id);
          if (!offering || data.startPeriod + 1 > offering.effective) {
            throw new Error('This BCA semester is not scheduled for those Saturday periods');
          }
        }
        await assertSectionsWithinSchedule(trx,[String(allocation.section_id)],weekday,data.startPeriod,2);
        proposed.section_id = allocation.section_id;
        proposed.faculty_id = allocation.faculty_id;
        if (data.mode === 'Weekly') {
          const current = await trx('lab_bookings').where({
            term_id: data.termId, allocation_id: data.allocationId, mode: 'Weekly', active: 1,
          }).modify(query => { if (data.id) query.whereNot({ id: data.id }); }).count({ count: 'id' }).first();
          if (Number(current?.count || 0) * 2 + 2 > Number(allocation.weekly_hours)) {
            throw new Error(`Booking exceeds this subject allocation's ${allocation.weekly_hours} weekly periods`);
          }
        }
      }
      const others = await trx('lab_bookings as b')
        .leftJoin('section_subject_allocations as a', 'a.id', 'b.allocation_id')
        .where('b.active', 1).select('b.*', 'a.faculty_id as current_faculty_id');
      for (const rawRow of others) {
        const other = asSlot(rawRow);
        // Use the CURRENT faculty assignment, not a stale booking-time snapshot.
        if (other.allocation_id) other.faculty_id = rawRow.current_faculty_id ?? null;
        if (other.id === data.id) continue;
        const why = resourceConflict(proposed, other);
        if (why) throw new Error(why);
      }
      // One shared collision system: lab reservations must also respect activities.
      await assertLabHasNoActivityClash(trx, {
        term_id: proposed.term_id, mode: proposed.mode, weekday: proposed.weekday,
        booking_date: proposed.booking_date, start_period: proposed.start_period, period_count: 2,
        section_ids: proposed.section_id ? [proposed.section_id] : [],
        faculty_id: proposed.faculty_id || null, lab_id: proposed.lab_id,
      });
      const id = data.id || randomUUID();
      const fields = {
        term_id: data.termId, lab_id: data.labId, booking_type: data.bookingType,
        mode: data.mode, weekday, booking_date: proposed.booking_date,
        start_period: data.startPeriod, period_count: 2,
        allocation_id: data.bookingType === 'BCA' ? data.allocationId : null,
        section_id: proposed.section_id ?? null, faculty_id: proposed.faculty_id ?? null,
        owner_label: data.bookingType === 'BCA' ? 'BCA' : (data.ownerLabel || 'Maintenance'),
        notes: data.notes, active: 1,
      };
      if (data.id) await trx('lab_bookings').where({ id }).update(fields);
      else await trx('lab_bookings').insert({ id, ...fields });
      return trx('lab_bookings').where({ id }).first();
    });
  });
  protectedHandle('labs:cancelBooking', async (_event, rawId: unknown) => {
    const id = uuid.parse(rawId);
    const affected = await db('schedule_lab_suspensions as x')
      .join('schedule_activities as a','a.id','x.activity_id')
      .where('x.lab_booking_id',id).where('a.active',1).first();
    if (affected) throw new Error('This lab booking has an active dated certification replacement. Cancel the affected certification before deactivating the recurring lab.');
    const updated = await db('lab_bookings').where({ id }).update({ active: 0 });
    if (!updated) throw new Error('Booking not found');
    return { success: true };
  });
}
