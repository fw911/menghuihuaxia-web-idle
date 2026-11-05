/* L4 诊断：量化 5 张高阶副本"打不死"的根因（玩家输出不足 vs 首领伤害过高 vs 超时），
   并对比 3 张可击杀副本作为基线，为数值回正提供决策依据。 */
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

function allocPlayer(q, L, mix) {
  for (const slot of E.HERO_SLOTS) {
    const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
    if (it) { it.job = q.job; q.equip[slot] = it; }
  }
  const per = E.attrPerLevel ? E.attrPerLevel(q.job) : 6;
  const total = per * Math.max(0, L - 1);
  q.attr = {};
  for (const [dim, r] of mix) q.attr[dim] = Math.round(total * r);
  q.attr_migrated = true;
  E.refreshStats();
}

function fight(mk, add, mix) {
  const map = E.mapByKey(mk);
  const b = E.dungeonBosses(map)[0];
  const baseL = map.enter_level_min || b.level || 100;
  const L = baseL + add;
  E.newPlayer('d', 'warrior');
  const q = E.state.player;
  q.level = L; q.gold = 5e6;
  allocPlayer(q, L, mix);
  Object.assign(E.state.auto, { hp: 85, mp: 30, potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
  E.state.speed = 4;
  const entered = E.startZone(map.key, null, true, b.key);
  const d0 = E.state.sess.deaths || 0;
  E.state.combat = null; E.setIdle(true);
  let won = false, rounds = 0, died = false;
  let bossMax = null, bossFrac = 1, batkLo = null, batkHi = null, bdef = null;
  for (; rounds < 3000; rounds++) {
    E.loop();
    const m = E.state.combat;
    if (m) {
      if (bossMax === null) { bossMax = m.hp; batkLo = m.min_phys_atk; batkHi = m.max_phys_atk; bdef = m.phys_def; }
      bossFrac = Math.max(0, m.curHp) / m.hp;
    }
    const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
    if (mb && mb[b.key]) { won = true; break; }
    if ((E.state.sess.deaths || 0) > d0) { died = true; break; }
  }
  E.setIdle(false);
  return {
    mk, map: map.name, bname: b.name, baseL, L, entered, won, died, rounds,
    bossMax, bossFrac: won ? 0 : +bossFrac.toFixed(3),
    batkLo, batkHi, bdef,
    php: Math.round(q._s.max_hp), patk: Math.round(q._s.main || 0), pdef: Math.round((q._s.combat && q._s.combat.phys_def) || 0)
  };
}

(async function () {
  await E.loadData();
  const fmt = r => `${r.map}「${r.bname}」ent${r.baseL}→Lv${r.L} | won=${r.won?'Y':'-'} died=${r.died?'Y':'-'} r=${r.rounds} bossHP剩=${r.won?'0':r.bossFrac} | P.HP=${r.php} P.atk=${r.patk} P.def=${r.pdef} | B.atk=${r.batkLo}~${r.batkHi} B.def=${r.bdef} B.hp=${r.bossMax}`;
  console.log('=== 5 高阶副本（失败组，标准配点 50/30/20）===');
  for (const mk of ['guimu_mh', 'xuanyuantai_mh', 'xianghunzhong_mh', 'shihundian', 'wuxingzhen']) {
    for (const add of [5, 15, 30]) console.log('  ' + fmt(fight(mk, add, MIX)));
  }
  console.log('=== 3 可击杀副本（基线，标准配点）===');
  for (const mk of ['xuanyuantai', 'guimu', 'xianghunzhong_instance']) {
    for (const add of [5, 15, 30]) console.log('  ' + fmt(fight(mk, add, MIX)));
  }
  process.exit(0);
})();
