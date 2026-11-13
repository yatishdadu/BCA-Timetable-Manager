const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Run the already installed esbuild JS launcher through Node (cross-platform, including Windows).
const cli = path.resolve(__dirname, '..', 'node_modules', 'esbuild', 'bin', 'esbuild');
const target = path.join(os.tmpdir(), `bca-master-${process.pid}.cjs`);
try { execFileSync(process.execPath, [cli, path.resolve(__dirname, '..', 'src/main/masterRules.ts'), '--bundle','--platform=node','--format=cjs',`--outfile=${target}`], {stdio:'pipe'}); }
catch(e) { throw new Error('The master rules tests require the existing local esbuild installation. '+(e.stderr||e.message)); }
const {effectiveMasterEvents, parseScheduleDate, projectedConflicts} = require(target);
process.on('exit',()=>{try{fs.unlinkSync(target)}catch{}});
const lab = (id,day,start,faculty='f1',section='s1',labId='l1')=>({id,source:'Lab',title:id,detail:'',mode:'Weekly',weekday:day,bookingDate:null,startPeriod:start,periodCount:2,sectionIds:[section],facultyId:faculty,labId});
test('2026-11-03 is Tuesday indexed 1',()=>assert.equal(parseScheduleDate('2026-11-03'),1));
test('rejects year 1016 typo',()=>assert.throws(()=>parseScheduleDate('1016-11-09')));
test('rejects nonexistent calendar day',()=>assert.throws(()=>parseScheduleDate('2026-02-30')));
test('weekly grid retains all recurring laboratory classes',()=>assert.equal(effectiveMasterEvents([lab('a',1,1),lab('b',0,4)],[],null).length,2));
test('Tuesday date selects only Tuesday and Tuesday dated sessions',()=>{
 const e=[lab('a',1,1),lab('b',0,4),{...lab('c',1,5),mode:'Dated',bookingDate:'2026-11-03'}];
 assert.deepEqual(effectiveMasterEvents(e,[],'2026-11-03').map(x=>x.id),['a','c']);
});
test('suspension hides a lab only on authorized date',()=>{
 const e=[lab('a',1,1)]; const suspension=[{labBookingId:'a',bookingDate:'2026-11-03'}];
 assert.equal(effectiveMasterEvents(e,suspension,'2026-11-03').length,0);
 assert.equal(effectiveMasterEvents(e,suspension,'2026-11-10').length,1);
 assert.equal(effectiveMasterEvents(e,suspension,null).length,1);
});
test('detects section conflict on same period',()=>assert.equal(projectedConflicts([lab('a',1,1),lab('b',1,2,'f2','s1','l2')]).length,1));
test('detects faculty conflict across sections',()=>assert.equal(projectedConflicts([lab('a',1,1),lab('b',1,2,'f1','s2','l2')]).length,1));
test('detects physical lab overlap',()=>assert.equal(projectedConflicts([lab('a',1,1),lab('b',1,2,'f2','s2','l1')]).length,1));
test('adjacent no conflict',()=>assert.equal(projectedConflicts([lab('a',1,1),lab('b',1,3,'f1','s1','l1')]).length,0));
