// 深度检查 2：合并后语义冲突扫描
// 目标：找出「双方都改了同一函数/同一逻辑块」但自动合并可能产生的语义打架：
//   ① 同一函数在两侧都被改（合并后是否两套逻辑并存 / 互斥）
//   ② 同一常量被两侧赋不同值
//   ③ 关键口径常量（BOSS_ATK_MULT / 伤害公式 / 点数口径）在合并后的实际取值
//   ④ 远程引入的新函数是否被本地引擎实际调用（避免"写了但没接"）
const fs = require('fs'), path = require('path');
const cp = require('child_process');
const DIR = path.join(__dirname, 'js');

function gitShow(rev, file) {
  try { return cp.execSync(`git show ${rev}:js/${file}`, { cwd: __dirname, encoding: 'utf8' }); }
  catch (e) { return null; }
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
// 提取顶层函数/const 定义的签名与所在行
function defs(src) {
  const out = new Map();
  const lines = stripComments(src).split('\n');
  lines.forEach((ln, i) => {
    let m = ln.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
         || ln.match(/^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/);
    if (m) out.set(m[1], { line: i + 1, text: ln.trim() });
  });
  return out;
}
function bodyOf(src, name) {
  // 取函数体到下一个顶层定义为止
  const lines = stripComments(src).split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m && m[1] === name) { start = i; break; }
  }
  if (start < 0) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^\s*(export\s+)?(async\s+)?(function|const|let|var)\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
const MERGE_BASE = '5785dd4', LOCAL = '0b9d2aa', REMOTE = '8c12ddd';

console.log('=== ① 双方都修改的顶层定义（潜在语义冲突点）===');
const conflictPoints = [];
for (const f of files) {
  const base = gitShow(MERGE_BASE, f), loc = gitShow(LOCAL, f), rem = gitShow(REMOTE, f);
  if (!base || !loc || !rem) continue;
  const b = defs(base), l = defs(loc), r = defs(rem);
  for (const [name, ld] of l) {
    if (!b.has(name)) continue;              // 新增定义，非冲突点
    const rb = bodyOf(rem, name), lb = bodyOf(loc, name), bb = bodyOf(base, name);
    const remoteChanged = rb !== bb;
    const localChanged = lb !== bb;
    if (remoteChanged && localChanged) {
      conflictPoints.push({ f, name, remoteChanged, localChanged, same: lb === rb });
      console.log(`  ⚠ ${f}  ${name}()  —— 双方均改动${lb === rb ? '（内容一致）' : '（内容不同，需人工核对）'}`);
    }
  }
}

console.log('\n=== ② 双方都赋值的关键常量（值冲突）===');
const constPat = /export\s+(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g;
for (const f of files) {
  const base = gitShow(MERGE_BASE, f), loc = gitShow(LOCAL, f), rem = gitShow(REMOTE, f);
  if (!base || !loc || !rem) continue;
  const grab = src => { const m = new Map(); let x; const re = new RegExp(constPat.source, 'g');
    while ((x = re.exec(stripComments(src)))) m.set(x[1], x[2].trim()); return m; };
  const b = grab(base), l = grab(loc), r = grab(rem);
  for (const [k, lv] of l) {
    if (!b.has(k) || !r.has(k)) continue;
    if (r.get(k) !== lv && r.get(k) !== b.get(k)) {
      console.log(`  ⚠ ${f}  ${k}: 远程=${r.get(k)}  本地=${lv}  (base=${b.get(k)})`);
    }
  }
}

console.log('\n=== ③ 关键口径常量在合并结果中的实际取值 ===');
const merged = {};
for (const f of files) merged[f] = fs.readFileSync(path.join(DIR, f), 'utf-8');
const probes = [
  ['battle.js', /export const BOSS_HP_MULT = ([\d.]+), BOSS_ATK_MULT = ([\d.]+)/, '首领 HP/ATK 倍率'],
  ['core.js', /export const FOUR_ELEMENTS = (\[[^\]]*\])/, '四元素常量'],
];
for (const [f, re, desc] of probes) {
  const m = merged[f].match(re);
  console.log(`  ${m ? '✓' : '?'} ${desc}: ${m ? (m[1] || m[0]).slice(0, 90) : '未匹配'}`);
}
const jw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/jobs.json'), 'utf-8'));
console.log('  ✓ data/jobs.json per_level_points:', jw.jobs.map(j => j.key + '=' + j.per_level_points).join(', '));

console.log('\n=== ④ 远程新增函数的调用点核查（是否真正接线）===');
const remoteNew = [];
for (const f of files) {
  const base = gitShow(MERGE_BASE, f), rem = gitShow(REMOTE, f);
  if (!base || !rem) continue;
  const b = defs(base), r = defs(rem);
  for (const [name] of r) if (!b.has(name)) remoteNew.push({ f, name });
}
// 远程提交的说明里提到的关键 API
const keyFns = ['lootDropHit','lootCountOf','lootPoolPick','dropKeyKnown','monsterSpeedMult','mapBatchSize','eliteChance','eliteCap','allocAttr','resetAttr','attrPerLevel'];
const allSrc = Object.values(merged).join('\n');
for (const fn of keyFns) {
  const definedIn = remoteNew.find(x => x.name === fn);
  // 调用点：排除定义行本身
  const callCount = (allSrc.match(new RegExp('\\b' + fn + '\\s*\\(', 'g')) || []).length;
  const uses = callCount - 1;   // 减去定义
  console.log(`  ${definedIn ? '新' : '旧'} ${fn.padEnd(18)} 定义于 ${definedIn ? definedIn.f : '既有'}  其他调用点≈${uses}` + (uses === 0 && definedIn ? '   ⚠ 仅定义未调用' : ''));
}

console.log('\n=== ⑤ 远程新增的数据表是否接入 DATA_FILES ===');
const stateSrc = merged['state.js'];
const dfMatch = stateSrc.match(/export const DATA_FILES = \[([\s\S]*?)\]/);
const df = dfMatch ? dfMatch[1] : '';
for (const t of ['loot_pools','loot_rules','monster_loot_built','difficulty']) {
  console.log(`  ${df.includes("'" + t + "'") ? '✓' : '✗'} ${t}`);
}
// data/ 目录里是否有对应文件
for (const t of ['loot_pools','loot_rules','monster_loot_built','difficulty']) {
  const p = path.join(__dirname, 'data', t + '.json');
  console.log(`  ${fs.existsSync(p) ? '✓' : '✗'} data/${t}.json 存在`);
}
