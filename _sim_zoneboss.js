/* 野外首领区可打性探针：手动进入首领区（先预填清剿额度），带装走真实 loop，看能否击杀首领并通关。
   目的：回答「18 条『XX通关』成就到底是死内容，还是只是自动换区不选它」。
   —— 因为 _probe_zones.js 已证明 bestZone() 在 Lv1~120 从不选首领区；本探针测「玩家手动点进去能否通关」。
   用法： node _sim_zoneboss.js [最大轮数]
*/
const fs = require('fs'), path = require('path');
global.window = global;

global.fetch = async (u) => {
  const f = path.join(__dirname, String(u).replace(/^\//, ''));
  return { json: async () => JSON.parse(fs.readFileSync(f, 'utf-8')) };
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [],
  };
}
global.document = { getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;
global.setTimeout = () => 0;

const MAXROUNDS = parseInt(process.argv[2] || '6000', 10);
require('./_test_game.js');
const E = global.__exp;
const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };

// 按等级给一套齐装（模拟玩家正常配装）——不配装会把首领显得过于变态
function gearUp(p, L) {
  const tier = E.tierFromLevel(L);
  for (const slot of E.HERO_SLOTS) {
    const it = E.genEquip(slot, p.job, tier, L);
    if (it) { it.job = p.job; p.equip[slot] = it; }
  }
  E.refreshStats();
}

// 单场：手动进首领区，先看「清剿阶段」要多久，再看「首领能否击杀」
function runOne(map, bz, L) {
  E.newPlayer('探针', 'warrior');
  const p = E.state.player;
  p.level = L; p.gold = 500000; gearUp(p, L);
  Object.assign(E.state.auto, { potion: true, zone: false, junk: true, buy: true, stats: false, rank: false });
  E.state.speed = 4;

  const mt = E.bossMinionTarget(map) || { normal: 0, elite: 0 };
  const hp0 = p._s.max_hp;
  const dps0 = Math.round(E.playerDps());

  // ---- 阶段 1：未清剿，直接进首领区（应在打小怪、不出首领）----
  if (!E.startZone(map.key, bz.key, true)) return { ok: false };
  E.setIdle(true);
  const d0 = E.state.sess.deaths || 0;
  let r1 = 0, clearedRound = -1, diedEarly = false, bossLeaked = false;
  const needN = mt.normal, needE = mt.elite;
  while (r1 < MAXROUNDS) {
    E.loop(); r1++;
    const cn = E.minionKillCount(map.key, 'normal'), ce = E.minionKillCount(map.key, 'elite');
    // 清剿尚未达成时，绝不该出现首领（isBoss 战斗）
    if (!E.bossZoneCleared(map)) {
      if (E.state.combat && E.state.combat.m && E.state.combat.m.isBoss) bossLeaked = true;
    } else { clearedRound = r1; break; }
    if ((E.state.sess.deaths || 0) > d0) { diedEarly = true; break; }
  }
  const cn1 = E.minionKillCount(map.key, 'normal'), ce1 = E.minionKillCount(map.key, 'elite');

  // ---- 阶段 2：清剿完成后继续挂，看首领能否击杀 / 能否通关 ----
  let r2 = 0, won = false, died = false;
  const d1 = E.state.sess.deaths || 0;
  let bossHp = 0, bossAtk = 0;
  while (r2 < MAXROUNDS) {
    E.loop(); r2++;
    const c = E.state.combat;
    if (c && c.m && c.m.isBoss && !bossHp) { bossHp = c.m.max_hp || c.m.hp; bossAtk = c.m.max_phys_atk; }
    if ((p.stats.mapClear || []).indexOf(map.key) >= 0) { won = true; break; }
    if ((E.state.sess.deaths || 0) > d1) { died = true; break; }
  }
  return {
    ok: true, L, hp0, dps0, needN, needE, cn1, ce1, bossHp, bossAtk,
    r1, r2, clearedRound, diedEarly, bossLeaked, won, died,
    timeout: !won && !died, sec: (r1 + r2) * 0.7,
  };
}

(async function main() {
  await E.loadData();

  const maps = E.DATA.maps.maps.filter(m => m.boss_zone && !m.is_dungeon);
  console.log('================ 野外首领区可打性探针 ================');
  console.log('装等：按角色等级配齐装；先预清剿额度验证不变量，再测首领击杀。最多 ' + MAXROUNDS + ' 轮/阶段');
  console.log('地图总数（含首领区）：' + maps.length);
  console.log('');

  const rows = [];
  let leak = 0;
  for (const map of maps.slice(0, 12)) {
    const bz = map.boss_zone;
    const gate = bz.unlock_level || 1;
    for (const off of [0, 5]) {
      const r = runOne(map, bz, gate + off);
      if (!r.ok) { console.log('  !! ' + map.name + ' 无法进入首领区'); continue; }
      r.map = map.name; r.zone = bz.name;
      rows.push(r);
      if (r.bossLeaked) leak++;
      console.log('  ' + (r.won ? '✔' : (r.died || r.diedEarly ? '✖' : '…')) + ' ' +
        pad(map.name + '·' + bz.name, 18) + pad('Lv' + r.L, 6) +
        '我HP=' + pad(r.hp0, 6) + ' 我DPS≈' + pad(r.dps0, 5) +
        ' 清剿(' + pad(r.cn1 + '/' + r.needN + '·' + r.ce1 + '/' + r.needE, 11) + ')' +
        ' 首领HP=' + pad(r.bossHp || '-', 8) + ' 攻=' + pad(r.bossAtk || '-', 6) +
        ' → ' + (r.won ? '通关成功' : (r.died || r.diedEarly ? '被击败' : '超时未决')) +
        '  (清剿' + r.r1 + '轮 + 首领' + r.r2 + '轮 ≈ ' + (r.sec / 60).toFixed(1) + 'min)');
    }
  }

  console.log('');
  console.log('================ 汇总 ================');
  console.log('共 ' + rows.length + ' 场：通关 ' + rows.filter(r => r.won).length +
    '，被击败 ' + rows.filter(r => r.died || r.diedEarly).length +
    '，超时 ' + rows.filter(r => r.timeout).length);
  console.log('不变量检查：清剿未满时泄漏首领的战斗数 = ' + leak +
    (leak === 0 ? '  ✔（清剿门有效）' : '  ✖（清剿门失效！）'));
  console.log('');
  console.log('明细（xN = 首领HP / 我HP 倍率；清剿轮/首领轮均为 0.7s 真实时间）');
  console.log('  地图·首领区          等级   结果    我HP   首领HP         x     清剿轮  首领轮');
  for (const r of rows) {
    console.log('  ' + pad(r.map + '·' + r.zone, 20) + pad('Lv' + r.L, 7) +
      pad(r.won ? '✔通关' : (r.died || r.diedEarly ? '✖败' : '…超时'), 8) +
      pad(r.hp0, 7) + pad(r.bossHp || '-', 12) +
      pad(r.bossHp ? 'x' + (r.bossHp / Math.max(1, r.hp0)).toFixed(0) : '-', 7) +
      pad(r.r1, 8) + r.r2);
  }
})();
