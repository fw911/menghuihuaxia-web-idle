/* ===== 模块 render.js —— 渲染基础（$/日志/头部/地图/战斗）+ 角色/武魂/技能/神魔面板 =====
 * 来源：game.js L2401-2946（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 27 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { DATA, EVENT_KEEP, LOG_KEEP, LOG_SHOW, PASSIVES, QIPO_KEYS, SANHUN_KEYS, SLOT_NAME, clamp } from './core.js';
import { expToNext, isXianzhiNow, jobSkills, passiveLevel, skillLvData, skillUpgradeReq, sm, smExpNeed, smMaxLevel, smTier, smTitle, smTransform, whItemName, whMaxLevel, whName, whReqLevel, wuhunExpNeed, wuhunStats, xzCapMin, xzRatePerMin } from './player.js';
import { xyCfg, xyDailyCap, xyGradeDef, xyGrades, xyMatRequirement, xyQuestState, xyRecipeName, xyRecipeTypes, xyStrCap, xyTrialCap } from './quest.js';
import { refreshStats, smEquipOk, smFmt, smNodeLv, smNodes, smPrereqOk, smSpent, smTierDef } from './smtree.js';
import { summonTier } from './battle.js';
import { addToBag, isTwoHand, weaponIsTwoHand } from './bag.js';
import { doInlay } from './refine.js';
import { bossMinionTarget, bossZoneCleared, dungeonBossKilled, dungeonBosses, dungeonEntryLeft, dungeonKilledCount, mapClearReward, mapCleared, mapExplorePct, minionKillCount, rewardText, travelTo, zoneExploredCount, zoneKillCount, zoneTarget } from './world.js';
import { SKILL_BANDS, skillBand, statLine } from './tabs.js';
import { itemName } from './shop.js';
import { courierRoutes, courierTravel, fmtNum } from './life.js';
import { startZone } from './loop.js';
import { renderAll } from './boot.js';

// ---------- 渲染 ----------
export function $(id){return document.getElementById(id);}
export function appendLog(line){
  state.logLines.push(line);
  if(state.logLines.length>LOG_KEEP) state.logLines.shift();
  const el = $('log'); if(!el) return;
  el.innerHTML = state.logLines.slice(-LOG_SHOW).join('<br>');
  el.scrollTop = el.scrollHeight;
}
export function log(html, cls){
  // cls 参数历史遗留，调用方已在 html 内联 class；保持签名兼容但不再二次包装
  appendLog(html);
}
// 本命日志：只记录重要事件（升级 / 高品质掉落 / 首领精英 / 任务 / 换装 / 存档），不复读战斗过程
// 2026-09-19：本命日志已合并到中间战斗日志，事件也进 state.logLines 以便按时间线混排
export function eventLog(html){
  const d=new Date();
  const pad=n=>(''+n).padStart(2,'0');
  const line = '<span class="ev-t">'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'</span> '+html;
  state.events.push(line);
  if(state.events.length>EVENT_KEEP) state.events.shift();
  appendLog(line);
}
export function expPct(){ const p=state.player; return clamp(p.exp/expToNext(p.level)*100,0,100); }

export function renderHeader(){
  const p=state.player; if(!p) return;
  $('h-lv').textContent = p.level;
  $('h-job').textContent = (DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job;
  $('h-gold').textContent = fmtNum(p.gold);
  $('h-crystal').textContent = fmtNum(p.crystal);
  $('h-kills').textContent = fmtNum(state.kills);
  // 底部状态栏
  const fc=$('f-char'), fz=$('f-zone');
  if(fc) fc.textContent = p.name+' · Lv.'+p.level+' · '+((DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job);
  if(fz) fz.textContent = state.zone? ('挂机中：'+zoneName(state.zone)) : '未挂机';
}
// 底部时钟
setInterval(()=>{
  const t=$('f-time'); if(!t) return;
  const d=new Date();
  const pad=n=>(''+n).padStart(2,'0');
  t.textContent = '现在时间 '+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
},1000);
export function zoneName(z){
  const map = DATA.maps.maps.find(m=>m.key===z.mapKey);
  if(!map) return '';
  if(z.isBoss){ if(map.boss_zone) return map.name+'·'+map.boss_zone.name; const _db=(map.dungeon_bosses||[]).find(x=>x.key===z.bossKey); return map.name+'·'+(_db?_db.name:'首领'); }
  const zone = map.zones.find(zz=>zz.key===z.zoneKey);
  return map.name+'·'+(zone?zone.name:'');
}
// ---------- 地图进度快照（renderMap 全量渲染与增量刷新共用同一口径） ----------
// 为什么要快照：挂机时探索进度要「实时显示」，但原实现每 2 秒整体重建 #map-pane 的
// innerHTML —— 重建会替换掉用户正要点击的节点（点击落空）、清掉 hover 态。
// 改为：全量渲染与增量刷新都读同一份快照，增量刷新只改文本节点，不动 DOM 结构。
export function mapProgressSnapshot(){
  const p=state.player; if(!p) return null;
  const map=DATA.maps.maps.find(m=>m.key===p.map); if(!map) return null;
  const zones={};
  for(const z of (map.zones||[])){
    const t=zoneTarget(map,z), n=zoneKillCount(map.key,z.key), done=t>0 && n>=t;
    zones[z.key]={ target:t, count:n, done,
      text: t>0 ? (done?'✔':(Math.min(n,t)+'/'+t)) : '' };
  }
  let boss=null;
  const mt=bossMinionTarget(map);
  if(mt){
    const normal=Math.min(minionKillCount(map.key,'normal'),mt.normal);
    const elite=Math.min(minionKillCount(map.key,'elite'),mt.elite);
    boss={ normal, elite, nt:mt.normal, et:mt.elite, cleared:bossZoneCleared(map),
           text: normal+'/'+mt.normal+' · '+elite+'/'+mt.elite };
  }
  const db=dungeonBosses(map);
  return {
    explore: mapExplorePct(map), explored: zoneExploredCount(map), totalZones:(map.zones||[]).length,
    zoneCount:(map.zones||[]).length, zones, boss,
    dbossKilled: dungeonKilledCount(map), dbossTotal: db.length
  };
}
// 增量刷新地图进度：只更新文本节点，不重建 DOM（保住点击与 hover）。
// 返回 false 表示「结构发生变化」（如首领现身/清剿完成、通关态翻转），需调用方全量重渲染。
export function updateMapProgress(){
  const snap=mapProgressSnapshot(); if(!snap) return false;
  const el=$('map-pane'); if(!el) return false;
  if(typeof el.querySelector!=='function') return false;
  let changed=false;
  // 地图探索度
  const ex=el.querySelector('[data-mapexp]');
  if(ex){
    const txt=' · 探索度 '+snap.explore+'%（'+snap.explored+'/'+snap.totalZones+'）';
    if(ex.textContent!==txt){ ex.textContent=txt; changed=true; }
  }
  // 各区域探索进度
  for(const key in snap.zones){
    const sp=el.querySelector('[data-zp="'+key+'"]'); if(!sp) continue;
    const z=snap.zones[key];
    if(sp.textContent!==z.text){ sp.textContent=z.text; changed=true; }
    const row=sp.parentElement;
    if(!row || !row.classList || typeof row.classList.toggle!=='function') continue;
    // 完成态（class done）
    if(row.classList.contains('done')!==z.done){ row.classList.toggle('done', z.done); changed=true; }
    // title 里的探索进度文本（悬停提示）
    if(z.target>0 && typeof row.getAttribute==='function'){
      const base=(row.getAttribute('data-ztitle')||'');
      if(base){
        const tip=base+' · 探索进度 '+Math.min(z.count,z.target)+'/'+z.target+(z.done?'（已完成）':'');
        if(row.getAttribute('title')!==tip){ row.setAttribute('title', tip); changed=true; }
      }
    }
  }
  // 首领区清剿进度：清剿完成 → 按钮形态要变（清剿计数 → 首通奖励），结构变化 → 交回全量重渲染
  const bm=el.querySelector('[data-bmp]');
  if(bm){
    if(snap.boss && !snap.boss.cleared){
      if(bm.textContent!==snap.boss.text){ bm.textContent=snap.boss.text; changed=true; }
    } else return false;                       // 已清剿 → 形态变了，需全量重渲染
  } else if(snap.boss && !snap.boss.cleared) return false;   // 首领刚现身 → 需全量重渲染
  // 副本首领击败计数
  const dc=el.querySelector('[data-dbtot]');
  if(dc){
    const txt=snap.dbossKilled+'/'+snap.dbossTotal;
    if(dc.textContent!==txt){ dc.textContent=txt; changed=true; }
  }
  return true;
}
export function renderMap(){
  const p=state.player; if(!p) return;
  const el=$('map-pane'); if(!el) return;
  const map = DATA.maps.maps.find(m=>m.key===p.map);
  const snap = mapProgressSnapshot();
  let html = '<div class="map-name">'+map.name+'</div>';
  html += '<div class="muted" style="margin-bottom:6px">'+(map.safe_zone?('安全区：'+map.safe_zone.name):'危险区域')
    + (snap && snap.totalZones? '<span data-mapexp> · 探索度 '+snap.explore+'%（'+snap.explored+'/'+snap.totalZones+'）</span>' : '')+'</div>';
  html += '<h3>练级区域（点击挂机）</h3><div class="zone-wrap">';
  for(const z of map.zones){
    const isCur = state.zone && !state.zone.isBoss && state.zone.zoneKey===z.key;
    const _t=zoneTarget(map,z), _n=zoneKillCount(map.key,z.key), _done=_t>0 && _n>=_t;
    const _zp = snap ? snap.zones[z.key] : null;
    const _titleBase='怪物等级 '+z.monster_level+(z.elite_monsters&&z.elite_monsters.length?' · 含精英':'');
    html += '<div class="zone'+(isCur?' active':'')+(_done?' done':'')+'" data-zone="'+z.key+'" '
            +'data-ztitle="'+_titleBase+'" '
            +'title="'+_titleBase+(_t? ' · 探索进度 '+Math.min(_n,_t)+'/'+_t+(_done?'（已完成）':''):'')+'">'+
            z.name+'<span class="zlv">Lv.'+z.monster_level+'</span>'
            +(_t? '<span class="zex" data-zp="'+z.key+'">'+(_zp? _zp.text : (_done?'✔':(Math.min(_n,_t)+'/'+_t)))+'</span>':'')+'</div>';
  }
  html += '</div>';
  if(map.boss_zone){
    const bz=map.boss_zone;
    const ok = p.level>=bz.unlock_level;
    const isCur = state.zone && state.zone.isBoss;
    const _cleared=bossZoneCleared(map), _mt=bossMinionTarget(map);
    const _done=mapCleared(map.key), _rw=mapClearReward(map.key), _rwTxt=rewardText(_rw);
    let _tip;
    if(!ok) _tip='需等级 '+bz.unlock_level+' 解锁';
    else if(!_cleared && _mt) _tip='需先清剿：普通 '+Math.min(minionKillCount(map.key,'normal'),_mt.normal)+'/'+_mt.normal
      +' · 精英 '+Math.min(minionKillCount(map.key,'elite'),_mt.elite)+'/'+_mt.elite;
    else if(_done) _tip='已通关 · 可继续挑战刷掉落';
    else _tip='推荐等级 '+bz.unlock_level+' · 点击挑战首领';
    if(_rwTxt) _tip += ' ｜ 首次通关奖励：'+_rwTxt+(_done?'（已领取）':'');
    // 未通关且已清剿 → 首领已现身，直接把首通奖励打进按钮，让这件事被看见
    const _showRw = (!_done && _cleared && _rwTxt);
    html += '<h3>首领区'+(_done?' · 已通关':(_cleared?'':' · 清剿中'))+'</h3><div class="zone-wrap"><div class="zone boss'+(isCur?' active':'')+(_cleared && !_done?' ready':'')+(_done?' done':'')+'" data-boss="1" '+
            'title="'+_tip+'">'+(_done?'✔ ':(_cleared?'☠ ':'⚔ '))+bz.name+'<span class="zlv">Lv.'+bz.unlock_level+'</span>'+
            ((!_cleared && _mt)? '<span class="zex" data-bmp>'+(snap&&snap.boss? snap.boss.text : (Math.min(minionKillCount(map.key,'normal'),_mt.normal)+'/'+_mt.normal
              +' · '+Math.min(minionKillCount(map.key,'elite'),_mt.elite)+'/'+_mt.elite))+'</span>'
              : (_showRw? '<span class="zex rw">首通 '+fmtNum(_rw.coins)+'金</span>':''))+'</div></div>';
  }
  const _dboss=dungeonBosses(map);
  if(_dboss.length){
    const lim=map.daily_enter_limit||0, left=dungeonEntryLeft(map), lvOk=p.level>=(map.enter_level_min||0);
    const _ddone=mapCleared(map.key), _drw=mapClearReward(map.key), _drwTxt=rewardText(_drw);
    html += '<h3>副本首领（<span data-dbtot>'+dungeonKilledCount(map)+'/'+_dboss.length+'</span>'+
            (lim? ' · 今日剩 '+left+'/'+lim+' 次':'')+(_ddone?' · 已通关':'')+'）</h3>';
    if(_drwTxt) html += '<div class="rwline">首次通关奖励：'+_drwTxt+(_ddone?'（已领取）':'')+'</div>';
    html += '<div class="zone-wrap">';
    for(const b of _dboss){
      const killed=dungeonBossKilled(map.key,b.key);
      const cur=state.zone && state.zone.isBoss && state.zone.bossKey===b.key;
      const tip=b.name+' Lv.'+b.level+(killed?' · 已击败':'')+(!lvOk?' · 需等级 '+(map.enter_level_min||0):'')+((lim && left<=0)? ' · 今日次数已用完':'');
      html += '<div class="zone boss'+(killed?' done':'')+(cur?' active':'')+'" data-dboss="'+b.key+'" title="'+tip+'">'+
              (killed?'✔ ':'☠ ')+b.name+'<span class="zlv">Lv.'+b.level+'</span></div>';
    }
    html += '</div>';
  }
  html += '<h3>前往（邻居）</h3><div>';
  for(const nk of (map.neighbors||[])){
    const nm = DATA.maps.maps.find(m=>m.key===nk);
    if(!nm) continue;
    const lock = nm.unlock_map && !p.unlocked[nm.unlock_map];
    html += '<span class="neighbor" data-go="'+nk+'">'+nm.name+(lock?' 🔒':'')+'</span>';
  }
  html += '</div>';
  // 信使（couriers.json）：付费传送到更远的地图
  const routes=courierRoutes(p.map);
  if(routes.length){
    html += '<h3>信使传送</h3><div>';
    for(const r of routes){
      const nm = DATA.maps.maps.find(m=>m.key===r.map_key);
      if(!nm) continue;
      const afford = p.gold >= (r.price||0);
      html += '<span class="neighbor" data-act="courier" data-map="'+r.map_key+'"'+(afford?'':' style="opacity:.55"')+'>'+nm.name+'（'+fmtNum(r.price||0)+'金）</span>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-zone]').forEach(d=> d.onclick=()=> startZone(p.map, d.getAttribute('data-zone'), false));
  el.querySelectorAll('[data-boss]').forEach(d=> d.onclick=()=> { if(p.level>=map.boss_zone.unlock_level) startZone(p.map, null, true); else log('<span class="dmg">等级不足，无法挑战首领区</span>'); });
  el.querySelectorAll('[data-dboss]').forEach(d=> d.onclick=()=> startZone(p.map, null, true, d.getAttribute('data-dboss')));
  el.querySelectorAll('[data-go]').forEach(d=> d.onclick=()=> travelTo(d.getAttribute('data-go')));
  el.querySelectorAll('[data-act="courier"]').forEach(d=> d.onclick=()=>{
    const r=courierTravel(d.getAttribute('data-map'));
    log(r.ok? ('<span class="loot">'+r.msg+'</span>') : ('<span class="dmg">'+r.msg+'</span>'));
    renderMap(); renderHeader();
  });
  return html;      // 返回渲染结果，便于无头测试断言
}
// ---------- 战斗状态面板（中间栏：当前怪物卡片 + 血条） ----------
export function renderBattle(){
  const el=$('battle-pane'); if(!el) return;
  const m=state.combat, p=state.player;
  if(!m || !p || !p._s){
    el.innerHTML='<div class="battle-empty">'+(state.idle?'搜索怪物中…':'未在战斗 —— 选择区域并开始挂机')+'</div>';
    return;
  }
  const tag = m.isBoss?'<span class="btag tag-boss">【首领】</span>':(m.isElite?'<span class="btag tag-elite">【精英】</span>':'');
  el.innerHTML='<div class="battle-card"><span class="bname">'+m.name+'</span><span class="blv">Lv.'+m.level+'</span>'+tag+
    '<div class="bar hp"><i style="width:'+clamp(m.curHp/m.hp*100,0,100)+'%"></i></div>'+
    '<div class="bar-label">怪物 HP '+fmtNum(Math.max(0,m.curHp))+' / '+fmtNum(m.hp)+'</div>'+
    '<div class="bar mp"><i style="width:'+clamp(p.hp/p._s.max_hp*100,0,100)+'%"></i></div>'+
    '<div class="bar-label">我的 HP '+fmtNum(Math.max(0,Math.round(p.hp)))+' / '+fmtNum(p._s.max_hp)+' · MP '+fmtNum(Math.round(p.mp))+' / '+fmtNum(p._s.max_mp)+'</div></div>';
}
// ---------- 角色常驻面板（属性 + 装备栏，独立成列，不与功能页签混在一起） ----------
export const HERO_SLOTS=['helmet','necklace','shoulder_l','cloak','armor','weapon','gloves','shield','belt','ring1','pants','ring2','shoes'];
export const CN_COMBAT={phys_atk:'物理攻击',magic_atk:'法术攻击',phys_def:'物理防御',magic_def:'法术防御',
  max_hp:'生命上限',max_mp:'法力上限',phys_crit:'物理暴击',dodge:'闪避',hit:'命中',crit_resist:'抗暴'};
export const CN_ATTR={strength:'力量',agility:'敏捷',constitution:'体质',intelligence:'智力',spirit:'精神'};
export function renderHero(){
  const p=state.player; if(!p||!p._s) return;
  const el=$('hero-pane'); if(!el) return;
  const s=p._s;
  const job=(DATA.jobs.jobs.find(j=>j.key===p.job)||{}).name||p.job;
  let html='<div class="char-card"><div class="hero-head"><span class="hero-name">'+p.name+'</span>'
    +'<span class="muted">'+job+' · Lv.'+p.level+'</span></div>';
  html+='<div class="bar hp"><i style="width:'+clamp(p.hp/s.max_hp*100,0,100)+'%"></i></div>'
    +'<div class="bar-label">生命 '+fmtNum(Math.round(p.hp))+' / '+fmtNum(s.max_hp)+'</div>';
  html+='<div class="bar mp"><i style="width:'+clamp(p.mp/s.max_mp*100,0,100)+'%"></i></div>'
    +'<div class="bar-label">法力 '+fmtNum(Math.round(p.mp))+' / '+fmtNum(s.max_mp)+'</div>';
  html+='<div class="bar exp"><i style="width:'+expPct()+'%"></i></div>'
    +'<div class="bar-label">经验 '+fmtNum(p.exp)+' / '+fmtNum(Math.round(expToNext(p.level)))+'（'+Math.round(expPct())+'%）</div></div>';
  // 战斗属性
  html+='<h3>战斗属性</h3><div class="stat-grid">';
  const order=['phys_atk','magic_atk','phys_def','magic_def','max_hp','max_mp','phys_crit','dodge'];
  const shown={};
  for(const k of order){ if(s.combat[k]==null) continue; shown[k]=1;
    html+='<div class="st"><span>'+(CN_COMBAT[k]||k)+'</span><b>'+fmtNum(s.combat[k])+'</b></div>'; }
  for(const k in s.combat){ if(shown[k]) continue;
    html+='<div class="st"><span>'+(CN_COMBAT[k]||k)+'</span><b>'+fmtNum(s.combat[k])+'</b></div>'; }
  html+='</div>';
  // 基础属性
  html+='<h3>基础属性</h3><div class="stat-grid">';
  for(const k in s.attr) html+='<div class="st"><span>'+(CN_ATTR[k]||k)+'</span><b>'+fmtNum(Math.round(s.attr[k]))+'</b></div>';
  html+='</div>';
  // 装备栏
  html+='<h3>装备（点击卸下）</h3><div class="eqgrid">';
  for(const sl of HERO_SLOTS){
    const it=p.equip[sl];
    if(it){
      const tag = it.bailian>0 ? ('百炼+'+it.bailian) : (it.refine>0 ? ('+'+it.refine) : '');
      // 双手武器徽标（原版 char.js：武器格戴「双手」角标）
      const twoH = (sl==='weapon' && isTwoHand(it)) ? ' <span class="pill">双手</span>' : '';
      const tip = SLOT_NAME[sl]+'·'+it.name+'\n'+statLine(it);
      html+='<div class="eqslot q-'+it.quality+'" data-unequip="'+sl+'" title="'+tip+'">'
        +'<span class="sl">'+SLOT_NAME[sl]+(tag?' '+tag:'')+twoH+'</span>'
        +'<span class="nm">'+it.name+'</span></div>';
    }else if(sl==='shield' && weaponIsTwoHand()){
      // 双手武器占用盾牌格（原版 char.js occupied-2h：不可穿戴/卸下）
      html+='<div class="eqslot empty" title="已装备双手武器，盾牌格被占用；请先卸下武器">'
        +'<span class="sl">盾牌</span><span class="nm">双手占用</span></div>';
    }else{
      html+='<div class="eqslot empty"><span class="sl">'+SLOT_NAME[sl]+'</span><span class="nm">—</span></div>';
    }
  }
  html+='</div>';
  // 本命日志已合并到中间战斗日志，不再在左侧重复渲染
  el.innerHTML=html;
  bindHeroClicks();
}
export function bindHeroClicks(){
  const el=$('hero-pane'); if(!el) return;
  el.querySelectorAll('[data-unequip]').forEach(d=> d.onclick=()=>{
    const sl=d.getAttribute('data-unequip');
    const it=state.player.equip[sl]; if(!it) return;
    // 若已选中宝石，则优先镶嵌到该装备
    if(window._pendingGem){
      doInlay(it, window._pendingGem); window._pendingGem=null;
      const t=$('inlay-target'); if(t) t.textContent='已镶嵌';
      return;
    }
    state.player.equip[sl]=null;
    addToBag(it);
    refreshStats();
    log('<span class="sys">卸下 '+SLOT_NAME[sl]+'·'+it.name+'</span>');
    renderAll();
  });
}
// ---------- 武魂面板 ----------
export const ATTR_LABEL = {
  phys_atk:'物攻', magic_atk:'法攻', phys_def:'物防', magic_def:'法防',
  max_hp:'生命', max_hp_pct:'生命%', max_mp:'法力', dark_atk:'暗攻',
  strength:'力量', agility:'敏捷', constitution:'体质', intelligence:'智力', spirit:'精神',
  phys_crit:'物爆', magic_crit:'法爆', dmg_reduce_pct:'减伤%',
  phys_atk_pct:'物攻%', magic_atk_pct:'法攻%', phys_def_pct:'物防%', magic_def_pct:'法防%'
};
export function whStatLine(o){
  const st=wuhunStats(o); const parts=[];
  for(const s in st) parts.push((ATTR_LABEL[s]||s)+' +'+st[s]);
  if(o.activated&&o.actAttr) parts.push('<span class="loot">'+(ATTR_LABEL[o.actAttr.name]||o.actAttr.name)+' +'+o.actAttr.value+'</span>');
  return parts.join('　');
}
export function soulCount(){
  const p=state.player; let n=0;
  for(const k of SANHUN_KEYS.concat(QIPO_KEYS)) n+=(p.materials[k]||0);
  return n;
}
export function matSeries(s){
  const p=state.player; const parts=[];
  for(let i=0;i<=5;i++){ const v=p.materials[s+'_'+i]||0; if(v>0) parts.push(i+'★:'+v); }
  return parts.length? parts.join(' ') : '0';
}
// 武魂炼制：消耗 淬魂瓶 + 下级符令 + 三魂七魄
export function whCraft(recipeKey){
  const R=(DATA.wuhun_recipes||{})[recipeKey];
  if(!R) return {ok:false,msg:'配方不存在'};
  const p=state.player;
  const res=R.result_item||'';
  const mm=res.match(/^(.+)_(\d+)$/);
  if(!mm) return {ok:false,msg:'配方产物异常'};
  const series=mm[1], star=parseInt(mm[2],10);
  const lowerKey = star>0 ? (series+'_'+(star-1)) : null;
  let ping=0, lowerCnt=0, soulNeed=0;
  for(const md of (R.materials||[])){
    const nm=md['名称']||'';
    const q=parseInt(String(md['数量']||'0/1').split('/')[1]||'1',10)||1;
    if(nm.indexOf('淬魂瓶')>=0) ping+=q;
    else if(nm.indexOf('符')>=0||nm.indexOf('令')>=0||nm.indexOf('诀')>=0) lowerCnt+=q;
    else soulNeed+=q;
  }
  if((p.materials.lianhua_ping||0) < ping) return {ok:false,msg:'淬魂瓶不足（需 '+ping+'）'};
  if(lowerKey && (p.materials[lowerKey]||0) < lowerCnt) return {ok:false,msg:whItemName(lowerKey)+' 不足（需 '+lowerCnt+'）'};
  const pool=SANHUN_KEYS.concat(QIPO_KEYS).filter(k=>(p.materials[k]||0)>0);
  let have=0; for(const k of pool) have+=p.materials[k];
  if(have < soulNeed) return {ok:false,msg:'三魂七魄不足（需 '+soulNeed+' 个，现有 '+have+'）'};
  p.materials.lianhua_ping = (p.materials.lianhua_ping||0) - ping;
  if(lowerKey) p.materials[lowerKey] -= lowerCnt;
  let need=soulNeed;
  for(const k of pool){ if(need<=0) break; const take=Math.min(need,p.materials[k]); p.materials[k]-=take; need-=take; }
  p.materials[res]=(p.materials[res]||0)+(R.result_count||1);
  return {ok:true,msg:'炼制成功：'+whItemName(res)+' x'+(R.result_count||1)};
}
// ---------- 技能面板 ----------
export const SKILL_TYPE_CN={attack:'攻击',control:'控制',buff:'增益',defense:'防御',heal:'治疗',purify:'净化',summon:'召唤'};
export function renderSkill(sub){
  const p=state.player;
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为）
  let html='<div class="muted">达到学习等级自动学会；升级消耗金币与经验（取自技能真实 requirements）。挂机时会自动施放技能。</div>';
  if(any || sub==='active' || SKILL_BANDS.some(b=>b.key===sub)){
    const allSkill=jobSkills(p.job);
    const learned=Object.keys(p.skills||{}).length;
    const list = (any || sub==='active') ? allSkill : allSkill.filter(x=>skillBand(x.learn_level||1)===sub);
    html+='<h3 class="sec">主动技能（已学 '+learned+'/'+allSkill.length+'）</h3>';
    for(const s of list){
      const lv=(p.skills||{})[s.key]||0;
      if(lv<=0){
        html+='<div class="item lock"><b>'+s.name+'</b> <span class="pill">未学会</span>'
          +'<br><span class="muted">'+(SKILL_TYPE_CN[s.skill_type]||s.skill_type)+' · 需角色 Lv.'+(s.learn_level||1)+'</span></div>';
        continue;
      }
      const L=skillLvData(s,lv);
      const cd=(p.skillCd||{})[s.key]||0;
      const req=skillUpgradeReq(s,lv);
      const maxed=lv>=(s.max_level||1);
      html+='<div class="item"><b>'+s.name+'</b> <span class="pill">Lv.'+lv+'/'+s.max_level+'</span>'
        +'<span class="muted"> '+(SKILL_TYPE_CN[s.skill_type]||s.skill_type)+' · MP '+(L.mp||0)+' · CD '+(L.cd!=null?L.cd:(s.cd||1))+'</span>'
        +(cd>0?'<span class="pill">冷却 '+cd+'</span>':'')
        +'<br><span class="muted">'+(L.desc||s.desc||'')+'</span>';
      if(!maxed && req){
        html+='<br><span class="muted">升级需 Lv.'+req.level+' · 金币 '+(req.money||0)+' · 经验 '+(req.exp||0)+'</span>'
          +' <button class="mini" data-skill="'+s.key+'">升级</button>';
      }else if(maxed) html+='<br><span class="muted">已达最高等级</span>';
      html+='</div>';
    }
  }
  if(on('passive')){
    html+='<h3 class="sec">被动技能</h3>';
    for(const ps of PASSIVES){
      if((ps.jobs||[]).indexOf(p.job)<0) continue;
      const lv=passiveLevel(p,ps);
      if(lv<=0){
        html+='<div class="item lock"><b>'+ps.name+'</b> <span class="pill">未领悟</span>'
          +'<br><span class="muted">需 Lv.'+(ps.learn_level||1)+' · '+(ps.desc||'')+'</span></div>';
        continue;
      }
      const arr=ps.levels||[];
      const e=arr.length? arr[Math.max(0,Math.min(lv-1,arr.length-1))] : (ps.effect||{});
      html+='<div class="item"><b>'+ps.name+'</b> <span class="pill">Lv.'+lv+'/'+ps.max_level+'</span>'
        +'<br><span class="muted">'+Object.keys(e).map(k=>(ATTR_LABEL[k]||k)+' +'+e[k]).join('　')+'　（每 5 级自动 +1）</span></div>';
    }
  }
  // 召唤兽（summons.json + 召唤技能表）
  if(on('summon') && DATA.summons){
    html+='<h3 class="sec">召唤兽</h3>';
    for(const k in DATA.summons){
      const d=DATA.summons[k];
      const lvs=Object.keys(d.levels||{}).map(Number).sort((a,b)=>a-b);
      const minLv=lvs[0]||1;
      if(p.level<minLv){
        html+='<div class="item lock"><b>'+d.name+'</b> <span class="pill">未解锁</span><br><span class="muted">需角色 Lv.'+minLv+'</span></div>';
        continue;
      }
      const t=summonTier(k, p.level);
      const onz=(p.summon===k);
      html+='<div class="item" data-summon="'+k+'"><b>'+d.name+'</b> <span class="pill">'+(onz?'出战中':'待命')+'</span> <span class="muted">阶段 Lv.'+t.lv+'（'+(d.type==='magic'?'法术':'物理')+'）</span>'
        +'<br><span class="muted">生命 '+t.data.hp+' · 攻击 '+t.data.min_phys+'~'+t.data.max_phys+' · 物防 '+t.data.min_phys_def+' · 速度 '+t.data.speed+'　（分担 30% 伤害，每回合出手）</span></div>';
    }
    html+='<div class="muted">点击切换出战/待命。召唤兽属性随角色等级自动取对应阶段。</div>';
  }
  return html;
}
export function renderWuhun(sub){
  const p=state.player;
  if(!p.wuhunSlots) p.wuhunSlots=[null,null];
  if(!state.whSel) state.whSel=[];
  const any=!sub, on=k=>any||sub===k;         // sub 为空 = 全量渲染（旧行为）
  let html='<div class="muted">武魂佩戴后杀怪吸经验成长；圆满可进化升星，激活需对应星级启魂符。</div>';
  if(on('wear')){
    html+='<h3 class="sec">佩戴槽位（双槽）</h3>';
    for(let i=0;i<2;i++){
      const o=p.wuhunSlots[i];
      html+='<div class="wh-slot">';
      if(o){
        const maxLv=whMaxLevel(o.whType,o.star);
        const need=wuhunExpNeed(o);
        html+='<div class="wh-row"><b>'+whName(o)+'</b> <span class="pill">Lv.'+o.level+'/'+maxLv+'</span>'
          +(o.activated?'<span class="pill on">已激活</span>':'<span class="pill">未激活</span>')+'</div>';
        html+='<div class="muted">'+whStatLine(o)+'</div>';
        if(o.level<maxLv){
          html+='<div class="bar exp" style="margin:4px 0"><i style="width:'+clamp((o.exp||0)/need*100,0,100)+'%"></i></div>';
          html+='<div class="muted">修炼值 '+Math.round(o.exp||0)+' / '+need+'</div>';
        }else html+='<div class="muted">已修炼圆满，可用于进化升星</div>';
        html+='<div style="margin-top:4px"><button class="mini" data-wh="unequip" data-slot="'+i+'">卸下</button> ';
        if(!o.activated) html+='<button class="mini" data-wh="act" data-uid="'+o.uid+'">潜能激活</button>';
        else html+='<button class="mini" data-wh="anni" data-uid="'+o.uid+'">湮灭</button>';
        html+='</div>';
      }else html+='<div class="muted">槽位 '+(i+1)+'：空（点击下方武魂佩戴）</div>';
      html+='</div>';
    }
    const list=p.bag.filter(b=>b.type==='wuhun');
    html+='<h3 class="sec">武魂背包（'+list.length+'）</h3>';
    if(!list.length) html+='<div class="muted">暂无武魂，击杀精英/首领有几率掉落。</div>';
    for(const o of list){
      const maxLv=whMaxLevel(o.whType,o.star);
      const req=whReqLevel(o.star);
      const sel=state.whSel.indexOf(o.uid)>=0;
      html+='<div class="item'+(sel?' sel':'')+'" data-wh-item="'+o.uid+'">'
        +'<b>'+whName(o)+'</b> <span class="pill">Lv.'+o.level+'/'+maxLv+'</span>'
        +(o.activated?'<span class="pill on">已激活</span>':'')
        +(p.level<req?' <span class="muted">（佩戴需 Lv.'+req+'）</span>':'')
        +'<br><span class="muted">'+whStatLine(o)+'</span></div>';
    }
    if(list.length){
      html+='<div class="bag-tools">'
        +'<button class="mini" data-wh="equip">佩戴所选</button>'
        +'<button class="mini" data-wh="evolve">进化(选2同星圆满)</button>'
        +'<button class="mini" data-wh="fuse">融合(选2已激活)</button>'
        +'<button class="mini" data-wh="recycle">回收换结晶</button>'
        +'<button class="mini" data-wh="clear">取消选择</button>'
        +'<span class="muted">已选 '+state.whSel.length+' 个</span></div>';
    }
  }
  if(on('craft')){
    html+='<h3 class="sec">武魂炼制</h3><div class="muted">消耗三魂七魄 + 淬魂瓶 + 下级符令。</div>';
    const R=DATA.wuhun_recipes||{};
    html+='<div class="craft-row"><select id="wh-recipe">';
    for(const k in R) html+='<option value="'+k+'">'+R[k].name+'</option>';
    html+='</select> <button class="mini" data-wh="craft">炼制</button></div>';
    html+='<div class="muted" style="margin-top:6px">淬魂瓶 '+(p.materials.lianhua_ping||0)
      +' · 魂魄 '+soulCount()+'　|　启魂符 '+matSeries('lingyin')+'　融魂令 '+matSeries('mingqi')+'　化星诀 '+matSeries('niepan')+'</div>';
  }
  return html;
}
// 仙之境子页：神魔专属安全区静修（无战斗，按滞留 tick 结算修验值）
export function renderXianzhi(){
  const p=state.player, s=p.shenmo;
  if(!s||!s.faction) return '<div class="muted">需先入神魔道才能进入仙之境。</div>';
  const rate=xzRatePerMin(s.level), cap=xzCapMin(), used=(s.xz_min||0);
  const left=Math.max(0,cap-used), here=isXianzhiNow();
  let h='<h3 class="sec">仙之境（神魔专属静修）</h3>';
  h+='<div class="muted">安全区无战斗，滞留即按等级结算修验值。每日上限 '+cap+' 分钟，次日 0 点重置。</div>';
  h+='<div class="stat-grid">'
    +'<div class="st"><span>修验速率</span><b>'+rate.toLocaleString()+' / 分钟</b></div>'
    +'<div class="st"><span>今日已用</span><b>'+used.toFixed(1)+' 分</b></div>'
    +'<div class="st"><span>今日剩余</span><b>'+left.toFixed(1)+' 分</b></div>'
    +'<div class="st"><span>累计获得</span><b>'+Math.round(s.xz_exp_total||0).toLocaleString()+'</b></div>'
    +'</div>';
  if(here) h+='<div class="loot">你正在仙之境静修，每 700ms 自动结算。</div>';
  else h+='<div class="bag-tools"><button class="mini" data-sm="go_xz">前往仙之境</button></div>';
  const needLv=((sm().entry||{}).min_char_level||101);
  h+='<div class="muted">入口：北原郡 NPC 欧文子（需角色 Lv.'+needLv+' 入道后开启）。</div>';
  return h;
}
export function renderXrTask(){
  const q=xyQuestState(); if(!q) return '<div class="muted">需先入神魔道。</div>';
  const s=state.player.shenmo, cap=xyDailyCap(), gd=q.current?xyGradeDef(q.current.grade):null;
  let h='<h3 class="sec">修验任务（炼丹产线）</h3>';
  h+='<div class="muted">每日可接 '+(cap===Infinity?'∞':cap)+' 次（今日已 '+(q.tasks_done||0)+' 次）。接取消耗修验经验+银子，提交材料后炼丹产出修验丹，再提交领金币。</div>';
  if(q.current){
    const c=q.current, r=xyMatRequirement(c.type,c.grade);
    h+='<div class="wh-slot"><div class="wh-row"><b>进行中：'+c.grade+'（'+xyRecipeName(c.type)+'）</b> <span class="pill on">'+c.status+'</span></div>';
    h+='<div class="muted">修验经验 '+(gd?gd.exp_cost:0)+' · 银子 '+(gd?gd.yinzi_qty:0)+' · 材料 ×'+(gd?gd.mat_qty:0)+'</div>';
    if(r) h+='<div class="muted">材料：'+(r.mode==='exact'? (itemName(r.items[0])+'×'+r.mq) : (r.items.map(k=>itemName(k)).join('/')+' 共×'+r.mq))+'</div>';
    if(c.status==='accepted') h+='<button class="mini" data-xy="submit">提交材料</button> ';
    if(c.status==='ready') h+='<button class="mini" data-xy="refine">炼丹</button> ';
    if(c.status==='refined') h+='<button class="mini" data-xy="handin">提交领金币</button> ';
    if(c.status!=='refined') h+='<button class="mini" data-xy="refresh">刷新品阶</button>';
    h+='</div>';
  } else {
    h+='<div class="muted">未接取任务，选择配方类型接取（品阶随机，按权重）：</div><div class="bag-tools">';
    for(const t in xyRecipeTypes()) h+='<button class="mini" data-xy="accept:'+t+'">'+xyRecipeName(t)+'</button>';
    h+='</div>';
  }
  h+='<h3 class="sec">品阶</h3><div class="stat-grid">';
  for(const g of xyGrades()){ const d=xyGradeDef(g); if(!d) continue;
    h+='<div class="st"><span>'+g+' '+d.quality+'</span><b>丹率 '+(d.dan_pct*100).toFixed(d.dan_pct<0.01?2:1)+'% · 提交 '+(d.submit_gold)+'金</b></div>'; }
  h+='</div>';
  return h;
}
export function renderXrStr(){
  const q=xyQuestState(); if(!q) return '<div class="muted">需先入神魔道。</div>';
  const st=q.str=q.str||{}, cfg=xyCfg().strengthen;
  let h='<h3 class="sec">强化修验任务</h3>';
  h+='<div class="muted">每日可强化 '+(xyStrCap())+' 次（今日 '+(st.times||0)+'）。消耗材料提升丹率(+5%/级)与提交金币(+10%/级)。</div>';
  h+='<div class="muted">当前强化等级：'+(st.enhanced||0)+'</div>';
  if(cfg&&cfg.mats){ const lvl=st.enhanced||0, parts=[]; for(const key in cfg.mats){ const arr=cfg.mats[key]; parts.push(itemName(key)+'×'+arr[Math.min(lvl,arr.length-1)]); } h+='<div class="muted">下次消耗：'+parts.join('、')+'</div>'; }
  h+='<button class="mini" data-xy="str">强化</button>';
  return h;
}
export function renderXrTrial(){
  const q=xyQuestState(); if(!q) return '<div class="muted">需先入神魔道。</div>';
  const tr=q.trial=q.trial||{}, cfg=xyCfg().trial;
  let h='<h3 class="sec">修验导师的考验</h3>';
  h+='<div class="muted">每日 '+(xyTrialCap())+' 次（今日 '+(tr.times||0)+'）。消耗百炼石，限时击杀指定数量怪物，按品阶给修验经验。</div>';
  if(tr.active){ const a=tr.active, left=Math.max(0,Math.ceil((a.deadline-Date.now())/1000));
    h+='<div class="wh-slot"><b>进行中：'+a.grade+'</b> <span class="pill on">'+a.kills+'/'+a.target+' · '+left+'秒</span></div>';
  } else h+='<div class="muted">未开始。接取后挂机击杀即可累计（'+(cfg?cfg.kill_seconds:900)+'秒内）。</div>';
  h+='<button class="mini" data-xy="trial_start">开始考验</button>';
  return h;
}
export function renderShenmo(sub){
  if(sub==='xianzhijing') return renderXianzhi();
  if(sub==='xr_task') return renderXrTask();
  if(sub==='xr_str') return renderXrStr();
  if(sub==='xr_trial') return renderXrTrial();
  const p=state.player; const S=sm();
  const need=(S.entry||{}).min_char_level||101;
  const cur = (p.shenmo&&p.shenmo.faction) ? smTransform(p.shenmo.level||1) : null;
  if(!p.shenmo||!p.shenmo.faction){
    let html='<div class="muted">神魔修验为 101 级后开启的深层体系。入道后挂机积累修验值，提升变身阶位获得攻/防/血/减伤加成。</div>';
    html+='<div class="bar exp" style="margin:6px 0"><i style="width:'+clamp(p.level/need*100,0,100)+'%"></i></div>';
    html+='<div class="muted">入道需角色 Lv.'+need+'（当前 Lv.'+p.level+'）</div>';
    html+='<div class="bag-tools">'
      +'<button class="mini" data-sm="join" data-f="shen">入神道（防御/团队）</button>'
      +'<button class="mini" data-sm="join" data-f="mo">入魔道（输出/控制）</button></div>';
    return html;   // 未入道时页面很短，不分节
  }
  const s=p.shenmo, td=smTier(s.spent||0);
  // ---- 段一：修验概况（归「修验·变身」子页）----
  let info='<div class="wh-slot"><div class="wh-row"><b>'+(((S.factions||{})[s.faction]||{}).name)+'</b>'
    +' <span class="pill on">'+smTitle(s.faction,s.level)+'</span></div>';
  info+='<div class="muted">修验等级 '+(s.level||1)+' / '+smMaxLevel()+' · 可用修验点 '+(s.points||0)+' · 已投入 '+(s.spent||0)+'</div>';
  if((s.level||1)<smMaxLevel()){
    const nd=smExpNeed(s.level||1);
    info+='<div class="bar exp" style="margin:4px 0"><i style="width:'+clamp((s.exp||0)/nd*100,0,100)+'%"></i></div>';
    info+='<div class="muted">修验值 '+Math.round(s.exp||0)+' / '+nd+'</div>';
  }else info+='<div class="muted">修验已满级</div>';
  if(cur) info+='<div class="muted">变身加成：攻击 +'+cur.atk+' · 防御 +'+cur.def+' · 生命 +'+cur.hp+' · 减伤 '+cur.dmg_reduce+'%</div>';
  info+='<div class="muted">当前档位：'+(td.name||'一档')+'（每级 +'+(td.points_per_level||1)+' 修验点）</div></div>';
  // ---- 段二：修验技能树（归「技能树」子页）----
  const nodes=smNodes();
  const spent=smSpent();
  let tree='<h3 class="sec">修验技能树</h3>';
  tree+='<div class="muted">可用修验点 <b style="color:var(--gold)">'+(s.points||0)+'</b> · 已投入 '+spent+' 点'
    +(nodes.fallback? '　（原版配置仅含战士节点，当前职业沿用战士节点）':'')+'</div>';
  tree+='<div class="bag-tools"><button class="mini" data-smact="reset">重置加点</button></div>';
  const byTier={};
  nodes.list.filter(d=>d.faction===s.faction).forEach(d=>{ (byTier[d.tier]=byTier[d.tier]||[]).push(d); });
  for(const tk of Object.keys(byTier).sort()){
    // sub='tree_<档位>' 时只渲染该档（sub='tree' / 空 表示全部档位）
    if(sub && sub.indexOf('tree_')===0 && Number(sub.slice(5))!==Number(tk)) continue;
    const td2=smTierDef(Number(tk));
    tree+='<div class="muted" style="margin-top:6px">'+(td2.name||('第'+tk+'档'))+'（解锁需累计投入 '+(td2.spent_required||0)+' 点 · 每级 '+(td2.points_per_level||1)+' 点）</div>';
    for(const d of byTier[tk]){
      const lv=smNodeLv(d.key), max=d.max_level||1;
      const unlocked = spent >= (td2.spent_required||0);
      const preq = smPrereqOk(d), eq = smEquipOk(d);
      const can = unlocked && preq && lv<max && (s.points||0) >= (td2.points_per_level||1);
      tree+='<div class="item'+(lv>0?' sel':'')+(can?'':' lock')+'" data-smnode="'+d.key+'">'
        +'<b>'+d.name+'</b> <span class="pill">Lv.'+lv+'/'+max+'</span>'+(d.type==='active'?' <span class="pill">主动</span>':'')
        +'<br><span class="muted">'+smFmt(d, lv||1)+'</span>'
        +'<br><span class="muted">'+(lv>=max? '已满级' : (unlocked? (preq? '点击 +1 级（消耗 '+(td2.points_per_level||1)+' 点）' : '前置未满足') : '需累计投入 '+(td2.spent_required||0)+' 点解锁'))
        +(eq?'':' · 当前装备不满足，暂不生效')+'</span></div>';
    }
  }
  // ---- 段三：变身阶位一览（归「修验·变身」子页）----
  let lvls='<h3 class="sec">变身阶位一览</h3>';
  const fac=(p.shenmo&&p.shenmo.faction)||'shen';
  for(const t of (S.transform_levels||[])){
    const onz = cur && cur.min_level===t.min_level;
    lvls+='<div class="item'+(onz?' sel':'')+'">Lv.'+t.min_level+' · '+smTitle(fac, t.min_level)
      +'<br><span class="muted">攻+'+t.atk+' 防+'+t.def+' 血+'+t.hp+' 减伤'+t.dmg_reduce+'%</span></div>';
  }
  if(!sub) return info+tree+lvls;             // 旧行为：全量、原顺序
  return (sub==='tree' || sub.indexOf('tree_')===0) ? tree : (info+lvls);
}

