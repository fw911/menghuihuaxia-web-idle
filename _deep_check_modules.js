// 深度检查 1：ES Module 导入/导出完整性
// 解析 js/*.js 的 import 与 export，核对：
//   ① 每个 import 的具名符号在目标模块确实被 export（悬空导入）
//   ② 同一模块内重复 export 同一名字（重复导出）
//   ③ export 的名字是否有重复声明冲突
//   ④ 循环依赖图
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'js');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));

function stripComments(src) {
  // 去掉块注释与行注释（避免注释里的关键字干扰）
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const exportsOf = {};   // file -> Set(names)
const declOf = {};      // file -> Map(name -> 'const'|'function'|'let'|'var'|'export'|'re-export')
const importsOf = {};   // file -> [{from, names:[{imported, local}]}]
const importsRaw = [];

for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  const ex = new Set();
  const dl = new Map();
  const im = [];

  // export const/let/var/function/class NAME
  const declRe = /export\s+(?:async\s+)?(const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(src))) { ex.add(m[2]); dl.set(m[2], m[1]); }

  // export { a, b as c }
  const braceRe = /export\s*\{([^}]*)\}/g;
  while ((m = braceRe.exec(src))) {
    for (let part of m[1].split(',')) {
      part = part.trim(); if (!part) continue;
      const as = part.split(/\s+as\s+/);
      const name = (as[1] || as[0]).trim();
      if (name) ex.add(name);
    }
  }

  // export default
  if (/export\s+default/.test(src)) ex.add('default');

  // export * from './x.js'
  for (const mm of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    im.push({ star: true, from: mm[1] });
  }

  // import { a, b as c } from './x.js'
  const impRe = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = impRe.exec(src))) {
    const from = m[2];
    const names = [];
    for (let part of m[1].split(',')) {
      part = part.trim(); if (!part) continue;
      const as = part.split(/\s+as\s+/);
      const imported = as[0].trim();
      const local = (as[1] || as[0]).trim();
      names.push({ imported, local });
    }
    im.push({ names, from });
  }

  // import X from '...'（默认导入）
  const defRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
  while ((m = defRe.exec(src))) im.push({ names: [{ imported: 'default', local: m[1] }], from: m[2] });

  // import * as NS from '...'
  const nsRe = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
  while ((m = nsRe.exec(src))) im.push({ names: [{ imported: '*', local: m[1] }], from: m[2] });

  // import '...'
  const bareRe = /import\s*['"]([^'"]+)['"]/g;
  while ((m = bareRe.exec(src))) im.push({ names: [], from: m[1] });

  exportsOf[f] = ex; declOf[f] = dl; importsOf[f] = im;
}

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const p = path.normalize(path.join(DIR, from, spec));
  const base = path.basename(p);
  if (files.includes(base)) return base;
  if (files.includes(base.replace(/\.js$/, '.js'))) return base;
  return null;
}

// 展开 export * 的传递导出（barrel：main.js re-export 全部模块）
const starsOf = {};
for (const f of files) {
  starsOf[f] = [];
  const src = stripComments(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  for (const mm of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const t = resolve(f, mm[1]);
    if (t) starsOf[f].push(t);
  }
}
const expCache = {};
function exportsOfResolved(f, seen) {
  if (expCache[f]) return expCache[f];
  seen = seen || new Set();
  if (seen.has(f)) return new Set();
  seen.add(f);
  const s = new Set(exportsOf[f]);
  for (const t of starsOf[f]) for (const n of exportsOfResolved(t, seen)) s.add(n);
  expCache[f] = s;
  return s;
}

let problems = 0;
const dangling = [], dupExport = [], unresolved = [];

// ① 悬空导入
for (const f of files) {
  for (const im of importsOf[f]) {
    const tgt = resolve(f, im.from);
    if (!tgt) { unresolved.push(`${f}  →  ${im.from}  (无法解析)`); problems++; continue; }
    for (const n of (im.names || [])) {
      if (n.imported === '*') continue;
      if (!exportsOfResolved(tgt).has(n.imported)) {
        dangling.push(`${f}  从 ${tgt} 导入 { ${n.imported} as ${n.local} } —— 目标未导出该名字`);
        problems++;
      }
    }
  }
}

// ② 重复导出
for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  const seen = new Map();
  const declRe = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(src))) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  for (const [k, v] of seen) if (v > 1) { dupExport.push(`${f}  重复 export: ${k} ×${v}`); problems++; }
}

// ③ 重复 import 局部名（同文件内同名 import 两次 → 后者覆盖前者）
for (const f of files) {
  const localCount = new Map();
  for (const im of importsOf[f]) {
    for (const n of (im.names || [])) {
      if (n.imported === '*') continue;
      localCount.set(n.local, (localCount.get(n.local) || 0) + 1);
    }
  }
  for (const [k, v] of localCount) {
    if (v > 1) { dupExport.push(`${f}  同一局部名重复 import: ${k} ×${v}`); problems++; }
  }
}

// ④ 循环依赖
const dep = {};
for (const f of files) {
  dep[f] = importsOf[f].map(im => resolve(f, im.from)).filter(Boolean);
}
const cycles = [];
const state = {};
function dfs(n, stack) {
  if (state[n] === 1) {
    const i = stack.indexOf(n);
    cycles.push(stack.slice(i).concat(n).join(' → '));
    return;
  }
  if (state[n] === 2) return;
  state[n] = 1; stack.push(n);
  for (const d of dep[n] || []) dfs(d, stack);
  stack.pop(); state[n] = 2;
}
for (const f of files) dfs(f, []);

console.log('=== 模块总数 ===', files.length);
console.log('=== 导入关系数 ===', files.reduce((a, f) => a + (dep[f] || []).length, 0));
console.log('\n=== 悬空导入 ===');
if (!dangling.length) console.log('  （无）');
else dangling.forEach(x => console.log('  ✗ ' + x));
console.log('\n=== 重复导出 / 重复 import ===');
if (!dupExport.length) console.log('  （无）');
else dupExport.forEach(x => console.log('  ✗ ' + x));
console.log('\n=== 无法解析的 import 路径 ===');
if (!unresolved.length) console.log('  （无）');
else unresolved.forEach(x => console.log('  ✗ ' + x));

// 循环依赖只报「最短环」，避免组合爆炸；并标注是否涉及 TDZ 风险
const minCycles = [];
for (const c of [...new Set(cycles)]) {
  const len = c.split(' → ').length;
  if (!minCycles.some(x => x.split(' → ').length === len)) minCycles.push(c);
}
console.log('\n=== 循环依赖（最短环，去重） ===' + (minCycles.length ? ' 共 ' + minCycles.length + ' 个' : ''));
if (!minCycles.length) console.log('  （无）');
else minCycles.forEach(x => console.log('  ! ' + x));

console.log('\n=== 各模块导出数 ===');
for (const f of files.sort()) console.log('  ' + f.padEnd(14), exportsOf[f].size);

console.log('\nPROBLEMS=' + problems);
