// Node 26 supports loading this lightweight TypeScript source directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffLogoType, logoDataUrl, validateDataUrl, MAX_LOGO_BYTES } = require('../src/main/brandingRules.ts');
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpg = Buffer.from([255,216,255,224,0,0]);
test('accepts PNG and JPEG signatures',()=>{assert.equal(sniffLogoType(png),'image/png');assert.equal(sniffLogoType(jpg),'image/jpeg');});
test('rejects SVG and arbitrary content',()=>{assert.equal(sniffLogoType(Buffer.from('<svg onload="x">')) ,null);});
test('roundtrip image data URLs',()=>{assert.equal(validateDataUrl(logoDataUrl(png)),logoDataUrl(png));assert.equal(validateDataUrl(logoDataUrl(jpg)),logoDataUrl(jpg));});
test('refuses spoofed image types',()=>{assert.throws(()=>validateDataUrl('data:image/jpeg;base64,'+png.toString('base64')),/does not match/);});
test('refuses malformed image data',()=>{assert.throws(()=>validateDataUrl('javascript:alert(1)'),/Only PNG/);});
test('can clear a logo',()=>{assert.equal(validateDataUrl(null),null);});
test('enforces 2MB image limit',()=>{assert.throws(()=>logoDataUrl(Buffer.alloc(MAX_LOGO_BYTES+1,1)),/2 MB/);});
