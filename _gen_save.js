/* 生成一份用于 UI 实拍的存档：北原郡 · 首领区已清剿但未通关（应显示「首通 N金」）。
   用法： node _gen_save.js > _shot_save.json
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
  E.newPlayer('验收', 'warrior');
  const p = E.state.player;
  p.level = 18; p.gold = 60000; p.crystal = 12; p.map = 'beijun';
  const tier = E.tierFromLevel(18);
  for (const s of E.HERO_SLOTS) { const it = E.genEquip(s, p.job, tier, 18); if (it) { it.job = p.job; p.equip[s] = it; } }
  E.refreshStats();
  p.unlocked = p.unlocked || {}; p.unlocked['beijun'] = true;
  p.stats.mapKills = { beijun: 120 };
  p.stats.zoneKills = { beijun: { farm: 35, central: 12, ronglin: 4, zhaohuntai: 0 } };
  p.stats.minionKills = { beijun: { normal: 50, elite: 20 } };   // 已清剿 → 首领现身
  p.stats.mapClear = [];                                          // 未通关 → 应显示首通奖励
  E.state.zone = null;
  process.stdout.write(JSON.stringify(E.buildSavePayload()));
})();
