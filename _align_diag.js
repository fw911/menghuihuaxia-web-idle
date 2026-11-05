/* 对齐诊断：怪物技能伤害（原版 skill_damage）vs 改造前自研 mult 口径
 * 用法： node _align_diag.js
 * 依赖：先 python _patch.py 生成 _test_entry.mjs；后端 8014 需启动（仅云存档桩用到）。
 */
const fs = require('fs'), path = require('path');
global.window = global;
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
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [],
    querySelector: () => null, parentElement: null };
}
const _els = new Map();
global.document = { getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); },
  querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_entry.mjs');
const E = global.__exp;

function bossMonster(baseKey, mult) {
  const base = E.getMonster(baseKey);
  const m = Object.assign({}, base);
  m.min_phys_atk = Math.round((m.min_phys_atk || 0) * mult);
  m.max_phys_atk = Math.round((m.max_phys_atk || 0) * mult);
  m.min_magic_atk = Math.round((m.min_magic_atk || 0) * mult);
  m.max_magic_atk = Math.round((m.max_magic_atk || 0) * mult);
  return m;
}
function setupPlayer(L) {
  E.newPlayer('诊断', 'warrior');
  const q = E.state.player;
  q.level = L; q.gold = 500000;
  for (const slot of E.HERO_SLOTS) {
    const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
    if (it) { it.job = q.job; q.equip[slot] = it; }
  }
  const total = (E.attrPerLevel ? E.attrPerLevel(q.job) : 6) * Math.max(0, L - 1);
  q.attr = { strength: Math.round(total * 0.5), constitution: Math.round(total * 0.3), agility: Math.round(total * 0.2) };
  q.attr_migrated = true;
  E.refreshStats();
  return q;
}
function legacyDamage(m, sk, s) {
  const magic = sk && (sk.element === 'magic' || sk.element === 'dark' || sk.element === 'fire' || sk.element === 'elec');
  const mult = sk ? (sk.mult || 1) : 1;
  const lo = magic ? (m.min_magic_atk || m.min_phys_atk || 1) : (m.min_phys_atk || 1);
  const hi = magic ? (m.max_magic_atk || m.max_phys_atk || 1) : (m.max_phys_atk || 1);
  const raw = ((lo + hi) / 2) * mult;
  const def = (magic ? (s.combat.magic_def || 0) : (s.combat.phys_def || 0));
  return Math.max(1, Math.round(raw * raw / Math.max(1, def)));
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

(async function main() {
  await E.loadData();
  const M = await import('./js/main.js');
  const dungs = E.DATA.maps.maps.filter(m => (m.dungeon_bosses || []).length);
  console.log('=== 怪物伤害口径对齐诊断 ===\n');
  for (const map of dungs) {
    const b = E.dungeonBosses(map)[0];
    const L = (map.enter_level_min || 1) + 5;
    const q = setupPlayer(L), s = q._s;
    const m = bossMonster(b.monster || b.key, 1.5);
    const skills = (E.MON_SKILLS[b.monster || b.key] || []).slice(0, 2);
    console.log('【' + map.name + '「' + b.name + '」Lv' + L + '】');
    console.log('  玩家: max_hp=' + s.max_hp + ' 物防=' + Math.round(s.combat.phys_def) + ' 法防=' + Math.round(s.combat.magic_def)
      + ' dodge=' + s.combat.dodge.toFixed(2) + '% 物攻=' + Math.round(s.main));
    console.log('  怪物: 物攻区间 [' + m.min_phys_atk + ',' + m.max_phys_atk + ']  物爆=' + (m.phys_crit || 0) + '%  法爆=' + (m.magic_crit || 0) + '%');
    for (const sk of [null].concat(skills)) {
      const tag = sk ? ('技能 ' + sk.name + '(' + sk.element + ', mult=' + sk.mult + ')') : '普攻';
      const sd = sk ? M.monsterSkillSd(m, sk) : 0;
      const orig = [], leg = [];
      const saved = Math.random;
      // 固定序列：规避暴击/闪避随机，只看基础伤害
      Math.random = () => 0.5;
      for (let i = 0; i < 200; i++) {
        orig.push(M.monsterDamageOrig(m, sk, s, 0).dmg);
        leg.push(legacyDamage(m, sk, s));
      }
      Math.random = saved;
      console.log('  ' + tag + '  sd=' + sd
        + ' | 原版均值 ' + mean(orig).toFixed(0) + ' (min ' + Math.min.apply(null, orig) + ', max ' + Math.max.apply(null, orig) + ')'
        + ' | legacy ' + mean(leg).toFixed(0)
        + ' | 倍数 ' + (mean(orig) / mean(leg)).toFixed(2));
    }
    console.log('');
  }
})().catch(e => { console.error(e); process.exit(1); });
