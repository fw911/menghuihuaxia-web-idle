/* 平衡验证（web-idle 版）：原版口径 vs 现状口径的属性/推进可行性对比
 * 复用 _run_test.js 的 DOM 桩；数据取自本地 data/*.json。
 * 口径说明见 js/core.js 的 BATTLE_ORIG。
 */
const fs = require('fs'), path = require('path');
global.window = global;
const DIR = path.join(__dirname, 'data');
const realFetch = global.fetch;
const API_ORIGIN = 'http://localhost:8014';
global.fetch = async (u, opts) => {
  const url = String(u);
  if (url.startsWith('/api')) { if (!realFetch) throw new Error('no builtin fetch'); return realFetch(API_ORIGIN + url, opts); }
  const f = path.join(__dirname, url.replace(/^\//, ''));
  const txt = fs.readFileSync(f, 'utf-8');
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
global.document = {
  getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); },
  querySelectorAll: () => [], createElement: () => el(), body: el(),
};
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_entry.mjs');
const E = global.__exp;
// main.js 汇总 re-export 全部模块（playerHit / monsterHit / computeStats 都在里面）
let M = null;

const LEVELS = [10, 30, 50, 60, 80, 100];
const SLOTS = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'ring', 'necklace'];

function fiveOrig(job, lv) {          // 原版：base + growth×(lv-1)（零加点）
  const jc = E.DATA.jobs.jobs.find(j => j.key === job);
  const o = {};
  for (const k in jc.base_stats) o[k] = jc.base_stats[k] + (jc.growth[k] || 0) * (lv - 1);
  return o;
}
function fiveAuto(job, lv) {          // 现状：额外 + per_level_points×(lv-1) 自动加到每维
  const jc = E.DATA.jobs.jobs.find(j => j.key === job);
  const o = {};
  for (const k in jc.base_stats) o[k] = jc.base_stats[k] + (jc.growth[k] || 0) * (lv - 1) + jc.per_level_points * (lv - 1);
  return o;
}
function combatFrom(five, job) {       // 五维 → 战斗属性（原版 attribute_effects 口径）
  const jc = E.DATA.jobs.jobs.find(j => j.key === job);
  const eff = jc.attribute_effects || {};
  const c = {};
  for (const a in five) {
    const map = eff[a] || {};
    for (const s in map) c[s] = (c[s] || 0) + Math.trunc(five[a] * map[s]);
  }
  return c;
}
function monAt(lv) {
  const arr = E.MONSTERS;
  const keys = Object.keys(arr);
  for (const k of keys) {
    const m = arr[k];
    if (m && m.type === 'normal' && Number(m.level) === lv) return m;
  }
  return null;
}
function sim(atkStat, defStat, mon, isPlayer) {
  // 单次出手伤害均值（玩家/怪物对打）：返回 [玩家每击伤害, 怪物每击伤害]
  const N = 120;
  const m = Object.assign({}, mon);
  m.curHp = 1e12; m.skills = []; m.skillCd = {};
  let dp = 0;
  for (let i = 0; i < N; i++) {
    m.curHp = 1e12;
    const r = M.playerHit(m);
    dp += r.dmg;
  }
  const fake = { curHp: 1e12, min_phys_def: defStat.phys_def || 1, max_phys_def: defStat.phys_def || 1,
                min_magic_def: defStat.magic_def || 1, max_magic_def: defStat.magic_def || 1, dodge: 0 };
  let dm = 0;
  for (let i = 0; i < N; i++) {
    const before = fake.curHp;
    E.state.player.hp = 1e9;
    M.monsterHit(fake);
    dm += (1e9 - E.state.player.hp);
  }
  return [dp / N, dm / N];
}

(async function main() {
  await E.loadData();
  M = await import('./js/main.js');
  console.log('== ① 五维/战斗属性：现状口径 vs 原版零加点口径（战士）==');
  console.log('Lv    五维(现状)      五维(原版)      物攻(现状)  物攻(原版)  气血(现状)  气血(原版)');
  for (const lv of LEVELS) {
    const a = fiveAuto('warrior', lv), o = fiveOrig('warrior', lv);
    const ca = combatFrom(a, 'warrior'), co = combatFrom(o, 'warrior');
    const hpA = Math.round((ca.max_hp || 100) + 100), hpO = Math.round((co.max_hp || 100) + 100);
    console.log('%s  %s  %s  %s  %s  %s  %s', String(lv).padEnd(5),
      `力${Math.round(a.strength)}/敏${Math.round(a.agility)}/体${Math.round(a.constitution)}`.padEnd(15),
      `力${Math.round(o.strength)}/敏${Math.round(o.agility)}/体${Math.round(o.constitution)}`.padEnd(15),
      String(Math.round(ca.phys_atk || 0)).padEnd(11), String(Math.round(co.phys_atk || 0)).padEnd(11),
      String(hpA).padEnd(11), String(hpO).padEnd(11));
  }

  console.log('\n== ② 同级对抗（现状属性口径，玩家裸装 vs 同级怪）==');
  console.log('Lv    怪物      玩家物攻  怪血量   玩家每次伤害  需出手数  玩家能挨   胜率判定');
  for (const lv of LEVELS) {
    const mon = monAt(lv);
    if (!mon) { console.log(lv, '（无同级怪）'); continue; }
    E.newPlayer('测试', 'warrior');
    const p = E.state.player;
    p.level = lv;
    E.refreshStats();
    const s = E.state.player._s;
    const [dp, dm] = sim(s.combat, { phys_def: s.combat.phys_def, magic_def: s.combat.magic_def }, mon);
    const need = mon.hp / Math.max(1, dp);
    const canTake = s.max_hp / Math.max(1, dm);
    console.log('%s  %s  %s  %s  %s  %s  %s  %s', String(lv).padEnd(5),
      String(mon.name).padEnd(9), String(Math.round(s.combat.phys_atk || 0)).padEnd(9),
      String(mon.hp).padEnd(8), dp.toFixed(1).padEnd(12), need.toFixed(1).padEnd(9),
      canTake.toFixed(1).padEnd(10), canTake >= need ? '胜' : '败');
  }

  console.log('\n== ③ 加成来源（现状口径下五维自动加点贡献了多少）==');
  for (const lv of [30, 60, 100]) {
    const a = fiveAuto('warrior', lv), o = fiveOrig('warrior', lv);
    const ca = combatFrom(a, 'warrior'), co = combatFrom(o, 'warrior');
    console.log('  Lv' + String(lv).padEnd(4) + ' 物攻 %s → %s（×%s）  气血 %s → %s（×%s）', Math.round(co.phys_atk || 0), Math.round(ca.phys_atk || 0),
      ((ca.phys_atk || 1) / (co.phys_atk || 1)).toFixed(2),
      Math.round((co.max_hp || 100) + 100), Math.round((ca.max_hp || 100) + 100),
      ((ca.max_hp || 1) / ((co.max_hp || 1) + 1)).toFixed(2));
  }
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
