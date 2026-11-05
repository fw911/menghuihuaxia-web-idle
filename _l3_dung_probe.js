/* L3 探针：对 5 个新增高阶副本的第一个首领，在不同等级(+5/+15/+30)测试可击杀性，
   判断是「测试等级/配装假设偏低」还是「确实过强（L4 数值回正范畴）」。 */
const fs = require('fs'), path = require('path');
global.window = global;
global.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, String(u).replace(/^\//, '')), 'utf-8')) });
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() { return { innerHTML: '', textContent: '', value: '', style: {}, onclick: null, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, querySelectorAll: () => [], appendChild(){}, getAttribute: () => null, setAttribute(){}, children: [], querySelector: () => null, parentElement: null }; }
const _els = new Map();
global.document = { getElementById: (id) => { if (!_els.has(id)) _els.set(id, el()); return _els.get(id); }, querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {}; global.confirm = () => true;
require('./_test_entry.mjs');
const E = global.__exp;

const NEW_DUNGEONS = ['guimu_mh','xuanyuantai_mh','xianghunzhong_mh','shihundian','wuxingzhen'];

(async function main() {
  await E.loadData();
  for (const mk of NEW_DUNGEONS) {
    const map = E.mapByKey(mk);
    if (!map || !(map.dungeon_bosses || []).length) { console.log(mk + ' 无副本首领'); continue; }
    const b = E.dungeonBosses(map)[0];
    const baseL = map.enter_level_min || b.level || 100;
    const out = [];
    for (const add of [5, 15, 30]) {
      const L = baseL + add;
      E.newPlayer('probe', 'warrior');
      const q = E.state.player;
      q.level = L; q.gold = 5e6;
      for (const slot of E.HERO_SLOTS) {
        const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
        if (it) { it.job = q.job; q.equip[slot] = it; }
      }
      const per = E.attrPerLevel ? E.attrPerLevel(q.job) : 6;
      const jc = E.DATA.jobs.jobs.find(j => j.key === q.job) || {};
      const total = per * Math.max(0, L - 1);
      const mix = [['strength',0.5],['constitution',0.3],['agility',0.2]];
      q.attr = {};
      for (const [dim, r] of mix) q.attr[dim] = Math.round(total * r);
      q.attr_migrated = true;
      E.refreshStats();
      Object.assign(E.state.auto, { hp: 85, mp: 30, potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
      E.state.speed = 4;
      const entered = E.startZone(map.key, null, true, b.key);
      const d0 = E.state.sess.deaths || 0;
      E.state.combat = null; E.setIdle(true);
      let won = false, rounds = 0;
      const hp0 = Math.round(q._s.max_hp);
      for (; rounds < 3000; rounds++) {
        E.loop();
        const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
        if (mb && mb[b.key]) { won = true; break; }
        if ((E.state.sess.deaths || 0) > d0) break;
      }
      E.setIdle(false);
      out.push('Lv' + L + (won ? ' ✓' : ' ✗') + '(' + rounds + '轮)');
    }
    console.log('  ' + map.name + '「' + b.name + '」 enter_min=' + baseL + '  ' + out.join('  '));
  }
  process.exit(0);
})();
