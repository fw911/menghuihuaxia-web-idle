/* 副本首领可打性探针：走真实 loop()（含自动喝药/自动补给），测每个副本首领在推荐等级附近能否击杀。
   用法： node _sim_boss.js [最大轮数]
   装等：按角色等级用 genEquip 生成一套齐装（模拟玩家正常配装），否则 Lv1 新手装会让首领显得过于变态。
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

const MAXROUNDS = parseInt(process.argv[2] || '4000', 10);
require('./_test_game.js');
const E = global.__exp;

// 按等级给一套齐装（模拟玩家正常配装）
function gearUp(p, L) {
  const tier = E.tierFromLevel(L);
  for (const slot of E.HERO_SLOTS) {
    const it = E.genEquip(slot, p.job, tier, L);
    if (it) { it.job = p.job; p.equip[slot] = it; }
  }
  E.refreshStats();
}

(async function main() {
  await E.loadData();

  const dungeons = E.DATA.maps.maps.filter(m => (m.dungeon_bosses || []).length);
  console.log('================ 副本首领可打性探针 ================');
  console.log('装等：按角色等级生成一套齐装；自动喝药 + 自动补给开启；最多 ' + MAXROUNDS + ' 轮');
  console.log('');

  const rows = [];
  for (const map of dungeons) {
    console.log('### ' + map.name + '（enter_level_min=' + (map.enter_level_min || 0) + '）');
    for (const b of E.dungeonBosses(map)) {
      const base = E.MONSTERS[b.monster] || {};
      for (const off of [0, 5, 10]) {
        const L = Math.max(1, (map.enter_level_min || 1) + off);
        E.newPlayer('探针', 'warrior');
        const p = E.state.player;
        p.level = L; p.gold = 500000; gearUp(p, L);
        Object.assign(E.state.auto, { potion: true, zone: false, junk: true, buy: true, stats: false, rank: false });
        E.state.speed = 4;

        const ok = E.startZone(map.key, null, true, b.key);
        if (!ok) { console.log('   !! 无法进入 ' + b.name); continue; }

        const d0 = E.state.sess.deaths || 0;
        const hp0 = p._s.max_hp;
        const dps0 = E.playerDps ? Math.round(E.playerDps()) : 0;
        // 记录首领实际血量
        const spawned = E.spawnMonster();
        const bossHp = spawned ? spawned.hp : 0;
        const bossAtk = spawned ? spawned.max_phys_atk : 0;
        E.state.combat = null;
        E.setIdle(true);

        let rounds = 0, won = false, died = false;
        for (; rounds < MAXROUNDS; rounds++) {
          E.loop();
          const mb = p.stats.mapBoss && p.stats.mapBoss[map.key];
          if (mb && mb[b.key]) { won = true; rounds++; break; }
          if ((E.state.sess.deaths || 0) > d0) { died = true; rounds++; break; }
        }
        rows.push({ map: map.name, boss: b.name, L, hp0, dps0, bossHp, bossAtk, won, died, rounds,
          sec: rounds * 0.7, timeout: !won && !died });
        const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
        console.log('   ' + (won ? '✔' : (died ? '✖' : '…')) + ' ' + pad(b.name, 14) +
          'Lv' + pad(L, 4) + ' 我HP=' + pad(hp0, 6) + ' 我DPS≈' + pad(dps0, 5) +
          ' 首领HP=' + pad(bossHp, 8) + ' 首领攻=' + pad(bossAtk, 6) + ' → ' +
          (won ? '击杀成功' : (died ? '被击败' : '超时未决')) + '  (' + rounds + ' 轮 ≈ ' +
          (rounds * 0.7 / 60).toFixed(1) + 'min)');
      }
    }
    console.log('');
  }

  const win = rows.filter(r => r.won).length;
  console.log('================ 汇总 ================');
  console.log('共 ' + rows.length + ' 场：击杀成功 ' + win + '，被击败 ' + rows.filter(r => r.died).length +
    '，超时 ' + rows.filter(r => r.timeout).length);
  console.log('');

  // ---- 对照组：不配装（只有 newPlayer 给的新手装）----
  // 用来量化「装备」对首领战胜负的影响，避免把「没穿装备」误判成「首领数值变态」
  console.log('---- 对照：裸装（仅新手装）挑战每个副本的第一个首领 ----');
  for (const map of dungeons) {
    const b = E.dungeonBosses(map)[0];
    const L = map.enter_level_min || 1;
    E.newPlayer('裸装', 'warrior');
    const p = E.state.player;
    p.level = L; p.gold = 500000; E.refreshStats();     // 不调 gearUp
    Object.assign(E.state.auto, { potion: true, zone: false, junk: true, buy: true, stats: false, rank: false });
    E.state.speed = 4;
    if (!E.startZone(map.key, null, true, b.key)) continue;
    const d0 = E.state.sess.deaths || 0;
    const hp0 = p._s.max_hp;
    E.state.combat = null; E.setIdle(true);
    let rounds = 0, won = false, died = false;
    for (; rounds < MAXROUNDS; rounds++) {
      E.loop();
      const mb = p.stats.mapBoss && p.stats.mapBoss[map.key];
      if (mb && mb[b.key]) { won = true; rounds++; break; }
      if ((E.state.sess.deaths || 0) > d0) { died = true; rounds++; break; }
    }
    console.log('  ' + map.name + ' / ' + b.name + '  Lv' + L + '  我HP=' + hp0 +
      '  →  ' + (won ? '击杀成功' : (died ? '被击败（' + rounds + ' 轮）' : '超时未决')));
  }
  console.log('');
  console.log('明细（每个首领按「刚到门槛等级 / +5 / +10」三档；xN = 首领HP/我HP 的倍率）：');
  console.log('  地图       首领        等级   结果    我HP   首领HP        x     我DPS   轮数');
  for (const r of rows) {
    const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); };
    console.log('  ' + pad(r.map, 10) + pad(r.boss, 12) + pad('Lv' + r.L, 7) +
      pad(r.won ? '✔胜' : (r.died ? '✖败' : '…超时'), 8) +
      pad(r.hp0, 7) + pad(r.bossHp, 12) + pad('x' + (r.bossHp / Math.max(1, r.hp0)).toFixed(0), 7) +
      pad(r.dps0, 7) + r.rounds);
  }
})();
