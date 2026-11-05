/* L4 验证：用真实引擎（已落地的 data/monsters.json）复测 5 张高阶副本首领
   在 entry / entry+5 / entry+10 三档是否可击杀（won=true）且不暴毙。
   用法：node _l4_verify.js */
const fs = require('fs'), path = require('path');
global.window = global;
global.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, String(u).replace(/^\//, '')), 'utf8')) });
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() { return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, querySelectorAll: () => [], appendChild(){}, getAttribute: () => null, setAttribute(){}, children: [], querySelector: () => null, parentElement: null }; }
const _els = new Map();
global.document = { getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); }, querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {}; global.confirm = () => true;
require('./_test_entry.mjs');
const E = global.__exp;

const MIX = [['strength', 0.5], ['constitution', 0.3], ['agility', 0.2]];

function allocPlayer(q, L) {
  for (const slot of E.HERO_SLOTS) {
    const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
    if (it) { it.job = q.job; q.equip[slot] = it; }
  }
  const per = E.attrPerLevel ? E.attrPerLevel(q.job) : 6;
  const total = per * Math.max(0, L - 1);
  q.attr = {};
  for (const [dim, r] of MIX) q.attr[dim] = Math.round(total * r);
  q.attr_migrated = true;
  E.refreshStats();
}

// 真实数据模拟（不覆盖 combatHp）：返回 {won, died, rounds, bossFrac}
function sim(mk, add) {
  const map = E.mapByKey(mk);
  const bossKey = E.dungeonBosses(map)[0].key;
  const baseL = map.enter_level_min || 100;
  const L = baseL + add;
  E.newPlayer('d', 'warrior');
  const q = E.state.player;
  q.level = L; q.gold = 5e6;
  allocPlayer(q, L);
  Object.assign(E.state.auto, { hp: 85, mp: 30, potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
  E.state.speed = 4;
  E.startZone(map.key, null, true, bossKey);
  E.setIdle(true);
  E.loop();                       // 触发战斗生成
  let won = false, died = false, rounds = 1;
  const mc = E.state.combat;
  const combatHpFull = mc.hp;
  for (; rounds < 3000; rounds++) {
    E.loop();
    const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
    if (mb && mb[bossKey]) { won = true; break; }
    if ((E.state.sess.deaths || 0) > 0) { died = true; break; }
  }
  E.setIdle(false);
  const c = E.state.combat;
  const frac = c ? Math.max(0, (c.curHp||0)/(c.hp||1)) : 1;
  return { won, died, rounds, bossFrac: won ? 0 : frac, combatHpFull };
}

(async function () {
  await E.loadData();
  const bosses = [
    { mk: 'guimu_mh', key: 'mh_guimu_30020' },
    { mk: 'xuanyuantai_mh', key: 'mh_xyt_30212' },
    { mk: 'xianghunzhong_mh', key: 'mh_xhz_30807' },
    { mk: 'shihundian', key: 'shd_boss115' },
    { mk: 'wuxingzhen', key: 'wxz_33164' },
  ];
  console.log('=== L4 首领击杀验证（真实 data， warrior 标准配点，上限 3000 轮）===');
  let allok = true;
  for (const b of bosses) {
    const map = E.mapByKey(b.mk);
    const baseL = map.enter_level_min || 100;
    const parts = [];
    for (const add of [0, 5, 10]) {
      const r = sim(b.mk, add);
      const tag = r.died ? 'DIED' : (r.won ? 'WON' : 'TIMEOUT');
      parts.push(`+${add}(L${baseL + add}):${tag}@${r.rounds}轮(剩${(r.bossFrac * 100).toFixed(0)}%)`);
      if (r.died || (!r.won && r.rounds >= 3000)) allok = false;
    }
    const spec = E.dungeonBosses(map)[0];
    console.log(`  ${(spec.name + ' ' + spec.key).padEnd(26)} ${parts.join('  ')}`);
  }
  console.log(allok ? 'RESULT: 全部档位可击杀/未暴毙 ✓' : 'RESULT: 存在不可杀或暴毙 ✗');
  process.exit(0);
})();
