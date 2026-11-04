/* 副本战斗诊断：区分「输出不足」与「生存不足」 */
const fs = require('fs'), path = require('path');
global.window = global;
const DIR = path.join(__dirname, 'data');
const realFetch = global.fetch;
global.fetch = async (u, opts) => {
  const url = String(u);
  if (url.startsWith('/api')) { if (!realFetch) throw new Error('no builtin fetch'); return realFetch('http://localhost:8014' + url, opts); }
  const txt = fs.readFileSync(path.join(__dirname, url.replace(/^\//, '')), 'utf-8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() {
  return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute: () => {}, children: [],
    querySelector: () => null, parentElement: null };
}
const _els = new Map();
global.document = { getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); },
  querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_entry.mjs');
const E = global.__exp;

(async function main() {
  await E.loadData();
  const M = await import('./js/main.js');
  const maps = E.DATA.maps.maps;
  for (const mk of ['xuanyuantai', 'xianghunzhong_instance']) {
    const map = maps.find(m => m.key === mk);
    if (!map) { console.log(mk, '地图未找到'); continue; }
    const b = E.dungeonBosses(map)[0];
    const L = (map.enter_level_min || 1) + 5;
    const mon = E.getMonster(b.monster || b.key);
    if(!mon){ console.log('  首领怪物未找到:', b.monster||b.key); continue; }
    E.newPlayer('打首', 'warrior');
    const q = E.state.player;
    q.level = L; q.gold = 500000;
    for (const slot of E.HERO_SLOTS) {
      const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
      if (it) { it.job = q.job; q.equip[slot] = it; }
    }
    const per = E.attrPerLevel ? E.attrPerLevel(q.job) : 6;
    const total = per * Math.max(0, L - 1);
    q.attr = { strength: Math.round(total * 0.5), constitution: Math.round(total * 0.3), agility: Math.round(total * 0.2) };
    E.refreshStats();
    console.log('\n=== %s（%s）Lv%d ===', map.name, b.name, L);
    console.log('  玩家：物攻 %s 物防 %s 气血 %s 暴击 %s',
      Math.round(q._s.combat.phys_atk || 0), Math.round(q._s.combat.phys_def || 0),
      Math.round(q._s.max_hp), Math.round(q._s.combat.phys_crit || 0));
    console.log('  首领：%s HP %s 物攻 %s 物防 %s',
      mon.name, mon.hp, mon.min_phys_atk, mon.min_phys_def);
    console.log('  倍率：玩家攻/首领HP = %s（每次出手需 %s 次）',
      ((q._s.combat.phys_atk || 0) * (q._s.combat.phys_atk || 0) / Math.max(1, mon.min_phys_def || 1)).toFixed(0),
      (mon.hp / Math.max(1, (q._s.combat.phys_atk || 0) ** 2 / Math.max(1, mon.min_phys_def || 1))).toFixed(0));

    Object.assign(E.state.auto, { potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
    E.state.speed = 4;
    const entered = E.startZone(map.key, null, true, b.key);
    const d0 = E.state.sess.deaths || 0;
    E.state.combat = null; E.setIdle(true);
    let won = false, rounds = 0, deathAt = -1, hpTrace = [];
    const LIMIT = Number(process.env.LIMIT || 1500);
    for (; rounds < LIMIT; rounds++) {
      E.loop();
      if (rounds % 200 === 0) hpTrace.push(Math.round(q.hp) + '/' + Math.round(q._s.max_hp));
      const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
      if (mb && mb[b.key]) { won = true; break; }
      if ((E.state.sess.deaths || 0) > d0) { deathAt = rounds; break; }
    }
    console.log('  结果：entered=%s won=%s rounds=%d 死亡于第%s轮 血量轨迹 %s',
      entered, won, rounds, deathAt, hpTrace.join(' → '));
  }
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
