/* 生成一份「成熟阶段」存档，用于 UI 溢出/子菜单效果量化。
   目的：让 10 个页签里每个都装满真实内容（背包上百件、成就已推进、神魔已加点），
   否则 Lv1 新号的背包/成就面板几乎是空的，量出来的高度毫无参考价值。

   用法： python _patch.py && node _gen_save_full.js > _full_save.json
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
  return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [] };
}
global.document = { getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true; global.setTimeout = () => 0;

require('./_test_game.js');
const E = global.__exp;

(async function main() {
  await E.loadData();
  const LV = 120;                     // 满级：神魔页才会展开技能树（入道需 Lv.101）
  E.newPlayer('测量号', 'warrior');
  const p = E.state.player;
  p.level = LV; p.gold = 800000000; p.crystal = 2500;
  p.map = 'beijun';

  const tier = E.tierFromLevel(LV);
  for (const s of E.HERO_SLOTS) { const it = E.genEquip(s, p.job, tier, LV); if (it) { it.job = p.job; p.equip[s] = it; } }

  // ---- 背包：消耗品全部 + 装备若干 + 宝石/矿石/材料/武魂（贴近真实长局）----
  let uid = 1;
  for (const it of (E.DATA.items.items || [])) {
    p.bag.push({ uid: 'c' + (uid++), type: 'consumable', key: it.key, count: 1 + (uid * 97) % 900 });
  }
  for (let i = 0; i < 22; i++) {
    const it = E.genEquip(E.HERO_SLOTS[i % E.HERO_SLOTS.length], p.job, tier, LV - (i % 5));
    if (it) { it.job = p.job; it.uid = 'e' + (uid++); p.bag.push(it); }
  }
  for (const o of (E.DATA.ores.ore_types || [])) p.ores[o.key] = 40 + (uid * 13) % 300;
  for (const g of (E.DATA.gems.gem_series || [])) {
    for (const gr of (E.DATA.gems.gem_grades || [])) {
      p.bag.push({ uid: 'g' + (uid++), type: 'gem', series: g.key, grade: gr, count: 1 + (uid % 9) });
    }
  }
  for (const m of ['bailian_shi', 'lianhua_ping', 'sanhun_tian', 'qipo_xi', 'lingyin_0', 'lingyin_1', 'lingyin_2']) {
    p.materials[m] = 20 + (uid * 7) % 200;
  }
  // 武魂：结构见 genWuhun() —— 必须带 whType/star/level 才能被 whName/whStatLine 正确渲染
  const whKeys = Object.keys(E.DATA.wuhun.wuhun_types || {});
  whKeys.slice(0, 6).forEach((t, i) => {
    p.bag.push({ uid: 'w' + (uid++), type: 'wuhun', whType: t, star: 2 + (i % 3), level: 3 + i,
      exp: 0, activated: i < 2, actAttr: null, count: 1 });
  });

  // ---- 神魔：已入道并加了若干节点（「神魔」页才有内容）----
  p.shenmo = { faction: 'shen', level: 12, exp: 400, spent: 6, points: 3, nodes: {}, cd: {} };
  const smSkills = (E.DATA.shenmo_skills && (E.DATA.shenmo_skills.skills || [])) || [];
  smSkills.slice(0, 8).forEach(n => { if (n && n.key) p.shenmo.nodes[n.key] = 1; });

  // ---- 技能 / 被动：按等级自动学会 ----
  E.syncSkills();

  // ---- 进度类状态：解锁多张图、通关若干、探索/清剿有进度、成就已达成一部分 ----
  const maps = (E.DATA.maps.maps || []);
  maps.forEach(m => { p.unlocked[m.key] = true; });
  p.stats.mapKills = {}; p.stats.zoneKills = {}; p.stats.minionKills = {}; p.stats.mapBoss = {};
  maps.slice(0, 14).forEach((m, i) => {
    p.stats.mapKills[m.key] = 500 + i * 137;
    const zk = {}; (m.zones || []).forEach((z, j) => { zk[z.key] = 40 + j * 9; });
    p.stats.zoneKills[m.key] = zk;
    if (i % 3 === 0) p.stats.mapClear.push(m.key);
    if (m.boss_zone) p.stats.minionKills[m.key] = { normal: 60, elite: 25 };
  });
  p.stats.kills = 48210;
  p.stats.killType = { '蜘蛛': 3521, '熊': 5281, '虎': 0, '蝎': 900, '鬼': 0, '厉角': 2126, '延维': 0, '青依': 0, '赤社': 15116, '山膏': 12170 };
  p.stats.refine7 = 12; p.stats.craftCount = 61; p.stats.crystalTotal = 480;
  p.stats.dungeonEnter = { guimu: { d: E.todayKey(), n: 1 } };

  // 成就：把前 72 条标记为已完成（成就面板与称号面板都会有内容）
  p.ach = {};
  (E.achList() || []).slice(0, 72).forEach(a => { p.ach[a.key] = 1; });

  E.refreshStats();
  p.hp = p._s.max_hp; p.mp = p._s.max_mp;
  E.state.zone = null;
  process.stdout.write(JSON.stringify(E.buildSavePayload()));
})();
