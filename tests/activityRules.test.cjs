const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const name = path.resolve(__dirname, '../src/main', file);
  if(cache.has(name)) return cache.get(name).exports;
  const m = new Module(name, module);
  m.filename=name; m.paths=module.paths; cache.set(name,m);
  const output=ts.transpileModule(fs.readFileSync(name,'utf8'),{ compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS} }).outputText;
  m.require = p=>p.endsWith('.ts') ? load(p) : require(p);
  m._compile(output,name); return m.exports;
}
const { confirmedReferenceClock: clock } = load('clockRules.ts');
const { validateEventSpan, validateActivityDate, timeOverlaps, activityConflict } = load('activityRules.ts');
const slot = (o={}) => ({term_id:'term-1',mode:'Weekly',weekday:0,booking_date:null,start_period:1,period_count:2,section_ids:['sec-a'],faculty_id:'f1',lab_id:null,...o});
for(const [p,n,min] of [[1,1,60],[1,2,120],[2,2,120],[4,2,120],[4,3,180],[6,1,60]]) {
  test(`P${p} length ${n} valid, ${min} minutes`,()=>assert.equal(validateEventSpan(clock,p,n),min));
}
test('P3-P4 across lunch rejected',()=>assert.throws(()=>validateEventSpan(clock,3,2),/lunch/));
test('P2-P4 across lunch rejected',()=>assert.throws(()=>validateEventSpan(clock,2,3),/lunch/));
test('P6-P7 rejected',()=>assert.throws(()=>validateEventSpan(clock,6,2),/existing/));
test('P1-P4 beyond 3 periods rejected',()=>assert.throws(()=>validateEventSpan(clock,1,4),/1–3/));
test('Invalid calendar date rejected',()=>assert.throws(()=>validateActivityDate('2026-02-30'),/Invalid/));
test('Sunday rejected',()=>assert.throws(()=>validateActivityDate('2026-11-01'),/Sunday/));
test('Monday date recognized',()=>assert.equal(validateActivityDate('2026-11-02'),0));
test('shared section blocks overlapping activity',()=>assert.match(activityConflict(slot(),slot({lab_id:'other',faculty_id:'f2'})),/section/));
test('same faculty blocks two sections',()=>assert.match(activityConflict(slot(),slot({section_ids:['sec-b']})),/Faculty/));
test('same lab blocks even when sections and faculty differ',()=>assert.match(activityConflict(slot({lab_id:'lab-1'}),slot({section_ids:['sec-b'],faculty_id:'f2',lab_id:'lab-1'})),/laboratory/));
test('different section and faculty and no lab is permitted',()=>assert.equal(activityConflict(slot(),slot({section_ids:['sec-b'],faculty_id:'f2'})),null));
test('P1 single period and P2 single period do not overlap',()=>assert.equal(timeOverlaps(slot({period_count:1}),slot({start_period:2,period_count:1})),false));
test('P1-P2 and P2-P3 overlap',()=>assert.equal(timeOverlaps(slot(),slot({start_period:2})),true));
test('week 1 versus dated same weekday conflicts in same term',()=>assert.equal(timeOverlaps(slot(),slot({mode:'Dated', booking_date:'2026-11-02'})),true));
test('dated sessions on different calendar dates do not conflict',()=>assert.equal(timeOverlaps(slot({mode:'Dated',booking_date:'2026-11-02'}),slot({mode:'Dated',booking_date:'2026-11-09'})),false));
test('weekly sessions in different terms do not conflict',()=>assert.equal(timeOverlaps(slot(),slot({term_id:'term-2'})),false));
test('dated sessions on same date overlap across terms',()=>assert.equal(timeOverlaps(slot({mode:'Dated',booking_date:'2026-11-02'}),slot({term_id:'term-2',mode:'Dated',booking_date:'2026-11-02'})),true));
test('two participating sections collide even if only one shared',()=>assert.match(activityConflict(slot({section_ids:['sec-a','sec-b']}),slot({section_ids:['sec-c','sec-b'],faculty_id:'f2'})),/section/));
