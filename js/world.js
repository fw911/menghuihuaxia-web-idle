/* ===== 模块 world.js —— 地图/导航/副本/区域探索/首领清剿 =====
 * 来源：game.js L2271-2400（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 24 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA } from './core.js';
import { sm } from './player.js';
import { eventLog, log, renderMap } from './render.js';
import { itemName } from './shop.js';
import { achList, checkAchievements, fmtNum } from './life.js';

// ---------- 地图 / 导航 ----------
export function travelTo(mapKey){
  const p = state.player;
  const map = DATA.maps.maps.find(m=>m.key===mapKey);
  if(!map) return;
  if(map.unlock_map && !p.unlocked[map.unlock_map]){ log('<span class="dmg">需先探索 '+map.unlock_map+' 才能进入</span>'); return; }
  if(map.require_shenmo && !(p.shenmo && p.shenmo.faction)){
    log('<span class="dmg">需先入神魔道（角色 Lv.'+((sm().entry||{}).min_char_level||101)+'）才能进入'+map.name+'</span>'); return;
  }
  p.map = mapKey; p.unlocked[mapKey]=true;
  state.zone=null; state.combat=null;
  log('<span class="sys">来到 '+map.name+'（安全区：'+(map.safe_zone?map.safe_zone.name:'无')+'）</span>');
  renderMap();
}

// ---------- 副本（dungeon_bosses / enter_level_min / daily_enter_limit） ----------
export function mapByKey(k){ return (DATA.maps.maps||[]).find(m=>m.key===k) || null; }
export function dungeonBosses(map){ return (map && map.dungeon_bosses) || []; }
export function isDungeon(map){ return !!(map && (map.is_dungeon || (map.dungeon_bosses||[]).length)); }
export function todayKey(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
export function dungeonBossKilled(mapKey, bossKey){ const mb=(state.player.stats.mapBoss||{})[mapKey]; return !!(mb && mb[bossKey]); }
export function dungeonKilledCount(map){ return dungeonBosses(map).filter(b=>dungeonBossKilled(map.key, b.key)).length; }
export function dungeonAllBossKilled(map){ const n=dungeonBosses(map).length; return n>0 && dungeonKilledCount(map)>=n; }
// 今日剩余进入次数（无 daily_enter_limit 时不限）
export function dungeonEntryLeft(map){
  const lim=map.daily_enter_limit||0; if(!lim) return Infinity;
  const rec=(state.player.stats.dungeonEnter||{})[map.key];
  if(!rec || rec.d!==todayKey()) return lim;
  return Math.max(0, lim-(rec.n||0));
}
export function consumeDungeonEntry(map){
  const lim=map.daily_enter_limit||0; if(!lim) return true;
  if(dungeonEntryLeft(map)<=0) return false;
  const p=state.player; p.stats.dungeonEnter=p.stats.dungeonEnter||{};
  const rec=p.stats.dungeonEnter[map.key];
  if(!rec || rec.d!==todayKey()) p.stats.dungeonEnter[map.key]={d:todayKey(), n:1};
  else rec.n=(rec.n||0)+1;
  return true;
}
// 记录一次副本首领击杀；全部首领击杀后记入 mapClear（= 通关，可领地图通关成就）
export function noteDungeonBossKilled(map, bossKey, mname){
  const p=state.player; p.stats.mapBoss=p.stats.mapBoss||{};
  const mb=p.stats.mapBoss[map.key]=p.stats.mapBoss[map.key]||{};
  if(mb[bossKey]) return false;
  mb[bossKey]=1;
  log('<span class="loot">副本首领 '+mname+' 已击败</span>（'+dungeonKilledCount(map)+'/'+dungeonBosses(map).length+'）');
  if(dungeonAllBossKilled(map)){
    p.stats.mapClear=p.stats.mapClear||[];
    if(p.stats.mapClear.indexOf(map.key)<0){
      p.stats.mapClear.push(map.key);
      log('<span class="lv">★ 通关副本：'+map.name+'</span>（已记入地图通关）');
      eventLog('<span class="lv">★ 通关 '+map.name+'</span>');
      checkAchievements();
    }
  }
  return true;
}
// ---------- 区域探索（explore_target）/ 首领区清剿（minion_target） ----------
// explore_target：在该区域累计击杀这么多只普通怪即算「探索完成」（野外 35 / 洞窟 35 / 副本区域 10~15）
export function zoneTarget(map, zone){ return (zone && zone.explore_target) || 0; }
export function zoneKillCount(mapKey, zoneKey){ const zk=(state.player.stats.zoneKills||{})[mapKey]; return (zk && zk[zoneKey]) || 0; }
export function zoneExplored(mapKey, zoneKey){
  const map=mapByKey(mapKey); if(!map) return false;
  const z=(map.zones||[]).find(x=>x.key===zoneKey); if(!z) return false;
  const t=zoneTarget(map,z); if(!t) return true;
  return zoneKillCount(mapKey, zoneKey) >= t;
}
export function zoneExploredCount(map){ return (map.zones||[]).filter(z=>zoneExplored(map.key, z.key)).length; }
// 地图探索度（按各区域目标加权）
export function mapExplorePct(map){
  const zs=(map.zones||[]); if(!zs.length) return 100;
  let done=0, tot=0;
  for(const z of zs){ const t=zoneTarget(map,z)||1; tot+=t; done+=Math.min(t, zoneKillCount(map.key, z.key)); }
  return tot? Math.round(done/tot*100) : 100;
}
// 该图的「首次通关」奖励（成就 map_single）—— 用于在地图面板上把奖励显性化。
// 成就奖励本身就是通关收益，但玩家在挂机流程里看不到它，导致「打首领区」这件事在体感上不存在。
export function mapClearReward(mapKey){
  for(const a of achList()){
    if(a.metric==='map_single' && a.map_key===mapKey)
      return { key:a.key, name:a.name, coins:a.reward_coins||0, coupon:a.reward_coupon||0, items:(a.reward_items||[]) };
  }
  return null;
}
export function mapCleared(mapKey){ return ((state.player.stats.mapClear)||[]).indexOf(mapKey)>=0; }
export function rewardText(r){
  if(!r) return '';
  const parts=[];
  if(r.coins) parts.push(fmtNum(r.coins)+'金币');
  if(r.coupon) parts.push(r.coupon+'神秘结晶');
  for(const it of (r.items||[])) parts.push(itemName(it.key)+'x'+(it.count||1));
  return parts.join(' + ');
}
// minion_target：首领区需先清剿指定数量的普通/精英小怪，首领才会现身
export function bossMinionTarget(map){
  const bz=map && map.boss_zone; if(!bz || !bz.minion_target) return null;
  return { normal: bz.minion_target.normal||0, elite: bz.minion_target.elite||0 };
}
export function minionKillCount(mapKey, kind){ const mk=(state.player.stats.minionKills||{})[mapKey]; return (mk && mk[kind]) || 0; }
export function bossZoneCleared(map){
  const t=bossMinionTarget(map); if(!t) return true;   // 没配 minion_target 就不设前置
  return minionKillCount(map.key,'normal')>=t.normal && minionKillCount(map.key,'elite')>=t.elite;
}
// 普通区域：记一次击杀（不含首领）
export function noteZoneKill(mapKey, zoneKey){
  const p=state.player; p.stats.zoneKills=p.stats.zoneKills||{};
  const zk=p.stats.zoneKills[mapKey]=p.stats.zoneKills[mapKey]||{};
  const before=zk[zoneKey]||0; zk[zoneKey]=before+1;
  const map=mapByKey(mapKey); if(!map) return;
  const z=(map.zones||[]).find(x=>x.key===zoneKey); if(!z) return;
  const t=zoneTarget(map,z); if(!t) return;
  if(before<t && zk[zoneKey]>=t){
    log('<span class="lv">★ 区域探索完成：'+z.name+'</span>（'+zoneExploredCount(map)+'/'+map.zones.length+'）');
    eventLog('<span class="lv">★ 探索完成 '+map.name+'·'+z.name+'</span>');
  }
}
// 首领区：记一次小怪清剿；凑齐 minion_target 时首领现身
export function noteMinionKill(mapKey, isElite){
  const p=state.player, map=mapByKey(mapKey);
  if(!map || !map.boss_zone) return;
  const was=bossZoneCleared(map);
  p.stats.minionKills=p.stats.minionKills||{};
  const mk=p.stats.minionKills[mapKey]=p.stats.minionKills[mapKey]||{normal:0, elite:0};
  const kind=isElite? 'elite':'normal';
  mk[kind]=(mk[kind]||0)+1;
  if(!was && bossZoneCleared(map)){
    log('<span class="lv">★ 清剿完成：'+map.name+'·'+map.boss_zone.name+'</span> 首领已现身，可挑战');
    eventLog('<span class="lv">★ 清剿完成 '+map.boss_zone.name+'</span>');
  }
}
