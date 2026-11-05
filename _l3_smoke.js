/* L3 冒烟测试：全量数据下，遍历所有地图/zone 刷怪 + 战役/自动选图逻辑不崩溃。
   复用 _run_test.js 的无头桩（fetch/localStorage/document）。 */
const fs = require('fs'), path = require('path');
global.window = global;
const DIR = path.join(__dirname, 'data');
const realFetch = global.fetch;
const API_ORIGIN = 'http://localhost:8014';
global.fetch = async (u, opts) => {
  const url = String(u);
  if (url.startsWith('/api')) {
    if (!realFetch) throw new Error('no builtin fetch');
    return realFetch(API_ORIGIN + url, opts);
  }
  const f = path.join(__dirname, url.replace(/^\//, ''));
  const txt = fs.readFileSync(f, 'utf-8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() {
  return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [], querySelector: () => null, parentElement: null };
}
const _els = new Map();
global.document = { getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); },
  querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_entry.mjs');
const E = global.__exp;

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
}

const NEW_MAPS = ['haishishenlou_l1','haishishenlou_l2','haishishenlou_l3','haishishenlou_l4','guimu_mh','xuanyuantai_mh','xianghunzhong_mh','shihundian','wuxingzhen','baishougu','qixingling','guihuidaze'];

(async function main() {
  await E.loadData();
  E.newPlayer('冒烟', 'warrior');
  const p = E.state.player;
  const maps = E.DATA.maps.maps;

  console.log('-- 数据计数 --');
  ok('怪物=1536', E.DATA.monsters.monsters.length === 1536, E.DATA.monsters.monsters.length + '');
  ok('物品=354', E.DATA.items.items.length === 354, E.DATA.items.items.length + '');
  ok('地图=56', maps.length === 56, maps.length + '');
  ok('任务=11', Object.keys(E.DATA.quests).length === 11, Object.keys(E.DATA.quests).length + '');
  ok('商店=14', E.DATA.shops.shops.length === 14, E.DATA.shops.shops.length + '');

  console.log('-- 全图刷怪（逐 zone spawnMonster，各 20 次）--');
  let totalZones = 0, totalNull = 0, totalThrow = 0;
  const newMapNull = {};
  for (const m of maps) {
    const zones = m.zones || [];
    for (const z of zones) {
      totalZones++;
      E.state.zone = { mapKey: m.key, zoneKey: z.key, isBoss: false };
      let nulls = 0, throws = 0;
      for (let i = 0; i < 20; i++) {
        try { const mon = E.spawnMonster(); if (!mon) nulls++; }
        catch (e) { throws++; if (throws <= 1) console.log('    THROW ' + m.key + '/' + z.key + ': ' + e.message); }
      }
      totalNull += nulls; totalThrow += throws;
      if (NEW_MAPS.indexOf(m.key) >= 0) newMapNull[m.key] = (newMapNull[m.key] || 0) + nulls;
    }
    // 首领区
    if (m.boss_zone) {
      totalZones++;
      E.state.zone = { mapKey: m.key, zoneKey: null, isBoss: true, bossKey: null };
      let nulls = 0, throws = 0;
      for (let i = 0; i < 20; i++) {
        try { const mon = E.spawnMonster(); if (!mon) nulls++; }
        catch (e) { throws++; if (throws <= 1) console.log('    THROW boss ' + m.key + ': ' + e.message); }
      }
      totalNull += nulls; totalThrow += throws;
    }
    // 副本首领
    for (const db of (m.dungeon_bosses || [])) {
      totalZones++;
      E.state.zone = { mapKey: m.key, zoneKey: null, isBoss: true, bossKey: db.key };
      let nulls = 0, throws = 0;
      for (let i = 0; i < 10; i++) {
        try { const mon = E.spawnMonster(); if (!mon) nulls++; }
        catch (e) { throws++; if (throws <= 1) console.log('    THROW dungeon ' + m.key + '/' + db.key + ': ' + e.message); }
      }
      totalNull += nulls; totalThrow += throws;
    }
  }
  ok('全图刷怪无抛错', totalThrow === 0, 'totalThrow=' + totalThrow);
  console.log('  总 zone 数=' + totalZones + ' 总 null=' + totalNull + ' 总 throw=' + totalThrow);
  // 新图：每个新图的普通 zone 在 20 次抽样中至少刷出过怪（null<20）
  let newOk = true, newDetail = [];
  for (const mk of NEW_MAPS) {
    const zs = (maps.find(m=>m.key===mk).zones||[]).filter(z=>z.monsters||z.elite_monsters).length;
    const n = newMapNull[mk]||0;
    const fine = n < 20 * zs; // 不允许整张图完全刷不出
    if (!fine) { newOk = false; newDetail.push(mk+':null='+n); }
  }
  ok('12 张新图均能刷出怪', newOk, newDetail.join(' '));

  console.log('-- 战役/自动选图逻辑 --');
  let bzThrow = false, ctThrow = false, ctVal = null;
  try { const b = E.bestZone(); if (!b) console.log('   bestZone 返回空（可能因为等级，正常）'); }
  catch (e) { bzThrow = true; console.log('   bestZone THROW: ' + e.message); }
  ok('bestZone 无抛错', !bzThrow);
  try { ctVal = E.campaignTargetMap(); }
  catch (e) { ctThrow = true; console.log('   campaignTargetMap THROW: ' + e.message); }
  ok('campaignTargetMap 无抛错', !ctThrow);
  console.log('   campaignTargetMap -> ' + (ctVal ? ctVal.key + ' (' + ctVal.name + ')' : 'null（全部完成）'));

  console.log('\n' + (fails === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAILED: ' + fails));
  process.exit(fails === 0 ? 0 : 1);
})();
