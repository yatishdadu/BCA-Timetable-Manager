// Static build verification. A genuine Windows runtime test is still required.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function checkFile(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size < 100) {
    throw new Error('Missing or empty production build output: ' + name);
  }
  console.log('OK', name);
  return fs.readFileSync(file, 'utf8');
}
const html = checkFile('dist/renderer/index.html');
const main = checkFile('dist/main/index.mjs');
const preload = checkFile('dist/main/preload.js');
if (html.includes('http://localhost:5173') || /(?:src|href)=["']\//.test(html)) {
  throw new Error('Renderer contains dev server or absolute root asset URLs; file:// requires relative paths.');
}
if (!main.includes('bca-timetable.db') || !main.includes('preload.js') || !main.includes('renderer/index.html')) {
  throw new Error('Main build is missing expected database, preload or renderer references.');
}
if (!preload.includes('contextBridge') || !preload.includes('ipcRenderer')) {
  throw new Error('Preload bridge did not compile as expected.');
}
console.log('Production output structure passed. This is NOT a Windows packaged-app runtime test.');
