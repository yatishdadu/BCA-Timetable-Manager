const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../src/main', name);
  const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
  const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  m._compile(result,filename); return m.exports;
}
const {canSuspendWeeklyBcaLab}=load('overrideRules.ts');
const candidate={term_id:'term1',mode:'Dated',weekday:0,booking_date:'2026-11-09',start_period:4,period_count:3,section_ids:['A'],faculty_id:'f',lab_id:'lab3'};
const lab={...candidate,mode:'Weekly',booking_date:null,period_count:2,booking_id:'x',booking_type:'BCA',owner_label:'BCA'};
test('dated certification can propose a recurring BCA lab suspension',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Certification',lab),true));
test('external department lab cannot be displaced',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Certification',{...lab,booking_type:'External'}),false));
test('maintenance booking cannot be displaced',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Certification',{...lab,booking_type:'Maintenance'}),false));
test('dated BCA lab cannot be displaced',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Certification',{...lab,mode:'Dated',booking_date:'2026-11-09'}),false));
test('booking in other academic term cannot be displaced',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Certification',{...lab,term_id:'term2'}),false));
test('weekly certification cannot cause dated suspension',()=>assert.equal(canSuspendWeeklyBcaLab({...candidate,mode:'Weekly',booking_date:null},'Certification',lab),false));
test('sports cannot suspend regular BCA lab',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Sports',lab),false));
test('club cannot suspend regular BCA lab',()=>assert.equal(canSuspendWeeklyBcaLab(candidate,'Club',lab),false));
