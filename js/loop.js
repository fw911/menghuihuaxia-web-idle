/* ===== 模块 loop.js —— 起区 startZone + 主循环 + 存档/读档 + 本地导入导出 =====
 * 来源：game.js L4661-4829（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 17 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { powerScore } from './api.js';
import { DATA, _ids } from './core.js';
import { refreshStats } from './smtree.js';
import { backfillDurability } from './equip.js';
import { tick } from './battle.js';
import { consolidateBag, maybeAutoSalvage } from './bag.js';
import { consumeDungeonEntry, dungeonBosses } from './world.js';
import { $, log, renderHeader, renderHero, renderMap, updateMapProgress, zoneName } from './render.js';
import { jobCn } from './panels.js';
import { fmtNum } from './life.js';
import { idleRate, maybeAutoZone } from './idle.js';
import { renderAll } from './boot.js';

export function startZone(mapKey, zoneKey, isBoss, bossKey){
  const p=state.player;
  const map=DATA.maps.maps.find(m=>m.key===mapKey);
  if(!map) return false;
  if(isBoss){
    if(map.boss_zone){
      if(p.level < map.boss_zone.unlock_level){ log('<span class="danger">等级不足</span>'); return false; }
    }else{
      // 副本首领：进入等级门槛 + 每日次数限制
      const b=dungeonBosses(map).find(x=>x.key===bossKey);
      if(!b){ log('<span class="dmg">无此副本首领</span>'); return false; }
      if(p.level < (map.enter_level_min||0)){ log('<span class="danger">等级不足（'+map.name+'需 Lv.'+map.enter_level_min+'）</span>'); return false; }
      if(!consumeDungeonEntry(map)){ log('<span class="dmg">今日进入次数已用完（每日 '+(map.daily_enter_limit||0)+' 次）</span>'); return false; }
    }
  }
  state.zone={mapKey, zoneKey, isBoss, bossKey};
  state.combat=null;
  log('<span class="sys">开始挂机：'+zoneName(state.zone)+'</span>');
  setIdle(true);
  renderMap(); renderHeader();
  return true;
}

// ---------- 主循环 ----------
export let timer=null;
export function setGameTimer(t){ timer = t; }   // 供 boot.js 跨模块设置主循环定时器（imported 绑定只读）
let _lastMapTick = -999;   // 地图进度刷新节流（见 loop()）
export function setIdle(on){
  state.idle=on;
  $('btn-toggle').textContent = on?'暂停挂机':'开始挂机';
  $('btn-toggle').classList.toggle('primary', !on);
}
// 地图探索进度实时刷新：原版 world.js renderProgress 每 tick 重渲染整块进度面板
// （并保留 .zone-loot 滚动位置）。本 port 的 #map-pane 内容短、无内嵌滚动列表。
// 2026-10-22 优化：原实现每 2 秒整体重建 #map-pane 的 innerHTML —— 重建会替换掉
// 用户正要点击的节点（点击落空）、清掉 hover 态，看起来像「点了没反应」。
// 改为：优先增量更新进度文本（不动 DOM 结构）；仅当结构变化（首领现身/清剿完成/
// 通关态翻转）才回退全量重渲染。
export function refreshMapProgress(){
  const el=$('map-pane'); if(!el) return;
  if(updateMapProgress()) return;          // 增量成功 → 完事
  const sc = el.scrollTop;
  renderMap();
  if(sc>0) el.scrollTop = sc;
}
export function loop(){
  if(!state.idle) return;
  if(!state.zone){ setIdle(false); log('<span class="danger">请先在左侧选择一个区域开始挂机。</span>'); return; }
  const steps = state.speed;
  for(let i=0;i<steps;i++) tick();
  maybeAutoZone();        // P0：定期按经验/秒自动换区
  maybeAutoSalvage();     // 包裹将满时自动分解白/绿装（回收矿石/宝石，避免被静默丢弃）
  // 头部与角色面板刷新（HP/MP/EXP）每轮
  renderHeader(); renderHero();
  // 地图探索进度实时刷新（击杀数/探索度/完成态）——节流到每 3 轮，避免 700ms 全量重渲染抖动
  if(state.ticks - _lastMapTick >= 3){ _lastMapTick = state.ticks; refreshMapProgress(); }
}

// ---------- 存档 ----------
export const SAVE_KEY='menghuihuaxia_idle_save_v1';
// 构造存档数据：本地 localStorage 与云端共用同一份结构
export function buildSavePayload(){
  const p=state.player;
  return { name:p.name, job:p.job, level:p.level, exp:p.exp, gold:p.gold, crystal:p.crystal, hp:p.hp, mp:p.mp,
    map:p.map, unlocked:p.unlocked, equip:p.equip, bag:p.bag, kills:state.kills, quests:p.quests||{},
    ores:p.ores, materials:p.materials, wuhunSlots:p.wuhunSlots||[null,null], shenmo:p.shenmo||null,
    skills:p.skills||{}, passives:p.passives||{}, events:state.events.slice(-12), _uid:_ids.n,
    summon:p.summon||null, mining:p.mining||{level:1,exp:0}, stats:p.stats||{}, ach:p.ach||{}, mine:state.mine||null,
    titles:p.titles||{}, equippedTitle:p.equippedTitle||null, crystals:p.crystals||{}, power:powerScore(p), v:2, ts:Date.now(), rate:idleRate() };
}
// 应用存档数据（本地读档与云端读档共用）
export function applySavePayload(d){
  state.player={ name:d.name, job:d.job, level:d.level, exp:d.exp, gold:d.gold, crystal:d.crystal||0, hp:d.hp, mp:d.mp,
    map:d.map, unlocked:d.unlocked||{}, equip:d.equip||{}, bag:d.bag||[], quests:d.quests||{},
    ores:d.ores||{}, materials:d.materials||{},
    wuhunSlots:d.wuhunSlots||[null,null], shenmo:d.shenmo||null,
    skills:d.skills||{}, passives:d.passives||{}, skillCd:{}, _s:null,
    summon:d.summon||null, mining:d.mining||{level:1, exp:0},
    stats:d.stats||{kills:0, killType:{}, mapKills:{}, mapClear:[], mapBoss:{}, dungeonEnter:{}, zoneKills:{}, minionKills:{}, refine7:0, craftCount:0, crystalTotal:0}, ach:d.ach||{}, titles:d.titles||{}, equippedTitle:d.equippedTitle||null, crystals:d.crystals||{} };
  state.kills=d.kills||0; _ids.n=d._uid||1; state.events=d.events||[];
  state.mine = d.mine||null;
  state._loadedTs = d.ts||null;       // 离线收益：读取上次存档时间
  state._loadedRate = d.rate||null;   // 离线收益：读取上次挂机速率
  if(state.player.shenmo){ state.player.shenmo.nodes=state.player.shenmo.nodes||{}; state.player.shenmo.cd=state.player.shenmo.cd||{}; }
  backfillDurability(); // 兼容旧存档：装备补 durability 字段（精炼过的按 ×1.04/级 补回增益）
  // 兼容旧存档：装备补 job 字段（本 port buildEquip 自初始版本即带 job，此处仅兜底；
  // 缺省时按存档角色职业回填——能进该玩家背包的装备按例可穿，避免职业门控误伤）
  for(const it of state.player.bag){ if(it&&it.type==='equip'&&it.job==null) it.job=d.job; }
  for(const sl in state.player.equip){ const it=state.player.equip[sl]; if(it&&it.type==='equip'&&it.job==null) it.job=d.job; }
  consolidateBag(); // 兼容旧存档：合并同类可叠加物品（装备不合并）
  refreshStats();
  state.player.hp=Math.min(state.player.hp, state.player._s.max_hp);
}
export function save(quiet){
  if(!state.player) return;
  localStorage.setItem(SAVE_KEY, JSON.stringify(buildSavePayload()));
  if(!quiet) log('<span class="sys">已存档</span>');
}
export function load(){
  const s=localStorage.getItem(SAVE_KEY); if(!s) return false;
  try{ applySavePayload(JSON.parse(s)); return true; }catch(e){ return false; }
}

// ---------- 本地存档 导出 / 导入（云存档之外的兜底，防浏览器清档丢档） ----------
// 读取本地存档时间戳（可能为 null / 解析失败）
export function localSaveStamp(){
  try{ const s=localStorage.getItem(SAVE_KEY); if(!s) return null; const d=JSON.parse(s); return (d&&d.ts)||null; }
  catch(e){ return null; }
}
// 校验导入的存档结构，坏档不许覆盖好档
export function validateSavePayload(d){
  if(!d || typeof d!=='object' || Array.isArray(d)) return {ok:false, msg:'不是有效的存档对象'};
  if(typeof d.name!=='string' || !d.name) return {ok:false, msg:'缺少角色名'};
  if(typeof d.job!=='string' || !d.job) return {ok:false, msg:'缺少职业'};
  if(typeof d.level!=='number' || !(d.level>=1)) return {ok:false, msg:'等级字段异常'};
  if(typeof d.gold!=='number' || !isFinite(d.gold)) return {ok:false, msg:'金币字段异常'};
  if(typeof d.exp!=='number' || !isFinite(d.exp)) return {ok:false, msg:'经验字段异常'};
  return {ok:true, msg:''};
}
// 导出文件名：梦回华夏_角色名_职业Lv_时间.json
export function exportFileName(){
  const p=state.player, d=new Date(), pad=n=>('0'+n).slice(-2);
  const stamp=d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes());
  const safe=String(p.name||'游侠').replace(/[\\/:*?"<>|\s]/g,'_');
  return '梦回华夏_'+safe+'_'+jobCn(p.job)+'Lv'+p.level+'_'+stamp+'.json';
}
// 导出为可下载的 .json 文件
export function exportSaveFile(){
  if(!state.player) return {ok:false, msg:'无角色'};
  const text=JSON.stringify(buildSavePayload());
  const fname=exportFileName();
  try{
    const blob=new Blob([text], {type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 4000);
    log('<span class="loot">已导出本地存档：'+fname+'（'+text.length+' 字节）</span>');
    return {ok:true, msg:fname};
  }catch(e){
    log('<span class="dmg">导出失败：'+(e&&e.message||e)+'，可改用「复制存档」。</span>');
    return {ok:false, msg:'下载失败'};
  }
}
// 复制存档文本到剪贴板；不可用时回填到文本框由用户手动复制
export async function copySaveText(){
  if(!state.player) return {ok:false, msg:'无角色'};
  const text=JSON.stringify(buildSavePayload());
  try{
    if(!(navigator.clipboard && navigator.clipboard.writeText)) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    log('<span class="loot">存档已复制到剪贴板（'+text.length+' 字节），可粘贴保存。</span>');
    return {ok:true, msg:'copied'};
  }catch(e){
    const ta=$('save-text');
    if(ta){ ta.value=text; log('<span class="sys">浏览器不允许自动写剪贴板，已把存档填入下方文本框，请手动复制。</span>'); }
    else log('<span class="dmg">复制失败，请改用「导出存档文件」。</span>');
    return {ok:false, msg:'fallback'};
  }
}
// 从 JSON 文本导入存档（二次确认，校验通过才落盘）
export function importSaveText(txt){
  if(!txt || !String(txt).trim()){ log('<span class="dmg">没有可导入的内容。</span>'); return {ok:false, msg:'空内容'}; }
  let d;
  try{ d=JSON.parse(txt); }catch(e){ log('<span class="dmg">导入失败：不是合法的 JSON 文本。</span>'); return {ok:false, msg:'JSON 解析失败'}; }
  const v=validateSavePayload(d);
  if(!v.ok){ log('<span class="dmg">导入失败：存档校验不通过（'+v.msg+'）。</span>'); return {ok:false, msg:v.msg}; }
  const cur = state.player ? (state.player.name+' '+jobCn(state.player.job)+' Lv.'+state.player.level) : '（当前无角色）';
  if(!confirm('导入将覆盖当前角色：'+cur+'\n\n即将导入：'+d.name+' '+jobCn(d.job)+' Lv.'+d.level+'\n\n确定继续？')) {
    log('<span class="sys">已取消导入。</span>'); return {ok:false, msg:'用户取消'};
  }
  applySavePayload(d);
  state._loadedTs=null; state._loadedRate=null;   // 导入后不触发离线补算
  state.zone=null; state.combat=null; state.idle=false;
  save(true);
  const ov=$('overlay'); if(ov) ov.style.display='none';
  renderAll();
  log('<span class="loot">已导入存档：'+d.name+' '+jobCn(d.job)+' Lv.'+d.level+'（战力 '+fmtNum(powerScore(state.player))+'）</span>');
  return {ok:true, msg:'ok'};
}
// 从 <input type="file"> 读文件后导入
export function importSaveFile(file){
  if(!file){ log('<span class="dmg">没有选择文件。</span>'); return; }
  if(typeof FileReader==='undefined'){ log('<span class="dmg">当前环境不支持读取文件，请改用「导入文本」。</span>'); return; }
  const rd=new FileReader();
  rd.onload=()=>{ importSaveText(String(rd.result||'')); };
  rd.onerror=()=>{ log('<span class="dmg">读取文件失败。</span>'); };
  try{ rd.readAsText(file,'utf-8'); }catch(e){ log('<span class="dmg">读取文件失败：'+(e&&e.message||e)+'</span>'); }
}
