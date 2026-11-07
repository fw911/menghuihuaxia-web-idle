// 深度检查 4：运行时链路完整性
//  ① 真实浏览器式启动：loadData → DATA 61 表全部加载成功
//  ② 引擎实际消费的关键数据字段是否非空
//  ③ 关键 API 在真实数据下可调用（冒烟）
//  ④ 存档/读档往返
//  ⑤ 战斗循环长时稳定性
const fs = require('fs'), path = require('path');
global.window = global;
const DIR = path.join(__dirname, 'data');
const realFetch = global.fetch;
global.fetch = async (u, opts) => {
  const url = String(u);
  if (url.startsWith('/api')) return realFetch('http://localhost:8014' + url, opts);
  const f = path.join(__dirname, url.replace(/^\//, ''));
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf-8')) };
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() {
  return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [],
    querySelector: () => null, parentElement: null };
}
const _els = new Map();
global.document = { getElementById: id => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); },
  querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_entry.mjs');
const E = global.__exp;

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '  << ' + x : '')); } };

(async () => {
  console.log('=== ① 数据加载 ===');
  await E.loadData();
  const declared = (fs.readFileSync(path.join(__dirname, 'js/state.js'), 'utf-8')
    .match(/export const DATA_FILES = \[([\s\S]*?)\]/)[1].match(/'([^']+)'/g) || []).length;
  let loaded = 0, missing = [];
  for (const t of ['maps','monsters','items','jobs','skills_passive','shops','quests','achievements',
                   'loot_pools','loot_rules','monster_loot_built','difficulty','summons','companion']) {
    if (t === 'companion') continue;  // 未在 DATA_FILES，属已知未移植
    if (E.DATA[t]) loaded++; else missing.push(t);
  }
  ok('关键数据表加载成功', missing.length === 0, missing.join(','));
  ok(`DATA_FILES 声明 ${declared} 张，实际 DATA 键 ${Object.keys(E.DATA).length} 个`, Object.keys(E.DATA).length >= declared);
  ok('monsters 已加载', (E.DATA.monsters.monsters || []).length === 1536, String((E.DATA.monsters.monsters||[]).length));
  ok('items 已加载', (E.DATA.items.items || []).length === 357);
  ok('loot_pools 已加载', Object.keys(E.DATA.loot_pools || {}).filter(k=>k!=='_meta').length > 0);
  ok('monster_loot_built 已加载', Object.keys(E.DATA.monster_loot_built || {}).length === 1536);
  ok('difficulty 已加载', !!E.DATA.difficulty);

  console.log('\n=== ② 关键引擎索引构建 ===');
  ok('MONSTERS 索引非空', Object.keys(E.MONSTERS).length > 1000, String(Object.keys(E.MONSTERS).length));
  ok('MON_SKILLS 索引非空', Object.keys(E.MON_SKILLS).length > 100, String(Object.keys(E.MON_SKILLS).length));
  ok('LOOT 合并表非空', Object.keys(E.LOOT).length > 0, String(Object.keys(E.LOOT).length));
  ok('LOOT_BUILT 已装配', Object.keys(E.LOOT_BUILT).length === 1536, String(Object.keys(E.LOOT_BUILT).length));
  ok('DROP_ITEM_OK 非空', E.DROP_ITEM_OK.size > 300, String(E.DROP_ITEM_OK.size));

  console.log('\n=== ③ 关键 API 冒烟（真实数据）===');
  E.newPlayer('深度检查', 'warrior');
  const p = E.state.player; p.level = 30; E.refreshStats();
  ok('newPlayer + refreshStats 正常', !!p._s && p._s.max_hp > 0, 'hp=' + (p._s && p._s.max_hp));
  ok('五维基线 = base+growth×29', Math.abs(p._s.attr.strength - (20 + 2.5*29)) < 1e-9, String(p._s.attr.strength));
  ok('attrPerLevel = 6', E.attrPerLevel('warrior') === 6);
  ok('Lv30 可分配点数 = 174', E.attrPointsTotal(p) === 174, String(E.attrPointsTotal(p)));

  const eq = E.genEquip('weapon', 'warrior', E.tierFromLevel(30), 30);
  ok('genEquip 生成装备', !!eq && !!eq.slot, JSON.stringify(eq && eq.slot));
  const built = E.buildEquip(E.DATA.bases_warrior.weapons[0], 'warrior', 3, 'weapon');
  ok('buildEquip 产出 1..8 档', built && built.tier >= 1 && built.tier <= 8, 'tier=' + (built && built.tier));

  console.log('\n=== ④ 掉落链路冒烟 ===');
  const m = E.getMonster('canxuedaoke38');
  ok('getMonster 可取', !!m, 'canxuedaoke38');
  let got = null;
  for (let i = 0; i < 200 && !got; i++) {
    const d = E.rollLoot(m, p);
    if (d && d.length) got = d;
  }
  ok('rollLoot 200 次内产出掉落', !!got, got ? JSON.stringify(got.slice(0,2)) : '无产出');

  console.log('\n=== ⑤ 存档/读档往返 ===');
  E.allocAttr(p, 'strength', 5);
  const pay = E.buildSavePayload();
  ok('buildSavePayload 含 attr', pay.attr && pay.attr.strength === 5, JSON.stringify(pay.attr));
  E.applySavePayload(JSON.parse(JSON.stringify(pay)));
  ok('读档还原加点', E.state.player.attr.strength === 5, String(E.state.player.attr.strength));

  console.log('\n=== ⑥ 战斗循环稳定性（300 轮挂机）===');
  E.state.speed = 4;
  const maps = E.DATA.maps.maps;
  const target = maps.find(x => x.zones && x.zones.length) || maps[0];
  let err = null;
  try {
    E.startZone(target.key, null, true, (target.zones[0]||{}).key);
    for (let i = 0; i < 300; i++) E.tick();
  } catch (e) { err = e; }
  ok('300 轮挂机无异常', !err, err && (err.message + ' @ ' + (err.stack||'').split('\n')[1]));
  ok('挂机有产出', E.state.player.exp > 0 || E.state.player.gold > 0,
     'exp=' + E.state.player.exp + ' gold=' + E.state.player.gold);

  console.log('\n' + (fails === 0 ? 'RUNTIME ALL PASS' : 'RUNTIME FAILED: ' + fails));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(2); });
