/* ===== 模块 life.js —— 打造/百炼/提取/矿石炼制/乾坤炉/晶石/信使/探矿/护符兑换/成就/称号/物品账目 =====
 * 来源：game.js L3958-4458（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 67 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, LS, ORE_BY_TIER, ORE_KEYS, ORE_NAME, SLOT_NAME, TITLES, clamp, pick, ri, uid } from './core.js';
import { refreshStats } from './smtree.js';
import { QNAME, buildEquip, genEquip, genEquipBaseForSlot, genEquipWithFallback, qualityFromPerks } from './equip.js';
import { addToBag } from './bag.js';
import { refineAddHidden, refineApplyOne, removeItem } from './refine.js';
import { travelTo } from './world.js';
import { eventLog, log, renderHeader } from './render.js';
import { renderTab } from './tabs.js';
import { gemSeriesName } from './inlay.js';
import { itemName } from './shop.js';
import { findItem } from './binds.js';

// ---------- 生活技能：打造 / 百炼 / 提取 / 矿石炼制 / 乾坤炉 ----------
export function weightedPick(keys, wmap){
  let tot=0; for(const k of keys) tot+=(wmap[k]||0);
  if(tot<=0) return keys[0];
  let r=Math.random()*tot;
  for(const k of keys){ r-=(wmap[k]||0); if(r<=0) return k; }
  return keys[keys.length-1];
}
export function cn(n){ return ['零','壹','贰','叁','肆','伍','陆','柒','捌','玖'][n]||(''+n); }
export function oreName(k){ return ORE_NAME[k]||k; }
// 大数字格式化：中文计数（万/亿/兆/京/垓/秭），每级 ×1e4
export function fmtNum(n){
  if(n==null || isNaN(n)) return '0';
  n = +n;
  if(n < 10000){
    if(Math.floor(n)===n) return ''+n;            // 整数（含小数百分比如暴击0.15）直出
    return ''+(Math.round(n*100)/100);
  }
  const u=['','万','亿','兆','京','垓','秭'];
  let i=0, v=n;
  while(v>=10000 && i<u.length-1){ v/=10000; i++; }
  const s = v>=100 ? (''+Math.round(v)) : (v.toFixed(2).replace(/\.?0+$/,''));
  return s+u[i];
}
// ---------- 晶石（crystals.json）：精炼 +5 起需消耗对应档晶石 ----------
export function crystalDef(k){ return ((DATA.crystals||{}).crystal_types||[]).find(c=>c.key===k)||null; }
export function crystalName(k){ const d=crystalDef(k); return d? d.name : k; }
export function crystalForTier(tier){ const m=(DATA.crystals||{}).tier_to_crystal||{}; return m[''+clamp(tier||1,1,7)] || m['1']; }
export function crystalStartRefine(){ return (DATA.crystals||{}).crystal_start_refine || 5; }
export function crystalCount(k){ return ((state.player.crystals||{})[k])||0; }
export function useCrystalStone(k, n){
  const p=state.player; p.crystals=p.crystals||{};
  if((p.crystals[k]||0) < n) return false;
  p.crystals[k]-=n; return true;
}
export function addCrystalStone(k, n){ const p=state.player; p.crystals=p.crystals||{}; p.crystals[k]=(p.crystals[k]||0)+n; }
// ---------- 信使（couriers.json）：付费传送 ----------
export function courierRoutes(mapKey){ return ((DATA.couriers||{})[mapKey])||[]; }
export function courierTravel(toMap){
  const p=state.player;
  const r=courierRoutes(p.map).find(x=>x.map_key===toMap);
  if(!r) return {ok:false, msg:'当前地图无此信使线路'};
  if(p.gold < (r.price||0)) return {ok:false, msg:'金币不足，需 '+fmtNum(r.price||0)};
  p.gold -= (r.price||0);
  travelTo(toMap);
  return {ok:true, msg:'支付 '+fmtNum(r.price||0)+' 金币，信使送你抵达 '+(instMapName(toMap))};
}
// 配置外补充物品名（炼化瓶/晶石/太古残片等）
export const EXTRA_ITEM_NAME = {lianhua_ping:'炼化瓶', yumo_crystal:'镇魔晶石', taigu_canpian:'太古残片',
  bailian_shi:'百炼石', shengzhe_fufu:'英灵护符', guangming_fufu:'光明护符', siwang_fufu:'死亡护符'};
export function itemCount(key){
  const p=state.player; let n=0;
  for(const b of p.bag) if(b.type==='consumable' && b.key===key) n += (b.count||1);
  return n;
}
export function itemConsume(key, n){
  if(itemCount(key) < n) return false;
  const p=state.player;
  for(const b of p.bag){
    if(n<=0) break;
    if(b.type==='consumable' && b.key===key){
      const c=b.count||1;
      if(c>n){ b.count=c-n; n=0; }
      else { n-=c; b.count=0; }
    }
  }
  p.bag = p.bag.filter(b=> !(b.type==='consumable' && (b.count||0)<=0));
  return true;
}
export function gemCount(series, grade){
  const p=state.player; let n=0;
  for(const b of p.bag) if(b.type==='gem' && b.series===series && b.grade===grade) n += (b.count||1);
  return n;
}
export function gemConsume(series, grade, n){
  if(gemCount(series,grade) < n) return false;
  const p=state.player;
  for(const b of p.bag){
    if(n<=0) break;
    if(b.type==='gem' && b.series===series && b.grade===grade){
      const c=b.count||1;
      if(c>n){ b.count=c-n; n=0; } else { n-=c; b.count=0; }
    }
  }
  p.bag = p.bag.filter(b=> !(b.type==='gem' && (b.count||0)<=0));
  return true;
}

// ---------- 探矿（mining.json 驱动） ----------
export function mineConf(){ return (DATA.mining||{}).mining || {}; }
export function compassDef(g){ return (mineConf().compass||{})[g] || null; }
export function mineExpNeed(lv){ const lu=mineConf().levelup||{base_exp:30, growth:1.18}; return Math.round(lu.base_exp*Math.pow(lu.growth, lv-1)); }
export function mineStart(grade, mapKey){
  const p=state.player;
  const cd=compassDef(grade);
  if(!cd){ return {ok:false, msg:'未知罗盘'}; }
  if(p.level < (cd.level_required||1)) return {ok:false, msg:'等级不足，'+cd.name+' 需 Lv.'+cd.level_required};
  if((cd.open_maps||[]).indexOf(mapKey)<0) return {ok:false, msg:cd.name+' 无法在 '+mapKey+' 使用'};
  if(state.mine) return {ok:false, msg:'已有探矿作业进行中'};
  if(itemCount(cd.key) < 1) return {ok:false, msg:'需要 '+cd.name+'（商店有售）'};
  state.mine={grade, map:mapKey, step:0, t:0};
  return {ok:true, msg:'开始探矿：'+cd.name+' @ '+mapKey};
}
export function mineProgress(){
  if(!state.mine) return 0;
  const steps=mineConf().steps||[];
  let total=0, done=0;
  steps.forEach((st,i)=>{ const sec=st.seconds||10; total+=sec; if(i<state.mine.step) done+=sec; });
  return total? clamp((done+state.mine.t)/total*100,0,100) : 0;
}
export function mineTick(dt){
  if(!state.mine) return;
  const steps=mineConf().steps||[];
  if(!steps.length){ state.mine=null; return; }
  state.mine.t += dt;
  const cur=steps[state.mine.step];
  if(!cur){ mineSettle(); return; }
  if(state.mine.t >= (cur.seconds||10)){
    state.mine.t -= (cur.seconds||10);
    state.mine.step++;
    if(state.mine.step>=steps.length){ mineSettle(); return; }
    log('<span class="sys">探矿：'+steps[state.mine.step].name+'</span>');
  }
}
export function mineSettle(){
  const m=state.mine; if(!m) return;
  state.mine=null;
  const p=state.player;
  const mc=mineConf(), cd=compassDef(m.grade);
  if(!itemConsume(cd.key, (mc.rounds_per_compass||1))){ log('<span class="dmg">罗盘不足，探矿中止</span>'); return; }
  const oc=mc.outcomes||{};
  const findRate = (oc.ore_find_rate!=null) ? oc.ore_find_rate : 0.88;  // 出矿带内实得率（原版 world/mining.py:_settle_round）
  const r=Math.random();
  const ml = p.mining.level;
  let gain = 0, oreKey = null;
  if(r < (oc.empty||0.05)){
    log('<span class="sys">探矿结束：矿脉空空，一无所获。</span>');
    gain = 0;
  }else if(r < (oc.empty||0.05)+(oc.ore||0.9)){
    // 出矿带：按 ore_find_rate 再判「是否真挖到」（原版约 12% 空欢喜）
    const tbl = ((mc.ore_tables_by_map||{})[m.grade]||{})[m.map] || (mc.ore_tables||{})[m.grade] || {};
    const keys=Object.keys(tbl);
    if(keys.length){
      const wmap={}; keys.forEach(k=> wmap[k]=tbl[k]);
      oreKey = weightedPick(keys, wmap);
      if(Math.random() < findRate){
        gain = Math.max(1, Math.round(mc.ore_group_base||20));   // 产量固定 = base（原版无等级加成/抖动）
        addOre(oreKey, gain);
        log('<span class="loot">探矿收获：'+ORE_NAME[oreKey]+' x'+gain+'</span>');
      }else{
        log('<span class="sys">矿脉贫瘠，一无所获（空欢喜）。</span>');
      }
    }
  }else{
    // 太古：双倍矿石 + 太古残片 + 远古宝箱（随机装备）
    const tbl = ((mc.ore_tables_by_map||{})[m.grade]||{})[m.map] || (mc.ore_tables||{})[m.grade] || {};
    const keys=Object.keys(tbl);
    if(keys.length){
      const wmap={}; keys.forEach(k=> wmap[k]=tbl[k]);
      oreKey = weightedPick(keys, wmap);
      gain = Math.max(1, Math.round((mc.ore_group_base||20)*2));   // 太古双倍，产量同样固定
      addOre(oreKey, gain);
    }
    addMaterial('taigu_canpian', 1);
    const box = genEquipWithFallback(pick(['weapon','armor','helmet','pants','shoes','gloves']), p.job, {level:p.level, hp:1}, p);
    if(box){ addToBag(box); eventLog('<span class="loot">太古矿脉：获得 '+box.name+'</span>'); }
    log('<span class="boss">太古矿脉！'+ORE_NAME[oreKey||'']+' x'+gain+'、太古残片 x1'+(box?'、['+QNAME[box.quality]+']'+box.name:'')+'</span>');
  }
  // 挖矿经验
  const exp = (12 + ml*6) * (r>=(oc.empty||0.05)+(oc.ore||0.9) ? 3 : 1);
  p.mining.exp += exp;
  while(p.mining.level < ((mc.levelup||{}).max_level||100) && p.mining.exp >= mineExpNeed(p.mining.level)){
    p.mining.exp -= mineExpNeed(p.mining.level);
    p.mining.level++;
    log('<span class="lv">探矿等级提升至 '+p.mining.level+' 级</span>');
    eventLog('<span class="lv">探矿等级 '+p.mining.level+'</span>');
  }
  renderTab(); renderHeader();
}

// ---------- 副本护符兑换（instance_exchange.json 驱动） ----------
export function instEntries(){
  const ie=DATA.instance_exchange||{}; const out=[];
  for(const k in ie){ if(k.charAt(0)==='_') continue; out.push(Object.assign({_k:k}, ie[k])); }
  return out;
}
export function instSpec(){ return (DATA.instance_exchange||{})._exchange_spec || {}; }
export function instName(key){ const n={xianghunzhong_instance:'香魂冢', xuanyuantai:'轩辕台', guimu:'古墓'}; return n[key]||key; }
export function instMapName(mapKey){ const m=(DATA.maps.maps||[]).find(x=>x.key===mapKey); return m? m.name : mapKey; }
export function instGroup(mapKey){ return instEntries().filter(e=> e.npc_map===mapKey); }
// 逐级套用精炼加成（与手动精炼到同级结果一致，不判定成败）
export function applyRefineLevels(it, lv){
  const rf=DATA.refine; if(!rf) return;
  const max=rf.refine_max||7;
  for(let n=0;n<Math.max(0,Math.floor(lv||0));n++){
    if((it.refine||0)>=max) break;
    it.refine=(it.refine||0)+1;
    refineApplyOne(it);
  }
  if((it.refine||0)>=max && !(it.perks||[]).some(pk=>pk.hidden)) refineAddHidden(it);
}
// 取词条在该档位的中值（perk_value=mid）
export function perkMidValue(name, tier, job){
  const pool=DATA.perk_pool[job+'_general_pool'] || DATA.perk_pool['warrior_general_pool'];
  if(!pool) return 1;
  const all=(pool.stat_fixed||[]).concat(pool.stat_percent||[], pool.atk_fixed||[]);
  const f=all.find(x=>x.name===name);
  if(!f) return 1;
  const v=f.values[''+tier] || f.values['1'] || [1,1];
  return Math.round((v[0]+v[1])/2);
}
export function buildExchangeEquip(e){
  const p=state.player, spec=instSpec();
  const it=genEquip(e.slot, p.job, e.tier, p.level);
  if(!it) return null;
  applyRefineLevels(it, spec.refine||5);
  it.sockets = spec.sockets||3;
  it.gems = new Array(it.sockets).fill(null);
  const poolKey = (e.slot==='weapon'||e.slot==='gloves')? 'weapon':'general';
  const names = ((spec.perks_by_pool_job||{})[poolKey]||{})[p.job] || [];
  it.perks = names.map(n=>({name:n, value:perkMidValue(n, e.tier, p.job)}));
  it.quality = qualityFromPerks(it.perks.length);
  it.fromInstance = e.instance;
  return it;
}
export function doInstanceExchange(key){
  const p=state.player;
  const e=instEntries().find(x=>x._k===key);
  if(!e) return;
  if(itemCount(e.cost_key) < e.cost_count){ log('<span class="dmg">护符不足：需 '+itemName(e.cost_key)+' x'+e.cost_count+'</span>'); return; }
  const it=buildExchangeEquip(e);
  if(!it){ log('<span class="dmg">兑换失败：无可用基底</span>'); return; }
  itemConsume(e.cost_key, e.cost_count);
  addToBag(it);
  log('<span class="loot">兑换成功：['+QNAME[it.quality]+']'+it.name+'（+'+(it.refine)+'精炼·'+it.sockets+'孔）</span>');
  eventLog('副本兑换 <span class="q-'+it.quality+'">['+QNAME[it.quality]+']'+it.name+'</span>');
  renderTab(); renderHeader();
}

// ---------- 成就（achievements.json 驱动） ----------
export function achList(){ return (DATA.achievements||{}).achievements || []; }
export function achCats(){ return (DATA.achievements||{}).categories || {}; }
// ---------- 称号系统（achievements.json#titles 驱动） ----------
export function titleList(){ return TITLES; }
export function titleByKey(key){ return TITLES.find(t=>t.key===key) || null; }
export function titleUnlocked(key){ const p=state.player; return !!(p && p.titles && p.titles[key]); }
export function titleEffect(){
  const p=state.player; if(!p || !p.equippedTitle) return null;
  const t = titleByKey(p.equippedTitle); return t ? (t.effect||null) : null;
}
// 称号对当前怪物的伤害倍率：monster_dmg（怪物名含 keyword） / map_buff（在指定地图内）
export function titleDmgMult(m){
  const eff = titleEffect(); if(!eff) return 1;
  if(eff.type==='monster_dmg'){
    const kw = eff.keyword || ''; if(!kw) return 1;
    const name = (m && (m.name||'')) || '';
    return name.indexOf(kw)>=0 ? (eff.mult||1) : 1;
  }
  if(eff.type==='map_buff'){
    const mk = (state.zone && state.zone.mapKey) || (state.player && state.player.map);
    if(mk === eff.map_key) return 1 + (eff.dmg_pct||0)/100;
  }
  return 1;
}
// 当前地图下每 tick 回血/回蓝（map_buff）
export function titleHeal(){
  const p=state.player; if(!p || !p._s) return {hp:0,mp:0};
  const eff = titleEffect(); if(!eff || eff.type!=='map_buff') return {hp:0,mp:0};
  if(!state.zone || state.zone.mapKey !== eff.map_key) return {hp:0,mp:0};
  const hp = Math.max(0, Math.floor(p._s.max_hp * (eff.hp_pct||0)/100));
  const mp = Math.max(0, Math.floor(p._s.max_mp * (eff.mp_pct||0)/100));
  return {hp, mp};
}
export function titleProgress(t){
  const p=state.player; const st=(p&&p.stats)||{}; const un=t.unlock||{};
  switch(un.type){
    case 'kill_type': return (st.killType||{})[un.keyword]||0;
    case 'map_clear': return ((st.mapClear||[]).indexOf(un.map_key)>=0) ? 1 : 0;
    case 'achieve_count': { let n=0; for(const k in (p.ach||{})) n++; return n; }
  }
  return 0;
}
export function titleTarget(t){ return ((t.unlock||{}).count)||(((t.unlock||{}).type==='map_clear')?1:0); }
export function grantTitle(t){
  const p=state.player; if(!p || !p.titles) return;
  if(p.titles[t.key]) return;
  p.titles[t.key]={t:Date.now()};
  log('<span class="lv">解锁称号：'+t.name+'</span>');
  eventLog('解锁称号 <span class="lv">'+t.name+'</span>');
  // 首次解锁自动装备（若当前未装备任何称号）
  if(!p.equippedTitle) p.equippedTitle=t.key;
}
export function checkTitles(){
  const p=state.player; if(!p || !p.titles) return;
  for(const t of titleList()){
    if(p.titles[t.key]) continue;
    if(titleProgress(t) >= titleTarget(t)) grantTitle(t);
  }
}
export function equipTitle(key){
  const p=state.player; if(!p) return false;
  if(!key){ p.equippedTitle=null; return true; }
  if(!titleByKey(key) || !p.titles || !p.titles[key]) return false;
  p.equippedTitle=key; return true;
}

export function achValue(a){
  const p=state.player; const st=p.stats||{};
  switch(a.metric){
    case 'level': return p.level;
    case 'kill': return st.kills||0;
    case 'kill_type': return (st.killType||{})[a.kill_keyword]||0;
    case 'map_single': return (st.mapClear||[]).indexOf(a.map_key)>=0 ? 1 : 0;   // 必须按该成就指定的 map_key 判定；原先取「全地图击杀最大值」，导致 18 条 target=1 的「XX通关」杀第一只怪就全部达成（瞬间发放 1,986,000 金币）
    case 'map_clear': return (st.mapClear||[]).length;
    case 'refine7': return st.refine7||0;
    case 'craft53': return st.craftCount||0;
    case 'jubao': return st.crystalTotal||0;
  }
  return 0;
}
export function achDone(key){ const p=state.player; return !!(p.ach && p.ach[key]); }
export function grantAchievement(a){
  const p=state.player;
  p.ach[a.key]={t:Date.now()};
  if(a.reward_coins) p.gold += a.reward_coins;
  if(a.reward_coupon) p.crystal += a.reward_coupon;
  for(const ri_ of (a.reward_items||[])) addToBag({type:'consumable', key:ri_.key, count:ri_.count||1});
  log('<span class="lv">成就达成：'+a.name+'（'+(a.reward_coins? fmtNum(a.reward_coins)+'金币 ':'')+((a.reward_items||[]).length? (a.reward_items||[]).map(r=>itemName(r.key)+'x'+r.count).join('、'):'')+'）</span>');
  eventLog('<span class="lv">成就 '+a.name+'</span>');
}
export function checkAchievements(){
  const p=state.player; if(!p || !p.ach) return;
  for(const a of achList()){
    if(achDone(a.key)) continue;
    if(achValue(a) >= (a.target||1)) grantAchievement(a);
  }
  // 成就数量型称号（解锁 N 个成就）在这里一并检查
  checkTitles();
}

// ---------- 宝石炼制 / 药水炼制 ----------
export function gemRecipeFor(series, grade){
  const gr=DATA.gem_recipes||{};
  for(const k in gr){ const r=gr[k]; if(r.series===series && r.src_grade===grade) return r; }
  return null;
}
export function doGemRefine(series, grade){
  const p=state.player;
  const r=gemRecipeFor(series, grade);
  if(!r){ log('<span class="dmg">无对应炼制配方</span>'); return; }
  if(p.level < (r.level_required||0)){ log('<span class="dmg">等级不足（需 Lv.'+r.level_required+'）</span>'); return; }
  if(gemCount(series, grade) < 4){ log('<span class="dmg">需要 '+r.src_name+' x4</span>'); return; }
  if(!useMaterial(r.bottle_key||'lianhua_ping', 1)){ log('<span class="dmg">需要炼化瓶 x1</span>'); return; }
  gemConsume(series, grade, 4);
  addToBag({type:'gem', series:series, grade:r.dst_grade, count:1});
  log('<span class="loot">炼制成功：'+r.dst_name+' x1</span>');
  eventLog('炼制宝石 <span class="loot">'+r.dst_name+'</span>');
  renderTab();
}
export function doPotionRefine(recipeKey){
  const p=state.player;
  const r=(DATA.potion_recipes||{})[recipeKey];
  if(!r){ log('<span class="dmg">无此配方</span>'); return; }
  if(p.level < (r.level_required||0)){ log('<span class="dmg">等级不足（需 Lv.'+r.level_required+'）</span>'); return; }
  const c=r.cost||{};
  if(c.hp_potion && itemCount(c.hp_potion.key) < c.hp_potion.count){ log('<span class="dmg">需要 '+itemName(c.hp_potion.key)+' x'+c.hp_potion.count+'</span>'); return; }
  if(c.mp_potion && itemCount(c.mp_potion.key) < c.mp_potion.count){ log('<span class="dmg">需要 '+itemName(c.mp_potion.key)+' x'+c.mp_potion.count+'</span>'); return; }
  if(c.crystal && p.crystal < c.crystal.count){ log('<span class="dmg">需要神秘结晶 x'+c.crystal.count+'</span>'); return; }
  if(c.bottle && !useMaterial(c.bottle.key, c.bottle.count||1)){ log('<span class="dmg">需要炼化瓶 x'+(c.bottle.count||1)+'</span>'); return; }
  if(c.hp_potion) itemConsume(c.hp_potion.key, c.hp_potion.count);
  if(c.mp_potion) itemConsume(c.mp_potion.key, c.mp_potion.count);
  if(c.crystal) useCrystal(c.crystal.count);
  addToBag({type:'consumable', key:r.result_item, count:r.result_count||1});
  log('<span class="loot">炼制成功：'+r.result_name+' x'+(r.result_count||1)+'</span>');
  renderTab(); renderHeader();
}
// 资源增减
export function addOre(k,n){ const p=state.player; p.ores[k]=(p.ores[k]||0)+n; }
export function useOre(k,n){ const p=state.player; if((p.ores[k]||0)>=n){ p.ores[k]-=n; return true; } return false; }
export function addCrystal(n){ state.player.crystal+=n; }
export function useCrystal(n){ if(state.player.crystal>=n){ state.player.crystal-=n; return true; } return false; }
export function addMaterial(k,n){ const p=state.player; p.materials[k]=(p.materials[k]||0)+n; }
export function useMaterial(k,n){ const p=state.player; if((p.materials[k]||0)>=n){ p.materials[k]-=n; return true; } return false; }

// ---- ① 打造 ----
export function doForge(){
  const p=state.player;
  const slot=LS.forgeSlot;
  const tier=clamp(parseInt(LS.forgeTier,10)||1,1,7);
  const oreKey=ORE_BY_TIER[tier-1];
  const oreCost=3+tier*2, goldCost=tier*150;
  const base=genEquipBaseForSlot(slot, p.job, tier);
  if(!base){ log('<span class="dmg">该职业/部位暂无 '+tier+' 档基底</span>'); return; }
  const mode=LS.forgeMode||'random';
  const goldNeeded = Math.round(goldCost * (mode==='full_perk'? 2 : 1));
  if(!useOre(oreKey, oreCost)){ log('<span class="dmg">矿石不足：需 '+ORE_NAME[oreKey]+' x'+oreCost+'（拥有 '+(p.ores[oreKey]||0)+'）</span>'); return; }
  if(p.gold<goldNeeded){ log('<span class="dmg">金币不足，打造需 '+fmtNum(goldNeeded)+'</span>'); return; }
  p.gold-=goldNeeded;
  const eq=buildEquip(base, p.job, tier, slot, mode);
  const cm=DATA.craft;
  if(eq.perks.length>cm.craft_max_attr) eq.perks.length=cm.craft_max_attr;
  if(eq.sockets>cm.craft_max_slots) eq.sockets=cm.craft_max_slots;
  eq.gems=new Array(eq.sockets).fill(null);
  addToBag(eq);
  p.stats.craftCount=(p.stats.craftCount||0)+1;
  log('<span class="loot">打造成功：'+SLOT_NAME[slot]+'·'+eq.name+' ['+QNAME[eq.quality]+']（'+ORE_NAME[oreKey]+' x'+oreCost+' + '+fmtNum(goldNeeded)+'金）</span>');
  checkAchievements();
  refreshStats(); renderHeader(); renderTab();
}
// ---- ② 百炼丹炼制链 ----
export function doBailianCraft(L){
  const p=state.player;
  const r=DATA.bailian_recipes['level_'+L]; if(!r) return;
  if(!useMaterial('lianhua_ping',1)){ log('<span class="dmg">需要 炼化瓶 x1</span>'); return; }
  let shi=0; for(const m of r.materials) if(m.key==='bailian_shi') shi+=m.count;
  if(!useMaterial('bailian_shi',shi)){ log('<span class="dmg">需要 百炼石 x'+shi+'</span>'); return; }
  let cry=0; for(const m of r.materials) if(m.kind==='crystal') cry+=m.count;
  if(cry && !useCrystal(cry)){ log('<span class="dmg">需要 晶石(神秘结晶) x'+cry+'</span>'); return; }
  const lowL=L-1;
  if(lowL>=1){
    const have=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+lowL);
    if(have.length<2){ log('<span class="dmg">需要 百炼丹·'+cn(lowL)+' x2</span>'); return; }
    for(let i=0;i<2;i++){ const d=have[i]; d.count--; if(d.count<=0) p.bag=p.bag.filter(b=>b.uid!==d.uid); }
  }
  addToBag({uid:uid(), type:'consumable', key:r.result_item, count:1});
  log('<span class="loot">炼制成功：'+r.result_name+'</span>');
  renderHeader(); renderTab();
}
// ---- ③ 百炼装备升阶 ----
export function doBailianUse(){
  const p=state.player;
  const u=LS.bailEquip; if(!u){ log('<span class="dmg">请先选择要百炼的装备</span>'); return; }
  const it=findItem(u); if(!it||it.type!=='equip'){ log('<span class="dmg">装备不存在</span>'); return; }
  const cap=DATA.craft.craft_upgrade_max_tier;
  if(it.bailian>=cap){ log('<span class="dmg">'+it.name+' 已达百炼上限 +'+cap+'</span>'); return; }
  const needL=it.bailian+1;
  const have=p.bag.filter(b=>b.type==='consumable'&&b.key==='bailian_dan_'+needL);
  if(!have.length){ log('<span class="dmg">需要 百炼丹·'+cn(needL)+'（背包不足）</span>'); return; }
  const dan=have[0]; dan.count--; if(dan.count<=0) p.bag=p.bag.filter(b=>b.uid!==dan.uid);
  it.bailian=needL;
  for(const s in it.stats) it.stats[s]=Math.round(it.stats[s]*1.15);
  if(Math.random()<0.5){
    const pool=DATA.perk_pool[it.job+'_general_pool']||DATA.perk_pool['warrior_general_pool'];
    const all=(pool.stat_fixed||[]).concat(pool.stat_percent||[],pool.atk_fixed||[]);
    if(all.length){ const sf=pick(all); const vals=sf.values[''+it.tier]||sf.values['1']||[1,1]; it.perks.push({name:sf.name, suffix:sf.suffix||'', value:ri(vals[0],vals[1])}); }
  }
  refreshStats();
  log('<span class="loot">百炼成功！'+it.name+' 提升至 +'+needL+'（属性大幅增强）</span>');
  renderHeader(); renderTab();
}
// ---- ④ 提取回收 ----
export function doExtract(){
  const p=state.player;
  const u=LS.extractEquip; if(!u){ log('<span class="dmg">请先选择要提取的装备</span>'); return; }
  const it=findItem(u); if(!it||it.type!=='equip'){ log('<span class="dmg">装备不存在</span>'); return; }
  const oreKey=ORE_BY_TIER[(it.tier||1)-1];
  const amt=DATA.extract.ore_per_equip||1;
  addOre(oreKey, amt);
  log('<span class="loot">提取 '+it.name+'，回收 '+ORE_NAME[oreKey]+' x'+amt+'</span>');
  for(const g of (it.gems||[])) if(g){ addToBag({uid:uid(), type:'gem', series:g.series, grade:g.grade}); log('回收宝石 <span class="loot">'+gemSeriesName(g.series)+'·'+g.grade+'</span>'); }
  removeItem(it);
  refreshStats(); renderHeader(); renderTab();
}
// ---- ⑤ 矿石炼制 ----
export function doOreRefine(){
  const p=state.player;
  const key=LS.oreRecipe; if(!key){ log('<span class="dmg">请选择矿石炼制配方</span>'); return; }
  const r=DATA.ore_recipes[key]; if(!r) return;
  const c=r.cost;
  if(!useOre(c.ore.key, c.ore.count)){ log('<span class="dmg">矿石不足：需 '+oreName(c.ore.key)+' x'+c.ore.count+'</span>'); return; }
  if(!useCrystal(c.crystal.count)){ log('<span class="dmg">晶石(神秘结晶)不足：需 '+c.crystal.count+'</span>'); return; }
  if(p.gold<c.coin){ log('<span class="dmg">金币不足，需 '+fmtNum(c.coin)+'</span>'); return; }
  p.gold-=c.coin;
  addOre(r.result_item, r.result_count);
  log('<span class="loot">矿石炼制成功：'+oreName(r.result_item)+' x'+r.result_count+'</span>');
  renderHeader(); renderTab();
}
// ---- ⑥ 乾坤炉合成 ----
export function doFurnace(){
  const p=state.player;
  const key=LS.furnace; if(!key){ log('<span class="dmg">请选择乾坤炉配方</span>'); return; }
  const r=DATA.furnace_recipes[key]; if(!r) return;
  if(ORE_KEYS.has(r.src_key)){ if(!useOre(r.src_key, r.src_count)){ log('<span class="dmg">材料不足：需 '+oreName(r.src_key)+' x'+r.src_count+'</span>'); return; } }
  else { if(!useMaterial(r.src_key, r.src_count)){ log('<span class="dmg">材料不足：需 '+itemName(r.src_key)+' x'+r.src_count+'</span>'); return; } }
  if(p.gold<(r.gold_cost||0)){ log('<span class="dmg">金币不足，需 '+fmtNum(r.gold_cost||0)+'</span>'); return; }
  p.gold-=(r.gold_cost||0);
  if(ORE_KEYS.has(r.result_key)) addOre(r.result_key, r.result_count);
  else addMaterial(r.result_key, r.result_count);
  log('<span class="loot">乾坤炉合成：'+itemName(r.result_key)+' x'+r.result_count+'</span>');
  renderHeader(); renderTab();
}
// ---- 材料商店 ----
export function buyMaterial(key, price){
  const p=state.player;
  if(p.gold<price){ log('<span class="dmg">金币不足（需 '+fmtNum(price)+'）</span>'); return; }
  p.gold-=price;
  if(ORE_KEYS.has(key)) addOre(key,1); else addMaterial(key,1);
  log('<span class="loot">购入 '+itemName(key)+(ORE_KEYS.has(key)?'矿石':'')+'</span>');
  renderHeader(); renderTab();
}

