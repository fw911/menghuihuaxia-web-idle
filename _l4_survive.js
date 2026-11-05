/* L4 续：普通区域挂机生存/产出探针（怪物强度回正前后对比用）
   在指定等级进入对应普通区域挂机 N 轮，统计：死亡次数、经验/金币产出、击杀数。
   用法：node _l4_survive.js */
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
const ROUNDS = 2500;   // 挂机生存测量（长程，看死亡次数）

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

// 在 map 的指定普通区域挂机
function farm(mk, zk, L, job) {
  E.newPlayer('s', job || 'warrior');
  const q = E.state.player;
  q.level = L; q.gold = 5e6;
  allocPlayer(q, L);
  Object.assign(E.state.auto, { hp: 85, mp: 30, potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
  E.state.speed = 4;
  E.state.sess.deaths = 0; E.state.sess.kills = 0; E.state.sess.exp = 0; E.state.sess.gold = 0;
  const entered = E.startZone(mk, zk, false);
  E.setIdle(true);
  for (let i = 0; i < ROUNDS; i++) E.loop();
  E.setIdle(false);
  const s = E.state.sess;
  return { entered, deaths: s.deaths || 0, kills: s.kills || 0, exp: s.exp || 0, gold: s.gold || 0, lvl: q.level };
}

(async function () {
  await E.loadData();
  // (地图 key, 区域 key 或 null=自动选最优普通区, 等级, 职业)
  const CASES = [
    [20, 'warrior'], [40, 'warrior'], [60, 'mage'],
    [60, 'shaman'], [80, 'darkwitch'], [100, 'warrior'],
  ];
  console.log(`=== 普通区挂机探针（每例 ${ROUNDS} 轮）===`);
  for (const [L, job] of CASES) {
    // 跨全部地图自动选「怪物等级差在 [-3,+1]」最贴近角色的普通区
    let mk = null, zoneKey = null, best = null, fb = null;
    for (const m of E.DATA.maps.maps) {
      if (m.is_dungeon || (m.dungeon_bosses || []).length) continue;   // 副本另测
      for (const z of (m.zones || [])) {
        if (!(z.monsters || []).length) continue;
        const lv = E.zoneMonsterAvg((z.monsters || []).concat((z.elite_monsters || []).slice(0, 1)));
        if (!lv || !lv.level) continue;
        const d = lv.level - L;
        if (!fb || Math.abs(d) < Math.abs(fb.d)) fb = { d, mk: m.key, zk: z.key, lv: lv.level };
        if (d < -3 || d > 1) continue;
        if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, mk: m.key, zk: z.key, lv: lv.level };
      }
    }
    const pick = best || fb;
    if (!pick) { console.log(`  L${L} ${job} 无可用普通区`); continue; }
    mk = pick.mk; zoneKey = pick.zk;
    const map = E.mapByKey(mk);
    {
      // 在该图普通区中选「怪物等级差在 [-4,+2]」的最贴近区域
      // （差 < -4 会因 over_low_factor 衰减到 0 经验，测不出战斗强度）
      const cands = (map.zones || []).filter(z => (z.monsters || []).length);
      let best = null, fb = null;
      for (const z of cands) {
        const lv = E.zoneMonsterAvg((z.monsters || []).concat((z.elite_monsters || []).slice(0, 1)));
        if (!lv || !lv.level) continue;
        const d = lv.level - L;
        if (!fb || Math.abs(d) < Math.abs(fb.d)) fb = { d, key: z.key, lv: lv.level };
        if (d < -4 || d > 2) continue;
        if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, key: z.key, lv: lv.level };
      }
      const pick = best || fb;
      if (!pick) { console.log(`  ${map.name} L${L} 无可用普通区`); continue; }
      zoneKey = pick.key;
    }
    const r = farm(mk, zoneKey, L, job);
    console.log(`  ${map.name} L${L} ${job} 区=${zoneKey} 死亡=${r.deaths} 击杀=${r.kills} 经验=${r.exp} 金币=${r.gold} 等级→${r.lvl}`);
  }
  process.exit(0);
})();
