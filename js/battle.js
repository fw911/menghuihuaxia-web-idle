/* ===== 模块 battle.js —— 战斗引擎（tick/出手/死亡）+ 召唤兽 =====
 * 来源：game.js L1616-1998（2026-10-21 模块化切分，内容逐字节保留）
 * 导出 17 个顶层名；import 由 AST 跨模块引用自动计算。
 */
import { state } from './state.js';
import { cloudRank } from './api.js';
import { DATA, MON_SKILLS, SUMMON_SKILLS, clamp, getMonster, pageVisible, pick, ri, rnd, uid } from './core.js';
import { castBattleStartBuffs, castHeal, damageMonster, expToNext, genWuhun, isXianzhiNow, monsterDef, monsterExp, paySkill, pickAttackSkill, pickHealSkill, skillDamage, smAppendHit, smGain, smXianzhiTick, syncSkills, tickSkillCd, whName, whReqLevel, wuhunAbsorb } from './player.js';
import { xyTrialOnKill } from './quest.js';
import { refreshStats, smActiveCast, smAggCached } from './smtree.js';
import { QNAME, rollLoot } from './equip.js';
import { addToBag, tryAutoEquip } from './bag.js';
import { bossMinionTarget, bossZoneCleared, dungeonBosses, mapByKey, minionKillCount, noteDungeonBossKilled, noteMinionKill, noteZoneKill } from './world.js';
import { eventLog, log, renderBattle, renderHeader } from './render.js';
import { renderTab } from './tabs.js';
import { gemSeriesName } from './inlay.js';
import { itemName, questProgress } from './shop.js';
import { achList, addCrystalStone, checkAchievements, checkTitles, crystalForTier, crystalName, fmtNum, instGroup, instName, titleDmgMult, titleHeal, weightedPick } from './life.js';
import { autoPotion, autoZoneOnLevelUp, sessBump, sessLevelUp } from './idle.js';
import { renderAll } from './boot.js';

// ---------- 战斗 ----------
// 首领威胁加成：让刚解锁的首领有真实压力（普通/精英区不受影响），配合死亡惩罚形成「挑战」感
export const BOSS_HP_MULT = 1.3, BOSS_ATK_MULT = 1.5;
export function spawnMonster(){
  const z = state.zone;
  let key, isBoss=false, isElite=false;
  if(z.isBoss){
    const _bm=DATA.maps.maps.find(m=>m.key===z.mapKey);
    if(_bm.boss_zone){
      // 首领区：未清剿完 minion_target 前只刷小怪，首领不现身
      if(!bossZoneCleared(_bm)){
        const _t=bossMinionTarget(_bm)||{normal:0, elite:0};
        const _pool=(_bm.boss_zone.monsters||[]).slice();
        const _el=(_bm.boss_zone.elite_monsters||[]).slice();
        const _needElite=minionKillCount(_bm.key,'elite')<_t.elite;
        if(_needElite && _el.length && Math.random()<0.25){ key=pick(_el); isElite=true; }
        else if(_pool.length){ key=pick(_pool); }
        else if(_el.length){ key=pick(_el); isElite=true; }
        else return null;
      }else{
        key=pick(_bm.boss_zone.boss); isBoss=true;
      }
    } else { const _db=(_bm.dungeon_bosses||[]).find(x=>x.key===z.bossKey); if(!_db) return null; key=_db.monster; isBoss=true; }
  }else{
    const map = DATA.maps.maps.find(m=>m.key===z.mapKey);
    const zone = map.zones.find(zz=>zz.key===z.zoneKey);
    const pool = (zone.monsters||[]).slice();
    if(zone.elite_monsters && zone.elite_monsters.length && Math.random()<0.08){
      key = pick(zone.elite_monsters); isElite=true;
    }else if(pool.length){
      key = pick(pool);
    }else if(zone.elite_monsters && zone.elite_monsters.length){
      key = pick(zone.elite_monsters); isElite=true;
    }
  }
  const base = getMonster(key);
  if(!base){ return null; }
  const m = Object.assign({}, base);
  m.isBoss=isBoss; m.isElite=isElite;
  if(isBoss){
    m.hp = Math.round((m.hp||0)*BOSS_HP_MULT);
    m.min_phys_atk  = Math.round((m.min_phys_atk||0)*BOSS_ATK_MULT);
    m.max_phys_atk  = Math.round((m.max_phys_atk||0)*BOSS_ATK_MULT);
    m.min_magic_atk = Math.round((m.min_magic_atk||0)*BOSS_ATK_MULT);
    m.max_magic_atk = Math.round((m.max_magic_atk||0)*BOSS_ATK_MULT);
  }
  m.curHp = m.hp;
  m.skills = MON_SKILLS[key] || [];
  m.skillCd = {};
  return m;
}

// ---------- 召唤兽 ----------
export function summonDef(key){ return (DATA.summons||{})[key] || null; }
export function summonAvailable(){
  if(!DATA.summons) return [];
  return Object.keys(DATA.summons).filter(k=>{
    const d=DATA.summons[k]; const lvs=Object.keys(d.levels||{}).map(Number);
    return lvs.length && state.player.level >= Math.min.apply(null, lvs);
  });
}
export function summonTier(key, playerLevel){
  const d=summonDef(key); if(!d) return null;
  const lvs=Object.keys(d.levels||{}).map(Number).sort((a,b)=>a-b);
  let t=lvs[0]; for(const l of lvs) if(l<=playerLevel) t=l;
  return {lv:t, data:d.levels[''+t]};
}
export function summonAttack(m){
  const p=state.player;
  const key=p.summon; const d=summonDef(key); if(!d) return null;
  const t=summonTier(key, p.level); if(!t) return null;
  const st=t.data;
  const sk = SUMMON_SKILLS[pick(d.skills||[])] || null;
  const pct = sk && sk.levels && sk.levels[0] ? (sk.levels[0].damage||60) : 60;
  const isMagic = d.type==='magic';
  const lo = isMagic? (st.min_magic||st.min_phys||1) : (st.min_phys||1);
  const hi = isMagic? (st.max_magic||st.max_phys||1) : (st.max_phys||1);
  const base = (lo+hi)/2 * (pct/100);
  const def = monsterDef(m, isMagic?'magic_def':'phys_def');
  const dodged = Math.random()*100 < (m.dodge||0);
  const dmg = dodged ? 0 : Math.max(1, Math.round(base*base/def));
  if(!dodged) m.curHp -= dmg;
  return {dmg, name: sk? sk.name : '扑击', dodged};
}

export function playerHit(m){
  const p = state.player, s = p._s;
  const ag = smAggCached();
  const atk = s.main + ((state.buff&&state.buff.atk)||0);
  const raw = atk * rnd(0.85,1.15);
  let def = monsterDef(m, s.defType);
  if(ag.ignoreDef) def = Math.round(def*(1-ag.ignoreDef/100));
  const dodged = Math.random()*100 < (m.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round((raw*raw/def)*titleDmgMult(m)));
  let crit = !dodged && Math.random() < (s.combat.phys_crit||0)/100;
  const critMult = 1.8 + (ag.critDmg||0)/100;
  if(crit) dmg = Math.round(dmg*critMult);
  if(!dodged) m.curHp -= dmg;
  state.pendingAppend = (state.pendingAppend||0) + (dodged?0:smAppendHit(m, def));
  return {dmg, crit, dodged};
}
export function monsterHit(m){
  const p = state.player, s = p._s;
  // 怪物技能：按 weight 抽取已就绪技能，元素决定攻防类型
  let sk=null;
  const list = m.skills || [];
  if(list.length){
    for(const k in (m.skillCd||{})) if(m.skillCd[k]>0) m.skillCd[k]--;
    const ready = list.filter(x=> !(m.skillCd[x.key]>0));
    if(ready.length && Math.random()<0.35 && !(m.silence>0)){
      const wmap={}; ready.forEach(x=> wmap[x.key]=(x.weight||1));
      const kk = weightedPick(ready.map(x=>x.key), wmap);
      sk = ready.find(x=>x.key===kk) || null;
    }
  }
  const magic = sk && (sk.element==='magic' || sk.element==='dark' || sk.element==='fire' || sk.element==='elec');
  const mult = sk? (sk.mult||1) : 1;
  const lo = magic? (m.min_magic_atk||m.min_phys_atk||1) : (m.min_phys_atk||1);
  const hi = magic? (m.max_magic_atk||m.max_phys_atk||1) : (m.max_phys_atk||1);
  const raw = ((lo+hi)/2) * mult;
  const def = (magic? (s.combat.magic_def||0) : (s.combat.phys_def||0)) + ((state.buff&&state.buff.phys_def)||0);
  // 原版伤害公式：max(1, round(atk²/def))；玩家完全闪避则 0 伤害（不触发分担/减伤/反弹）
  const dodged = Math.random()*100 < (s.combat.dodge||0);
  let dmg = dodged ? 0 : Math.max(1, Math.round(raw*raw/def));
  if(!dodged){
    // 出战召唤兽承担 30% 伤害
    if(p.summon && state.summonHp>0){
      const share = Math.round(dmg*0.3);
      state.summonHp -= share; dmg -= share;
      if(state.summonHp<=0){ state.summonHp=0; log('<span class="dmg">召唤兽 '+summonDef(p.summon).name+' 被击退！</span>'); }
    }
    // 神魔：减伤（变身 dmg_reduce / 格挡）
    const ag0 = smAggCached();
    const reduce = ((s.combat.dmg_reduce_pct||0) + (ag0.block||0));
    if(reduce) dmg = Math.max(1, Math.round(dmg*(1 - clamp(reduce,0,80)/100)));
    // 神魔：反弹（on_damage_taken reflect_pct）
    if(ag0.reflect>0 && m){ const rf=Math.max(1, Math.round(dmg*ag0.reflect/100)); m.curHp-=rf; state.pendingReflect=(state.pendingReflect||0)+rf; }
  }
  p.hp -= dmg;
  if(sk) m.skillCd[sk.key] = sk.cd||2;
  if(m.silence>0) m.silence--;
  return {dmg, skill:sk, dodged};
}

export function tick(){
  if(!state.idle || !state.player) return;
  state.ticks++;
  const p = state.player;
  tickSkillCd();
  autoPotion();                      // P0：低血/低蓝自动喝药（不足自动补给）
  // 法力自然回复（每回合 3% 上限），保证技能可持续循环
  if(p._s) p.mp = Math.min(p._s.max_mp, (p.mp||0) + Math.max(2, Math.round(p._s.max_mp*0.03)));
  // 称号地图 Buff：每 tick 按百分比回血/回蓝
  if(p._s && p.hp>0){
    const th=titleHeal();
    if(th.hp>0){ p.hp=Math.min(p._s.max_hp, p.hp+th.hp); }
    if(th.mp>0){ p.mp=Math.min(p._s.max_mp, p.mp+th.mp); }
  }
  // 仙之境：安全区被动修验（无战斗），按滞留 tick 结算后直接返回（避免进入下方战斗分支）
  if(isXianzhiNow()){ smXianzhiTick(); renderHeader(); return; }
  if(!state.combat){
    const m = spawnMonster();
    if(!m){ return; }
    state.combat = m;
    state.atbP = 0; state.atbM = 0;   // 速度条（ATB）累加器
    // 召唤兽出场：按角色等级取阶段属性
    if(p.summon){ const t=summonTier(p.summon, p.level); state.summonHp = t? (t.data.hp||0) : 0; }
    castBattleStartBuffs();   // 战斗开始先放增益/防御技能
    log((m.isBoss?'<span class="boss">【首领】':'<span class="sys">') + (m.isElite?'【精英】':'') + m.name + ' (Lv.'+m.level+') 出现了'+(m.isBoss?'</span>':'</span>'), m.isBoss?'boss':'sys');
  }
  const m = state.combat;
  // 速度条累加器（外部直接构造战斗时可能没有，兜底为 0）
  if(state.atbP==null) state.atbP=0;
  if(state.atbM==null) state.atbM=0;
  // 生命偏低时优先治疗（每 tick 一次，不占出手）
  if(p.hp < p._s.max_hp*0.6){
    const hs = pickHealSkill();
    if(hs){
      const r = castHeal(hs);
      log('施放 <span class="skill">'+hs.name+'</span>，回复 <span class="loot">'+fmtNum(r.heal)+'</span> 生命（HP '+fmtNum(Math.round(p.hp))+'/'+fmtNum(p._s.max_hp)+'）');
    }
  }
  // 速度条推进：双方按敏捷派生速度累加，跑满 100 各出手一次（原版战斗模型）
  state.atbP += p._s.combat.speed;
  state.atbM += (m.speed||4);
  let guard = 0;
  while((state.atbP>=100 || state.atbM>=100) && guard++<30){
    if(state.atbP>=100){ state.atbP-=100; playerTurn(m); if(m.curHp<=0){ onMonsterDead(m); return; } }
    if(state.atbM>=100){ state.atbM-=100; monsterTurn(m); if(p.hp<=0){ onPlayerDead(); return; } }
  }
  renderBattle();
}

// 玩家一次出手（技能/普攻 → 神魔追击 → 神魔主动 → 召唤兽）
export function playerTurn(m){
  const p = state.player;
  state.pendingAppend = 0;
  const sk = pickAttackSkill();
  if(sk){
    const lv = p.skills[sk.key]||1;
    paySkill(sk);
    const h = damageMonster(m, skillDamage(sk, lv));
    if(h.dodged) log(m.name+' 闪避了你的 <span class="skill">'+sk.name+'</span>');
    else log('施放 <span class="skill">'+sk.name+'</span>，对 '+m.name+' 造成 <span class="dmg">'+fmtNum(h.dmg)+'</span>'+(h.crit?' 暴击!':'')+' 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
    if(m.curHp<=0) return;
  }else{
    const h = playerHit(m);
    if(h.dodged) log(m.name+' 闪避了你的攻击');
    else log('你对 '+m.name+' 造成 <span class="dmg">'+fmtNum(h.dmg)+'</span>'+(h.crit?' 暴击!':'')+' 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
    if(m.curHp<=0) return;
  }
  if(state.pendingAppend>0){ log('<span class="skill">神魔追击</span> 追加 <span class="dmg">'+state.pendingAppend+'</span> 伤害'); state.pendingAppend=0; }
  // 神魔主动技能（变身/修验解锁后自动施放）
  if(p.shenmo && p.shenmo.faction){
    const sc = smActiveCast(m);
    if(sc){
      if(sc.kind==='attack') log('神魔技 <span class="skill">'+sc.name+'</span> 造成 <span class="dmg">'+fmtNum(sc.dmg)+'</span> 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
      else log('神魔技 <span class="skill">'+sc.name+'</span> 发动');
      if(m.curHp<=0) return;
    }
  }
  // 召唤兽出手（出战且存活）
  if(p.summon && state.summonHp>0){
    const sh = summonAttack(m);
    if(sh){
      if(sh.dodged) log('<span class="skill">'+summonDef(p.summon).name+'</span> 的 '+sh.name+' 被 '+m.name+' 闪避');
      else log('<span class="skill">'+summonDef(p.summon).name+'</span> 施放 '+sh.name+'，造成 <span class="dmg">'+fmtNum(sh.dmg)+'</span> 伤害（剩余'+fmtNum(Math.max(0,m.curHp))+'/'+fmtNum(m.hp)+'）');
      if(m.curHp<=0) return;
    }
  }
}

// 怪物一次出手（含技能/普攻，玩家可完全闪避）
export function monsterTurn(m){
  const p = state.player;
  state.pendingReflect = 0;
  const mh = monsterHit(m);
  if(mh.dodged) log('你闪避了 '+m.name+(mh.skill? ' 的 <span class="skill">'+mh.skill.name+'</span>':' 的反击')+'！');
  else log(m.name+(mh.skill? ' 施放 <span class="skill">'+mh.skill.name+'</span>':' 反击')+'，你受到 <span class="dmg">'+fmtNum(mh.dmg)+'</span> 伤害（HP '+fmtNum(Math.max(0,Math.round(p.hp)))+'/'+fmtNum(p._s.max_hp)+'）');
  if(state.pendingReflect>0){ log('<span class="skill">伤害反弹</span> 反弹 <span class="dmg">'+state.pendingReflect+'</span> 给 '+m.name); state.pendingReflect=0; }
}

export function onMonsterDead(m){
  const p = state.player;
  state.kills++;
  sessBump('kills', 1);
  const exp = monsterExp(m, p.level);
  sessBump('exp', exp);
  log('<span class="lv">击败 '+m.name+'，获得经验 '+fmtNum(exp)+'</span>');
  gainExp(exp);
  // 佩戴中的武魂吸经验（双槽各 50%）+ 神魔修验值
  wuhunAbsorb(exp);
  smGain(exp);
  const gold = ri(m.gold_min||0, m.gold_max||0);
  if(gold>0){ p.gold += gold; sessBump('gold', gold); log('获得金币 <span class="loot">'+fmtNum(gold)+'</span>'); }
  // 神秘结晶（商店兑换高阶装备用）：精英/首领掉落
  if(m.isElite){ p.crystal += 1; p.stats.crystalTotal=(p.stats.crystalTotal||0)+1; log('获得神秘结晶 <span class="loot">+1</span>'); }
  if(m.isBoss){ p.crystal += 5; p.stats.crystalTotal=(p.stats.crystalTotal||0)+5; log('获得神秘结晶 <span class="loot">+5</span>'); }
  // 副本护符：首领掉落本地图 NPC 兑换所需护符（1~2 个）
  if(m.isBoss){
    const grp = instGroup(state.zone? state.zone.mapKey : p.map);
    if(grp.length){
      const f = grp[0];
      if(Math.random()<0.4){        // 首领 40% 概率掉落副本护符
        const n = ri(1,2);
        addToBag({type:'consumable', key:f.cost_key, count:n});
        log('首领掉落 <span class="loot">'+itemName(f.cost_key)+' x'+fmtNum(n)+'</span>（'+instName(f.instance)+'兑换用）');
        eventLog('获得 <span class="loot">'+itemName(f.cost_key)+' x'+fmtNum(n)+'</span>');
      }
    }
    // 地图通关记录（成就·地图通关）
    // 野外图：击杀该图首领即通关；副本：需击杀全部 dungeon_bosses
    const mk = state.zone? state.zone.mapKey : p.map;
    const _zmap = mapByKey(mk);
    if(_zmap && dungeonBosses(_zmap).length){
      if(state.zone && state.zone.bossKey) noteDungeonBossKilled(_zmap, state.zone.bossKey, m.name);
    }else if(mk && (p.stats.mapClear||[]).indexOf(mk)<0){
      p.stats.mapClear.push(mk);
      const _rmap=mapByKey(mk);
      if(_rmap){ log('<span class="lv">★ 首次通关 '+_rmap.name+'！</span>首领已被击败，继续探索其他区域吧'); eventLog('<span class="lv">★ 通关 '+_rmap.name+'</span>'); }
    }
    // 首领掉落晶石（按角色等级档位）
    if(Math.random()<0.5){
      const ck = crystalForTier(Math.max(1, Math.ceil(p.level/20)));
      addCrystalStone(ck, 1);
      log('首领掉落 <span class="loot">'+crystalName(ck)+' x1</span>（精炼 +5 起消耗）');
    }
  }
  // 成就统计：总击杀 / 同类型猎杀 / 单图击杀
  p.stats.kills=(p.stats.kills||0)+1;
  {
    for(const a of achList()){
      if(a.metric==='kill_type' && a.kill_keyword && (m.name||'').indexOf(a.kill_keyword)>=0){
        p.stats.killType[a.kill_keyword]=(p.stats.killType[a.kill_keyword]||0)+1;
      }
    }
    const mk2 = state.zone? state.zone.mapKey : p.map;
    if(mk2) p.stats.mapKills[mk2]=(p.stats.mapKills[mk2]||0)+1;
  }
  // 称号/成就解锁检查（击杀类型计数已更新）
  checkTitles(); checkAchievements();
  // 区域探索进度（explore_target）/ 首领区清剿进度（minion_target）
  {
    const _emk = state.zone? state.zone.mapKey : p.map;
    if(state.zone && state.zone.isBoss){ if(!m.isBoss) noteMinionKill(_emk, m.isElite); }
    else if(state.zone && state.zone.zoneKey) noteZoneKill(_emk, state.zone.zoneKey);
  }
  if(m.isBoss) eventLog('<span class="boss">击败首领 '+m.name+'</span>，获得神秘结晶 +5');
  else if(m.isElite) eventLog('<span class="ev-elite">击败精英 '+m.name+'</span>，获得神秘结晶 +1');
  // 掉落
  const drops = rollLoot(m, p);
  let dropN=0;
  for(const d of drops){
    if(d.type!=='gold') dropN++;   // 只统计实物掉落（品质分布另计，见下）
    if(d.type==='equip'){
      addToBag(d.item);
      log('掉落装备 <span class="loot">['+QNAME[d.item.quality]+']'+d.item.name+'</span>');
      sessBump('drop', 1, d.item.quality);   // 品质分布只统计装备（消耗品/矿石/宝石无“品质”概念）
      // 蓝装以上才进本命日志
      if(['blue','purple','gold','red'].indexOf(d.item.quality)>=0)
        eventLog('获得 <span class="q-'+d.item.quality+'">['+QNAME[d.item.quality]+']'+d.item.name+'</span>');
      tryAutoEquip(d.item);
    }
    else if(d.type==='gold'){ /* 已加 */ }
    else if(d.type==='consumable'){ addToBag({uid:uid(),type:'consumable',key:d.key,count:d.count}); log('掉落道具 <span class="loot">'+itemName(d.key)+' x'+d.count+'</span>'); }
    else if(d.type==='gem'){ addToBag({type:'gem',series:d.series,grade:d.grade,count:d.count||1}); log('掉落宝石 <span class="loot">'+gemSeriesName(d.series)+'·'+d.grade+(d.count>1?' x'+d.count:'')+'</span>'); }
    else if(d.type==='wuhun'){
      const n = d.count||1;
      for(let i=0;i<n;i++){
        const o = genWuhun(d.stars||0);
        addToBag(o);
        log('掉落武魂 <span class="loot">'+whName(o)+'</span>');
        eventLog('获得武魂 <span class="loot">'+whName(o)+'</span>（佩戴需 Lv.'+whReqLevel(o.star)+'）');
      }
    }
  }
  if(dropN) sessBump('dropCount', dropN);
  // 任务进度
  questProgress(m);
  xyTrialOnKill();
  checkAchievements();
  state.combat = null;
  renderBattle();
  renderHeader(); renderTab();
}
// 死亡惩罚（轻罚）：损失「当前等级已积累经验」的 5%，不掉金币、无虚弱，避免挫败挂机节奏
export const DEATH_EXP_PENALTY = 0.05;
export function onPlayerDead(){
  const p = state.player;
  sessBump('deaths', 1);
  const lose = Math.floor((p.exp||0) * DEATH_EXP_PENALTY);
  if(lose>0) p.exp -= lose;
  log('<span class="dmg">你被击败了！</span>损失经验 <span class="dmg">'+fmtNum(lose)+'</span>，传送回安全区并恢复状态。');
  p.hp = p._s.max_hp; p.mp = p._s.max_mp;
  eventLog('<span class="dmg">被击败，损失经验 '+fmtNum(lose)+'，已传送回安全区</span>');
  // 回到当前地图安全区
  state.combat=null;
  renderAll();
}

export function gainExpCheck(){ checkAchievements(); }
export function gainExp(n){
  const p = state.player;
  p.exp += n;
  let leveled=false;
  while(p.exp >= expToNext(p.level)){
    p.exp -= expToNext(p.level);
    p.level++;
    leveled=true;
  }
  if(leveled){
    syncSkills();   // 升级可能学会新技能/被动
    refreshStats();
    p.hp = p._s.max_hp; p.mp = p._s.max_mp;
    log('<span class="lv">★ 升级！当前等级 '+p.level+'</span>');
    eventLog('<span class="lv">★ 升级至 Lv.'+p.level+'</span>');
    sessLevelUp(p.level);      // 升级时间线
    gainExpCheck();
    autoZoneOnLevelUp();
    if(state.auto.rank && pageVisible()) cloudRank();   // 仅页面可见时上排行（后台标签页跳过快照，2 分钟同步会补）
  }
}

