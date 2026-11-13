const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bca-auth-rules-'));
const target = path.join(tmp, 'rules.cjs');
const rulesPath = path.resolve(process.cwd(), 'src/main/coordinatorAuthRules.ts');
const output = ts.transpileModule(fs.readFileSync(rulesPath, 'utf8'), { fileName: rulesPath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
fs.writeFileSync(target, output.outputText);
const r = require(target);
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
test('username is case-insensitive and trimmed', () => assert.equal(r.normalizeIdentity('  COORDINATOR_1 '), 'coordinator_1'));
test('accepts valid username', () => assert.equal(r.validUsername('tt-coord'), true));
test('rejects short or malformed username', () => { assert.equal(r.validUsername('a'), false); assert.equal(r.validUsername('co ord'), false); });
test('accepts guest or permanent faculty-style employee code', () => assert.equal(r.validEmployeeCode('GUEST-001'), true));
test('rejects employee code containing spaces', () => assert.equal(r.validEmployeeCode('BAD CODE'), false));
test('rejects short passwords', () => assert.equal(r.validPassword('password1'), false));
test('accepts long passphrases', () => assert.equal(r.validPassword('A memorable long passphrase'), true));
test('rejects control characters', () => assert.equal(r.validPassword('VeryLong\\nPassword123'.replace('\\n','\n')), false));
test('normalizes grouped recovery keys', () => assert.equal(r.normalizeRecoveryCode('aabb-ccdd 0011'), 'AABBCCDD0011'));
test('rejects incorrect length recovery keys', () => assert.equal(r.validRecoveryCode('AABB-CCDD'), false));
test('validates 48-character hexadecimal recovery key', () => assert.equal(r.validRecoveryCode('A'.repeat(48)), true));
test('formats recovery key in six groups', () => assert.equal(r.groupRecoveryCode('f'.repeat(48)).split('-').length, 6));
test('every business IPC handler is centrally protected', () => {
  const sourceDir = path.resolve(process.cwd(), 'src/main');
  for (const filename of ['index.ts','facultyIdentity.ts','collegeBranding.ts','laboratories.ts','activities.ts','masterTimetable.ts','theoryGenerator.ts','timetablePublication.ts']) {
    const source = fs.readFileSync(path.join(sourceDir, filename), 'utf8');
    assert.ok(source.includes('protectedHandle('), filename);
    assert.equal(/ipcMain\.handle\(/.test(source), false, filename + ' bypasses coordinator authentication');
  }
});
test('main process registers auth before opening the coordinator window', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(),'src/main/index.ts'),'utf8');
  assert.ok(src.indexOf('registerCoordinatorAuthHandlers(database)') < src.indexOf('    createWindow();'));
  assert.ok(src.includes('allowCoordinatorWindow(win.webContents)'));
});
test('renderer gates all routes behind the coordinator login', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8');
  assert.ok(src.includes('<CoordinatorGate>'));
});
