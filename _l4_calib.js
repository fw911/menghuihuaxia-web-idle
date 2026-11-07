/* L4 校准：用真实引擎测量 5 张高阶副本首领在 entry+5 级的有效 DPS，
   反推「约 1950 轮可击杀」所需的 data hp（含 ×1.3 首领倍率）。

   重要：以 v0.91 原始怪物表（../放置归墟_v0.91_decrypted/monsters.json）为基准，
   直接按 原始值×系数 设置战斗中的 def/atk —— 不可从实时怪物读取后再缩放，
   否则会把已下调过的数值二次缩放，导致 DPS 被高估。

   用法：node _l4_calib.js */
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
const TARGET_ROUNDS = 1950;
const COMBAT_HP_SCALE = 1.3;      // 引擎把 data hp 放大 1.3 作为战斗血量
const ORIG_REF = path.join(__dirname, '..', '放置归墟_v0.91_decrypted', 'monsters.json');

// v0.91 原始怪物表
const ORIG = {};
{
  const raw = JSON.parse(fs.readFileSync(ORIG_REF, 'utf8'));
  const ms = Array.isArray(raw) ? raw : raw.monsters;
  for (const m of ms) ORIG[m.key] = m;
}

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

// 模拟：把战斗怪物的 def/atk 直接设为「原始值×系数」，用小血量测真实 DPS
// 注意：map.dungeon_bosses[i] 是 spec，spec.key 用于进入副本，spec.monster 才是 monsters.json 的 key
function sim(mk, bossSpecKey, add, trialCombatHp, defScale, atkScale) {
  const map = E.mapByKey(mk);
  const spec = E.dungeonBosses(map).find(b => b.key === bossSpecKey);
  const monsterKey = spec && spec.monster;
  const L = (map.enter_level_min || 100) + add;
  E.newPlayer('d', 'warrior');
  const q = E.state.player;
  q.level = L; q.gold = 5e6;
  allocPlayer(q, L);
  Object.assign(E.state.auto, { hp: 85, mp: 30, potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
  E.state.speed = 4;
  E.startZone(map.key, null, true, bossSpecKey);
  E.setIdle(true);
  E.loop();                       // 触发战斗生成
  let won = false, died = false, rounds = 1;
  const mc = E.state.combat;
  const o = ORIG[monsterKey];
  if (!o) throw new Error('ORIG missing for monster ' + monsterKey);
  mc.hp = trialCombatHp; mc.curHp = trialCombatHp;
  mc.min_phys_def = Math.round(o.min_phys_def * defScale);
  mc.max_phys_def = Math.round(o.max_phys_def * defScale);
  if (o.min_phys_atk != null) mc.min_phys_atk = Math.round(o.min_phys_atk * atkScale);
  if (o.max_phys_atk != null) mc.max_phys_atk = Math.round(o.max_phys_atk * atkScale);
  const hpCombat = mc.hp;
  for (; rounds < 3000; rounds++) {
    E.loop();
    const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
    if (mb && mb[bossSpecKey]) { won = true; break; }
    if ((E.state.sess.deaths || 0) > 0) { died = true; break; }
  }
  E.setIdle(false);
  let dealt;
  if (won) dealt = hpCombat;
  else {
    const c = E.state.combat;
    const frac = c ? Math.max(0, (c.curHp || 0) / (c.hp || 1)) : 1;
    dealt = hpCombat * (1 - frac);
  }
  const dps = rounds > 0 ? dealt / rounds : 0;
  return { won, died, rounds, dps, monsterKey };
}

(async function () {
  await E.loadData();
  const dungeons = ['guimu_mh', 'xuanyuantai_mh', 'xianghunzhong_mh', 'shihundian', 'wuxingzhen'];
  console.log('=== L4 首领校准（entry+5，目标 ~%d 轮；def/atk 以 v0.91 原始值为基准）===', TARGET_ROUNDS);
  const out = {};
  for (const mk of dungeons) {
    const map = E.mapByKey(mk);
    const spec = E.dungeonBosses(map)[0];
    const monsterKey = spec.monster;
    // 五曜真君首关 atk 偏高，按 0.72 缩放以保证 entry+5 不暴毙
    const defScale = 0.7;
    const atkScale = (monsterKey === 'wxz_33164') ? 0.72 : 1.0;
    const trial = 80000;
    const r = sim(mk, spec.key, 5, trial, defScale, atkScale);
    if (r.died) { console.log('%s(%s) 试算暴毙（atkScale=%s 仍不够）', spec.name, monsterKey, atkScale); continue; }
    if (!r.won) { console.log('%s(%s) 试算异常未杀', spec.name, monsterKey); continue; }
    const dps = r.dps;
    const targetCombatHp = Math.round(dps * TARGET_ROUNDS);
    const targetDataHp = Math.round(targetCombatHp / COMBAT_HP_SCALE);
    out[monsterKey] = { hp: targetDataHp, def: [Math.round(ORIG[monsterKey].min_phys_def * defScale), Math.round(ORIG[monsterKey].max_phys_def * defScale)] };
    console.log(`${spec.name}(${monsterKey}) 入口Lv${(map.enter_level_min || 100) + 5} DPS≈${Math.round(dps)}/轮 → 建议 data hp=${targetDataHp}  def=${out[monsterKey].def[0]}~${out[monsterKey].def[1]}`);
  }
  console.log('SUGGEST=' + JSON.stringify(out));
  process.exit(0);
})();
