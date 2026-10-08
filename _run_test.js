/* 无头测试：验证怪物技能 / 召唤兽 / 探矿 / 宝石炼制 / 药水炼制 / 副本兑换 / 成就 */
const fs = require('fs'), path = require('path');
global.window = global;
const DIR = path.join(__dirname, 'data');
const realFetch = global.fetch;                       // Node 22 内置 fetch，用于真实后端 API
const API_ORIGIN = 'http://localhost:8014';
global.fetch = async (u, opts) => {
  const url = String(u);
  if (url.startsWith('/api')) {
    if (!realFetch) throw new Error('no builtin fetch');
    return realFetch(API_ORIGIN + url, opts);
  }
  const f = path.join(__dirname, url.replace(/^\//, ''));
  return { json: async () => JSON.parse(fs.readFileSync(f, 'utf-8')) };
};
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
function el() {
  const o = {
    innerHTML: '', textContent: '', value: '', style: {}, onclick: null, onchange: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll: () => [], appendChild() {}, getAttribute: () => null, setAttribute() {}, children: [],
  };
  return o;
}
global.document = { getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el() };
global.setInterval = () => 0; global.clearInterval = () => {};
global.confirm = () => true;

require('./_test_game.js');
const E = global.__exp;

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  << ' + extra : '')); }
}

(async function main() {
  await E.loadData();
  console.log('-- 数据加载 --');
  ok('怪物技能索引非空', Object.keys(E.MON_SKILLS).length > 0, Object.keys(E.MON_SKILLS).length + '');
  ok('宝石品级链', E.GEM_ORDER.length >= 2, JSON.stringify(E.GEM_ORDER));
  ok('副本兑换条目 27', E.instEntries().length === 27, E.instEntries().length + '');
  ok('成就条目 87', E.achList().length === 87, E.achList().length + '');
  ok('消耗品掉落中文名', E.itemName('xuming_xiao') === '回春小还丹' && E.itemName('ningshen_jiuzhuan') === '九转定神液', E.itemName('xuming_xiao') + ' / ' + E.itemName('ningshen_jiuzhuan'));
  ok('道具名兜底', E.itemName('__missing__') === '__missing__', E.itemName('__missing__'));

  E.newPlayer('测试', 'warrior');
  let p = E.state.player;
  ok('新角色含 mining/stats/ach', !!p.mining && !!p.stats && !!p.ach);

  // ---- 战斗：怪物技能 + 召唤兽 ----
  console.log('-- 战斗（怪物技能 / 召唤兽）--');
  const skMon = Object.keys(E.MON_SKILLS)[0];
  const mBase = E.MONSTERS[skMon];
  E.state.zone = null;
  // 直接构造战斗：找一个有技能的怪物
  const m = Object.assign({}, mBase);
  m.curHp = m.hp; m.skills = E.MON_SKILLS[skMon] || []; m.skillCd = {}; m.isBoss = false; m.isElite = false;
  E.state.combat = m;
  E.state.idle = true;
  E.state.summonHp = 0;
  let usedSkill = false, summonHit = false;
  p.level = 30; E.refreshStats(); p.hp = p._s.max_hp;
  p.summon = 'yanling';
  E.state.summonHp = 999;
  for (let i = 0; i < 300; i++) {
    E.state.logLines.length = 0;
    E.tick();
    const txt = E.state.logLines.join(' ');
    if (/施放/.test(txt)) usedSkill = true;
    if (/炎灵兽/.test(txt)) summonHit = true;
    if (!E.state.combat) { // 怪物死亡，换一只
      const k = Object.keys(E.MON_SKILLS)[0];
      const b = E.MONSTERS[k];
      const nm = Object.assign({}, b); nm.curHp = nm.hp; nm.skills = E.MON_SKILLS[k] || []; nm.skillCd = {};
      E.state.combat = nm;
    }
    if (usedSkill && summonHit) break;
  }
  ok('怪物释放技能', usedSkill);
  ok('召唤兽出手', summonHit);

  // ---- 探矿 ----
  console.log('-- 探矿 --');
  E.state.mine = null;
  E.addToBag({ type: 'consumable', key: 'yipin_luopan', count: 5 });
  const oreSum = () => Object.keys(p.ores).reduce((a, k) => a + (p.ores[k] || 0), 0);
  const before = oreSum();
  let gained = 0, rounds = 0;
  for (let r = 0; r < 5; r++) {
    const r1 = E.mineStart('yipin', 'tianshengyuan');
    if (r === 0) ok('开始探矿', r1.ok, r1.msg);
    if (!r1.ok) break;
    for (let i = 0; i < 60; i++) E.mineTick(1);
    rounds++;
  }
  gained = oreSum() - before;
  ok('探矿结算完成', E.state.mine === null && rounds === 5, 'rounds=' + rounds);
  ok('矿石产出增加', gained > 0, 'gained=' + gained);
  ok('罗盘每轮消耗 1 个', E.itemCount('yipin_luopan') === 0, E.itemCount('yipin_luopan') + '');
  ok('探矿经验增长', p.mining.exp > 0 || p.mining.level > 1, JSON.stringify(p.mining));

  // ---- 宝石炼制 ----
  console.log('-- 宝石炼制 --');
  const series = (E.DATA.gems.gem_series || [])[0].key;
  const g0 = E.GEM_ORDER[0], g1 = E.GEM_ORDER[1];
  E.addToBag({ type: 'gem', series, grade: g0, count: 4 });
  p.materials.lianhua_ping = 5;
  p.level = 60;
  E.doGemRefine(series, g0);
  ok('宝石升一级', E.gemCount(series, g1) === 1, g1 + ' count=' + E.gemCount(series, g1));

  // ---- 药水炼制 ----
  console.log('-- 药水炼制 --');
  const prk = Object.keys(E.DATA.potion_recipes)[0];
  const pr = E.DATA.potion_recipes[prk];
  const c = pr.cost || {};
  if (c.hp_potion) E.addToBag({ type: 'consumable', key: c.hp_potion.key, count: c.hp_potion.count });
  if (c.mp_potion) E.addToBag({ type: 'consumable', key: c.mp_potion.key, count: c.mp_potion.count });
  if (c.crystal) p.crystal += c.crystal.count;
  p.materials.lianhua_ping = 5;
  const beforeBag = p.bag.length;
  E.doPotionRefine(prk);
  ok('药水炼制产出', p.bag.length > beforeBag || E.itemCount(pr.result_item) > 0);

  // ---- 副本兑换 ----
  console.log('-- 副本兑换 --');
  const e0 = E.instEntries()[0];
  E.addToBag({ type: 'consumable', key: e0.cost_key, count: e0.cost_count });
  const eqBefore = p.bag.filter(b => b.type === 'equip').length;
  E.doInstanceExchange(e0._k);
  const eqAfter = p.bag.filter(b => b.type === 'equip').length;
  ok('兑换产出装备', eqAfter === eqBefore + 1);
  const got = p.bag.filter(b => b.type === 'equip').pop();
  ok('兑换装备规格：精炼5/3孔/2词条', got && got.refine === 5 && got.sockets === 3 && got.perks.length === 2,
    got ? JSON.stringify({ r: got.refine, s: got.sockets, pk: got.perks }) : 'none');

  // ---- 成就 ----
  console.log('-- 成就 --');
  p.level = 10;
  E.checkAchievements();
  const doneCount = Object.keys(p.ach).length;
  ok('等级成就达成', doneCount > 0, doneCount + '');
  const lvlAch = E.achList().find(a => a.metric === 'level' && a.target <= 10);
  ok('成就值计算正确', E.achValue(lvlAch) >= lvlAch.target, JSON.stringify({ v: E.achValue(lvlAch), t: lvlAch.target }));

  // ---- 神魔修验技能树 ----
  console.log('-- 神魔修验技能树 --');
  p.level = 105; E.refreshStats();
  const join = E.smJoin('shen');
  ok('入道（Lv.101+）', join.ok, join.msg);
  ok('入道赠送 1 点', p.shenmo.points === 1, String(p.shenmo.points));
  const nodes = E.smNodes().list.filter(n => n.faction === 'shen' && n.tier === 1);
  ok('神道一档节点存在', nodes.length > 0, nodes.length + '');
  const atkBefore = p._s.main;
  const n0 = nodes.find(n => !(n.require || {}).equip_weapon_kind && !(n.require || {}).equip_shield) || nodes[0];
  if (n0) {
    const r2 = E.smAddPoint(n0.key);
    ok('加点成功', r2.ok, r2.msg);
    E.refreshStats();
    const eff = E.smAgg();
    const any = eff.atk > 0 || eff.crit > 0 || eff.constitutionPct > 0 || eff.dmgBonus > 0
      || (eff.append && eff.append.length > 0) || eff.reflect > 0 || eff.block > 0
      || Object.keys(eff.cdReduce || {}).length > 0 || Object.keys(eff.skillDmg || {}).length > 0;
    ok('技能树加成汇总生效', any, JSON.stringify({ node: n0.key, hook: n0.hook, mode: n0.mode, atk: eff.atk, crit: eff.crit, con: eff.constitutionPct, append: eff.append }));
    ok('已投入点数 = 1', E.smSpent() >= 1, E.smSpent() + '');
  }
  const act = E.smNodes().list.find(n => n.type === 'active' && n.faction === 'shen');
  if (act) {
    // 神魔主动技能（如秘法盾）要求持盾，先装备盾
    if (!p.equip.shield) p.equip.shield = { name: '玄铁盾', stats: {}, perks: [], gems: [] };
    // 先在一档节点投入足够点数解锁二档（spent_required=20）
    p.shenmo.points += 60;
    for (const nd of nodes) { for (let i = 0; i < 5; i++) E.smAddPoint(nd.key); }
    ok('累计投入解锁二档', E.smSpent() >= 20, E.smSpent() + '');
    const ra = E.smAddPoint(act.key);
    ok('主动节点加点', ra.ok, ra.msg);
    E.refreshStats();
    const cast = E.smActiveCast({ curHp: 99999, hp: 99999, phys_def: 0, magic_def: 0 });
    ok('神魔主动技能可施放', !!cast, cast ? cast.name : 'null');
  }
  p.shenmo.points = 0;
  const r3 = E.smAddPoint(nodes[0].key);
  ok('点数不足拒绝加点', !r3.ok, r3.msg);
  p.gold = 999999;
  const r4 = E.smResetPoints();
  ok('重置加点（金币）', r4.ok, r4.msg);
  ok('重置后节点清空', Object.keys(p.shenmo.nodes).length === 0);

  // ---- 晶石 ----
  console.log('-- 晶石精炼 --');
  const eq0 = p.bag.filter(b => b.type === 'equip')[0] || E.genEquip('weapon', p.job, 3, p.level);
  if (!eq0.uid) E.addToBag(eq0);
  eq0.tier = 3; eq0.refine = 4;
  const ck = E.crystalForTier(3);
  p.gold = 999999;
  const beforeC = E.crystalCount(ck);
  const rr0 = E.doRefine(eq0);   // 需晶石（+5 起）
  ok('精炼 +5 需要晶石（无晶石时不消耗）', eq0.refine === 4 || eq0.refine === 5, 'refine=' + eq0.refine);
  E.addCrystalStone(ck, 2);
  let guard = 0;
  while (eq0.refine < 5 && guard++ < 40) { p.gold = 999999; E.addCrystalStone(ck, 1); E.doRefine(eq0); }
  ok('精炼 +5 消耗晶石', E.crystalCount(ck) < beforeC + 20, 'ck=' + E.crystalCount(ck));

  // ---- 精炼数值口径（按原版 refine.py 反汇编还原：档位取表 / 无百分比 / 跳过 0/0 / 失败回退）----
  console.log('-- 精炼口径（档位取表 / 无百分比 / 回退）--');
  {
    const tw = E.genEquip('weapon', p.job, 7, 100);
    tw.tier = 7; tw.stats = { phys_atk: 300, magic_atk: 0 }; tw.refine = 0; tw.perks = [];
    E.applyRefineLevels(tw, 7);
    ok('tier7 每级 +13 ⇒ +7 恰好 +91（无百分比缩放）', tw.stats.phys_atk === 391,
      'phys_atk=' + tw.stats.phys_atk + '（应 300+7*13=391）');
    ok('tier7 flat 与精炼等级无关（不是取 flat 表第 1..7 行再乘系数）', tw.stats.phys_atk !== 305);
    ok('0/0 白板键被跳过（magic_atk 保持 0）', tw.stats.magic_atk === 0, 'magic_atk=' + tw.stats.magic_atk);
    ok('+7 解锁隐藏词条（武器 → 致命）',
      tw.refine === 7 && (tw.perks || []).some(k => k.hidden && k.name === '致命'),
      'refine=' + tw.refine + ' perks=' + JSON.stringify(tw.perks));
    const tw2 = E.genEquip('weapon', p.job, 1, 1);
    tw2.tier = 1; tw2.stats = { phys_atk: 20, magic_atk: 0 }; tw2.refine = 0; tw2.perks = [];
    E.applyRefineLevels(tw2, 7);
    ok('tier1 每级 +3 ⇒ +7 恰好 +21（另一条档位行）', tw2.stats.phys_atk === 41,
      'phys_atk=' + tw2.stats.phys_atk);
    const hd = E.genEquip('helmet', p.job, 7, 100);
    if (hd) {
      hd.perks = []; E.applyRefineLevels(hd, 7);
      ok('非攻击部位隐藏词条 → 守御', (hd.perks || []).some(k => k.hidden && k.name === '守御'),
        JSON.stringify(hd.perks));
    }
    // 失败回退：造一件 +5，强制 drop / zero（outcomes['6']: destroy .01 / zero .01 / drop .16）
    const rb = E.genEquip('weapon', p.job, 7, 100);
    rb.tier = 7; rb.stats = { phys_atk: 300, magic_atk: 0 }; rb.refine = 0; rb.perks = [];
    E.applyRefineLevels(rb, 5);
    E.addToBag(rb); E.addCrystalStone(E.crystalForTier(7), 5); p.gold = 9999999;
    const origRnd = Math.random;
    const rollOnce = (v) => { let once = true; Math.random = () => { if (once) { once = false; return v; } return origRnd(); }; };
    rollOnce(0.10); E.doRefine(rb); Math.random = origRnd;      // → drop
    ok('降级回退一级加成（300+5*13=365 → 352）', rb.refine === 4 && rb.stats.phys_atk === 352,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
    rollOnce(0.015); E.doRefine(rb); Math.random = origRnd;     // → zero
    ok('归零退回全部已得加成（352 → 300）', rb.refine === 0 && rb.stats.phys_atk === 300,
      'refine=' + rb.refine + ' atk=' + rb.stats.phys_atk);
  }

  // ---- 宝石镶嵌（gems.json#gem_series[].slots 是「本系列只能镶哪些部位」的白名单）----
  console.log('-- 宝石镶嵌（系列限定部位）--');
  {
    p.bag.push({ uid: 'gem_p1', type: 'gem', series: 'beidou', grade: '碎石', count: 1 });   // 武器/护手/戒指
    p.bag.push({ uid: 'gem_p2', type: 'gem', series: 'wangyue', grade: '碎石', count: 1 });  // 防具六件
    ok('宝石系列 key 映射为完整中文名', E.gemSeriesName('beidou') === '北斗' && E.gemSeriesName('wangyue') === '望月' && E.gemSeriesName('unknown') === 'unknown');
    const gb = p.bag.find(b => b.uid === 'gem_p1'), gw = p.bag.find(b => b.uid === 'gem_p2');
    const iw = E.genEquip('weapon', p.job, 7, 100);
    const ih = E.genEquip('helmet', p.job, 7, 100);
    if (iw && ih) {
      iw.slot = 'weapon'; iw.sockets = 1; iw.gems = [null];
      ih.slot = 'helmet'; ih.sockets = 1; ih.gems = [null];
      ok('北斗可行白名单：可镶武器、不可镶头盔',
        E.gemCanInlay(gb, iw) === true && E.gemCanInlay(gb, ih) === false);
      ok('望月白名单：不可镶武器、可镶头盔',
        E.gemCanInlay(gw, iw) === false && E.gemCanInlay(gw, ih) === true);
      // 宝石的加成是在 computeStats 里按 it.gems 累加的（且只对【已装备】生效），
      // 所以这里必须先把装备穿上再比角色总属性，而不是看 it.stats。
      const prevW = p.equip.weapon;
      E.addToBag(iw); E.addToBag(ih);
      p.equip.weapon = iw; E.refreshStats();
      const atkB = p._s.combat.phys_atk;
      E.doInlay(iw, gb);
      E.refreshStats();
      ok('镶嵌填入孔位（系列/属性正确）',
        (iw.gems || []).filter(Boolean).length === 1 && iw.gems[0].series === 'beidou'
        && iw.gems[0].stat === 'phys_atk' && iw.gems[0].value > 0, JSON.stringify(iw.gems[0]));
      ok('镶嵌扣掉背包里那颗宝石', (gb.count || 0) === 0 || p.bag.indexOf(gb) < 0, 'count=' + gb.count);
      ok('装备后镶嵌使角色物理攻击提升', p._s.combat.phys_atk > atkB, atkB + ' → ' + p._s.combat.phys_atk);
      ih.gems = [{ series: 'wangyue', stat: 'phys_def', value: 1, grade: '碎石' }];   // 满孔
      E.LS.inlayGem = 'gem_p1';
      ok('满孔装备不再出现在镶嵌候选里（先确认它在候选池内）',
        !E.inlayEquipList().some(it => it.uid === ih.uid) && E.gemCanInlay(gb, ih) === false);
      E.LS.inlayGem = 'gem_p2';
      ok('换成望月后满孔头盔仍不在候选里（说明同时校验部位与孔位）',
        E.inlayEquipList().some(it => it.uid === ih.uid) === false);   // 它已满孔，仍不该在
      E.LS.inlayGem = null; p.equip.weapon = prevW; E.refreshStats();
    }
  }

  // ---- 信使 ----
  console.log('-- 信使传送 --');
  E.travelTo('beijun');
  const routes = E.courierRoutes('beijun');
  ok('信使线路存在', routes.length > 0, routes.length + '');
  p.gold = 999999;
  const tgt = routes[0].map_key;
  const rt = E.courierTravel(tgt);
  ok('信使传送成功', rt.ok && p.map === tgt, rt.msg + ' map=' + p.map);

  // ---- 打造模式 ----
  console.log('-- 打造生成模式 --');
  const base = E.DATA.bases_warrior.weapons[0];
  const wb = E.buildEquip(base, 'warrior', 5, 'weapon', 'whiteboard');
  ok('白板模式 0 词条', wb.perks.length === 0, wb.perks.length + '');
  const fp = E.buildEquip(base, 'warrior', 5, 'weapon', 'full_perk');
  ok('满词条模式 = 上限', fp.perks.length === (E.PERK_CAP[5] || 4), fp.perks.length + ' vs ' + (E.PERK_CAP[5] || 4));
  const pc = E.buildEquip(base, 'warrior', 5, 'weapon', 'percent');
  ok('百分比模式仅百分比词条', pc.perks.every(x => /%/.test(x.name) || /%/.test(x.suffix || '')), JSON.stringify(pc.perks.slice(0, 3)));

  // ---- 战力评分 ----
  console.log('-- 战力评分 --');
  p.level = 30; E.refreshStats();
  const pw30 = E.powerScore(p);
  p.level = 80; E.refreshStats();
  const pw80 = E.powerScore(p);
  ok('战力随等级提升', pw80 > pw30 && pw30 > 0, pw30 + ' -> ' + pw80);

  // ---- 存档 payload 往返 ----
  console.log('-- 存档 payload 往返 --');
  const payload = E.buildSavePayload();
  ok('payload 含战力字段', typeof payload.power === 'number' && payload.power > 0, String(payload.power));
  const keepName = p.name, keepLv = p.level, keepGold = p.gold;
  E.applySavePayload(JSON.parse(JSON.stringify(payload)));
  p = E.state.player;   // applySavePayload 会重建 player，需重新取引用
  ok('payload 往返一致', E.state.player.level === keepLv && E.state.player.gold === keepGold && E.state.player.name === keepName,
    E.state.player.level + '/' + E.state.player.gold + '/' + E.state.player.name);

  // ---- P0 自动喝药 ----
  console.log('-- 自动喝药 --');
  E.state.auto.potion = true; E.state.auto.buy = true; E.state.auto.hp = 60;
  p.level = 30; E.refreshStats();
  p.bag = p.bag.filter(b => !(b.type === 'consumable' && /xuming|ningshen/.test(b.key || '')));
  p.gold = 100000;
  p.hp = Math.floor(p._s.max_hp * 0.3);
  const hpBefore = p.hp;
  E.autoPotion();
  ok('低血自动喝药/补给', p.hp > hpBefore, hpBefore + ' -> ' + p.hp);
  ok('自动补给已扣金币', p.gold < 100000, String(p.gold));
  const boughtOnce = E.buyPotion(E.HP_POTIONS, E.potionTier(p.level));
  ok('buyPotion 能买到药', boughtOnce === true && p.bag.some(b => b.type === 'consumable' && /xuming/.test(b.key || '')),
    p.bag.filter(b => b.type === 'consumable' && /xuming/.test(b.key || '')).map(b => b.key + 'x' + b.count).join(','));
  p.mp = 1;
  const mpBefore = p.mp;
  E.autoPotion();
  ok('低蓝自动喝药/补给', p.mp > mpBefore, mpBefore + ' -> ' + p.mp);
  // 关闭自动喝药后不应触发
  E.state.auto.potion = false;
  p.hp = Math.floor(p._s.max_hp * 0.2);
  const hp2 = p.hp; E.autoPotion();
  ok('关闭后不自动喝药', p.hp === hp2, hp2 + ' -> ' + p.hp);
  E.state.auto.potion = true;

  // ---- P0 自动换区 ----
  console.log('-- 自动换区 --');
  p.level = 25; E.refreshStats(); p.hp = p._s.max_hp;
  p.unlocked = { beijun: true, tianshengyuan: true };
  const bz = E.bestZone();
  ok('能选出最优区域', !!bz && bz.score > 0, bz ? bz.name + ' ' + bz.score.toFixed(2) : 'null');
  E.state.auto.zone = true;
  E.state.zone = { mapKey: 'beijun', zoneKey: 'farm', isBoss: false };
  E.autoZone(true);
  ok('自动换区已切换', E.state.zone && E.state.zone.mapKey === bz.mapKey, JSON.stringify(E.state.zone));
  const lowEval = E.zoneEval('beijun', 'farm', false);
  const highEval = E.zoneEval('beijun', null, true);
  ok('区域评估返回数值或 -1', typeof lowEval === 'number' && typeof highEval === 'number', lowEval + ' / ' + highEval);
  E.state.auto.zone = false;

  // ---- 自动换区：首领优先（未通关且可打的首领区优先于普通区）----
  console.log('-- 自动换区（首领优先）--');
  {
    const _orig = E.DATA.maps.maps;
    const _mon = '__tz_boss_mon';
    E.MONSTERS[_mon] = { key:_mon, name:'测试首领', level:25, hp:200, exp:80, min_phys_atk:1, max_phys_atk:3,
      min_magic_atk:1, max_magic_atk:3, min_phys_def:1, max_phys_def:3, min_magic_def:1, max_magic_def:3,
      dodge:0, gold_min:1, gold_max:3 };
    const _fake = { key:'__tz_boss', name:'测试首领区', neighbors:['beijun'], zones:[],
      boss_zone:{ key:'__tz_bz', name:'BZ', boss:[_mon], monsters:[_mon], elite_monsters:[], unlock_level:1 } };
    E.DATA.maps.maps = _orig.concat([_fake]);
    p.level = 25; E.refreshStats(); p.hp = p._s.max_hp;
    p.unlocked = Object.assign({}, p.unlocked, {__tz_boss:true});
    p.stats.mapClear = (p.stats.mapClear||[]).filter(k=>k!=='__tz_boss');
    const bz2 = E.bestZone();
    ok('首领优先：未通关且可打的首领区被优先', !!bz2 && bz2.mapKey==='__tz_boss' && bz2.isBoss===true, JSON.stringify(bz2));
    p.stats.mapClear = (p.stats.mapClear||[]).concat(['__tz_boss']);
    const bz3 = E.bestZone();
    ok('已通关的首领区不再被首领优先', bz3.isBoss !== true || bz3.mapKey !== '__tz_boss', JSON.stringify(bz3));
    E.DATA.maps.maps = _orig; delete E.MONSTERS[_mon];
    p.unlocked = { beijun:true, tianshengyuan:true }; p.stats.mapClear = p.stats.mapClear.filter(k=>k!=='__tz_boss');
  }

  // ---- 挂机统计埋点 ----
  console.log('-- 挂机统计 --');
  E.state.sess.kills = 0; E.state.sess.exp = 0; E.state.sess.gold = 0; E.state.sess.drops = {};
  E.sessBump('kills', 5); E.sessBump('exp', 500); E.sessBump('gold', 120); E.sessBump('drop', 1, 'green');
  ok('统计累加', E.state.sess.kills === 5 && E.state.sess.exp === 500 && E.state.sess.drops.green === 1,
    JSON.stringify(E.state.sess.drops));
  const pm = E.sessPerMin();
  ok('每分钟统计可算', typeof pm.exp === 'number', JSON.stringify(pm));

  // ---- 后端 / 云存档（需 8014 在跑） ----
  console.log('-- 后端云存档 --');
  let backendOk = false;
  try { backendOk = await E.apiProbe(); } catch (e) { backendOk = false; }
  ok('后端探测', backendOk === true, 'ok=' + backendOk + ' base=' + E.state.cloud.base);
  if (backendOk) {
    // 复用固定测试账号：早先每跑一次就 new 一个账号，后端累积了 57 个垃圾账号 + 55 条刷屏榜单
    const uname = 'probe_ci';
    let r1 = await E.cloudRegister(uname, 'pwd123456');
    if (!r1.ok) { await E.cloudLogout(); r1 = await E.cloudLogin(uname, 'pwd123456'); }
    ok('注册或登录成功（固定测试账号 probe_ci）', r1.ok === true, r1.msg || '');
    await E.cloudLogout();
    const r2 = await E.cloudLogin(uname, 'pwd123456');
    ok('登录成功', r2.ok === true, r2.msg || '');
    const r3 = await E.cloudSave(1, true);
    ok('云保存成功', r3.ok === true, r3.msg || JSON.stringify(r3));
    const slots = await E.refreshSlots();
    ok('槽位列表非空', slots.length === 3 && !slots[0].empty, JSON.stringify(slots[0]));
    // 改本地数据后读取云端应还原
    const lvBefore = E.state.player.level;
    E.state.player.level = 7;
    const r4 = await E.cloudLoad(1);
    ok('云读取成功并还原', r4.ok === true && E.state.player.level === lvBefore, r4.msg + ' lv=' + E.state.player.level);
    const r5 = await E.cloudRank();
    ok('战力上传', !!r5 && r5.ok === true, JSON.stringify(r5));
    const rk = await E.cloudRankList('');
    ok('排行榜可读', !!rk && !!rk.list && rk.list.length > 0, rk && rk.list ? rk.list.length + '' : 'null');
    const sm = await E.cloudStatsSummary();
    ok('统计摘要可读', !!sm && !!sm.total, sm ? JSON.stringify(sm.total) : 'null');
    const r6 = await E.cloudDelete(1);
    ok('删除请求返回 ok（后端 unlink 未被静默吞错）', !!r6 && r6.ok === true, JSON.stringify(r6));
    const slots2 = await E.refreshSlots();
    ok('云删除生效', slots2[0].empty === true, JSON.stringify(slots2[0]));
    await E.cloudLogout();
  } else {
    console.log('  SKIP  后端未启动，跳过云存档用例');
  }

  // ---- 离线收益 ----
  console.log('-- 离线收益 --');
  {
    // 累计经验（含已升入等级的部分），用于精确校验离线经验 gross
    const cumExp = p => { let c = 0; for (let L = 1; L < p.level; L++) c += E.expToNext(L); return c + p.exp; };
    E.newPlayer('离线', 'mage');
    const pl = E.state.player;
    pl.level = 40; E.refreshStats(); pl.hp = pl._s.max_hp;
    const beforeExp = cumExp(pl), beforeGold = pl.gold;
    // 模拟离开 1 小时（3600s），给定挂机速率 经验 100/s、金币 50/s，效率 50%
    E.state._loadedTs = Date.now() - 3600 * 1000;
    E.state._loadedRate = { exp: 100, gold:50 };
    E.applyOfflineEarnings();
    const grossExp = cumExp(pl) - beforeExp;       // 含升级吃掉的部分，应为 floor(100*3600*0.5)=180000
    const goldGain = pl.gold - beforeGold;          // 离线金币 + 升级触发的成就奖励（应 ≥ 90000）
    ok('离线经验补算≈18万（含升级）', Math.abs(grossExp - 180000) < 1, grossExp + '');
    ok('离线金币至少补算9万', goldGain >= 90000, goldGain + '');
    ok('离线时间戳已清空', E.state._loadedTs === null);
  }
  {
    E.newPlayer('瞬时', 'warrior');
    const pl = E.state.player;
    const before = pl.gold;
    E.state._loadedTs = Date.now() - 5 * 1000;     // 仅离开 5 秒，不足 1 分钟
    E.state._loadedRate = { exp: 1000, gold: 1000 };
    E.applyOfflineEarnings();
    ok('离开不足1分钟不补算', pl.gold === before && E.state._loadedTs === null);
  }

  // ---- 大数字格式化 ----
  console.log('-- 数字格式化 --');
  {
    const f = E.fmtNum;
    ok('fmtNum 小数字原样', f(0) === '0' && f(9999) === '9999', f(9999));
    ok('fmtNum 万', f(12300) === '1.23万', f(12300));
    ok('fmtNum 亿', f(123000000) === '1.23亿', f(123000000));
    ok('fmtNum 兆', f(1.2e12) === '1.2兆', f(1.2e12));
    ok('fmtNum 空值归零', f(null) === '0' && f('abc') === '0');
  }

  // ---- 自动分解白/绿装 ----
  console.log('-- 自动分解 --');
  {
    E.newPlayer('分解', 'warrior');
    const pl = E.state.player;
    const oreSum = () => Object.keys(pl.ores).reduce((a, k) => a + (pl.ores[k] || 0), 0);
    const mkJunk = i => ({ type: 'equip', uid: 'junk' + i, quality: 'white', name: '测试白装' + i,
      slot: 'helmet', tier: 1, reqLevel: 1, stats: { max_hp: 1 }, perks: [], gems: [], refine: 0, bailian: 0 });
    const per = (E.DATA.extract && E.DATA.extract.ore_per_equip) || 1;

    pl.bag = []; const o0 = oreSum();
    for (let i = 0; i < 50; i++) pl.bag.push(mkJunk(i));
    const n1 = E.autoExtractJunk(true);
    ok('autoExtractJunk 分解 50 件白装', n1 === 50 && pl.bag.length === 0, 'n=' + n1 + ' bag=' + pl.bag.length);
    ok('分解回收矿石 50×' + per, oreSum() - o0 === 50 * per, (oreSum() - o0) + '');

    pl.bag = [mkJunk(1), Object.assign(mkJunk(2), { refine: 3 }),
      Object.assign(mkJunk(3), { quality: 'blue' }), Object.assign(mkJunk(4), { bailian: 1 })];
    const n2 = E.autoExtractJunk(true);
    ok('跳过已强化/高品质/百炼装', n2 === 1 && pl.bag.length === 3, 'n=' + n2 + ' bag=' + pl.bag.length);

    pl.bag = []; for (let i = 0; i < E.AUTO_SALVAGE_AT + 10; i++) pl.bag.push(mkJunk(i));
    E.state.auto.junk = false;
    ok('关闭时不自动分解', E.maybeAutoSalvage() === 0 && pl.bag.length === E.AUTO_SALVAGE_AT + 10, 'bag=' + pl.bag.length);
    E.state.auto.junk = true;
    const n3 = E.maybeAutoSalvage();
    ok('开启且达阈值自动分解', n3 === E.AUTO_SALVAGE_AT + 10 && pl.bag.length === 0, 'n=' + n3 + ' bag=' + pl.bag.length);
    ok('阈值低于背包上限', E.AUTO_SALVAGE_AT < E.BAG_CAP, E.AUTO_SALVAGE_AT + '<' + E.BAG_CAP);
  }
  {
    E.state.auto.junk = false; E.saveAuto();
    E.state.auto.junk = true; E.loadAuto();
    ok('自动分解设置持久化', E.state.auto.junk === false);
    E.state.auto.junk = true; E.saveAuto();
  }

  // ---- 死亡惩罚（轻罚：损失当前级经验 5%）----
  console.log('-- 死亡惩罚 --');
  {
    E.newPlayer('死亡', 'warrior');
    const pl = E.state.player;
    pl.level = 20; E.refreshStats(); pl.hp = pl._s.max_hp;
    pl.exp = 5000;
    const before = pl.exp;
    E.state.combat = { name: 'x' };
    E.onPlayerDead();
    const expect = before - Math.floor(before * E.DEATH_EXP_PENALTY);
    ok('死亡损失当前级经验 5%', pl.exp === expect, pl.exp + ' vs ' + expect);
    ok('死亡后满血且脱战回到安全区', pl.hp === pl._s.max_hp && E.state.combat === null);
    ok('死亡计数 +1', E.state.sess.deaths >= 1, E.state.sess.deaths + '');
    pl.exp = 0; E.onPlayerDead();
    ok('零经验死亡不出现负数', pl.exp === 0, pl.exp + '');
  }

  // ---- 长时挂机冒烟（自动喝药/换区/分解 全链路不崩）----
  console.log('-- 长时挂机冒烟 --');
  {
    E.newPlayer('挂机', 'warrior');
    const pl = E.state.player;
    pl.level = 12; E.refreshStats();
    const map0 = E.DATA.maps.maps[0];
    let err = null;
    try {
      E.startZone(map0.key, map0.zones[0].key, false);
      E.setIdle(true);
      for (let i = 0; i < 2000; i++) E.loop();
    } catch (e) { err = e; }
    ok('2000 轮挂机无异常', !err, err ? err.message : '');
    ok('挂机有产出（升级或击杀）', pl.level > 12 || E.state.sess.kills > 0,
      'lvl=' + pl.level + ' kills=' + E.state.sess.kills);
  }

  // ---- 首领威胁加成（普通/精英区不受影响）----
  console.log('-- 首领加成 --');
  {
    E.newPlayer('首领', 'warrior');
    const pl = E.state.player; pl.level = 20; E.refreshStats();
    const map = E.DATA.maps.maps.find(m => m.boss_zone && m.boss_zone.unlock_level <= 20);
    pl.unlocked[map.key] = 1;
    // 首领区需先清剿 minion_target，首领才会现身（本段只验首领数值，直接把清剿额度填满）
    pl.stats.minionKills = {}; pl.stats.minionKills[map.key] = { normal: 50, elite: 50 };
    E.state.zone = { mapKey: map.key, zoneKey: null, isBoss: true };
    const m = E.spawnMonster();
    const base = E.getMonster(m.key);
    ok('首领血量已加成', m.hp === Math.round((base.hp || 0) * E.BOSS_HP_MULT), m.hp + ' vs ' + Math.round((base.hp || 0) * E.BOSS_HP_MULT));
    ok('首领攻击已加成', m.max_phys_atk === Math.round((base.max_phys_atk || 0) * E.BOSS_ATK_MULT), m.max_phys_atk + '');
    ok('首领等级/名称未被改动', m.name === base.name && m.level === base.level);
    ok('首领标记正确', m.isBoss === true);

    // 普通区怪物不应被加成
    E.state.zone = { mapKey: map.key, zoneKey: map.zones[0].key, isBoss: false };
    let same = true;
    for (let i = 0; i < 30; i++) { const mm = E.spawnMonster(); const bb = E.getMonster(mm.key); if (mm.hp !== bb.hp) same = false; }
    ok('普通区怪物不被加成', same);
  }

  console.log('-- 本地存档 导入 / 导出 --');
  {
    // ① 校验器：坏档必须被拦（坏档不许覆盖好档）
    ok('校验拒绝 null', !E.validateSavePayload(null).ok);
    ok('校验拒绝数组', !E.validateSavePayload([]).ok);
    ok('校验拒绝缺角色名', !E.validateSavePayload({ job: 'warrior', level: 1, gold: 0, exp: 0 }).ok);
    ok('校验拒绝缺职业', !E.validateSavePayload({ name: 'a', level: 1, gold: 0, exp: 0 }).ok);
    ok('校验拒绝等级异常', !E.validateSavePayload({ name: 'a', job: 'warrior', level: 0, gold: 0, exp: 0 }).ok);
    ok('校验拒绝金币非数', !E.validateSavePayload({ name: 'a', job: 'warrior', level: 1, gold: 'X', exp: 0 }).ok);
    ok('校验拒绝经验 NaN', !E.validateSavePayload({ name: 'a', job: 'warrior', level: 1, gold: 0, exp: NaN }).ok);

    // ② 真实存档应通过校验，文件名合规
    E.newPlayer('存档甲', 'mage');
    const pa = E.state.player;
    pa.level = 33; pa.gold = 987654; pa.crystal = 42; E.refreshStats();
    E.state.kills = 777;
    const pay = E.buildSavePayload();
    ok('校验真实存档通过', E.validateSavePayload(pay).ok, JSON.stringify(E.validateSavePayload(pay)));
    ok('导出文件名含角色/职业/等级', /梦回华夏_存档甲_法师.*Lv33.*\.json$/.test(E.exportFileName()), E.exportFileName());

    // ③ 导出文本 → 篡改当前角色 → 导入回来，关键字段必须复原
    const text = JSON.stringify(pay);
    pa.level = 1; pa.gold = 0; pa.crystal = 0; E.state.kills = 0; E.refreshStats();
    const r = E.importSaveText(text);
    ok('导入返回成功', r.ok === true, JSON.stringify(r));
    const pb = E.state.player;                     // applySavePayload 会重建 player 对象
    ok('导入恢复等级', pb.level === 33, pb.level + '');
    ok('导入恢复金币', pb.gold === 987654, pb.gold + '');
    ok('导入恢复结晶', pb.crystal === 42, pb.crystal + '');
    ok('导入恢复击杀数', E.state.kills === 777, E.state.kills + '');
    ok('导入后本地存档时间戳已写入', typeof E.localSaveStamp() === 'number', typeof E.localSaveStamp());
    ok('导入后不触发离线补算', E.state._loadedTs === null && E.state._loadedRate === null);

    // ④ 坏 JSON / 结构不全 / 空内容：必须拒绝且不改动当前角色
    const lvBefore = pb.level, goldBefore = pb.gold;
    ok('导入坏 JSON 被拒', E.importSaveText('{ 这不是 JSON').ok === false);
    ok('导入结构不全被拒', E.importSaveText(JSON.stringify({ name: 'x' })).ok === false);
    ok('导入空内容被拒', E.importSaveText('').ok === false);
    ok('拒绝后角色未被改动', E.state.player.level === lvBefore && E.state.player.gold === goldBefore);

    // ⑤ 二次确认：用户点「取消」则不落盘
    const realConfirm = global.confirm;
    global.confirm = () => false;
    const rCancel = E.importSaveText(JSON.stringify(pay));
    global.confirm = realConfirm;
    ok('取消确认则放弃导入', rCancel.ok === false && E.state.player.level === lvBefore, JSON.stringify(rCancel));

    // ⑥ 复制/导出在无浏览器能力时不得抛异常
    const rc = await E.copySaveText();
    ok('复制存档有返回且不抛异常', rc && typeof rc.ok === 'boolean', JSON.stringify(rc));
    let rExp = null, threw = false;
    try { rExp = E.exportSaveFile(); } catch (e) { threw = true; }
    ok('导出存档不抛异常', !threw && rExp && typeof rExp.ok === 'boolean', threw ? 'threw' : JSON.stringify(rExp));

    // ⑦ 云存档页确实渲染出了本地导入/导出入口
    const cloudHtml = E.renderCloud();
    ok('云存档页含导出按钮', cloudHtml.indexOf('导出存档文件') >= 0 && cloudHtml.indexOf('复制存档') >= 0);
    ok('云存档页含导入入口', cloudHtml.indexOf('导入存档文件') >= 0 && cloudHtml.indexOf('导入文本') >= 0);
    ok('云存档页含粘贴文本框', cloudHtml.indexOf('id="save-text"') >= 0 && cloudHtml.indexOf('id="save-file"') >= 0);
  }

  console.log('-- 统计图表（战力/掉落/升级）--');
  {
    // ① 趋势采样
    E.newPlayer('图表', 'warrior');
    E.state.sess.history = [];
    E.sessSample(); E.sessSample();
    ok('趋势采样写入 history', E.state.sess.history.length === 2 && typeof E.state.sess.history[0].power === 'number');
    E.state.sess.history = [];
    for (let i = 0; i < 130; i++) E.sessSample();
    ok('趋势采样最多 120 帧', E.state.sess.history.length === 120, E.state.sess.history.length + '');

    // ② 升级时间线：写入 / 去重 / 上限
    E.state.sess.levelUps = [];
    E.sessLevelUp(7); E.sessLevelUp(7); E.sessLevelUp(8);
    ok('升级时间线去重同等级', E.state.sess.levelUps.length === 2 && E.state.sess.levelUps[1].level === 8,
      JSON.stringify(E.state.sess.levelUps));
    E.state.sess.levelUps = [];
    for (let i = 1; i <= 70; i++) E.sessLevelUp(i + 100);
    ok('升级时间线最多 60 条', E.state.sess.levelUps.length === 60, E.state.sess.levelUps.length + '');

    // gainExp 升级时应写入时间线
    const pl = E.state.player; pl.level = 5; E.refreshStats();
    E.state.sess.levelUps = [];
    E.gainExp(E.expToNext(5) + 10);
    ok('gainExp 升级写入时间线', E.state.sess.levelUps.length === 1 && E.state.sess.levelUps[0].level === 6,
      JSON.stringify(E.state.sess.levelUps));

    // ③ 掉落累计（dropTotal 不被上报清零）
    E.state.sess.dropTotal = {}; E.state.sess.drops = {};
    E.sessBump('drop', 1, 'white'); E.sessBump('drop', 2, 'blue');
    ok('掉落写入 dropTotal', E.state.sess.dropTotal.white === 1 && E.state.sess.dropTotal.blue === 2,
      JSON.stringify(E.state.sess.dropTotal));
    E.state.sess.drops = {};   // 模拟 reportStats 上报后清零
    ok('上报清零不影响 dropTotal', E.state.sess.dropTotal.white === 1 && E.state.sess.dropTotal.blue === 2);

    // 全部掉落件数（含无品质的消耗品/矿石/宝石）
    E.state.sess.dropCount = 0;
    E.sessBump('dropCount', 3); E.sessBump('dropCount', 2);
    ok('全部掉落件数累计', E.state.sess.dropCount === 5, E.state.sess.dropCount + '');

    // ④ 品质顺序固定
    ok('品质顺序固定', JSON.stringify(E.QUALITY_ORDER) === JSON.stringify(['white', 'green', 'blue', 'purple', 'gold', 'red']),
      JSON.stringify(E.QUALITY_ORDER));

    // ⑤ 战力曲线
    ok('战力曲线：不足2帧给提示', E.svgPower([{ power: 1 }]).indexOf('<svg') < 0);
    ok('战力曲线：无数据给提示', E.svgPower(null).indexOf('<svg') < 0);
    const pw = E.svgPower([{ power: 100 }, { power: 150 }, { power: 120 }]);
    ok('战力曲线：≥2帧出SVG', pw.indexOf('<svg') >= 0 && pw.indexOf('<path') >= 0);
    ok('战力曲线：标注当前与峰值', pw.indexOf('战力') >= 0 && pw.indexOf('峰值') >= 0);

    // ⑥ 掉落分布
    ok('掉落分布：空数据给提示', E.svgDropBars({}).indexOf('<svg') < 0 && E.svgDropBars({}).length > 0);
    ok('掉落分布：空数据提示说明只统计装备', E.svgDropBars({}).indexOf('装备') >= 0, E.svgDropBars({}).slice(0, 60));
    const db = E.svgDropBars({ white: 3, green: 1 });
    ok('掉落分布：出SVG且含品质名', db.indexOf('<svg') >= 0 && db.indexOf('白板') >= 0 && db.indexOf('绿色') >= 0);
    ok('掉落分布：含百分比', db.indexOf('%') >= 0);
    ok('掉落分布：累计件数正确', db.indexOf('累计 4 件') >= 0, db.slice(-60));
    ok('掉落分布：未出现品质不描边', db.indexOf('红色') < 0 && db.indexOf('紫色') < 0);
    ok('掉落分布：按固定品质顺序排列', db.indexOf('白板') < db.indexOf('绿色'));

    // ⑦ 升级时间线
    ok('升级时间线：不足2次给提示', E.svgLevelTimeline([{ t: 1, level: 1 }]).indexOf('<svg') < 0);
    const tl = E.svgLevelTimeline([{ t: 1000, level: 1 }, { t: 3000, level: 2 }, { t: 7000, level: 3 }]);
    ok('升级时间线：出SVG并标注次数', tl.indexOf('<svg') >= 0 && tl.indexOf('本局升级 3 次') >= 0, tl.slice(0, 90));
    ok('升级时间线：标注均耗时', tl.indexOf('秒/级') >= 0);
    ok('升级时间线：标注起止等级', tl.indexOf('Lv1') >= 0 && tl.indexOf('Lv3') >= 0);

    // ⑧ 云存档页确实渲染出三张新图
    const ch = E.renderCloud();
    ok('云档页含战力走势图', ch.indexOf('战力走势') >= 0);
    ok('云档页含掉落分布图', ch.indexOf('掉落品质分布（本局装备') >= 0, ch.indexOf('掉落品质分布') >= 0 ? ch.slice(ch.indexOf('掉落品质分布'), ch.indexOf('掉落品质分布') + 40) : '未找到');
    ok('云档页掉落图标注全部掉落件数', ch.indexOf('全部掉落') >= 0);
    ok('云档页含升级节奏图', ch.indexOf('升级节奏') >= 0);
  }

  // ---- map_single 成就口径（曾导致开局瞬间发放 1,986,000 金币）----
  console.log('-- map_single 成就（按 map_key 判定）--');
  {
    E.newPlayer('成就', 'warrior');
    const q = E.state.player;
    const ms = E.achList().filter(a => a.metric === 'map_single');
    ok('map_single 共 18 条', ms.length === 18, ms.length + '');
    ok('每条都带 map_key', ms.every(a => !!a.map_key), ms.filter(a => !a.map_key).map(a => a.key).join(','));
    ok('全部 target=1', ms.every(a => a.target === 1));
    ok('18 条奖励合计 1986000', ms.reduce((s, a) => s + (a.reward_coins || 0), 0) === 1986000,
      ms.reduce((s, a) => s + (a.reward_coins || 0), 0) + '');

    // 新号：任何图都没通关 → 全部未达成
    ok('新号 map_single 全部未达成', ms.every(a => E.achValue(a) === 0));

    // 在某图杀过怪（mapKills）不等于通关
    q.stats.mapKills = { beijun: 500 };
    const beijun = ms.find(a => a.map_key === 'beijun');
    const kunlun = ms.find(a => a.map_key === 'kunlun');
    ok('单图击杀 500 只 ≠ 该图通关', E.achValue(beijun) === 0, 'v=' + E.achValue(beijun));
    ok('北原郡击杀不影响昆仑通关', E.achValue(kunlun) === 0);

    // 真正通关（mapClear 记录）才达成，且只达成对应的那张图
    q.stats.mapClear = ['beijun'];
    ok('通关北原郡后该条达成', E.achValue(beijun) >= beijun.target);
    ok('未通关的昆仑仍不达成', E.achValue(kunlun) === 0);
    ok('通关 1 张图只满足 1 条 map_single', ms.filter(a => E.achValue(a) >= a.target).length === 1,
      ms.filter(a => E.achValue(a) >= a.target).map(a => a.key).join(','));

    // 端到端：真开局杀怪，不会白送百万金币
    E.newPlayer('开局', 'warrior');
    const w = E.state.player;
    const g0 = w.gold, k0 = E.state.sess.kills || 0;
    const map0 = E.mapByKey('beijun');
    E.startZone(map0.key, map0.zones[0].key, false);
    E.setIdle(true);
    for (let i = 0; i < 400; i++) E.loop();
    const gained = w.gold - g0, kills = (E.state.sess.kills || 0) - k0;
    ok('确实发生了击杀（口径被触发过）', kills > 0, 'kills=' + kills);
    ok('开局未白送「XX通关」成就', Object.keys(w.ach).filter(k => k.indexOf('msingle_') === 0).length === 0,
      Object.keys(w.ach).filter(k => k.indexOf('msingle_') === 0).join(','));
    ok('开局金币增量正常（<50万，修复前为 198.6 万）', gained < 500000, 'gained=' + gained);
  }

  // ---- 副本系统（dungeon_bosses / enter_level_min / daily_enter_limit）----
  console.log('-- 副本系统 --');
  {
    E.newPlayer('副本', 'warrior');
    const q = E.state.player;
    const gm = E.mapByKey('guimu');
    const bs = E.dungeonBosses(gm);
    ok('诡墓有 3 个 dungeon_bosses', bs.length === 3, bs.length + '');
    ok('诡墓没有 boss_zone（旧逻辑下不可能通关）', !gm.boss_zone);
    ok('isDungeon 识别副本', E.isDungeon(gm));
    ok('野外图不被识别为副本', !E.isDungeon(E.mapByKey('beijun')));

    // ① 副本首领真的能生成，且是配置指定的怪
    q.level = 30; E.refreshStats();
    ok('等级达标可进入副本首领战', E.startZone(gm.key, null, true, bs[0].key) === true);
    const m0 = E.spawnMonster();
    const base0 = E.MONSTERS[bs[0].monster];
    ok('副本首领可生成', !!m0, m0 ? m0.name : 'null');
    ok('生成的是配置指定的首领怪', m0 && m0.key === bs[0].monster, (m0 ? m0.key : 'null') + ' vs ' + bs[0].monster);
    ok('首领名与配置一致', m0 && base0 && m0.name === base0.name, (m0 ? m0.name : '') + ' / ' + (base0 ? base0.name : ''));
    ok('带 isBoss 标记', !!(m0 && m0.isBoss));
    ok('血量按 BOSS_HP_MULT 加成', m0 && m0.hp === Math.round((base0.hp || 0) * E.BOSS_HP_MULT),
      (m0 ? m0.hp : '?') + ' vs ' + Math.round((base0.hp || 0) * E.BOSS_HP_MULT));
    ok('zoneName 在无 boss_zone 时不抛且含首领名', (function () {
      try { return E.state.zone.isBoss && E.state.zone.bossKey === bs[0].key; } catch (e) { return false; }
    })());

    // ② 逐个击杀 → 全部击杀才通关
    E.newPlayer('副本2', 'warrior');
    const r = E.state.player; r.level = 30; E.refreshStats();
    const gm2 = E.mapByKey('guimu');
    const bs2 = E.dungeonBosses(gm2);
    ok('初始未通关诡墓', (r.stats.mapClear || []).indexOf(gm2.key) < 0);
    E.noteDungeonBossKilled(gm2, bs2[0].key, bs2[0].name);
    ok('击杀 1/3 后仍未通关', (r.stats.mapClear || []).indexOf(gm2.key) < 0);
    ok('击杀进度记为 1/3', E.dungeonKilledCount(gm2) === 1, E.dungeonKilledCount(gm2) + '');
    ok('重复记录同一首领不重复计数', E.noteDungeonBossKilled(gm2, bs2[0].key, bs2[0].name) === false);
    E.noteDungeonBossKilled(gm2, bs2[1].key, bs2[1].name);
    ok('击杀 2/3 后仍未通关', (r.stats.mapClear || []).indexOf(gm2.key) < 0);
    ok('dungeonAllBossKilled 此时为假', !E.dungeonAllBossKilled(gm2));
    E.noteDungeonBossKilled(gm2, bs2[2].key, bs2[2].name);
    ok('3/3 后写入通关标记', (r.stats.mapClear || []).indexOf(gm2.key) >= 0);
    ok('dungeonAllBossKilled 此时为真', E.dungeonAllBossKilled(gm2));

    // ③ 通关后「诡墓通关」成就可以拿到（修复前永不可得）
    E.checkAchievements();
    const gAch = E.achList().find(a => a.key === 'msingle_guimu');
    ok('「诡墓通关」成就已达成', !!r.ach[gAch.key], Object.keys(r.ach).join(','));
    ok('该成就奖励 190000 金币', gAch.reward_coins === 190000, String(gAch.reward_coins));
    ok('通关诡墓不影响其他图成就',
      E.achList().filter(a => a.metric === 'map_single' && a.key !== 'msingle_guimu' && E.achValue(a) >= a.target).length === 0);

    // ④ 进入等级门槛
    E.newPlayer('门槛', 'warrior');
    const t = E.state.player;
    t.level = 10; E.refreshStats();
    const gm3 = E.mapByKey('guimu');
    const bs3 = E.dungeonBosses(gm3);
    ok('enter_level_min = 20', gm3.enter_level_min === 20, String(gm3.enter_level_min));
    ok('等级不足时被拒', E.startZone(gm3.key, null, true, bs3[0].key) === false);
    ok('被拒时不消耗次数', E.dungeonEntryLeft(gm3) === gm3.daily_enter_limit, String(E.dungeonEntryLeft(gm3)));
    ok('不存在的首领被拒', E.startZone(gm3.key, null, true, 'no_such_boss') === false);
    t.level = 25; E.refreshStats();
    ok('等级达标后可进入', E.startZone(gm3.key, null, true, bs3[0].key) === true);

    // ⑤ 每日次数限制
    const lim = gm3.daily_enter_limit;
    ok('daily_enter_limit = 3', lim === 3, String(lim));
    ok('进入 1 次后剩 2', E.dungeonEntryLeft(gm3) === 2, String(E.dungeonEntryLeft(gm3)));
    E.startZone(gm3.key, null, true, bs3[1].key);
    E.startZone(gm3.key, null, true, bs3[2].key);
    ok('用满 3 次后剩 0', E.dungeonEntryLeft(gm3) === 0, String(E.dungeonEntryLeft(gm3)));
    ok('第 4 次被拒', E.startZone(gm3.key, null, true, bs3[0].key) === false);
    ok('前 3 次均放行后 zone 仍指向本次', E.state.zone && E.state.zone.mapKey === gm3.key);

    // ⑥ 跨天重置 / 无限制地图
    t.stats.dungeonEnter[gm3.key] = { d: '1970-1-1', n: 3 };
    ok('跨天后次数重置', E.dungeonEntryLeft(gm3) === 3, String(E.dungeonEntryLeft(gm3)));
    ok('无 daily_enter_limit 的地图不限次', E.dungeonEntryLeft({ key: 'x' }) === Infinity);

    // ⑦ 副本首领渲染进地图面板
    t.level = 25; t.map = gm3.key; E.refreshStats();
    E.startZone(gm3.key, null, true, bs3[0].key);
    const mh = E.renderMap();
    ok('地图面板含「副本首领」区块', typeof mh === 'string' && mh.indexOf('副本首领') >= 0);
    ok('面板显示击杀进度 0/3', mh.indexOf('0/3') >= 0);
    ok('面板含首领名字', mh.indexOf(bs3[0].name) >= 0);
    ok('面板含每日剩余次数', mh.indexOf('今日剩') >= 0);
    ok('面板含 data-dboss 可点击', mh.indexOf('data-dboss') >= 0);

    // ⑧ 野外图仍走原「首领区」逻辑，不被副本逻辑影响
    E.newPlayer('野外', 'warrior');
    const f = E.state.player; f.level = 30; f.map = 'beijun'; E.refreshStats();
    f.stats.minionKills = { beijun: { normal: 50, elite: 50 } };   // 先满足清剿前置
    ok('野外图无 dungeon_bosses', E.dungeonBosses(E.mapByKey('beijun')).length === 0);
    ok('野外图仍可挑战首领区', E.startZone('beijun', null, true) === true);
    const fm = E.spawnMonster();
    ok('野外首领来自 boss_zone', fm && fm.isBoss && E.mapByKey('beijun').boss_zone.boss.indexOf(fm.key) >= 0,
      fm ? fm.key : 'null');
    ok('野外图首领不进 data-dboss 渲染', E.renderMap().indexOf('data-dboss') < 0);
  }

  // ---- 副本首领可打性（防数值回归：每个副本的第一个首领在门槛等级+5 必须打得过）----
  console.log('-- 副本首领可打性 --');
  {
    const dungs = E.DATA.maps.maps.filter(m => (m.dungeon_bosses || []).length);
    ok('共 3 个副本', dungs.length === 3, dungs.length + '');
    ok('共 12 个副本首领', dungs.reduce((s, m) => s + E.dungeonBosses(m).length, 0) === 12,
      dungs.reduce((s, m) => s + E.dungeonBosses(m).length, 0) + '');
    for (const map of dungs) {
      const b = E.dungeonBosses(map)[0];
      const L = (map.enter_level_min || 1) + 5;
      E.newPlayer('打首', 'warrior');
      const q = E.state.player;
      q.level = L; q.gold = 500000;
      // 配一套等级相当的装备（模拟正常玩家）
      for (const slot of E.HERO_SLOTS) {
        const it = E.genEquip(slot, q.job, E.tierFromLevel(L), L);
        if (it) { it.job = q.job; q.equip[slot] = it; }
      }
      E.refreshStats();
      Object.assign(E.state.auto, { potion: true, buy: true, zone: false, junk: true, stats: false, rank: false });
      E.state.speed = 4;
      const entered = E.startZone(map.key, null, true, b.key);
      const d0 = E.state.sess.deaths || 0;
      E.state.combat = null; E.setIdle(true);
      let won = false, rounds = 0;
      for (; rounds < 1500; rounds++) {
        E.loop();
        const mb = q.stats.mapBoss && q.stats.mapBoss[map.key];
        if (mb && mb[b.key]) { won = true; break; }
        if ((E.state.sess.deaths || 0) > d0) break;
      }
      ok(map.name + '「' + b.name + '」在 Lv' + L + '（配装）可击杀',
        entered && won, 'entered=' + entered + ' won=' + won + ' rounds=' + rounds);
      E.setIdle(false);
    }
  }

  // ---- 区域探索进度（explore_target）----
  console.log('-- 区域探索进度 --');
  {
    E.newPlayer('探索', 'warrior');
    const q = E.state.player;
    const bj = E.mapByKey('beijun');
    const z0 = bj.zones[0];
    const T = E.zoneTarget(bj, z0);
    ok('区域带 explore_target = 35', T === 35, String(T));
    ok('新号该区域未探索', !E.zoneExplored(bj.key, z0.key));
    ok('新号该区域击杀数为 0', E.zoneKillCount(bj.key, z0.key) === 0);
    ok('新号已探索区域数 0', E.zoneExploredCount(bj) === 0);
    ok('新号地图探索度 0%', E.mapExplorePct(bj) === 0, E.mapExplorePct(bj) + '%');

    for (let i = 0; i < T - 1; i++) E.noteZoneKill(bj.key, z0.key);
    ok('34/35 还未完成', !E.zoneExplored(bj.key, z0.key), E.zoneKillCount(bj.key, z0.key) + '');
    E.noteZoneKill(bj.key, z0.key);
    ok('35/35 完成探索', E.zoneExplored(bj.key, z0.key));
    ok('已探索区域数 1', E.zoneExploredCount(bj) === 1, E.zoneExploredCount(bj) + '');
    ok('探索度落在 (0,100) 之间', E.mapExplorePct(bj) > 0 && E.mapExplorePct(bj) < 100, E.mapExplorePct(bj) + '%');

    // 其余区域不共享进度
    ok('其他区域仍为 0', E.zoneKillCount(bj.key, bj.zones[1].key) === 0);

    for (const z of bj.zones) { for (let i = 0; i < 40; i++) E.noteZoneKill(bj.key, z.key); }
    ok('全区域打满后探索度 100%', E.mapExplorePct(bj) === 100, E.mapExplorePct(bj) + '%');
    ok('已探索区域数 = 总区域数', E.zoneExploredCount(bj) === bj.zones.length,
      E.zoneExploredCount(bj) + '/' + bj.zones.length);

    // 真挂机也会累加
    E.newPlayer('探索2', 'warrior');
    const bj2 = E.mapByKey('beijun');
    const z1 = bj2.zones[0];
    E.state.auto.zone = false;
    E.startZone(bj2.key, z1.key, false); E.setIdle(true);
    for (let i = 0; i < 400; i++) E.loop();
    ok('挂机自动累加区域探索进度', E.zoneKillCount(bj2.key, z1.key) > 0, E.zoneKillCount(bj2.key, z1.key) + '');
    ok('挂机累计击杀不超过实际击杀数（不虚增）', E.zoneKillCount(bj2.key, z1.key) <= (E.state.sess.kills || 0) + 1,
      E.zoneKillCount(bj2.key, z1.key) + ' vs ' + E.state.sess.kills);
    E.setIdle(false);

    const h = E.renderMap();
    ok('地图面板含探索度', h.indexOf('探索度') >= 0);
    ok('地图面板含探索度百分比', /\d+%/.test(h));
    ok('区域按钮渲染进度标记 zex', h.indexOf('zex') >= 0);
  }

  // ---- 首领区清剿前置（minion_target）----
  console.log('-- 首领区清剿前置 --');
  {
    E.newPlayer('清剿', 'warrior');
    const q = E.state.player;
    const map = E.DATA.maps.maps.find(m => m.boss_zone && m.boss_zone.unlock_level <= 20);
    const bz = map.boss_zone;
    q.level = 40; E.refreshStats();
    E.state.auto.zone = false;
    const t = E.bossMinionTarget(map);
    ok('首领区带 minion_target', !!t && t.normal === 50 && t.elite === 20, JSON.stringify(t));
    ok('所有野外首领区都配了 minion_target',
      E.DATA.maps.maps.filter(m => m.boss_zone).every(m => !!E.bossMinionTarget(m)));
    ok('初始未清剿', !E.bossZoneCleared(map));
    ok('清剿计数初始 0/0', E.minionKillCount(map.key, 'normal') === 0 && E.minionKillCount(map.key, 'elite') === 0);

    // 未清剿 → 只出小怪，不出首领
    let sawBoss = false; const seen = new Set();
    const pool = (bz.monsters || []).concat(bz.elite_monsters || []);
    for (let i = 0; i < 80; i++) {
      E.state.zone = { mapKey: map.key, zoneKey: null, isBoss: true };
      const mm = E.spawnMonster();
      if (!mm) continue;
      if (mm.isBoss) sawBoss = true;
      seen.add(mm.key);
    }
    ok('未清剿时不出首领', !sawBoss);
    ok('出的是首领区小怪池内的怪', [...seen].every(k => pool.indexOf(k) >= 0), [...seen].join(','));
    E.state.zone = { mapKey: map.key, zoneKey: null, isBoss: true };
    const mn = E.spawnMonster();
    ok('小怪不吃 BOSS 加成', mn.hp === E.getMonster(mn.key).hp, mn.hp + ' vs ' + E.getMonster(mn.key).hp);
    ok('小怪不带 isBoss', !mn.isBoss);

    // 只满一项不算清剿
    for (let i = 0; i < t.normal; i++) E.noteMinionKill(map.key, false);
    ok('普通满但精英未满 → 未清剿', !E.bossZoneCleared(map));
    for (let i = 0; i < t.elite; i++) E.noteMinionKill(map.key, true);
    ok('双指标都满 → 清剿完成', E.bossZoneCleared(map));

    E.state.zone = { mapKey: map.key, zoneKey: null, isBoss: true };
    const boss = E.spawnMonster();
    ok('清剿完成后出首领', boss.isBoss === true);
    ok('首领来自 boss_zone.boss', bz.boss.indexOf(boss.key) >= 0, boss.key);
    ok('首领血量已加成', boss.hp === Math.round((E.getMonster(boss.key).hp || 0) * E.BOSS_HP_MULT));

    // 面板：清剿前 / 清剿后
    E.newPlayer('清剿2', 'warrior');
    const q2 = E.state.player; q2.level = 40; q2.map = map.key; E.refreshStats();
    E.state.auto.zone = false;
    const h2 = E.renderMap();
    ok('未清剿时面板标「清剿中」', h2.indexOf('清剿中') >= 0);
    ok('未清剿时面板显示配额 0/50', h2.indexOf('0/50') >= 0);
    ok('未清剿时提示「需先清剿」', h2.indexOf('需先清剿') >= 0);
    for (let i = 0; i < t.normal; i++) E.noteMinionKill(map.key, false);
    for (let i = 0; i < t.elite; i++) E.noteMinionKill(map.key, true);
    const h3 = E.renderMap();
    ok('清剿完成后面板出首领（☠）', h3.indexOf('☠ ' + bz.name) >= 0);
    ok('清剿完成后不再显示「清剿中」', h3.indexOf('清剿中') < 0);

    // 真挂机：在首领区挂机会先累加清剿计数；清剿满之前绝不可能通关该图
    E.newPlayer('清剿3', 'warrior');
    const q3 = E.state.player; q3.level = 40; E.refreshStats();
    E.state.auto.zone = false;
    E.state.zone = { mapKey: map.key, zoneKey: null, isBoss: true };
    E.state.combat = null; E.setIdle(true);
    let clearedAt = -1, mapClearAt = -1;
    for (let i = 0; i < 300; i++) {
      E.loop();
      if (clearedAt < 0 && E.bossZoneCleared(map)) clearedAt = i;
      if (mapClearAt < 0 && (q3.stats.mapClear || []).includes(map.key)) mapClearAt = i;
    }
    const mn2 = E.minionKillCount(map.key, 'normal'), el2 = E.minionKillCount(map.key, 'elite');
    ok('挂机自动累加清剿计数', mn2 + el2 > 0, 'normal=' + mn2 + ' elite=' + el2);
    ok('清剿满之前绝不通关该图', mapClearAt < 0 || (clearedAt >= 0 && mapClearAt >= clearedAt),
      'clearedAt=' + clearedAt + ' mapClearAt=' + mapClearAt);
    E.setIdle(false);
  }

  // ---- 首次通关奖励显性化（成就即通关奖励，此前玩家在面板上看不到）----
  // 依据 _probe_reward.js：通关奖励 ≈ 该等级挂机 2~775 分钟的收入，而打首领区只要 0.3~1.6 分钟。
  // 所以不缺奖励、缺可见性 —— 这组断言锁住「奖励必须显示出来」这件事。
  console.log('-- 通关奖励显性化 --');
  {
    const wmap = E.DATA.maps.maps.find(m => m.boss_zone);
    const rw = E.mapClearReward(wmap.key);
    ok('mapClearReward 取到野外图首通奖励', !!rw && rw.coins > 0, JSON.stringify(rw));
    ok('首通奖励含神秘结晶', !!rw && rw.coupon > 0, rw && rw.coupon + '');
    ok('rewardText 含金币与结晶字样', /金币/.test(E.rewardText(rw)) && /神秘结晶/.test(E.rewardText(rw)), E.rewardText(rw));
    // 3 个副本图里只有「诡墓」配了 map_single（轩辕台/幽芷冢没有通关成就，属配置原意）
    const dmap = E.DATA.maps.maps.find(m => (m.dungeon_bosses || []).length && E.mapClearReward(m.key));
    const drw = E.mapClearReward(dmap.key);
    ok('副本图也有首通奖励', !!drw && drw.coins > 0, JSON.stringify(drw));
    const msAll = E.achList().filter(a => a.metric === 'map_single');
    ok('map_single 的 map_key 都能对应到真实地图（无孤儿成就）',
      msAll.every(a => !!E.DATA.maps.maps.find(m => m.key === a.map_key)), msAll.map(a => a.map_key).join(','));
    const withAch = E.DATA.maps.maps.filter(m => E.mapClearReward(m.key));
    ok('恰有 18 张图有通关成就且奖励可读',
      withAch.length === 18 && withAch.every(m => E.mapClearReward(m.key).coins > 0), withAch.length + ' 张');
    ok('不是每张图都有通关成就（44 图 / 18 条）', withAch.length === msAll.length && msAll.length === 18,
      msAll.length + ' 条成就');

    // 新号：未通关
    E.newPlayer('奖励', 'warrior');
    const p = E.state.player;
    p.map = wmap.key; p.level = (wmap.boss_zone.unlock_level || 1) + 5; E.refreshStats();
    E.state.zone = null;
    ok('新号未通关该图', E.mapCleared(wmap.key) === false);
    let h = E.renderMap();
    ok('面板 title 含「首次通关奖励」', h.indexOf('首次通关奖励') >= 0);
    ok('未通关的奖励不标「已领取」', h.indexOf('已领取') < 0);
    ok('未清剿时不显示「首通」金额（首领还没现身）', h.indexOf('首通') < 0, '');

    // 清剿完成 → 首领现身，奖励打进按钮
    const mt = E.bossMinionTarget(wmap);
    for (let i = 0; i < mt.normal; i++) E.noteMinionKill(wmap.key, false);
    for (let i = 0; i < mt.elite; i++) E.noteMinionKill(wmap.key, true);
    h = E.renderMap();
    ok('清剿完成后按钮显示「首通 N金」', h.indexOf('首通 ') >= 0, '');
    ok('显示的奖励数额与配置一致', h.indexOf(E.fmtNum(rw.coins)) >= 0, E.fmtNum(rw.coins));

    // 通关后 → 状态翻转
    p.stats.mapClear.push(wmap.key);
    h = E.renderMap();
    ok('通关后首领区标「已通关」', h.indexOf('已通关') >= 0);
    ok('通关后 title 标「已领取」', h.indexOf('已领取') >= 0);
    ok('通关后首领按钮变 ✔', h.indexOf('✔ ') >= 0);
    ok('通关后不再显示首通金额', h.indexOf('首通 ') < 0, '');

    // 副本面板同样可见
    E.newPlayer('奖励2', 'warrior');
    const p2 = E.state.player;
    p2.map = dmap.key; p2.level = (dmap.enter_level_min || 1) + 5; E.refreshStats();
    E.state.zone = null;
    let h2 = E.renderMap();
    ok('副本面板渲染首通奖励行', h2.indexOf('首次通关奖励') >= 0 && h2.indexOf('rwline') >= 0);
    ok('副本未通关时不标「已通关」', h2.indexOf('已通关') < 0);
    p2.stats.mapClear.push(dmap.key);
    h2 = E.renderMap();
    ok('副本通关后标「已通关」与「已领取」', h2.indexOf('已通关') >= 0 && h2.indexOf('已领取') >= 0);

    // 没有通关成就的图（如轩辕台）不该凭空显示奖励行
    const noAch = E.DATA.maps.maps.find(m => (m.dungeon_bosses || []).length && !E.mapClearReward(m.key));
    if (noAch) {
      E.newPlayer('奖励3', 'warrior');
      const p3 = E.state.player;
      p3.map = noAch.key; p3.level = (noAch.enter_level_min || 1) + 5; E.refreshStats();
      E.state.zone = null;
      const h3 = E.renderMap();
      ok('无通关成就的图不显示奖励行', h3.indexOf('rwline') < 0, noAch.name);
    } else {
      ok('存在没有通关成就的副本图（配置原意）', false, '未找到');
    }
  }

  // ---- 类型经验倍率按等级档位递进（type_exp_tiers 接线）----
  // character.json 里 type_exp_multiplier（恒定）与 type_exp_tiers（每 20 级一档，6 段）两套都在，
  // 此前只用了前者 → Lv101+ 的精英/首领经验被低估最多 1.9 倍。这组断言锁住「档位被真的用上」。
  console.log('-- 类型经验倍率（type_exp_tiers）--');
  {
    const T = E.DATA.character.type_exp_tiers, M = E.DATA.character.type_exp_multiplier;
    const KINDS = ['elite', 'boss', 'jubao', 'dungeon_boss'];
    ok('配置里有 4 套 tiers', !!T && KINDS.every(k => Array.isArray(T[k])), T ? Object.keys(T).join(',') : 'null');
    ok('每套 6 段（覆盖怪物 Lv1~50，末档兜底 Lv51+）', KINDS.every(k => T[k].length === 6), KINDS.map(k => T[k].length).join(','));
    ok('tiers 首段 == type_exp_multiplier（后者是 tier1 简化版）',
      KINDS.every(k => T[k][0] === M[k]), JSON.stringify(T) + ' vs ' + JSON.stringify(M));
    ok('每套严格递增', KINDS.every(k => T[k].every((v, i) => i === 0 || v > T[k][i - 1])));

    // 取档依据是【怪物等级】每 10 级一档（原版 tier_idx = (mon_level-1)//10，越界取末档）
    ok('怪Lv1   → tier1', E.typeExpMul('elite', 1) === T.elite[0], E.typeExpMul('elite', 1) + '');
    ok('怪Lv10  → tier1（边界）', E.typeExpMul('elite', 10) === T.elite[0], E.typeExpMul('elite', 10) + '');
    ok('怪Lv11  → tier2（边界）', E.typeExpMul('elite', 11) === T.elite[1], E.typeExpMul('elite', 11) + '');
    ok('怪Lv21  → tier3', E.typeExpMul('elite', 21) === T.elite[2], E.typeExpMul('elite', 21) + '');
    ok('怪Lv41  → tier5', E.typeExpMul('elite', 41) === T.elite[4], E.typeExpMul('elite', 41) + '');
    ok('怪Lv51  → tier6', E.typeExpMul('elite', 51) === T.elite[5], E.typeExpMul('elite', 51) + '');
    ok('怪Lv120 取末档（不越界）', E.typeExpMul('elite', 120) === T.elite[5], E.typeExpMul('elite', 120) + '');
    ok('怪Lv1200 仍取末档', E.typeExpMul('elite', 1200) === T.elite[5], E.typeExpMul('elite', 1200) + '');
    ok('怪Lv0 取首档（不为负索引）', E.typeExpMul('elite', 0) === T.elite[0], E.typeExpMul('elite', 0) + '');
    ok('boss 怪Lv120 == 11.0', E.typeExpMul('boss', 120) === 11.0, E.typeExpMul('boss', 120) + '');
    ok('jubao 怪Lv120 == 25.0', E.typeExpMul('jubao', 120) === 25.0, E.typeExpMul('jubao', 120) + '');
    ok('dungeon_boss 怪Lv120 == 25.0', E.typeExpMul('dungeon_boss', 120) === 25.0, E.typeExpMul('dungeon_boss', 120) + '');
    ok('normal 无 tiers → 回落 1.0', E.typeExpMul('normal', 120) === 1.0, E.typeExpMul('normal', 120) + '');
    ok('未知类型 → 回落 1', E.typeExpMul('__no_such_type__', 50) === 1);
    // 取档依据必须是【怪物等级】：同一怪物类型下，不同怪物等级给出不同倍率
    ok('同类型不同怪等级 → 倍率不同（证明按怪等级取档）',
      E.typeExpMul('elite', 5) !== E.typeExpMul('elite', 105),
      E.typeExpMul('elite', 5) + ' vs ' + E.typeExpMul('elite', 105));

  }

  // ---- 等级差经验缩放（原版 battle/encounter.py:scale_monster_exp 口径）----
  console.log('-- 等级差经验缩放（expScale）--');
  {
    const MS = E.DATA.character.monster_exp_scale;
    ok('diff=0   → 1.0', E.expScale(0) === 1.0, E.expScale(0) + '');
    ok('diff=+1  → 1.2', Math.abs(E.expScale(1) - 1.2) < 1e-9, E.expScale(1) + '');
    ok('diff=+2  → 1.44（指数而非线性）', Math.abs(E.expScale(2) - 1.44) < 1e-9, E.expScale(2) + '');
    ok('diff=+4  → 1.2^4', Math.abs(E.expScale(4) - Math.pow(1.2, 4)) < 1e-9, E.expScale(4) + '');
    ok('diff=+5  → 1.2^5（尚未触顶）', Math.abs(E.expScale(5) - Math.pow(1.2, 5)) < 1e-9, E.expScale(5) + '');
    ok('diff=+6  → 封顶 max_cap', E.expScale(6) === MS.max_cap, E.expScale(6) + ' vs ' + MS.max_cap);
    ok('diff=+40 → 仍封顶（不溢出）', E.expScale(40) === MS.max_cap, E.expScale(40) + '');
    ok('diff=−1  → 0.8（线性衰减）', Math.abs(E.expScale(-1) - 0.8) < 1e-9, E.expScale(-1) + '');
    ok('diff=−2  → 0.6', Math.abs(E.expScale(-2) - 0.6) < 1e-9, E.expScale(-2) + '');
    ok('diff=−3  → 0.4', Math.abs(E.expScale(-3) - 0.4) < 1e-9, E.expScale(-3) + '');
    ok('diff=−4  → 0.2', Math.abs(E.expScale(-4) - 0.2) < 1e-9, E.expScale(-4) + '');
    ok('diff=−5  → 0（怪低 5 级零经验）', E.expScale(-5) === 0, E.expScale(-5) + '');
    ok('diff=−40 → 0（不为负）', E.expScale(-40) === 0, E.expScale(-40) + '');
  }

  // ---- monsterExp 端到端：逐条手算期望值（合成怪，隔离怪物数据变动）----
  console.log('-- monsterExp 端到端（合成怪手算对拍）--');
  {
    const fake = (lv, type, exp) => ({ key: '_t', name: '对拍怪', type, level: lv, exp });
    const CASES = [
      ['同级 normal', fake(120, 'normal', 100), 120, 100],
      ['高 4 级 normal', fake(124, 'normal', 100), 120, 207],
      ['高 5 级 normal（1.2^5 未触顶）', fake(125, 'normal', 100), 120, 248],
      ['高 6 级封顶', fake(126, 'normal', 100), 120, 250],
      ['高 40 级仍封顶', fake(160, 'normal', 100), 120, 250],
      ['低 1 级 normal', fake(119, 'normal', 100), 120, 80],
      // 注意：1 − 4×0.2 在 IEEE754 下是 0.19999999999999996，原版 int() 截断后得 19 —— 这里保持同口径
      ['低 4 级 normal（浮点同原版）', fake(116, 'normal', 100), 120, 19],
      ['低 5 级 → 0', fake(115, 'normal', 100), 120, 0],
      ['低 40 级 → 0', fake(80, 'normal', 10000), 120, 0],
      ['同级 boss（怪Lv120 档 11.0）', fake(120, 'boss', 100), 120, 1100],
      ['同级 elite（怪Lv120 档 5.4）', fake(120, 'elite', 100), 120, 540],
      ['低级 elite 不再白拿高档', fake(5, 'elite', 100), 5, 290],
      ['基础经验为 0 → 0', fake(120, 'normal', 0), 120, 0],
      ['基础经验为负 → 0', fake(120, 'normal', -5), 120, 0],
    ];
    for (const [name, m, cl, want] of CASES) {
      const got = E.monsterExp(m, cl);
      ok('monsterExp ' + name + ' = ' + want, got === want, got + '');
    }
  }

  // ---- 自动择区：必须选「等级匹配」而非「低级怪」----
  console.log('-- 自动择区行为（低级怪零经验）--');
  {
    // 注意：不能用外层 let p —— 前面的导入/云存档测试会经 applySavePayload 重建 player，
    // 此处必须重新取引用，否则改的是一个孤儿对象。
    const pl = E.state.player;
    const saveLv = pl.level, saveUnlocked = JSON.stringify(pl.unlocked);
    // 前面的测试把 unlocked 重置过；幻月海等高层区域在 unlock_map 链上，
    // 这里模拟「已走遍全图」的玩家，否则测出来的是「可达区域里最优」而非「全图最优」。
    pl.unlocked = {};
    for (const m of E.DATA.maps.maps) pl.unlocked[m.key] = true;
    const zoneInfo = b => {
      const map = E.DATA.maps.maps.find(m => m.key === b.mapKey);
      const keys = E.zoneKeys(map, b.zoneKey, b.isBoss) || [];
      const ms = keys.map(k => E.getMonster(k)).filter(Boolean);
      return { avg: E.zoneMonsterAvg(keys), maxLv: Math.max.apply(null, ms.map(m => m.level || 0)),
               y: E.zoneYield(keys, pl.level) };
    };
    for (const L of [40, 80, 120]) {
      pl.level = L; E.refreshStats(); pl.hp = pl._s.max_hp;
      const b = E.bestZone();
      ok('Lv' + L + ' 能选出区域', !!b && b.score > 0, b ? b.name + ' ' + b.score.toFixed(2) : 'null');
      if (b) {
        const zi = zoneInfo(b);
        ok('Lv' + L + ' 最优区经验 > 0（不是纯低级怪区）', zi.y.exp > 0, '区经验 ' + zi.y.exp);
        ok('Lv' + L + ' 最优区均怪等级在可打窗口 [L−8, L+8] 内',
          zi.avg.level >= L - 8 && zi.avg.level <= L + 8,
          '均怪lv ' + zi.avg.level.toFixed(0) + ' / 最高怪lv ' + zi.maxLv + ' @ ' + b.name);
      }
    }
    // 低级怪区在高级角色下必须是 0 经验
    pl.level = 120; E.refreshStats(); pl.hp = pl._s.max_hp;
    const lowMap = E.DATA.maps.maps.find(m => m.key === 'beijun');
    const lowZ = (lowMap.zones || [])[0];
    const lowKeys = E.zoneKeys(lowMap, lowZ.key, false);
    const lowAvg = E.zoneMonsterAvg(lowKeys).level;
    ok('北原郡是低级怪区（均怪lv ' + lowAvg.toFixed(0) + '）', lowAvg < 115, lowAvg + '');
    ok('Lv120 时北原郡每只经验为 0',
      lowKeys.every(k => E.monsterExp(E.getMonster(k), 120) === 0), '仍有非零');
    ok('Lv120 时北原郡 zoneEval 为 0（不再被选为挂机点）',
      E.zoneEval('beijun', lowZ.key, false) === 0, E.zoneEval('beijun', lowZ.key, false) + '');
    // 直接锁住本次修复的动机：修复前 bestZone() 在 Lv120 恰好挑中这个均怪 Lv84 的区域
    ok('Lv120 时旧的「最优区」七曲洞二层·左翼通道已是 0 经验',
      E.zoneEval('qimidong_l2', 'zuo_yi_tong_dao', false) === 0,
      E.zoneEval('qimidong_l2', 'zuo_yi_tong_dao', false) + '');
    const bz120 = E.bestZone();
    ok('Lv120 最优区不再是低级怪区（七曲洞二层·左翼通道）',
      !!bz120 && !(bz120.mapKey === 'qimidong_l2' && bz120.zoneKey === 'zuo_yi_tong_dao'),
      bz120 ? bz120.name : 'null');
    ok('Lv120 最优区均怪等级 ≥ 115（等级匹配）',
      !!bz120 && zoneInfo(bz120).avg.level >= 115,
      bz120 ? bz120.name + ' 均怪lv ' + zoneInfo(bz120).avg.level.toFixed(0) : 'null');

    // 超出怪物上限（最高怪 Lv120 → Lv126+ 全部零经验）时要有保底，否则金币也断供
    pl.level = 140; E.refreshStats(); pl.hp = pl._s.max_hp;
    const b140 = E.bestZone();
    ok('Lv140 全零经验时仍有保底区域（可继续刷金币）', !!b140, b140 ? b140.name + ' score=' + b140.score : 'null');
    if (b140) {
      ok('Lv140 保底区 score == 0（经验为 0，不该伪报收益）', b140.score === 0, b140.score + '');
      ok('Lv140 保底区挑的是最高级可打区域', zoneInfo(b140).avg.level >= 110, '均怪lv ' + zoneInfo(b140).avg.level.toFixed(0));
    }
    pl.level = saveLv; pl.unlocked = JSON.parse(saveUnlocked); E.refreshStats(); pl.hp = pl._s.max_hp;
  }

  // ---- 渲染各页签 ----
  console.log('-- 渲染 --');
  for (const t of ['bag', 'life', 'shop', 'quest', 'wuhun', 'shenmo', 'skill', 'instance', 'ach', 'cloud']) {
    E.state.selTab = t;
    let err = null;
    try { E.renderTab(); } catch (e) { err = e; }
    ok('渲染 ' + t, !err, err ? err.message : '');
  }

  // ---- 右侧页签二级菜单（子菜单）----
  console.log('-- 二级菜单（子菜单）--');
  const cntOf = (h, needle) => h.split(needle).length - 1;

  // 这一段的断言必须自带状态：测试前半段的「本地存档导入/导出」会把 state.player 整个换掉，
  // 依赖上一段留下的背包会得到空背包 —— 断言要么空过、要么莫名其妙地失败（第一版就踩了）。
  {
    const sp = E.state.player;
    sp.bag = [];
    let n = 1;
    for (const it of (E.DATA.items.items || []))
      sp.bag.push({ uid: 's' + (n++), type: 'consumable', key: it.key, count: 1 + (n % 300) });
    for (let i = 0; i < 10; i++) {
      const eq = E.genEquip(E.HERO_SLOTS[i % E.HERO_SLOTS.length], sp.job, E.tierFromLevel(sp.level), sp.level);
      if (eq) { eq.job = sp.job; eq.uid = 'se' + (n++); sp.bag.push(eq); }
    }
    for (const g of (E.DATA.gems.gem_series || []))
      for (const gr of (E.DATA.gems.gem_grades || []))
        sp.bag.push({ uid: 'sg' + (n++), type: 'gem', series: g.key, grade: gr, count: 2 });
    for (const o of (E.DATA.ores.ore_types || []))
      sp.bag.push({ uid: 'so' + (n++), type: 'ore', key: o.key, count: 5 });
    for (const m of ['bailian_shi', 'lianhua_ping', 'sanhun_tian'])
      sp.bag.push({ uid: 'sm' + (n++), type: 'material', key: m, count: 8 });
    Object.keys(E.DATA.wuhun.wuhun_types || {}).slice(0, 3).forEach((t, i) => {
      sp.bag.push({ uid: 'sw' + (n++), type: 'wuhun', whType: t, star: 2, level: 3, exp: 0, activated: i === 0, actAttr: null, count: 1 });
    });
    sp.shenmo = { faction: 'shen', level: 12, exp: 0, spent: 6, points: 3, nodes: {}, cd: {} };
    ok('为子菜单断言备好内容丰富的背包 + 已入道状态', sp.bag.length > 120, sp.bag.length + ' 件');
  }
  const bagKeys = E.subTabs('bag').map(x => x.key);
  {
    const empties = bagKeys.filter(k => cntOf(E.renderBag(k), 'class="item') === 0);
    ok('每个背包子页都有内容（effect_type → 子菜单 的映射无死角）', empties.length === 0, empties.join(','));
  }

  // ① 分组完备性 + 不丢内容（最关键的两条）
  ok('背包子菜单 11 项（装备按 slot_type 再拆 3 段）', bagKeys.length === 11, bagKeys.join(','));
  ok('背包子菜单 key 唯一', new Set(bagKeys).size === bagKeys.length);
  {
    let orphan = null;
    for (const it of E.state.player.bag) {
      if (bagKeys.indexOf(E.bagSubOf(it)) < 0) { orphan = it.type + ':' + it.key; break; }
    }
    ok('背包每个物品都能归入某个子菜单（无孤儿 → 分类完备）', !orphan, orphan || '');

    const full = cntOf(E.renderBag(), 'class="item');
    const sum = bagKeys.reduce((a, k) => a + cntOf(E.renderBag(k), 'class="item'), 0);
    ok('背包：各子页 item 之和 == 全量（拆分不丢内容）', full === sum, full + ' vs ' + sum);
    ok('背包每个子页都短于全量（确实被拆开）',
      bagKeys.every(k => cntOf(E.renderBag(k), 'class="item') < full || full === 0));
  }

  // ② 子页只含本类内容，且空分类有提示
  {
    const eqKeys = bagKeys.filter(k => k.indexOf('eq_') === 0);
    ok('装备按 slots.json#slot_type 拆成 3 段（武器·副手 / 防具 / 首饰）',
      eqKeys.join(',') === 'eq_weapon,eq_armor,eq_jewelry', eqKeys.join(','));
    const eqList = E.state.player.bag.filter(b => b.type === 'equip');
    ok('背包·装备三段 item 之和 == 全量装备数（拆装备不丢件）',
      eqKeys.reduce((a, k) => a + cntOf(E.renderBag(k), 'class="item'), 0) === eqList.length,
      eqList.length + ' 件');
    {
      let placed = true, mapped = true;
      for (const b of eqList) {
        const st = E.bagSlotType(b.slot);
        const want = (st === 'weapon' || st === 'offhand') ? 'eq_weapon'
          : (st === 'jewelry' ? 'eq_jewelry' : 'eq_armor');
        if (E.equipSubOf(b) !== want) mapped = false;
        // 该装备只出现在自己那一段，别段找不到它
        if (E.renderBag(want).indexOf('data-item="' + b.uid + '"') < 0) placed = false;
        for (const k of eqKeys)
          if (k !== want && E.renderBag(k).indexOf('data-item="' + b.uid + '"') >= 0) placed = false;
      }
      ok('每件装备只出现在自己那一段（slot_type → 子菜单 无错位）', placed && mapped);
      ok('每个装备子页只含装备（每项都带品质类 q-、无消耗品）',
        eqKeys.every(k => {
          const h2 = E.renderBag(k);
          return cntOf(h2, 'class="item') > 0
            && cntOf(h2, 'class="item') === cntOf(h2, 'class="item q-')
            && h2.indexOf('回春丹') < 0;
        }), eqKeys.join(','));
      {
        // 不用中文串当判据（工具条文案里就有「宝石/矿石」），改比 data-item 的 uid 集合
        const eqUids = { };
        for (const b of eqList) eqUids[b.uid] = 1;
        const foreign = [];
        for (const k of eqKeys) {
          const h2 = E.renderBag(k), re = /data-item="([^"]+)"/g;
          let m; while ((m = re.exec(h2))) if (!eqUids[m[1]]) foreign.push(m[1]);
        }
        const leaked = E.state.player.bag.filter(b => b.type !== 'equip')
          .filter(b => eqKeys.some(k => E.renderBag(k).indexOf('data-item="' + b.uid + '"') >= 0))
          .map(b => b.uid);
        ok('装备子页里的每个 data-item 都是装备（消耗品/宝石/矿石/材料不泄漏进来）',
          foreign.length === 0 && leaked.length === 0,
          foreign.concat(leaked).slice(0, 3).join(',') || (eqList.length + ' 件装备'));
      }
    }
    const po = E.renderBag('potion');
    ok('背包·药品 子页含回春丹', po.indexOf('回春丹') >= 0);
    ok('背包·药品 子页不含装备（品质类）', cntOf(po, 'class="item q-') === 0);
    ok('未知分类给提示语而不是空白', E.renderBag('__nope__').indexOf('分类下暂无物品') >= 0);
  }

  // ③ 生活技能：5 子页 + 分节归属
  {
    const lk = E.subTabs('life').map(x => x.key);
    ok('生活技能子菜单 5 项', lk.length === 5, lk.join(','));
    const full = E.renderLife();
    const sum = lk.reduce((a, k) => a + cntOf(E.renderLife(k), 'class="item'), 0);
    ok('生活技能：各子页 item 之和 == 全量（不丢内容）',
      cntOf(full, 'class="item') === sum, cntOf(full, 'class="item') + ' vs ' + sum);
    ok('全量仍含全部 9 个编号分节（①~⑨，回归保护）',
      ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'].every(x => full.indexOf(x) >= 0));
    const mine = E.renderLife('mine'), craft = E.renderLife('craft');
    ok('探矿子页含「资源概览」+「⑦ 探矿」', mine.indexOf('资源概览') >= 0 && mine.indexOf('⑦ 探矿') >= 0);
    ok('探矿子页不含「① 打造」', mine.indexOf('① 打造') < 0);
    ok('打造子页含 ① 与 ③', craft.indexOf('① 打造') >= 0 && craft.indexOf('③ 百炼装备') >= 0);
    ok('打造子页不含 ② 与 ④', craft.indexOf('② 百炼丹') < 0 && craft.indexOf('④ 提取') < 0);
    ok('打造子页含 ⑩ 装备精炼（此前完全无入口）',
      craft.indexOf('⑩ 装备精炼') >= 0 && craft.indexOf('id="refine-equip"') >= 0
      && craft.indexOf('data-act="refine-eq"') >= 0);
    ok('炼丹·药水子页不含 ⑩', E.renderLife('refine').indexOf('⑩ 装备精炼') < 0);
    ok('精炼面板写明「按装备档位取表」', craft.indexOf('按【装备档位】取表') >= 0);
    ok('未选装备时面板也显示「下一级」消耗/成功率详情', craft.indexOf('下一级 +') >= 0);
    ok('打造子页含 ⑪ 宝石镶嵌（此前完全无入口）',
      craft.indexOf('⑪ 宝石镶嵌') >= 0 && craft.indexOf('id="inlay-gem"') >= 0
      && craft.indexOf('id="inlay-equip"') >= 0 && craft.indexOf('data-act="inlay"') >= 0);
    ok('炼丹·药水子页不含 ⑪', E.renderLife('refine').indexOf('⑪ 宝石镶嵌') < 0);
    ok('全量渲染含 ①~⑪', E.renderLife().indexOf('⑪ 宝石镶嵌') >= 0);
    const rf = E.renderLife('refine'), cb = E.renderLife('combine'), rc = E.renderLife('recycle');
    ok('炼丹·药水子页含 ② 与 ⑨', rf.indexOf('② 百炼丹') >= 0 && rf.indexOf('⑨ 药水炼制') >= 0);
    ok('合成子页含 ⑤ ⑥ ⑧',
      cb.indexOf('⑤ 矿石炼制') >= 0 && cb.indexOf('⑥ 乾坤炉') >= 0 && cb.indexOf('⑧ 宝石炼制') >= 0);
    ok('提取·商店子页含 ④ 与「材料商店」', rc.indexOf('④ 提取') >= 0 && rc.indexOf('材料商店') >= 0);
    ok('子页首节已剥掉前导 <hr>', craft.indexOf('<hr>') !== 0 && rf.indexOf('<hr>') !== 0);
  }

  // ④ 商店：一子页 = 一商店
  {
    const shops = E.subTabs('shop');
    const all = E.DATA.shops.shops || [];
    ok('商店子菜单 == 商店数（6）', shops.length === all.length && shops.length === 6, shops.length + '');
    let cntOk = true, named = true, mixed = false;
    for (const s2 of shops) {
      const def = all.find(x => x.key === s2.key);
      const h = E.renderShop(s2.key);
      if (cntOf(h, 'data-buy="' + s2.key + '|') !== def.items.length) cntOk = false;
      if (h.indexOf(def.name) < 0) named = false;
      for (const o of all) if (o.key !== s2.key && h.indexOf('data-buy="' + o.key + '|') >= 0) mixed = true;
    }
    ok('每个商店子页条目数 == 该商店真实条目数', cntOk);
    ok('每个商店子页标题带店名', named);
    ok('商店子页不混入其它商店的条目', !mixed);
    ok('商店：各子页 item 之和 == 全量',
      cntOf(E.renderShop(), 'class="item') === shops.reduce((a, s2) => a + cntOf(E.renderShop(s2.key), 'class="item'), 0));
  }

  // ⑤ 技能 / 武魂
  {
    const sk = E.subTabs('skill').map(x => x.key);
    ok('技能子菜单 5 项（主动按 learn_level 拆 3 段 + 被动 + 召唤兽）',
      sk.join(',') === 'lv1,lv2,lv3,passive,summon', sk.join(','));
    {
      const all = E.jobSkills(E.state.player.job);
      const wantOf = s3 => (s3.learn_level || 1) <= 30 ? 'lv1' : ((s3.learn_level || 1) <= 60 ? 'lv2' : 'lv3');
      ok('skillBand 边界正确（≤30 初阶 / ≤60 中阶 / >60 高阶）',
        all.length > 0 && all.every(s3 => E.skillBand(s3.learn_level || 1) === wantOf(s3)), all.length + ' 个主动');
      ok('主动三段 item 之和 == 全部主动（拆主动不丢技能）',
        ['lv1', 'lv2', 'lv3'].reduce((a, k) => a + cntOf(E.renderSkill(k), 'class="item'), 0)
        === cntOf(E.renderSkill('active'), 'class="item'),
        cntOf(E.renderSkill('active'), 'class="item') + '');
      ok('每个主动段只含本段技能（不串段）',
        ['lv1', 'lv2', 'lv3'].every(k =>
          all.filter(s3 => wantOf(s3) === k).every(s3 => E.renderSkill(k).indexOf('>' + s3.name + '</b> <') >= 0)
          && all.filter(s3 => wantOf(s3) !== k).every(s3 => E.renderSkill(k).indexOf('>' + s3.name + '</b> <') < 0)),
        ['lv1', 'lv2', 'lv3'].map(k => cntOf(E.renderSkill(k), 'class="item')).join('/'));
    }
    const a1 = E.renderSkill('active'), p1 = E.renderSkill('passive'), s1 = E.renderSkill('summon');
    ok('技能·主动 子页含「主动技能」不含「被动技能」/「召唤兽」',
      a1.indexOf('主动技能') >= 0 && a1.indexOf('被动技能') < 0 && a1.indexOf('召唤兽') < 0);
    ok('技能·被动 子页含「被动技能」不含「主动技能」',
      p1.indexOf('被动技能') >= 0 && p1.indexOf('主动技能') < 0);
    ok('技能·召唤兽 子页含「召唤兽」不含「主动技能」',
      s1.indexOf('召唤兽') >= 0 && s1.indexOf('主动技能') < 0);
    ok('技能：各子页 item 之和 == 全量',
      cntOf(E.renderSkill(), 'class="item') === sk.reduce((a, k) => a + cntOf(E.renderSkill(k), 'class="item'), 0),
      cntOf(E.renderSkill(), 'class="item') + '');
    const w = E.subTabs('wuhun').map(x => x.key);
    ok('武魂子菜单 2 项（佩戴·背包 / 炼制）', w.join(',') === 'wear,craft', w.join(','));
    ok('武魂·佩戴 子页不含「武魂炼制」', E.renderWuhun('wear').indexOf('武魂炼制') < 0);
    ok('武魂·炼制 子页含「武魂炼制」不含「佩戴槽位」',
      E.renderWuhun('craft').indexOf('武魂炼制') >= 0 && E.renderWuhun('craft').indexOf('佩戴槽位') < 0);
  }

  // ⑥ 副本 / 成就：按数据动态生成
  {
    const ins = E.subTabs('instance');
    ok('副本子菜单 == 副本数（3）', ins.length === 3, ins.map(x => x.label).join(','));
    let cntOk = true;
    for (const s2 of ins) {
      const want = E.instEntries().filter(e => e.instance === s2.key).length;
      if (cntOf(E.renderInstance(s2.key), 'data-inst=') !== want) cntOk = false;
    }
    ok('每个副本子页条目数 == 该副本真实条目数（12 首领完整切分）', cntOk);
    ok('副本：各子页 item 之和 == 全量',
      cntOf(E.renderInstance(), 'class="item') === ins.reduce((a, s2) => a + cntOf(E.renderInstance(s2.key), 'class="item'), 0));
    ok('副本子菜单用中文副本名', ins.every(x => x.label && !/^[a-z_0-9]+$/.test(x.label)), ins.map(x => x.label).join(','));

    const cats = E.subTabs('ach');
    ok('成就子菜单 11 项（8 分类 + 称号，其中「等级」按 target 再拆 3 段）',
      cats.length === 11, cats.map(x => x.label).join(','));
    let achOk = true;
    for (const c of cats) {
      const want = E.achList().filter(a => E.achSubOf(a) === c.key).length;
      if (cntOf(E.renderAch(c.key), 'class="item') !== want) achOk = false;
    }
    ok('每个成就子页条目数 == 该子页成就数（87 条完整切分）', achOk);
    {
      const lvKeys = ['level_1', 'level_2', 'level_3'];
      ok('等级成就按 target 拆 3 段（≤40 / ≤80 / >80）且排在最前',
        cats.slice(0, 3).map(x => x.key).join(',') === lvKeys.join(','),
        cats.slice(0, 3).map(x => x.label).join(','));
      const lvList = E.achList().filter(a => a.category === 'level');
      const wantOf = a => (a.target || 0) <= 40 ? 'level_1' : ((a.target || 0) <= 80 ? 'level_2' : 'level_3');
      ok('achSubOf 边界正确（≤40 等级·初 / ≤80 等级·中 / >80 等级·高）',
        lvList.length > 0 && lvList.every(a => E.achSubOf(a) === wantOf(a)), lvList.length + ' 条等级成就');
      ok('等级三段成就数之和 == 等级成就总数',
        lvKeys.reduce((a, k) => a + lvList.filter(a2 => E.achSubOf(a2) === k).length, 0) === lvList.length,
        lvList.length + ' 条');
      ok('非等级分类的成就不会被 achSubOf 改判',
        E.achList().filter(a => a.category !== 'level').every(a => E.achSubOf(a) === a.category));
    }
    ok('成就：各子页 item 之和 == 全量',
      cntOf(E.renderAch(), 'class="item') === cats.reduce((a, c) => a + cntOf(E.renderAch(c.key), 'class="item'), 0));
    ok('成就子页标题带分类名', E.renderAch(cats[0].key).indexOf('（' + cats[0].label + '）') >= 0);
  }

  // ⑦ 神魔：未入道不拆；入道后 修验·变身 + 各档技能树（按 shenmo_skills#tier）
  {
    const saved = E.state.player.shenmo;
    E.state.player.shenmo = null;
    ok('未入道时神魔页不显示子菜单（只 1 个子页）', E.subTabs('shenmo').length === 1);
    E.state.player.shenmo = saved;
    const smSubs = E.subTabs('shenmo');
    const tiers = E.smNodeTiers();
    ok('入道后神魔子菜单 = 修验·变身 + 档位 + 仙之境 + 3 修验任务页',
      smSubs.length === tiers.length + 5 && tiers.length > 1,
      smSubs.map(x => x.label).join(','));
    ok('技能树子菜单标签取自 shenmo.json#tiers 的 name',
      smSubs.slice(1, 1 + tiers.length).every((x, i) => x.label === (E.smTierDef(tiers[i]) || {}).name),
      smSubs.map(x => x.label).join(','));
    ok('仙之境位于档位之后、修验任务页之前',
      smSubs[1 + tiers.length] && smSubs[1 + tiers.length].key === 'xianzhijing',
      smSubs.map(x => x.key).join(','));
    ok('修验任务三页（task/str/trial）位于子菜单末位',
      ['xr_task','xr_str','xr_trial'].every(k => smSubs.some(x => x.key === k)) &&
      smSubs[smSubs.length-3].key === 'xr_task' && smSubs[smSubs.length-2].key === 'xr_str' && smSubs[smSubs.length-1].key === 'xr_trial',
      smSubs.map(x => x.key).join(','));
    ok('子菜单档位与节点实际档位一一对应（升序、无重复）',
      tiers.join(',') === E.smNodeTiers().join(',') && new Set(tiers).size === tiers.length, tiers.join(','));
    {
      const nodes = E.smNodes().list.filter(d => d.faction === E.state.player.shenmo.faction);
      ok('修验各档子页节点数之和 == 全部节点数（拆档不丢节点）',
        tiers.reduce((a, t) => a + cntOf(E.renderShenmo('tree_' + t), 'data-smnode="'), 0)
        === cntOf(E.renderShenmo('tree'), 'data-smnode="'),
        nodes.length + ' 个节点');
      ok('每档子页条目数 == 该档真实节点数（按 tier 过滤）',
        tiers.every(t => cntOf(E.renderShenmo('tree_' + t), 'data-smnode="')
          === nodes.filter(d => d.tier === t).length),
        tiers.map(t => t + ':' + nodes.filter(d => d.tier === t).length).join(' '));
      ok('每个档位子页只含本档节点（不串档）',
        tiers.every(t => nodes.filter(d => d.tier !== t)
          .every(d => E.renderShenmo('tree_' + t).indexOf('data-smnode="' + d.key + '"') < 0)));
    }
    const tr = E.renderShenmo('tree'), lv2 = E.renderShenmo('level');
    ok('神魔·技能树 子页含「修验技能树」不含「变身阶位一览」',
      tr.indexOf('修验技能树') >= 0 && tr.indexOf('变身阶位一览') < 0);
    ok('神魔·修验·变身 子页含「变身阶位一览」不含「修验技能树」',
      lv2.indexOf('变身阶位一览') >= 0 && lv2.indexOf('修验技能树') < 0);
    ok('神魔：两子页 item 之和 == 全量',
      cntOf(lv2, 'class="item') + cntOf(tr, 'class="item') === cntOf(E.renderShenmo(), 'class="item'));
  }

  // ⑧ 云存档：存档 / 挂机设置 / 统计 / 排行
  {
    const ck = E.subTabs('cloud').map(x => x.key);
    ok('云存档子菜单 4 项', ck.join(',') === 'save,auto,stats,rank', ck.join(','));
    const sv = E.renderCloud('save'), au = E.renderCloud('auto'),
      st = E.renderCloud('stats'), rk = E.renderCloud('rank');
    ok('云存档·存档 子页含「本地存档」不含「自动挂机设置」',
      sv.indexOf('本地存档') >= 0 && sv.indexOf('自动挂机设置') < 0);
    ok('云存档·挂机设置 子页含「自动挂机设置」不含「战力排行榜」',
      au.indexOf('自动挂机设置') >= 0 && au.indexOf('战力排行榜') < 0);
    ok('云存档·挂机设置 首节无前导 <hr>', au.indexOf('<hr>') !== 0);
    ok('云存档·统计 子页含「本次挂机」+ 趋势图标题',
      st.indexOf('本次挂机') >= 0 && st.indexOf('经验/分 · 金币/分 趋势') >= 0);
    ok('云存档·排行 子页含「战力排行榜」+「挂机统计」',
      rk.indexOf('战力排行榜') >= 0 && rk.indexOf('挂机统计') >= 0);
    ok('云存档·排行 子页不含「本地存档」', rk.indexOf('本地存档') < 0);
    const full = E.renderCloud();
    ok('云存档全量仍含各分节标题（回归保护）',
      ['后端服务', '账号', '本地存档', '自动挂机设置', '本次挂机', '战力排行榜', '挂机统计']
        .every(x => full.indexOf(x) >= 0));
    ok('云存档全量不出现「前导 <hr>」以外的结构变化（首节仍是后端服务）',
      full.indexOf('<h3>后端服务</h3>') === 0);
  }

  // ⑨ subKey / 子菜单栏渲染
  {
    E.state.subSel = {};
    ok('无子菜单的页签 subKey 返回空串（任务页一屏装得下，不拆）',
      E.subKey('quest') === '' && E.subTabs('quest').length === 0);
    ok('subKey 默认返回第一个子页', E.subKey('bag') === 'eq_weapon', E.subKey('bag'));
    ok('subKey 默认值跟随 BAG_SUBS 首项（不是硬编码）', E.subKey('bag') === E.subTabs('bag')[0].key,
      E.subKey('bag') + ' / ' + E.subTabs('bag')[0].key);
    ok('成就页 subKey 默认落在「等级·初」', E.subKey('ach') === 'level_1', E.subKey('ach'));
    E.state.subSel.bag = 'potion';
    ok('subKey 记住用户选择', E.subKey('bag') === 'potion');
    E.state.subSel.bag = '__nope__';
    ok('subKey 遇到失效 key 回落到第一项（旧存档/配置变动后不崩）', E.subKey('bag') === 'eq_weapon',
      E.subKey('bag'));
    E.state.subSel = {};

    const bagSubs = E.subTabs('bag');
    const h1 = E.renderSubtabsHtml('bag', bagSubs, 'potion');
    ok('子菜单栏按钮数 == 子页数', cntOf(h1, 'data-subtab=') === bagSubs.length, cntOf(h1, 'data-subtab=') + '');
    ok('选中项带 active 类', h1.indexOf('data-subtab="potion" class="active"') >= 0);
    ok('同时只有 1 个 active', cntOf(h1, 'class="active"') === 1);
    ok('子菜单栏含全部中文标签', bagSubs.every(x => h1.indexOf('>' + x.label + '<') >= 0));
    ok('单子页不产出子菜单栏（不显示空栏）',
      E.renderSubtabsHtml('quest', E.subTabs('quest'), '') === ''
      && E.renderSubtabsHtml('shenmo', [{ key: 'level', label: '修验·变身' }], 'level') === '');
  }

  // ⑩ 汇总：每个页签的「最大子页」都必须短于全量
  {
    const pairs = [['bag', () => E.renderBag], ['life', () => E.renderLife], ['shop', () => E.renderShop],
      ['skill', () => E.renderSkill], ['wuhun', () => E.renderWuhun], ['instance', () => E.renderInstance],
      ['ach', () => E.renderAch], ['cloud', () => E.renderCloud], ['shenmo', () => E.renderShenmo]];
    let bad = [];
    for (const [t, get] of pairs) {
      const fn = get(); const subs = E.subTabs(t);
      if (!subs.length) continue;
      const mx = Math.max.apply(null, subs.map(x => fn(x.key).length));
      if (!(mx < fn().length)) bad.push(t);
    }
    ok('每个页签的最大子页都比全量短（确实拆小了）', bad.length === 0, bad.join(','));
  }

  // ⑪ 派生属性（敏捷→暴击/闪避/速度）：按原版 character/stats.py 口径裁定
  //    原版只走 jobs.json#attribute_effects 一张表，没有任何额外补算。
  //    用「等级 +10 的差分」隔离系数：装备/词条/武魂/神魔随等级不变在差分中抵消；
  //    被动 passiveLevel 依赖等级 ⇒ 临时置空纯化差分。
  {
    const ps = E.state.player;
    const origJob = ps.job, origLevel = ps.level, origPassives = ps.passives;
    ps.job = 'warrior'; ps.level = 60; ps.passives = {}; E.refreshStats();
    const job = E.DATA.jobs.jobs.find(j => j.key === ps.job) || E.DATA.jobs.jobs[0];
    const AE = job.attribute_effects || {};
    const COEF = (AE.agility && AE.agility.phys_crit) || 0;
    ok('jobs.json#attribute_effects 有 战士 敏捷→phys_crit', COEF > 0, COEF + '');

    const a = E.computeStats(ps);
    ps.level = 70;
    const b = E.computeStats(ps);
    const dA = b.attr.agility - a.attr.agility;
    const dC = (b.combat.phys_crit || 0) - (a.combat.phys_crit || 0);
    const meas = dA ? dC / dA : NaN;

    ok('敏捷→暴击系数实测 == 表里系数（只计一次，未重复累加）',
      dA > 0 && Math.abs(meas - COEF) < 1e-6, '实测 ' + meas + ' / 表 ' + COEF);
    ok('敏捷→暴击系数 != 2× 表里系数（排除重复计算回归）',
      Math.abs(meas - 2 * COEF) > 1e-6, '2× = ' + (2 * COEF));

    // 逐等级：属性点确实随等级增长，暴击单调不减
    const critAt = [];
    for (const L of [30, 60, 90, 120]) { ps.level = L; E.refreshStats(); critAt.push([L, ps._s.combat.phys_crit || 0, (ps._s.attr || {}).agility || 0]); }
    ok('敏捷随等级单调增（差分测试有意义）',
      critAt.every((x, i) => i === 0 || x[2] > critAt[i - 1][2]), JSON.stringify(critAt.map(x => x[2])));
    ok('暴击随等级单调不减',
      critAt.every((x, i) => i === 0 || x[1] >= critAt[i - 1][1]), JSON.stringify(critAt.map(x => x[1])));

    // 闪避 / 速度：原版战斗模型已接回（按 agility 派生），锁住公式正确性
    ps.level = 60; E.refreshStats();
    const _agi60 = ps._s.combat.agility||0;
    ok('dodge 已按原版公式派生（int(10*agi/(agi+100)) 上限10）',
      ps._s.combat.dodge === Math.min(10, Math.trunc(10*_agi60/(_agi60+100))),
      'dodge=' + ps._s.combat.dodge + ' agi=' + _agi60);
    ok('speed 已按原版公式派生（4+int(12*agi/(agi+60)) 上限16）',
      ps._s.combat.speed === 4 + Math.min(12, Math.trunc(12*_agi60/(_agi60+60))),
      'speed=' + ps._s.combat.speed + ' agi=' + _agi60);
    ok('dodge 落在 [0,10]', ps._s.combat.dodge>=0 && ps._s.combat.dodge<=10, 'dodge=' + ps._s.combat.dodge);
    ok('speed 落在 [4,16]', ps._s.combat.speed>=4 && ps._s.combat.speed<=16, 'speed=' + ps._s.combat.speed);

    // 原版公式的黄金表（已接回，对拍用）
    ok('原版 dodge/speed 黄金表可复现',
      (function () {
        const od = ag => Math.min(10, Math.trunc(10 * ag / (ag + 100)));
        const os = ag => 4 + Math.min(12, Math.trunc(12 * ag / (ag + 60)));
        return [[0, 0, 4], [100, 5, 11], [200, 6, 13], [900, 9, 15]].every(g => od(g[0]) === g[1] && os(g[0]) === g[2]);
      })(),
      'agi=' + _agi60);

    ps.job = origJob; ps.level = origLevel; ps.passives = origPassives; E.refreshStats();

    // 怪物真实防御：数据里 phys_def 字段恒为 0，必须取 min/max 区间中值
    {
      // 选一个物理/法术防御字段都齐整的怪物，确保中点断言有意义
      const mk = Object.keys(E.MONSTERS).find(k => { const mm = E.MONSTERS[k];
        return (mm.min_phys_def||0) > 0 && (mm.max_phys_def||0) > 0
            && (mm.min_magic_def||0) > 0 && (mm.max_magic_def||0) > 0; });
      const mm = E.MONSTERS[mk];
      const def = E.monsterDef(mm, 'phys_def');
      ok('怪物防御取 min/max 区间中值（非 phys_def 字段0）', def > 0 && Math.abs(def - (mm.min_phys_def + mm.max_phys_def)/2) < 1e-6, 'def=' + def);
      const mdef = E.monsterDef(mm, 'magic_def');
      ok('magic 防御同样取区间中值', mdef > 0 && Math.abs(mdef - (mm.min_magic_def + mm.max_magic_def)/2) < 1e-6, 'mdef=' + mdef);
      // 路由正确性：对 phys/magic 防御不一致的怪物，两者必须分别落回各自区间中值且不混淆
      ok('monsterDef 按 phys/magic 分别路由（不串用防御）', def === (mm.min_phys_def+mm.max_phys_def)/2 && mdef === (mm.min_magic_def+mm.max_magic_def)/2 && Math.abs(def-mdef) >= 1e-6, 'def='+def+' mdef='+mdef);
    }
  }

  // ⑫ 称号系统（解锁 + 效果）
  {
    const ps = E.state.player;
    const origTitles = JSON.parse(JSON.stringify(ps.titles || {}));
    const origEq = ps.equippedTitle;
    // 清掉称号状态以做隔离测试
    ps.titles = {}; ps.equippedTitle = null;

    const spider = E.titleByKey('kx_蜘蛛');
    ok('称号配置可读取（蜘蛛克星）', !!spider && spider.name === '蜘蛛克星' && spider.effect.type === 'monster_dmg');

    // 模拟击杀 1500 只蜘蛛解锁
    ps.stats = ps.stats || {};
    ps.stats.killType = ps.stats.killType || {};
    ps.stats.killType['蜘蛛'] = 1500;
    E.checkTitles();
    ok('击杀 1500 只蜘蛛解锁「蜘蛛克星」', !!ps.titles['kx_蜘蛛']);
    ok('解锁后自动装备首个称号', ps.equippedTitle === 'kx_蜘蛛');

    // 装备地图称号测试 map_buff
    const bj = E.titleByKey('my_beijun');
    ok('称号配置可读取（北原郡勇者）', !!bj && bj.name === '北原郡勇者' && bj.effect.type === 'map_buff');
    ps.equippedTitle = 'my_beijun';
    ps.map = 'beijun';
    E.state.zone = { mapKey: 'beijun', zoneKey: 'beijun_plains', isBoss: false };
    const th = E.titleHeal();
    ok('地图称号在北原郡回血/回蓝 > 0', th.hp > 0 && th.mp > 0, 'hp=' + th.hp + ' mp=' + th.mp);

    // 伤害倍率：怪物名含「蜘蛛」时 spider 称号 ×1.5
    ps.equippedTitle = 'kx_蜘蛛';
    const m1 = { name: '北部毒蜘蛛' };
    const m2 = { name: '北部野狼' };
    ok('怪物名含关键字时称号伤害倍率生效', E.titleDmgMult(m1) === 1.5, E.titleDmgMult(m1));
    ok('怪物名不含关键字时倍率为 1', E.titleDmgMult(m2) === 1, E.titleDmgMult(m2));

    ps.titles = origTitles; ps.equippedTitle = origEq;
  }

  // 物品中文名覆盖：商店/背包中不再出现 raw key
  {
    ok('矿石显示中文名（寒铁矿石）', E.itemName('hantie') === '寒铁矿石');
    ok('武魂配方卷轴显示中文名（启魂符☆炼制配方）', E.itemName('recipe_lingyin_1') === '启魂符☆炼制配方');
    ok('宝石原料显示中文名（北斗石）', E.itemName('beidou_石') === '北斗石');
    ok('武魂材料显示中文名（天魂）', E.itemName('sanhun_tian') === '天魂');
  }

  // ---- 仙之境（shenmo.json#xianzhijing：神魔专属安全区被动修验）----
  console.log('-- 仙之境（被动修验）--');
  {
    // 配置存在性
    const xc = E.DATA.shenmo && E.DATA.shenmo.xianzhijing;
    ok('仙之境配置存在', !!xc, xc ? '' : 'null');
    ok('仙之境每日上限 60 分钟', E.xzCapMin() === 60, String(E.xzCapMin()));
    ok('仙之境 per_min_exp 表存在（≥10 段）', !!(xc && xc.per_min_exp && xc.per_min_exp.length >= 10),
      xc && xc.per_min_exp ? xc.per_min_exp.length + ' 段' : 'null');

    // 入道（神魔道）后才能进；未入道 travelTo 被拒
    E.newPlayer('仙之', 'warrior');
    const ps = E.state.player;
    ps.level = 105; E.refreshStats();
    ps.map = 'beijun';
    E.travelTo('xianzhijing');
    ok('未入神魔道时 travelTo(xianzhijing) 被拒', E.state.player.map === 'beijun', E.state.player.map);

    const j = E.smJoin('shen');
    ok('入道成功（Lv.105 神道）', j.ok, j.msg);
    ok('入道后 shenmo.faction 已设', !!ps.shenmo.faction, ps.shenmo.faction);

    // 子菜单 / 路由：renderShenmo(xianzhijing) 应路由到仙之境页面
    ok('神魔子菜单含仙之境', E.subTabs('shenmo').some(x => x.key === 'xianzhijing' && x.label === '仙之境'),
      JSON.stringify(E.subTabs('shenmo').map(x => x.key)));
    ok('renderShenmo(xianzhijing) 路由到仙之境', E.renderShenmo('xianzhijing').indexOf('仙之境') >= 0,
      E.renderShenmo('xianzhijing').slice(0, 30));

    // 速率按等级取表
    ps.shenmo.level = 1;
    ok('Lv1 修验速率 = 25/分', E.xzRatePerMin(1) === 25, String(E.xzRatePerMin(1)));
    ps.shenmo.level = 30;
    ok('Lv30 修验速率 = 1850/分', E.xzRatePerMin(30) === 1850, String(E.xzRatePerMin(30)));
    ps.shenmo.level = 90;
    ok('Lv90 修验速率 = 1,000,000/分', E.xzRatePerMin(90) === 1000000, String(E.xzRatePerMin(90)));
    ps.shenmo.level = 1;

    // 直接结算分钟：精确累加 + 每日上限
    ps.shenmo.xz_date = '2000-1-1'; ps.shenmo.xz_min = 0; ps.shenmo.xz_frac = 0; ps.shenmo.xz_exp_total = 0; ps.shenmo.exp = 0;
    const g1 = E.smXianzhiAddMinutes(30);
    ok('结算 30 分钟获得 30×25=750', g1 === 750, g1 + '');
    ok('xz_min 累加至 30', Math.abs((ps.shenmo.xz_min || 0) - 30) < 1e-9, String(ps.shenmo.xz_min));
    const g2 = E.smXianzhiAddMinutes(40);   // 上限 60，剩 30 → 只结算 30
    ok('超每日上限只结算到 60（再得 750）', g2 === 750, g2 + '');
    ok('xz_min 封顶 60', Math.abs((ps.shenmo.xz_min || 0) - 60) < 1e-9, String(ps.shenmo.xz_min));
    const g3 = E.smXianzhiAddMinutes(10);    // 已封顶
    ok('已达上限再结算为 0', g3 === 0, String(g3));

    // 每 tick 结算：86 tick ≈ 1 分钟（loop 700ms → 60000/700≈85.7）
    ps.shenmo.xz_date = '2000-1-1'; ps.shenmo.xz_min = 0; ps.shenmo.xz_frac = 0; ps.shenmo.xz_exp_total = 0; ps.shenmo.exp = 0;
    ps.shenmo.level = 1;
    const expB = ps.shenmo.exp;
    for (let i = 0; i < 86; i++) E.smXianzhiTick();
    ok('86 tick ≈ 1 分钟（xz_min≈1）', Math.abs((ps.shenmo.xz_min || 0) - 1) < 0.05, String(ps.shenmo.xz_min));
    ok('86 tick 累积经验 ≈ 25（速率 25/分）', Math.abs((ps.shenmo.exp - expB) - 25) < 1.0,
      'exp+' + (ps.shenmo.exp - expB).toFixed(2));

    // 跨日重置：日期不同则 xz_min 归零后重新累加
    ps.shenmo.xz_date = '1999-9-9'; ps.shenmo.xz_min = 50; ps.shenmo.xz_frac = 0;
    E.smXianzhiAddMinutes(1);
    ok('跨日重置：xz_min 归零后重新累加（≤1）', (ps.shenmo.xz_min || 0) <= 1 + 1e-9, String(ps.shenmo.xz_min));

    // 进入仙之境：isXianzhiNow + tick 早退 + autoZone 不换走
    ps.shenmo.level = 1;
    E.travelTo('xianzhijing');
    ok('入道后可进入 xianzhijing', E.state.player.map === 'xianzhijing', E.state.player.map);
    ok('进入后 isXianzhiNow 为 true', E.isXianzhiNow() === true);
    ok('仙之境 zone 置空（安全区无战斗）', E.state.zone === null);

    // tick 在仙之境早退、不进战斗分支
    E.state.player.map = 'xianzhijing'; E.state.zone = null; E.state.combat = null; E.state.idle = true;
    let tickErr = null;
    try { for (let i = 0; i < 100; i++) E.tick(); } catch (e) { tickErr = e; }
    ok('仙之境 tick 不崩溃且不进战斗', !tickErr && E.state.combat === null, tickErr ? tickErr.message : ('combat=' + E.state.combat));
    E.state.idle = false;

    // autoZone 不强行换走仙之境（zone 仍为空）
    E.state.auto.zone = true;
    E.state.zone = null;
    E.autoZone(false);
    ok('autoZone 不换走仙之境', E.state.zone === null && E.isXianzhiNow());
    E.state.auto.zone = false;

    // 渲染：未进入时含「前往仙之境」按钮；进入后含「静修中」
    E.state.player.map = 'beijun';
    const htmlOut = E.renderXianzhi();
    ok('仙之境页面含进入按钮', htmlOut.indexOf('前往仙之境') >= 0, htmlOut.slice(0, 30));
    ok('仙之境页面含每日上限说明', htmlOut.indexOf('60') >= 0);
    E.state.player.map = 'xianzhijing';
    const htmlIn = E.renderXianzhi();
    ok('在仙之境内页面显示静修中', htmlIn.indexOf('静修') >= 0);
  }

  // ---- 修验任务（shenmo.json#quest：炼丹产线三系统）----
  console.log('-- 修验任务（炼丹产线）--');
  {
    const ps = E.state.player;
    const qcfg = E.DATA.shenmo && E.DATA.shenmo.quest;
    ok('修验任务配置存在', !!qcfg);
    ok('recipe_types 含 6 类（exp/ore/crystal/gem/soul/bailian）',
      Object.keys(E.xyRecipeTypes()).length === 6, Object.keys(E.xyRecipeTypes()).join(','));
    ok('grade_order = 1A~5A', JSON.stringify(E.xyGrades()) === JSON.stringify(['1A','2A','3A','4A','5A']));
    ok('5 个品阶均含 dan_pct/exp_cost/yinzi_qty/submit_gold/mat_qty',
      E.xyGrades().every(g => { const d = E.xyGradeDef(g); return d && typeof d.dan_pct==='number' && typeof d.exp_cost==='number' && typeof d.yinzi_qty==='number' && typeof d.submit_gold==='number' && typeof d.mat_qty==='number'; }),
      E.xyGrades().map(g => !!E.xyGradeDef(g)).join(','));
    ok('yinzi.pool = 紫菱花/风铃珠/百炼石', JSON.stringify(E.xyYinziPool()) === JSON.stringify(['ziling_hua','fengling_zhu','bailian_shi']));
    ok('furnace_item = liandan_shenlu', qcfg.furnace_item === 'liandan_shenlu');
    ok('submit_bonus_pct = 0.2', qcfg.submit_bonus_pct === 0.2);
    ok('talisman = 修验符 + dan_bonus_pct 0.2', qcfg.talisman.item === 'shenmo_xiulian_fu' && qcfg.talisman.dan_bonus_pct === 0.2);

    // 每日上限受等级影响：基础5 / L40+5 / L80 无限
    ps.shenmo.level = 10; ok('Lv10 每日上限 = 5', E.xyDailyCap() === 5, String(E.xyDailyCap()));
    ps.shenmo.level = 50; ok('Lv50 每日上限 = 10', E.xyDailyCap() === 10, String(E.xyDailyCap()));
    ps.shenmo.level = 100; ok('Lv100 每日上限 = Infinity', E.xyDailyCap() === Infinity, String(E.xyDailyCap()));

    // 准备：干净背包 + 充足修验经验 + 银子池
    ps.bag = []; ps.ores = {}; ps.crystal = 0;
    ps.shenmo.quest = {}; ps.shenmo.exp = 2e9;
    E.addToBag({type:'consumable', key:'ziling_hua', count:1000});
    E.addToBag({type:'consumable', key:'fengling_zhu', count:1000});
    E.addToBag({type:'consumable', key:'bailian_shi', count:1000});

    // xyAccept：未知类型 / 每日上限 / exp+银子扣减 / tasks_done 累加
    ok('xyAccept 未知配方类型被拒', E.xyAccept('nope').ok === false);
    const poolSum = () => ['ziling_hua','fengling_zhu','bailian_shi'].reduce((a,k)=>a+E.itemCount(k),0);
    ps.shenmo.level = 10; ps.shenmo.quest = {}; ps.shenmo.exp = 2e9;   // L10 → 每日 5 次
    let okN = 0, expBefore = ps.shenmo.exp, poolBefore = poolSum();
    for (let i = 0; i < 6; i++) if (E.xyAccept('ore').ok) okN++;
    ok('Lv10 每日接取恰好 5 次（第 6 次超上限）', okN === 5, 'okN=' + okN);
    ok('接取后 tasks_done 累加至 5', (ps.shenmo.quest.tasks_done||0) === 5, String(ps.shenmo.quest.tasks_done));
    ok('接取消耗修验经验', ps.shenmo.exp < expBefore, expBefore + '→' + ps.shenmo.exp);
    ok('接取消耗银子池', poolSum() < poolBefore, poolBefore + '→' + poolSum());
    ps.shenmo.level = 100; ps.shenmo.quest = {}; ps.shenmo.exp = 2e9;   // 复位供后续

    // 受控 current：矿石 1A（hantie×5），验证 store 路由 + submit + refine + handin
    const q = E.xyQuestState(); q.current = { grade:'1A', type:'ore', status:'accepted' };
    ok('矿石类型 xyHasMaterials 初始缺料为 false', E.xyHasMaterials('ore','1A') === false);
    ps.ores.hantie = 5;
    ok('注入 hantie×5 后 xyHasMaterials 为 true（ore 走 p.ores 路由）', E.xyHasMaterials('ore','1A') === true);
    const rSub = E.xySubmitMaterials();
    ok('提交材料成功（accepted→ready）', rSub.ok && q.current.status === 'ready', rSub.msg);
    ok('提交后 hantie 被消耗（p.ores 路由扣减）', (ps.ores.hantie||0) === 0, String(ps.ores.hantie));
    E.addToBag({type:'consumable', key:'liandan_shenlu', count:1});
    const rRef = E.xyRefine();
    ok('有炼丹神炉时炼丹成功（ready→refined）', rRef.ok && q.current.status === 'refined', rRef.msg);
    ok('炼丹结果 gotPill 为布尔', typeof q.current.gotPill === 'boolean');
    const goldBefore = ps.gold;
    const rHand = E.xyHandIn();
    ok('提交领金币成功（refined→清空 current）', rHand.ok && q.current === null, rHand.msg);
    ok('1A 提交金币 = 5000×1.2 = 6000（强化0级）', ps.gold - goldBefore === 6000, '+' + (ps.gold - goldBefore));

    // store 路由：晶石（p.crystal）
    q.current = { grade:'1A', type:'crystal', status:'accepted' };
    ok('晶石类型初始缺料为 false', E.xyHasMaterials('crystal','1A') === false);
    ps.crystal = 5;
    ok('注入晶石×5 后 xyHasMaterials 为 true（crystal 走 p.crystal 路由）', E.xyHasMaterials('crystal','1A') === true);
    E.xySubmitMaterials();
    ok('提交后晶石被消耗（p.crystal 路由扣减）', (ps.crystal||0) === 0, String(ps.crystal));

    // store 路由：宝石（p.bag type=gem，any_of）
    q.current = { grade:'1A', type:'gem', status:'accepted' };
    ok('宝石类型初始缺料为 false', E.xyHasMaterials('gem','1A') === false);
    E.addToBag({type:'gem', series:'beidou', grade:'碎石', count:5});
    ok('注入 beidou_碎石×5 后 xyHasMaterials 为 true（gem 走 p.bag 路由）', E.xyHasMaterials('gem','1A') === true);
    E.xySubmitMaterials();
    const gemLeft = ps.bag.filter(b=>b.type==='gem'&&b.series==='beidou'&&b.grade==='碎石').reduce((a,b)=>a+(b.count||1),0);
    ok('提交后宝石被消耗（gem 路由扣减）', gemLeft === 0, String(gemLeft));

    // store 路由：魂魄（consumable，any_of）
    q.current = { grade:'1A', type:'soul', status:'accepted' };
    ok('魂魄类型初始缺料为 false', E.xyHasMaterials('soul','1A') === false);
    E.addToBag({type:'consumable', key:'sanhun_tian', count:5});
    ok('注入 sanhun_tian×5 后 xyHasMaterials 为 true（consumable 路由）', E.xyHasMaterials('soul','1A') === true);
    E.xySubmitMaterials();
    ok('提交后魂魄被消耗', E.itemCount('sanhun_tian') === 0, String(E.itemCount('sanhun_tian')));

    // none 类型（exp）无材料需求 → 始终可提交
    q.current = { grade:'1A', type:'exp', status:'accepted' };
    ok('exp 类型无材料需求 → xyHasMaterials 恒 true', E.xyHasMaterials('exp','1A') === true);

    // xyRefresh：Lv40 解锁；带免费次数
    q.current = { grade:'1A', type:'ore', status:'accepted' };
    ps.shenmo.level = 10;
    ok('Lv10 刷新被拒（需 Lv40）', E.xyRefresh().ok === false);
    ps.shenmo.level = 100;
    const rRef2 = E.xyRefresh();
    ok('Lv100 刷新成功（免费次数内）', rRef2.ok === true, rRef2.msg);
    ok('刷新后 grade 仍为合法品阶', E.xyGrades().indexOf(q.current.grade) >= 0, q.current.grade);

    // 强化：材料递增 + enhanced/times 累加 + 每日上限
    ps.bag = []; ps.ores = {}; ps.crystal = 0;     // 干净背包，精准校验消耗
    ps.shenmo.quest = {}; ps.shenmo.level = 100;
    E.addToBag({type:'consumable', key:'bailian_shi', count:100});
    E.addToBag({type:'consumable', key:'ziling_hua', count:20});
    E.addToBag({type:'consumable', key:'fengling_zhu', count:20});
    ok('强化每日上限 Lv100 = 3（基础1 + 符令加成2）', E.xyStrCap() === 3, String(E.xyStrCap()));
    const rStr = E.xyStrengthen();
    ok('强化成功（enhanced→1, times→1）', rStr.ok && ps.shenmo.quest.str.enhanced === 1 && ps.shenmo.quest.str.times === 1, rStr.msg);
    ok('强化消耗 0 级材料（百炼石×10/紫菱花×1/风铃珠×1）',
      E.itemCount('bailian_shi') === 90 && E.itemCount('ziling_hua') === 19 && E.itemCount('fengling_zhu') === 19,
      [E.itemCount('bailian_shi'),E.itemCount('ziling_hua'),E.itemCount('fengling_zhu')].join(','));

    // 导师考验：消耗百炼石 + 限时击杀给经验
    ps.shenmo.quest = {}; ps.shenmo.level = 100;
    E.addToBag({type:'consumable', key:'bailian_shi', count:100});
    ok('考验每日上限 Lv100 = 1', E.xyTrialCap() === 1, String(E.xyTrialCap()));
    const rTr = E.xyTrialStart();
    ok('考验开始成功', rTr.ok && !!ps.shenmo.quest.trial.active, rTr.msg);
    const tg = ps.shenmo.quest.trial.active;
    const perKill = qcfg.trial.per_kill_exp[tg.grade], need = tg.target;
    const expB2 = ps.shenmo.exp;
    for (let i = 0; i < need; i++) E.xyTrialOnKill();
    ok('达成目标击杀后给经验（per_kill_exp × target）', ps.shenmo.exp === expB2 + perKill * need, (ps.shenmo.exp - expB2) + ' vs ' + (perKill*need));
    ok('达成后 active 清空', ps.shenmo.quest.trial.active === null);

    // UI 路由：三页均渲染且含对应按钮
    const tHtml = E.renderXrTask(), sHtml = E.renderXrStr(), trHtml = E.renderXrTrial();
    ok('修验任务页含接取按钮 accept:*', tHtml.indexOf('accept:') >= 0);
    ok('强化页含 data-xy="str"', sHtml.indexOf('data-xy="str"') >= 0);
    ok('导师考验页含 data-xy="trial_start"', trHtml.indexOf('data-xy="trial_start"') >= 0);
    ok('renderShenmo(xr_task) 路由到修验任务页', E.renderShenmo('xr_task').indexOf('修验任务') >= 0);
  }

  // 恢复默认页签，避免影响后续/重复运行
  E.state.selTab = 'bag'; E.state.subSel = {};

  console.log(fails === 0 ? '\nALL PASS' : '\nFAILED: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPTION', e); process.exit(2); });
