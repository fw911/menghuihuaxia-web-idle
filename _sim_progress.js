/* 全等级段推进模拟：用真实 loop()/tick() 跑挂机，记录每级的真实耗时。
   用法： node _sim_progress.js [最大loop轮数] [职业]
   1 次 loop = setInterval(loop,700) 的 700ms 真实时间；state.speed 决定内部 tick 次数。
   => 真实秒数 = loop轮数 * 0.7
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
const realSetTimeout = global.setTimeout;
global.setTimeout = () => 0;          // 让升级触发的异步换区不参与（maybeAutoZone 每轮已覆盖）

// SIM_SEED=12345 → 用确定性随机数替换 Math.random。
// 挂机推进对装备掉落极敏感（重尾分布），同一份代码无种子跑两次可能差 50%+，
// 跨版本 A/B 对比会被随机性淹没 —— 做「改前 vs 改后」时必须带同一个种子。
// （不设 SIM_SEED 时保持真随机，用于看分布范围。）
if (process.env.SIM_SEED) {
  let _sd = (parseInt(process.env.SIM_SEED, 10) || 1) >>> 0;
  Math.random = function () { _sd = (_sd * 1664525 + 1013904223) >>> 0; return _sd / 4294967296; };
  console.log('[确定性] SIM_SEED=' + process.env.SIM_SEED);
}

const MAXLOOP = parseInt(process.argv[2] || '400000', 10);
const JOB = process.argv[3] || 'warrior';
const SEC_PER_LOOP = 0.7;

require('./_test_game.js');
const E = global.__exp;

function fmtSec(s) {
  if (s < 60) return s.toFixed(0) + 's';
  if (s < 3600) return (s / 60).toFixed(1) + 'min';
  if (s < 86400) return (s / 3600).toFixed(2) + 'h';
  return (s / 86400).toFixed(2) + 'd';
}

(async function main() {
  await E.loadData();
  E.newPlayer('模拟', JOB);
  const p = E.state.player;

  // 全自动：喝药 / 换区 / 分解 / 关掉需要后端的上报与排行
  Object.assign(E.state.auto, { potion: true, zone: true, junk: true, stats: false, rank: false });
  E.state.speed = 4;                 // 满速（每 loop 4 tick）

  const m0 = E.DATA.maps.maps[0];
  E.startZone(m0.key, m0.zones[0].key, false);
  E.setIdle(true);

  const marks = [];                  // {level, loop, sec}
  let lastLv = p.level, died = 0, i = 0;
  const t0 = Date.now();
  const hpHist = [];

  for (i = 0; i < MAXLOOP; i++) {
    try { E.loop(); } catch (e) { console.log('!! loop 抛异常 @' + i + ': ' + e.message); break; }
    if (p.level > lastLv) {
      for (let L = lastLv + 1; L <= p.level; L++) {
        marks.push({ level: L, loop: i + 1, sec: (i + 1) * SEC_PER_LOOP, gold: p.gold, power: E.powerScore(p) });
      }
      lastLv = p.level;
    }
    if (p.hp <= 0) died++;
    if (i % 500 === 0) hpHist.push(p.hp / Math.max(1, p._s.max_hp));
    if (p.level >= 120) { i++; break; }
  }

  const wall = (Date.now() - t0) / 1000;

  console.log('================ 全等级段推进模拟 ================');
  console.log('职业 ' + JOB + ' | 跑了 ' + i + ' 轮 loop | 折算游戏时长 ' + fmtSec(i * SEC_PER_LOOP) +
    ' | 实跑耗时 ' + wall.toFixed(1) + 's');
  console.log('最终：Lv' + p.level + '  金币 ' + p.gold + '  战力 ' + E.powerScore(p) +
    '  死亡次数 ' + died + '  当前区 ' + (E.state.zone ? (E.state.zone.mapKey + '/' + (E.state.zone.zoneKey || '首领')) : '无'));
  console.log('解锁地图数 ' + Object.keys(p.unlocked || {}).length);
  console.log('');
  console.log('等级   累计loop    累计时长    本级耗时     本级loop          金币       战力');
  let prev = { loop: 0, sec: 0, gold: 0 };
  for (const m of marks) {
    const dLoop = m.loop - prev.loop;
    // 抽样打印：每级都打太密，按 5 级或跨度打印
    if (m.level <= 20 || m.level % 5 === 0 || m.level >= 115) {
      console.log(String(m.level).padStart(4) + String(m.loop).padStart(12) +
        fmtSec(m.sec).padStart(12) + fmtSec(dLoop * SEC_PER_LOOP).padStart(12) +
        String(dLoop).padStart(11) + String(m.gold == null ? '' : m.gold).padStart(14) +
        String(m.power == null ? '' : m.power).padStart(11));
    }
    prev = m;
  }
  console.log('');
  // 分段汇总
  const stages = [[1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 80], [80, 100], [100, 120]];
  console.log('分段耗时汇总：');
  for (const [a, b] of stages) {
    const ma = marks.find(x => x.level === a), mb = marks.find(x => x.level === b);
    if (!ma || !mb) { console.log('  Lv' + a + '~' + b + ' : 未到达'); continue; }
    const d = (mb.sec - ma.sec);
    console.log('  Lv' + String(a).padStart(3) + '~' + String(b).padEnd(3) + ' : ' +
      fmtSec(d).padStart(10) + '   (' + (mb.loop - ma.loop) + ' loop, 均 ' +
      (d / (b - a)).toFixed(0) + 's/级)');
  }
  console.log('');
  // 找最慢的 5 级
  const per = [];
  prev = { loop: 0, sec: 0, level: 0 };
  for (const m of marks) { per.push({ level: m.level, sec: (m.loop - prev.loop) * SEC_PER_LOOP, loop: m.loop - prev.loop }); prev = m; }
  per.sort((x, y) => y.sec - x.sec);
  console.log('最慢的 5 级：');
  for (let k = 0; k < Math.min(5, per.length); k++) {
    console.log('  Lv' + per[k].level + '  ' + fmtSec(per[k].sec) + ' (' + per[k].loop + ' loop)');
  }
  console.log('');
  console.log('HP 健康度（采样 min/mean）：' + Math.min(...hpHist).toFixed(2) + ' / ' +
    (hpHist.reduce((a, b) => a + b, 0) / hpHist.length).toFixed(2));

  // ---- 成就 / 通关 / 探索 进度（验证进度类机制是否被正常推进）----
  console.log('');
  console.log('================ 进度类机制 ================');
  const cleared = (p.stats.mapClear || []);
  console.log('已通关地图 ' + cleared.length + ' 张：' + (cleared.join('、') || '（无）'));
  const ms = (E.achList ? E.achList() : []).filter(a => a.metric === 'map_single');
  const got = ms.filter(a => p.ach && p.ach[a.key]);
  console.log('「XX通关」成就 ' + got.length + '/' + ms.length + '：' + (got.map(a => a.name).join('、') || '（无）'));
  console.log('已获得成就 ' + Object.keys(p.ach || {}).length + ' / ' + (E.achList ? E.achList().length : '?'));
  let zTotal = 0, zDone = 0, bzCleared = 0, bzTotal = 0, explored1 = 0;
  for (const m of E.DATA.maps.maps) {
    zTotal += (m.zones || []).length;
    zDone += (m.zones || []).filter(z => {
      const t = z.explore_target || 0; if (!t) return false;
      const zk = (p.stats.zoneKills || {})[m.key] || {};
      return (zk[z.key] || 0) >= t;
    }).length;
    if (m.boss_zone) { bzTotal++; if (E.bossZoneCleared(m)) bzCleared++; }
    if ((p.stats.zoneKills || {})[m.key]) explored1++;
  }
  console.log('区域探索完成 ' + zDone + '/' + zTotal + '（有进度的地图 ' + explored1 + ' 张）');
  console.log('首领区清剿完成 ' + bzCleared + '/' + bzTotal);
  realSetTimeout(() => { }, 0);
})();
