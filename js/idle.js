/* ===== 模块 idle.js —— 离线收益 + 自动挂机（药水/换区）+ 统计上报 =====
 * 来源：game.js L4830-5071（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 27 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { apiCall, powerScore } from './api.js';
import { DATA, getMonster } from './core.js';
import { isXianzhiNow, monsterExp } from './player.js';
import { gainExp } from './battle.js';
import { addToBag } from './bag.js';
import { bossZoneCleared, mapCleared, travelTo } from './world.js';
import { $, log, renderHeader, renderHero, renderMap, zoneName } from './render.js';
import { renderTab } from './tabs.js';
import { itemName, useConsumable } from './shop.js';
import { fmtNum } from './life.js';


// ---------- 离线收益（离线挂机也能赚） ----------
// 原口径（battle/autopilot.py _tick_realtime L211-218 反汇编）：
//   if dt > OFFLINE_EXP_MIN_GAP(30s): whole_min=min(int(dt//60),1440); exp=int(rate_per_min*whole_min*0.5*REWARD_EXTRA_FACTOR)
// 即上限 1440 分钟 = 24 小时；本 port 另按 OFFLINE_EFF 净倍率同步结算金币。
export const OFFLINE_MAX_SEC = 24*3600;   // 最多补算 24 小时（原版 min(int(dt//60),1440) 分钟）
export const OFFLINE_MIN_GAP = 30;        // 离开不足 30 秒不补算（原版 OFFLINE_EXP_MIN_GAP=30）
export const OFFLINE_EFF = 0.0875;       // 离线净倍率 = 原版 0.35(在线效率) × 0.5(离线系数) × 0.5(奖励额外) = 0.0875
// 当前（或最优）区域的每秒收益：经验/秒来自 zoneEval，金币/秒按平均金币 ÷ 击杀耗时
export function idleRate(){
  const p=state.player; if(!p||!p._s) return {exp:0, gold:0};
  let z = state.zone;
  if(!z){ const b=bestZone(); if(b) z={mapKey:b.mapKey, zoneKey:b.zoneKey, isBoss:b.isBoss}; }
  if(!z) return {exp:0, gold:0};
  const map=DATA.maps.maps.find(m=>m.key===z.mapKey); if(!map) return {exp:0, gold:0};
  const keys=zoneKeys(map, z.zoneKey, z.isBoss)||[];
  const a=zoneMonsterAvg(keys); if(!a) return {exp:0, gold:0};
  const ttk=Math.max(0.8, a.hp/playerDps());
  const expPerSec = zoneEval(z.mapKey, z.zoneKey, z.isBoss);
  const goldPerSec = ((a.gold_min||0)+(a.gold_max||0))/2 / ttk;
  return { exp: Math.max(0,expPerSec||0), gold: Math.max(0,goldPerSec) };
}
// 启动补算离线收益（在 load 之后调用）
export function applyOfflineEarnings(){
  const p=state.player;
  if(!p || !state._loadedTs) return;
  const away = (Date.now() - state._loadedTs)/1000;
  state._loadedTs = null;
  if(away < OFFLINE_MIN_GAP) return;      // 离开不足 30 秒不算（原版 OFFLINE_EXP_MIN_GAP）
  const earnSec = Math.min(away, OFFLINE_MAX_SEC);
  const rate = state._loadedRate || idleRate();
  const expGain = Math.floor((rate.exp||0) * earnSec * OFFLINE_EFF);
  const goldGain = Math.floor((rate.gold||0) * earnSec * OFFLINE_EFF);
  if(expGain>0) gainExp(expGain);
  if(goldGain>0) p.gold += goldGain;
  renderHeader(); renderHero(); renderTab();
  if(expGain>0 || goldGain>0) showOfflineModal(away, earnSec, expGain, goldGain);
}
export function showOfflineModal(awaySec, earnSec, exp, gold){
  const el=$('offline-modal'); if(!el) return;
  const fmtTime = s=>{ const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=Math.floor(s%60);
    if(h>0) return h+' 小时 '+m+' 分'; if(m>0) return m+' 分 '+ss+' 秒'; return ss+' 秒'; };
  $('offline-summary').innerHTML = '你离开了 <b>'+fmtTime(awaySec)+'</b>（按 '+Math.round(OFFLINE_EFF*100)+'% 效率结算 '+fmtTime(earnSec)+'）<br>'+
    '离线挂机收益：经验 <b style="color:var(--gold)">'+fmtNum(exp)+'</b> · 金币 <b style="color:var(--gold)">'+fmtNum(gold)+'</b>';
  el.style.display='flex';
  const btn=$('offline-close'); if(btn) btn.onclick=()=>{ el.style.display='none'; renderHeader(); renderHero(); renderTab(); };
}

// ---------- 自动挂机（P0 闭环） ----------
export const HP_POTIONS = ['xumingdan','xuming_xiao','xuming_da','xuming_sanqing','xuming_jiuzhuan','xuming_longxian'];
export const MP_POTIONS = ['ningshenye','ningshen_lingfu','ningshen_yuquan','ningshen_sanhua','ningshen_jiuzhuan','ningshen_longxian'];
export function potionTier(level){          // 按角色等级挑合适的药水档位（0~5）
  if(level<20) return 0; if(level<40) return 1; if(level<60) return 2;
  if(level<80) return 3; if(level<100) return 4; return 5;
}
export function itemPrice(key){ const d=(DATA.items.items||[]).find(i=>i.key===key); return d? (d.price||0) : 0; }
// 找背包里该 key 的第一瓶药
export function findPotion(key){
  const p=state.player;
  return p.bag.find(b=> b.type==='consumable' && b.key===key && (b.count||0)>0) || null;
}
// 自动补给：按 items.json 价格买一瓶（优先选买得起的最高档）
export function buyPotion(list, tier){
  const p=state.player;
  for(let t=tier; t>=0; t--){
    const k=list[t], price=itemPrice(k);
    if(price>0 && p.gold>=price){
      p.gold-=price;
      const found=p.bag.find(b=> b.type==='consumable' && b.key===k);
      if(found) found.count=(found.count||1)+1;
      else addToBag({type:'consumable', key:k, count:1});
      log('<span class="sys">自动补给：'+itemName(k)+' x1（-'+fmtNum(price)+'金）</span>');
      return true;
    }
  }
  return false;
}
// 自动喝药：低血/低蓝时喝，药水不足自动购买
export function autoPotion(){
  const p=state.player, A=state.auto;
  if(!A.potion || !p || !p._s) return;
  const tier=potionTier(p.level);
  if(p.hp < p._s.max_hp*(A.hp/100)){
    let k=HP_POTIONS[tier], it=findPotion(k);
    if(!it && A.buy && buyPotion(HP_POTIONS, tier)) it=findPotion(k);
    if(!it){ // 高等级药没有就往下找一瓶能用的
      for(let t=tier-1;t>=0 && !it;t--){ it=findPotion(HP_POTIONS[t]); if(it) k=HP_POTIONS[t]; }
    }
    if(it) useConsumable(it);
  }
  if(p.mp < p._s.max_mp*(A.mp/100)){
    let k=MP_POTIONS[tier], it=findPotion(k);
    if(!it && A.buy && buyPotion(MP_POTIONS, tier)) it=findPotion(k);
    if(!it){ for(let t=tier-1;t>=0 && !it;t--){ it=findPotion(MP_POTIONS[t]); if(it) k=MP_POTIONS[t]; } }
    if(it) useConsumable(it);
  }
}

// ---------- 自动换区：按「经验/秒」挑最优区域 ----------
export function zoneMonsterAvg(keys){
  let lv=0, exp=0, hp=0, n=0;
  for(const k of (keys||[])){
    const m=getMonster(k); if(!m) continue;
    lv+=m.level||0; exp+=m.exp||0; hp+=m.hp||0; n++;
  }
  if(!n) return null;
  return { level:lv/n, exp:exp/n, hp:hp/n };
}
export function playerDps(){
  const p=state.player, s=p._s||{};
  return Math.max(1, (s.main||1) * 1.4 + 10);   // 含技能加成的粗估
}
// 区域出怪列表（与实际遭遇一致：小怪 + 1 只精英；首领区未清剿完时以清剿对象计）
export function zoneKeys(map, zoneKey, isBoss){
  if(!map) return null;
  if(isBoss){
    if(!map.boss_zone) return null;
    if(bossZoneCleared(map)) return map.boss_zone.boss|| [];
    return (map.boss_zone.monsters||[]).concat((map.boss_zone.elite_monsters||[]).slice(0,1));
  }
  const z=(map.zones||[]).find(zz=>zz.key===zoneKey); if(!z) return null;
  return (z.monsters||[]).concat((z.elite_monsters||[]).slice(0,1));
}
// 区域「打穿一轮」的产出：经验走 monsterExp（与实际掉落同源，含类型倍率与等级差缩放），
// HP 用于估算耗时。角色等级超出怪物上限时各区经验都会是 0（exp=0）。
export function zoneYield(keys, playerLevel){
  let exp=0, hp=0, n=0;
  for(const k of (keys||[])){
    const m=getMonster(k); if(!m) continue;
    exp += monsterExp(m, playerLevel); hp += (m.hp||0); n++;
  }
  return n? {exp, hp, n} : null;
}
// 评估某区域收益：返回经验/秒，不可打返回 -1
export function zoneEval(mapKey, zoneKey, isBoss){
  const p=state.player;
  const map=DATA.maps.maps.find(m=>m.key===mapKey); if(!map) return -1;
  if(isBoss && p.level < (map.boss_zone? (map.boss_zone.unlock_level||0) : 0)) return -1;
  const keys=zoneKeys(map, zoneKey, isBoss); if(!keys) return -1;
  const a=zoneMonsterAvg(keys); if(!a) return -1;
  if(a.level > p.level+8) return -1;                       // 太强打不过
  const y=zoneYield(keys, p.level); if(!y) return -1;
  const exp=y.exp*(isBoss? 0.9 : 1);                       // 首领区略折（要走机制，实际更慢）
  const ttk=Math.max(0.8, y.hp/playerDps());               // 估算击杀耗时（秒等效）
  if(p.hp>0 && a.level > p.level+3 && p._s && a.hp > p._s.max_hp*0.9) return -1;  // 容易被打死
  return exp/ttk;
}
export function bestZone(){
  const p=state.player; let best=null, fb=null, bestBoss=null;
  const consider=(map, zoneKey, isBoss, name)=>{
    const mk=map.key;
    const sc=zoneEval(mk, zoneKey, isBoss);
    if(sc>0){
      if(!best || sc>best.score) best={mapKey:mk, zoneKey, isBoss, score:sc, name};
      // 首领优先：未通关且可打的首领区，优先于普通区，改善 boss 进度推进
      if(isBoss && !mapCleared(mk) && (!bestBoss || sc>bestBoss.score)) bestBoss={mapKey:mk, zoneKey, isBoss, score:sc, name};
      return;
    }
    // 保底：角色等级超出怪物上限后（最高怪 Lv120，怪低 5 级即 0 经验）所有区域经验都为 0，
    // 此时仍要能继续挂机刷金币/材料，退化为「均怪等级最高且打得过」的区域。
    const keys=zoneKeys(map, zoneKey, isBoss); if(!keys) return;
    const a=zoneMonsterAvg(keys); if(!a || a.level > p.level+8) return;
    if(!fb || a.level>fb.lv) fb={mapKey:mk, zoneKey, isBoss, name, lv:a.level};
  };
  // 遍历全部地图：只要 unlock_map 前置满足即可前往（travelTo 会自动解锁），
  // 等级门槛由 zoneEval 过滤，这样挂机才能随等级自动推进到新地图。
  for(const map of (DATA.maps.maps||[])){
    if(map.unlock_map && !p.unlocked[map.unlock_map]) continue;
    if(!(map.zones||[]).length && !map.boss_zone) continue;
    for(const z of (map.zones||[])) consider(map, z.key, false, map.name+' · '+(z.name||z.key));
    if(map.boss_zone) consider(map, null, true, map.name+' · 首领');
  }
  if(bestBoss) return bestBoss;   // 首领优先：先推进未通关副本
  if(best) return best;
  return fb? {mapKey:fb.mapKey, zoneKey:fb.zoneKey, isBoss:fb.isBoss, score:0, name:fb.name} : null;
}
export function autoZone(force){
  const A=state.auto, p=state.player;
  if(!A.zone || !p) return;
  if(isXianzhiNow()) return;   // 仙之境为手动静修，autoZone 不强行换走
  const b=bestZone(); if(!b) return;
  const cur=state.zone;
  const same = cur && cur.mapKey===b.mapKey && cur.zoneKey===b.zoneKey && cur.isBoss===b.isBoss;
  if(same && !force) return;
  if(p.map!==b.mapKey){ travelTo(b.mapKey); }
  state.zone={mapKey:b.mapKey, zoneKey:b.zoneKey, isBoss:b.isBoss};
  state.combat=null;
  log('<span class="sys">自动换区 → '+zoneName(state.zone)+'（预估 '+b.score.toFixed(1)+' 经验/秒）</span>');
  renderMap(); renderHeader();
}
// 升到新等级时重新评估区域（异步，避免打断当前结算）
export function autoZoneOnLevelUp(){ if(state.auto.zone) setTimeout(()=>autoZone(false), 0); }
// 挂机中定期评估：每 30 tick 一次、且只在非战斗中切换，避免打断战斗
export let _lastZoneTick = -999;
export function maybeAutoZone(){
  if(!state.auto.zone || !state.player) return;
  if(state.combat) return;
  if(state.ticks - _lastZoneTick < 30) return;
  _lastZoneTick = state.ticks;
  autoZone(false);
}

// ---------- 挂机统计与后端上报 ----------
export function sessBump(field, n, key){
  const S=state.sess;
  if(field==='drop'){
    S.drops[key]=(S.drops[key]||0)+(n||0);
    if(!S.dropTotal) S.dropTotal={};                       // 兼容旧 state
    S.dropTotal[key]=(S.dropTotal[key]||0)+(n||0);          // 累计版（不被上报清零）
  }
  else S[field]=(S[field]||0)+(n||0);
}
// 记录升级时间点（用于「升级时间线」图）
export function sessLevelUp(level){
  const S=state.sess;
  if(!S.levelUps) S.levelUps=[];
  const last=S.levelUps[S.levelUps.length-1];
  if(last && last.level===level) return;
  S.levelUps.push({ t:Date.now(), level });
  if(S.levelUps.length>60) S.levelUps.shift();
}
export function sessPerMin(){
  const S=state.sess, min=Math.max(1/60,(Date.now()-S.t0)/60000);
  return { kills:Math.round(S.kills/min*10)/10, exp:Math.round(S.exp/min), gold:Math.round(S.gold/min),
    minutes:Math.round(min*10)/10 };
}
// 本局趋势采样：每隔一段时间记录一帧（战力 / 经验·分 / 金币·分），用于折线图
export function sessSample(){
  const S=state.sess, p=state.player;
  if(!p || !p._s) return;
  const pm=sessPerMin();
  S.history.push({ t:Date.now(), power:powerScore(p), expPerMin:pm.exp, goldPerMin:pm.gold });
  if(S.history.length>120) S.history.shift();   // 最多保留 1 小时（30s 一帧）
}
export async function reportStats(force){
  if(!state.auto.stats || !state.cloud.ok || !state.player) return;
  const S=state.sess, now=Date.now();
  if(!force && now-S.lastReport < 60000) return;
  const seconds=(now-S.lastReport)/1000;
  S.lastReport=now;
  const body={ job:state.player.job, level:state.player.level, kills:S.kills, exp:S.exp, gold:S.gold,
    seconds, deaths:S.deaths, drops:S.drops, samples:1 };
  S.kills=0; S.exp=0; S.gold=0; S.drops={}; S.deaths=0;
  try{ await apiCall('/api/stats',{method:'POST', body}); }catch(e){}
}

