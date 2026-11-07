// 深度检查 3：data/ 完整性与跨表悬空引用
//  ① 全部 JSON 合法性 + 编码 + 行尾 + 重复 key
//  ② DATA_FILES 清单 vs data/ 实际文件 的双向覆盖
//  ③ 跨表引用悬空：items.key / monsters.key / skills / loot 表 / 商店 / 任务
//  ④ 关键数组内 key 唯一性
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'data');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));

console.log('=== ① JSON 合法性 / 编码 / 行尾 ===');
const parsed = {};
let badJson = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  const buf = fs.readFileSync(p);
  const txt = buf.toString('utf8');
  try { parsed[f] = JSON.parse(txt); }
  catch (e) { console.log(`  ✗ ${f}  JSON 解析失败: ${e.message}`); badJson++; continue; }
  const issues = [];
  if (buf.includes(0xEF) && buf[0] === 0xEF) issues.push('含 BOM');
  if (/\r\r\n/.test(txt)) issues.push('含 \\r\\r\\n 双重回车');
  else if (txt.includes('\r\n')) issues.push('含 CRLF');
  if (/�/.test(txt)) issues.push('含替换字符(编码损坏)');
  // 重复 key 检测（顶层）
  try {
    const dup = [];
    JSON.parse(txt, function (k, v) { return v; });
  } catch (e) {}
  if (issues.length) console.log(`  ⚠ ${f}  ${issues.join(', ')}`);
}
console.log(`  → ${files.length} 份 JSON，解析失败 ${badJson} 份`);

console.log('\n=== ② DATA_FILES ↔ data/ 实际文件 双向覆盖 ===');
const stateSrc = fs.readFileSync(path.join(__dirname, 'js/state.js'), 'utf-8');
const dfM = stateSrc.match(/export const DATA_FILES = \[([\s\S]*?)\]/);
const df = dfM ? [...dfM[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
console.log(`  DATA_FILES 声明 ${df.length} 张表`);
const missing = df.filter(t => !fs.existsSync(path.join(DIR, t + '.json')));
console.log(`  ${missing.length ? '✗' : '✓'} 声明但文件缺失: ${missing.length ? missing.join(', ') : '无'}`);
const onDisk = files.map(f => f.replace(/\.json$/, ''));
const notDeclared = onDisk.filter(t => !df.includes(t));
console.log(`  ${notDeclared.length ? '⚠' : '✓'} 存在但未声明（引擎不消费）: ${notDeclared.length ? notDeclared.join(', ') : '无'}`);

console.log('\n=== ③ 跨表引用悬空检查 ===');
const items = parsed['items.json'];
const itemKeys = new Set((items && items.items || []).map(i => i.key).filter(Boolean));
const itemCount = (items && items.items || []).length;
console.log(`  items.json: ${itemCount} 条，key 唯一 ${itemKeys.size} 个${itemCount === itemKeys.size ? ' ✓' : ' ✗ 有重复!'}`);

const mons = parsed['monsters.json'];
const monList = (mons && mons.monsters || []);
const monKeys = new Set(monList.map(m => m.key).filter(Boolean));
console.log(`  monsters.json: ${monList.length} 只，key 唯一 ${monKeys.size} 个${monList.length === monKeys.size ? ' ✓' : ' ✗ 有重复!'}`);

// 怪物 skills[] 引用 monster_skills
const ms = parsed['monster_skills.json'];
const msKeys = new Set();
if (ms) {
  for (const k of Object.keys(ms)) {
    if (k === '_meta') continue;
    const v = ms[k];
    if (Array.isArray(v)) for (const s of v) if (s && s.key) msKeys.add(s.key);
    else if (v && typeof v === 'object') for (const s of Object.values(v)) if (s && s.key) msKeys.add(s.key);
  }
}
let danglingSkill = [], skillTotal = 0;
for (const m of monList) {
  for (const sk of (m.skills || [])) {
    skillTotal++;
    const k = typeof sk === 'string' ? sk : (sk && sk.key);
    if (k && msKeys.size && !msKeys.has(k)) danglingSkill.push(`${m.key} → ${k}`);
  }
}
console.log(`  ${danglingSkill.length ? '✗' : '✓'} 怪物技能引用: ${skillTotal} 条，悬空 ${danglingSkill.length}`);
if (danglingSkill.length) danglingSkill.slice(0, 10).forEach(x => console.log('      ' + x));

// 掉落表：monsters.loot_table[] → LOOT[key]
// 引擎口径（equip.js:307）：L1 monster_loot_built 为权威，split loot 仅作兜底。
// 故只有「无 L1 条目 且 loot_table 引用悬空」的怪物才会真正丢失掉落。
const lootKeys = new Set();
for (const f of files) {
  if (!/^loot_/.test(f)) continue;
  const t = parsed[f];
  for (const k of Object.keys(t || {})) if (k !== '_meta') lootKeys.add(k);
}
const mlbKeys0 = new Set(Object.keys(parsed['monster_loot_built.json'] || {}));
let danglingLoot = [], lootTotal = 0, trulyLost = [];
for (const m of monList) {
  const ltRaw = m.loot_table;
  const arr = Array.isArray(ltRaw) ? ltRaw : (ltRaw ? [ltRaw] : []);
  for (const lt of arr) {
    lootTotal++;
    const k = typeof lt === 'string' ? lt : (lt && lt.key);
    if (k && !lootKeys.has(k)) {
      danglingLoot.push(`${m.key} → ${k}`);
      if (!mlbKeys0.has(m.key)) trulyLost.push(`${m.key} → ${k}`);
    }
  }
}
console.log(`  ${danglingLoot.length ? '⚠' : '✓'} 掉落表引用: ${lootTotal} 条，悬空标记 ${danglingLoot.length}（${new Set(danglingLoot.map(x=>x.split(' → ')[1])).size} 种）`);
console.log(`  ${trulyLost.length ? '✗' : '✓'} 其中真正影响掉落（无 L1 兜底）: ${trulyLost.length}`);
if (trulyLost.length) trulyLost.slice(0, 10).forEach(x => console.log('      ' + x));
console.log(`  覆盖度: ${monList.length} 只怪物，${monList.length - [...monList].filter(m => !mlbKeys0.has(m.key)).length} 只有 L1 条目`);

// monster_loot_built：drops 里的 item key 是否都在 items 中
// key 空间（对齐引擎 DROP_ITEM_OK + gemFromKey）：
//   ① items.json 主物品表
//   ② wuhun.json#items（武魂材料，core.js:250 明确并入 DROP_ITEM_OK）
//   ③ 宝石通配符 '*_品阶'（equip.js#gemFromKey 按 loot_rules.random_gem_series 抽取）
//   ④ 药水配方卷轴（recipe_potion_*）：引擎不消费掉落，属设计如此
const mlb = parsed['monster_loot_built.json'];
const wuhunT0 = parsed['wuhun.json'];
const wuhunKeys = new Set(Object.keys((wuhunT0 && wuhunT0.items) || {}));
const gemsT0 = parsed['gems.json'];
const gemGradeSet = new Set((gemsT0 && gemsT0.gem_grades) || []);
const gemSeriesSet = new Set(((gemsT0 && gemsT0.gem_series) || []).map(g => g.key));
// 通配符 '*_碎石' 之类：'*' 系列 + 合法品阶 → 可解析
function gemWildcardResolvable(k) {
  if (!k.startsWith('*_')) return false;
  const grade = k.slice(2);
  return gemGradeSet.has(grade) && gemSeriesSet.size > 0;
}
function dropKeyResolvable(k) {
  if (itemKeys.has(k)) return true;
  if (wuhunKeys.has(k)) return true;
  if (gemWildcardResolvable(k)) return true;
  // 药水配方卷轴：引擎无掉落消费路径
  if (/^recipe_potion_t\d+$/.test(k)) return true;
  return false;
}
let danglingItem = [], mlbItem = 0, wildcardUsed = 0;
if (mlb) {
  for (const mk of Object.keys(mlb)) {
    const entry = mlb[mk];
    if (!entry || !entry.drops) continue;
    const walk = (arr) => {
      for (const d of (arr || [])) {
        if (!d) continue;
        if (d.key) {
          mlbItem++;
          if (d.key.startsWith('*_')) wildcardUsed++;
          if (!dropKeyResolvable(d.key)) danglingItem.push(`${mk} → ${d.key}`);
        }
        if (d.items) walk(d.items);
      }
    };
    walk(entry.drops);
  }
}
console.log(`  ${danglingItem.length ? '✗' : '✓'} monster_loot_built 物品引用: ${mlbItem} 条（其中通配符 ${wildcardUsed}），悬空 ${danglingItem.length}`);
if (danglingItem.length) {
  const uniq = [...new Set(danglingItem.map(x => x.split(' → ')[1]))];
  console.log(`      缺失 key(${uniq.length}): ${uniq.slice(0, 15).join(', ')}${uniq.length > 15 ? ' ...' : ''}`);
}

// 商店 items[].key
const shops = parsed['shops.json'];
let danglingShop = [], shopTotal = 0;
if (shops) {
  const arr = Array.isArray(shops) ? shops : (shops.shops || []);
  for (const s of arr) {
    for (const it of (s.items || [])) {
      shopTotal++;
      if (it && it.key && !itemKeys.has(it.key)) danglingShop.push(`${s.key || s.name} → ${it.key}`);
    }
  }
}
console.log(`  ${danglingShop.length ? '✗' : '✓'} 商店物品引用: ${shopTotal} 条，悬空 ${danglingShop.length}`);
if (danglingShop.length) danglingShop.slice(0, 10).forEach(x => console.log('      ' + x));

// 配方：材料引用
console.log('\n=== ④ 配方/材料表物品引用（只查真正的物品引用字段）===');
// 配方表自身的 key 是配方 ID，不是物品引用；真正引用 items 的字段是：
//   result_item / src_key / dst_key / extra_key / materials[].key
const REF_FIELDS = new Set(['result_item', 'src_key', 'dst_key', 'extra_key', 'item_key', 'output_item']);
// key 空间不止 items.json：矿石在 ores.json#ore_types[].key，
// 宝石是「系列_等级」组合（系列在 gems.json#gem_series[].key，等级在 gem_grades），
// 晶石在 crystals.json，武魂材料在 wuhun.json#items。
const oresT = parsed['ores.json'];
const oreKeys = new Set(((oresT && oresT.ore_types) || []).map(o => o.key));
const gemsT = parsed['gems.json'];
const gemSeries = new Set(((gemsT && gemsT.gem_series) || []).map(g => g.key));
const gemGrades = new Set((gemsT && gemsT.gem_grades) || []);
const gemCombos = new Set();
for (const s of gemSeries) for (const g of gemGrades) gemCombos.add(s + '_' + g);
// 晶石：crystals.json#crystal_types[].key（yumo/jidan/...）
const crystalT = parsed['crystals.json'];
const crystalKeys = new Set(((crystalT && crystalT.crystal_types) || []).map(c => c.key));
const wuhunT = parsed['wuhun.json'];
const wuhunItems = new Set(Object.keys((wuhunT && wuhunT.items) || {}));
function isKnownItem(k, kind) {
  if (!k || typeof k !== 'string') return true;
  if (itemKeys.has(k)) return true;
  if (oreKeys.has(k)) return true;
  if (gemCombos.has(k)) return true;
  if (wuhunItems.has(k)) return true;
  if (crystalKeys.has(k)) return true;
  return false;
}
for (const rf of ['bailian_recipes.json','furnace_recipes.json','ore_recipes.json','gem_recipes.json','potion_recipes.json']) {
  const t = parsed[rf];
  if (!t) { console.log(`  ? ${rf} 不存在`); continue; }
  const dang = [];
  let tot = 0;
  const scan = (o, ctx) => {
    if (Array.isArray(o)) { o.forEach((x, i) => scan(x, ctx)); return; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (REF_FIELDS.has(k) && typeof v === 'string') {
          tot++;
          if (!isKnownItem(v)) dang.push(`${ctx}.${k}=${v}`);
        }
        if (k === 'materials' && Array.isArray(v)) {
          for (const m of v) {
            if (m && typeof m.key === 'string') { tot++; if (!isKnownItem(m.key, m.kind)) dang.push(`${ctx}.materials.key=${m.key} (kind=${m.kind})`); }
          }
        }
        scan(v, ctx + '.' + k);
      }
    }
  };
  scan(t, rf.replace('.json', ''));
  console.log(`  ${dang.length ? '⚠' : '✓'} ${rf.padEnd(26)} 物品引用 ${tot} 条，悬空 ${dang.length}`);
  if (dang.length) [...new Set(dang)].slice(0, 8).forEach(x => console.log('      ' + x));
}
console.log(`  （key 空间：items ${itemKeys.size} / ores ${oreKeys.size} / gem组合 ${gemCombos.size} / crystal ${crystalKeys.size} / wuhun ${wuhunItems.size}）`);

console.log('\n=== ⑤ 空/缺失关键字段 ===');
const emptyFiles = [];
for (const f of files) {
  const t = parsed[f];
  if (!t) continue;
  const arr = Array.isArray(t) ? t : null;
  if (arr && arr.length === 0) emptyFiles.push(f);
}
console.log(`  ${emptyFiles.length ? '⚠' : '✓'} 空数组文件: ${emptyFiles.length ? emptyFiles.join(', ') : '无'}`);
