/** Run from the project root: node --test tests/clockRules.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/main/clockRules.ts');
const code = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const mod = new Module(filename, module);
mod.filename = filename; mod.paths = module.paths;
mod._compile(compiled, filename);
const { confirmedReferenceClock: clock, checkClock, labBlockClockMinutes, requireTwoHours, effectiveSaturdayPeriods } = mod.exports;
test('confirmed clock contains P1–P6', () => assert.equal(clock.periods.length, 6));
test('confirmed clock validates', () => assert.doesNotThrow(() => checkClock(clock)));
for (const start of [1, 2, 4, 5]) {
  test(`P${start}+P${start + 1} is 120 continuous minutes`, () => assert.equal(labBlockClockMinutes(clock, start), 120));
}
test('P3+P4 crosses lunch and is rejected', () => assert.throws(() => labBlockClockMinutes(clock, 3), /lunch/));
test('P6+P7 is outside the working day', () => assert.throws(() => labBlockClockMinutes(clock, 6), /two existing periods/));
test('lunch has exact 60-minute duration', () => {
  const mins = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  assert.equal(mins(clock.lunchEnd)-mins(clock.lunchStart), 60);
});
test('period overlap is rejected', () => {
  const damaged = { ...clock, periods: clock.periods.map(p => ({...p})) };
  damaged.periods[1].start = '10:30';
  assert.throws(() => checkClock(damaged), /continuous|60 minutes/);
});
test('invalid shifted lunch is rejected', () => {
  const damaged = { ...clock, lunchStart:'12:35' };
  assert.throws(() => checkClock(damaged), /Lunch/);
});
test('short teaching periods are rejected', () => {
  const shorter = { ...clock, periods: clock.periods.map(p=>({...p})) };
  shorter.periods[0].start = '09:55';
  assert.throws(() => requireTwoHours(shorter, 1), /60 minutes/);
});
test('half-day semester may fit inside full-day campus', () => assert.equal(effectiveSaturdayPeriods(6, 3), 3));
test('semester cannot exceed campus Saturday hours', () => assert.throws(() => effectiveSaturdayPeriods(3, 6), /cannot run/));
test('closed semester cannot book on a campus open Saturday', () => assert.equal(effectiveSaturdayPeriods(6, 0), 0));
test('no semester override inherits campus hours', () => assert.equal(effectiveSaturdayPeriods(6, null), 6));
test('unapproved Saturday values are rejected', () => assert.throws(() => effectiveSaturdayPeriods(6, 5), /Closed/));
